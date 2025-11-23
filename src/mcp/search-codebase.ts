/**
 * MCP Tool: search_codebase
 * Semantic code search with multi-project and reference repository support
 */
import { type Pool } from 'pg';

import { type DatabaseClient } from '@database/client';
import { searchCodebase as searchCodebaseFn } from '@retrieval/search';
import { formatSearchResult } from '@mcp/formatter';
import {
  validateArray,
  validateBoolean,
  validateEnum,
  validateImportDepth,
  validateMaxFiles,
  validateMaxSnippets,
  validateNumberInRange,
  validateQuery,
  validateRepoId,
  validateServiceId,
  validateThreshold,
  validateWorkspaceId,
} from '@mcp/validator';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';
import { type RepositoryType } from '@/types/database';
import { type SearchOptions, type SearchResult } from '@/types/retrieval';

/**
 * Input schema for search_codebase tool
 */
export interface SearchCodebaseInput {
  // Core parameters
  query: string;
  max_files?: number; // Default: 15, Range: 1-50
  max_snippets?: number; // Default: 25, Range: 1-100
  include_imports?: boolean; // Default: true
  import_depth?: number; // Default: 3, Range: 1-3
  dedup_threshold?: number; // Default: 0.92, Range: 0.0-1.0
  similarity_threshold?: number; // Default: 0.3, Range: 0.0-1.0 (file-level)
  chunk_similarity_threshold?: number; // Default: 0.2, Range: 0.0-1.0 (chunk-level)

  // Multi-project filtering
  workspace_filter?: string | string[];
  package_filter?: string | string[];
  exclude_workspaces?: string[];
  service_filter?: string | string[];
  service_type_filter?: string[];
  exclude_services?: string[];
  repo_filter?: string | string[];
  exclude_repos?: string[];
  cross_repo?: boolean; // Default: false
  exclude_repo_types?: string[];

  // Workspace/Service scope configuration
  workspace_scope?: {
    mode: 'strict' | 'inclusive' | 'unrestricted';
    max_depth?: number;
  };
  service_scope?: {
    mode: 'strict' | 'inclusive' | 'unrestricted';
    max_depth?: number;
  };
}

/**
 * Output schema for search_codebase tool
 */
export interface SearchCodebaseOutput {
  formatted_result: string; // Markdown-formatted search result
  raw_result: SearchResult; // Raw result for programmatic access
}

/**
 * Validate and normalize workspace_filter parameter
 *
 * Converts single string or array values to validated string array.
 * Ensures all workspace IDs pass validation before use in database queries.
 *
 * @param value - Input value (string, array, or undefined)
 * @returns Validated array of workspace IDs, or undefined
 * @throws {Error} If any workspace ID fails validation
 */
const normalizeWorkspaceFilter = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  // Single workspace ID provided as string
  if (typeof value === 'string') {
    const validated = validateWorkspaceId(value, true);
    if (!validated) throw new Error('workspace_filter validation failed');
    return [validated];
  }

  // Multiple workspace IDs provided as array
  const arr = validateArray('workspace_filter', value, false) as string[] | undefined;
  if (arr) {
    // Validate each workspace ID individually
    return arr.map((id) => {
      const validated = validateWorkspaceId(id, true);
      if (!validated) throw new Error('workspace_filter item validation failed');
      return validated;
    });
  }

  return undefined;
};

/**
 * Validate and normalize service_filter parameter
 *
 * Converts single string or array values to validated string array.
 * Ensures all service IDs pass validation before use in database queries.
 *
 * @param value - Input value (string, array, or undefined)
 * @returns Validated array of service IDs, or undefined
 * @throws {Error} If any service ID fails validation
 */
const normalizeServiceFilter = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const validated = validateServiceId(value, true);
    if (!validated) throw new Error('service_filter validation failed');
    return [validated];
  }

  const arr = validateArray('service_filter', value, false) as string[] | undefined;
  if (arr) {
    // Validate each service ID
    return arr.map((id) => {
      const validated = validateServiceId(id, true);
      if (!validated) throw new Error('service_filter item validation failed');
      return validated;
    });
  }

  return undefined;
};

/**
 * Validate and normalize repo_filter parameter
 *
 * Converts single string or array values to validated string array.
 * Ensures all repository IDs pass validation before use in database queries.
 *
 * @param value - Input value (string, array, or undefined)
 * @returns Validated array of repository IDs, or undefined
 * @throws {Error} If any repository ID fails validation
 */
const normalizeRepoFilter = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const validated = validateRepoId(value, true);
    if (!validated) throw new Error('repo_filter validation failed');
    return [validated];
  }

  const arr = validateArray('repo_filter', value, false) as string[] | undefined;
  if (arr) {
    // Validate each repo ID
    return arr.map((id) => {
      const validated = validateRepoId(id, true);
      if (!validated) throw new Error('repo_filter item validation failed');
      return validated;
    });
  }

  return undefined;
};

/**
 * Search codebase MCP tool implementation
 *
 * Performs semantic code search using the 7-stage retrieval pipeline: query processing,
 * file-level retrieval, chunk-level retrieval, symbol resolution, import chain expansion,
 * API contract enrichment, and deduplication. Supports multi-project filtering by workspace,
 * service, and repository with optional reference/documentation inclusion.
 *
 * @param db - Database connection pool
 * @param config - cindex configuration with embedding and summary settings
 * @param ollama - Ollama client for embedding generation
 * @param input - Search parameters with filters, scope, and retrieval options
 * @returns Formatted search result with context, metadata, and warnings
 * @throws {Error} If query validation fails or database connection fails
 */
export const searchCodebaseTool = async (
  db: Pool,
  config: CindexConfig,
  ollama: OllamaClient,
  input: SearchCodebaseInput
): Promise<SearchCodebaseOutput> => {
  logger.info('search_codebase tool invoked', { query: input.query });

  // Validate required parameters
  const query = validateQuery(input.query, true);
  if (!query) throw new Error('query validation failed');

  // Validate optional parameters with defaults
  const maxFiles = validateMaxFiles(input.max_files, false);
  const maxSnippets = validateMaxSnippets(input.max_snippets, false);
  const includeImports = validateBoolean('include_imports', input.include_imports, false);
  const importDepth = validateImportDepth(input.import_depth, false);
  const dedupThreshold = validateThreshold('dedup_threshold', input.dedup_threshold, false);
  const similarityThreshold = validateThreshold('similarity_threshold', input.similarity_threshold, false);
  const chunkSimilarityThreshold = validateThreshold(
    'chunk_similarity_threshold',
    input.chunk_similarity_threshold,
    false
  );

  // Validate multi-project filters with normalization
  const workspaceFilter = normalizeWorkspaceFilter(input.workspace_filter);
  const packageFilter = validateArray('package_filter', input.package_filter, false) as string[] | undefined;
  const excludeWorkspaces = validateArray('exclude_workspaces', input.exclude_workspaces, false) as
    | string[]
    | undefined;
  const serviceFilter = normalizeServiceFilter(input.service_filter);
  const serviceTypeFilter = validateArray('service_type_filter', input.service_type_filter, false) as
    | string[]
    | undefined;
  const excludeServices = validateArray('exclude_services', input.exclude_services, false) as string[] | undefined;
  const repoFilter = normalizeRepoFilter(input.repo_filter);
  const excludeRepos = validateArray('exclude_repos', input.exclude_repos, false) as string[] | undefined;
  const crossRepo = validateBoolean('cross_repo', input.cross_repo, false);
  const excludeRepoTypes = validateArray('exclude_repo_types', input.exclude_repo_types, false) as string[] | undefined;

  // Validate workspace/service scope configuration
  // Scope modes: strict (same workspace/service only), inclusive (direct dependencies),
  // unrestricted (all workspaces/services). Max depth controls dependency traversal.
  let workspaceScope: SearchOptions['workspace_scope'];
  if (input.workspace_scope) {
    const mode = validateEnum(
      'workspace_scope.mode',
      input.workspace_scope.mode,
      ['strict', 'inclusive', 'unrestricted'] as const,
      true
    );
    if (!mode) throw new Error('workspace_scope.mode validation failed');
    const maxDepth = validateNumberInRange('workspace_scope.max_depth', input.workspace_scope.max_depth, 1, 5, false);
    workspaceScope = { mode, max_depth: maxDepth };
  }

  let serviceScope: SearchOptions['service_scope'];
  if (input.service_scope) {
    const mode = validateEnum(
      'service_scope.mode',
      input.service_scope.mode,
      ['strict', 'inclusive', 'unrestricted'] as const,
      true
    );
    if (!mode) throw new Error('service_scope.mode validation failed');
    const maxDepth = validateNumberInRange('service_scope.max_depth', input.service_scope.max_depth, 1, 5, false);
    serviceScope = { mode, max_depth: maxDepth };
  }

  // Build SearchOptions
  const searchOptions: SearchOptions = {
    // Core options
    max_files: maxFiles,
    max_snippets: maxSnippets,
    include_imports: includeImports,
    import_depth: importDepth,
    dedup_threshold: dedupThreshold,
    similarity_threshold: similarityThreshold,
    chunk_similarity_threshold: chunkSimilarityThreshold,

    // Multi-project filtering
    workspace_filter: workspaceFilter,
    package_filter: packageFilter,
    service_filter: serviceFilter,
    service_type_filter: serviceTypeFilter,
    repo_filter: repoFilter,
    exclude_workspaces: excludeWorkspaces,
    exclude_services: excludeServices,
    exclude_repos: excludeRepos,
    cross_repo: crossRepo,
    exclude_repo_types: excludeRepoTypes as RepositoryType[],

    // Workspace/Service scope
    workspace_depth: workspaceScope?.max_depth,
    service_depth: serviceScope?.max_depth,
    strict_workspace_scope: workspaceScope?.mode === 'strict',
    strict_service_scope: serviceScope?.mode === 'strict',
  };

  logger.debug('Executing codebase search', { options: searchOptions });

  // Execute search through 7-stage retrieval pipeline
  // Note: DatabaseClient expects a full class instance, but we only need the query method.
  // We create a minimal wrapper that provides the query interface for compatibility.
  const dbClient = { query: db.query.bind(db) } as unknown as DatabaseClient;
  const result = await searchCodebaseFn(query, config, dbClient, ollama, searchOptions);

  logger.info('search_codebase completed', {
    query,
    total_tokens: result.metadata.total_tokens,
    files_retrieved: result.metadata.files_retrieved,
    chunks_retrieved: result.metadata.chunks_retrieved,
    query_time_ms: result.metadata.query_time_ms,
  });

  // Format result as Markdown
  const formattedResult = formatSearchResult(result);

  return {
    formatted_result: formattedResult,
    raw_result: result,
  };
};
