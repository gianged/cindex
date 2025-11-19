/**
 * Context Assembly (Stage 7 of retrieval pipeline)
 *
 * Aggregates results from all stages into a structured SearchResult.
 * Counts tokens, generates warnings, and assembles final context for LLM consumption.
 */

import { type DatabaseClient } from '@database/client';
import { logger } from '@utils/logger';
import { type CindexConfig } from '@/types/config';
import { type RepositoryMetadata, type RepositoryType } from '@/types/database';
import {
  type APIContext,
  type DeduplicationResult,
  type ImportChain,
  type QueryEmbedding,
  type RelevantChunk,
  type RelevantFile,
  type RepositorySearchMetadata,
  type ResolvedSymbol,
  type SearchContext,
  type SearchContextGroup,
  type SearchMetadata,
  type SearchResult,
  type SearchWarning,
} from '@/types/retrieval';

/**
 * Token estimation constants
 */
const TOKENS_PER_SYMBOL = 50; // Estimated tokens per symbol definition
const TOKENS_PER_IMPORT = 30; // Estimated tokens per import chain entry

/**
 * Repository metadata query result
 */
interface RepositoryMetadataRow {
  repo_id: string;
  repo_type: RepositoryType;
  metadata: RepositoryMetadata | null;
}

/**
 * Fetch repository metadata for repos found in search results
 *
 * @param db - Database client
 * @param repoIds - Repository IDs to fetch metadata for
 * @returns Map of repo_id → { repo_type, metadata }
 */
const fetchRepositoryMetadata = async (
  db: DatabaseClient,
  repoIds: Set<string>
): Promise<Map<string, { repo_type: RepositoryType; metadata: RepositoryMetadata | null }>> => {
  if (repoIds.size === 0) {
    return new Map();
  }

  const repoIdArray = Array.from(repoIds);

  const query = `
    SELECT repo_id, repo_type, metadata
    FROM repositories
    WHERE repo_id = ANY($1::text[])
  `;

  try {
    const result = await db.query<RepositoryMetadataRow>(query, [repoIdArray]);

    const metadataMap = new Map<string, { repo_type: RepositoryType; metadata: RepositoryMetadata | null }>();

    for (const row of result.rows) {
      metadataMap.set(row.repo_id, {
        repo_type: row.repo_type,
        metadata: row.metadata,
      });
    }

    return metadataMap;
  } catch (error) {
    logger.warn('Failed to fetch repository metadata', {
      error: error instanceof Error ? error.message : String(error),
      repoIds: repoIdArray,
    });

    return new Map();
  }
};

/**
 * Group search results by workspace
 *
 * @param files - Relevant files
 * @param chunks - Relevant chunks
 * @param symbols - Resolved symbols
 * @param imports - Import chains
 * @returns Grouped results by workspace ID
 */
const groupByWorkspace = (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  symbols: ResolvedSymbol[],
  imports: ImportChain[]
): Record<string, SearchContextGroup> => {
  const groups: Record<string, SearchContextGroup> = {};

  // Collect workspace IDs
  const workspaceIds = new Set<string>();
  for (const file of files) {
    if (file.workspace_id) workspaceIds.add(file.workspace_id);
  }
  for (const chunk of chunks) {
    if (chunk.workspace_id) workspaceIds.add(chunk.workspace_id);
  }

  // Initialize groups
  for (const workspaceId of workspaceIds) {
    groups[workspaceId] = {
      id: workspaceId,
      name: workspaceId, // Could be enhanced with workspace name from DB
      files: [],
      chunks: [],
      symbols: [],
      imports: [],
    };
  }

  // Group files
  for (const file of files) {
    if (file.workspace_id) {
      groups[file.workspace_id].files.push(file);
    }
  }

  // Group chunks
  for (const chunk of chunks) {
    if (chunk.workspace_id) {
      groups[chunk.workspace_id].chunks.push(chunk);
    }
  }

  // Group symbols
  for (const symbol of symbols) {
    if (symbol.workspace_id) {
      groups[symbol.workspace_id].symbols.push(symbol);
    }
  }

  // Group imports
  for (const importChain of imports) {
    if (importChain.workspace_id) {
      groups[importChain.workspace_id].imports.push(importChain);
    }
  }

  return groups;
};

/**
 * Group search results by service
 *
 * @param files - Relevant files
 * @param chunks - Relevant chunks
 * @param symbols - Resolved symbols
 * @param imports - Import chains
 * @returns Grouped results by service ID
 */
const groupByService = (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  symbols: ResolvedSymbol[],
  imports: ImportChain[]
): Record<string, SearchContextGroup> => {
  const groups: Record<string, SearchContextGroup> = {};

  // Collect service IDs
  const serviceIds = new Set<string>();
  for (const file of files) {
    if (file.service_id) serviceIds.add(file.service_id);
  }
  for (const chunk of chunks) {
    if (chunk.service_id) serviceIds.add(chunk.service_id);
  }

  // Initialize groups
  for (const serviceId of serviceIds) {
    groups[serviceId] = {
      id: serviceId,
      name: serviceId, // Could be enhanced with service name from DB
      files: [],
      chunks: [],
      symbols: [],
      imports: [],
    };
  }

  // Group files
  for (const file of files) {
    if (file.service_id) {
      groups[file.service_id].files.push(file);
    }
  }

  // Group chunks
  for (const chunk of chunks) {
    if (chunk.service_id) {
      groups[chunk.service_id].chunks.push(chunk);
    }
  }

  // Group symbols
  for (const symbol of symbols) {
    if (symbol.service_id) {
      groups[symbol.service_id].symbols.push(symbol);
    }
  }

  // Group imports
  for (const importChain of imports) {
    if (importChain.service_id) {
      groups[importChain.service_id].imports.push(importChain);
    }
  }

  return groups;
};

/**
 * Group search results by repository (for multi-repo context)
 *
 * @param files - Relevant files
 * @param chunks - Relevant chunks
 * @param symbols - Resolved symbols
 * @param imports - Import chains
 * @param repoMetadata - Repository metadata map
 * @returns Grouped results by repo ID
 */
const groupByRepo = (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  symbols: ResolvedSymbol[],
  imports: ImportChain[],
  _repoMetadata: Map<string, { repo_type: RepositoryType; metadata: RepositoryMetadata | null }>
): Record<string, SearchContextGroup> => {
  const groups: Record<string, SearchContextGroup> = {};

  // Initialize groups
  const repoIds = new Set<string>();
  for (const file of files) {
    if (file.repo_id) repoIds.add(file.repo_id);
  }
  for (const chunk of chunks) {
    if (chunk.repo_id) repoIds.add(chunk.repo_id);
  }

  for (const repoId of repoIds) {
    groups[repoId] = {
      id: repoId,
      name: repoId,
      files: [],
      chunks: [],
      symbols: [],
      imports: [],
    };
  }

  // Group files
  for (const file of files) {
    if (file.repo_id) {
      groups[file.repo_id].files.push(file);
    }
  }

  // Group chunks
  for (const chunk of chunks) {
    if (chunk.repo_id) {
      groups[chunk.repo_id].chunks.push(chunk);
    }
  }

  // Group symbols
  for (const symbol of symbols) {
    if (symbol.service_id) {
      // Find repo for this service (simplified - assumes service_id matches repo_id)
      // In production, would need to query services table
      for (const repoId of repoIds) {
        groups[repoId].symbols.push(symbol);
        break;
      }
    }
  }

  // Group imports
  for (const importChain of imports) {
    if (importChain.workspace_id) {
      // Find repo for this workspace (simplified)
      for (const repoId of repoIds) {
        groups[repoId].imports.push(importChain);
        break;
      }
    }
  }

  return groups;
};

/**
 * Count total tokens in assembled context
 *
 * Token breakdown:
 * - Chunks: sum of chunk.token_count (pre-calculated)
 * - Symbols: ~50 tokens per symbol definition
 * - Imports: ~30 tokens per import chain entry
 *
 * @param chunks - Deduplicated chunks
 * @param symbols - Resolved symbols
 * @param imports - Import chain entries
 * @returns Total token count
 */
const countTotalTokens = (chunks: RelevantChunk[], symbols: ResolvedSymbol[], imports: ImportChain[]): number => {
  // Chunk tokens (pre-calculated during indexing)
  const chunkTokens = chunks.reduce((sum, chunk) => sum + chunk.token_count, 0);

  // Symbol tokens (estimated)
  const symbolTokens = symbols.length * TOKENS_PER_SYMBOL;

  // Import tokens (estimated)
  const importTokens = imports.length * TOKENS_PER_IMPORT;

  return chunkTokens + symbolTokens + importTokens;
};

/**
 * Generate boundary crossing warnings for multi-project searches
 *
 * Warns when workspace or service boundaries are crossed unexpectedly.
 *
 * @param imports - Import chains
 * @returns Array of boundary warnings
 */
const generateBoundaryWarnings = (imports: ImportChain[]): SearchWarning[] => {
  const warnings: SearchWarning[] = [];

  // Check for cross-workspace imports
  const crossWorkspaceImports = imports.filter((imp) => imp.cross_workspace);
  if (crossWorkspaceImports.length > 0) {
    warnings.push({
      type: 'boundary_crossed',
      severity: 'info',
      message: `Found ${String(crossWorkspaceImports.length)} cross-workspace import(s)`,
      suggestion: 'Dependencies cross workspace boundaries - this may indicate tight coupling',
    });
  }

  // Check for cross-service imports
  const crossServiceImports = imports.filter((imp) => imp.cross_service);
  if (crossServiceImports.length > 0) {
    warnings.push({
      type: 'boundary_crossed',
      severity: 'warning',
      message: `Found ${String(crossServiceImports.length)} cross-service import(s)`,
      suggestion: 'Code dependencies cross service boundaries - consider using API contracts instead',
    });
  }

  return warnings;
};

/**
 * Generate reference repository warnings
 *
 * Warns about outdated reference repositories and similar code in references vs main code.
 *
 * @param repoMetadata - Repository metadata map
 * @returns Array of reference warnings
 */
const generateReferenceWarnings = (
  repoMetadata: Map<string, { repo_type: RepositoryType; metadata: RepositoryMetadata | null }>
): SearchWarning[] => {
  const warnings: SearchWarning[] = [];

  // Check for reference repos in results
  const referenceRepos: string[] = [];
  const outdatedRepos: string[] = [];

  for (const [repoId, repoInfo] of repoMetadata.entries()) {
    const { repo_type: repoType, metadata } = repoInfo;

    if (repoType === 'reference') {
      referenceRepos.push(repoId);

      // Check if reference repo is outdated (> 3 months since last index)
      if (metadata?.last_indexed) {
        const lastIndexed = new Date(metadata.last_indexed);
        const monthsOld = (Date.now() - lastIndexed.getTime()) / (1000 * 60 * 60 * 24 * 30);

        if (monthsOld > 3) {
          outdatedRepos.push(repoId);
        }
      }
    }
  }

  // Warn about reference repos in results (info level)
  if (referenceRepos.length > 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'info',
      message: `Results include ${String(referenceRepos.length)} reference repository/repositories`,
      suggestion: `Reference repos: ${referenceRepos.join(', ')}. These are external frameworks for learning.`,
    });
  }

  // Warn about outdated reference repos
  if (outdatedRepos.length > 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'warning',
      message: `${String(outdatedRepos.length)} reference repository/repositories may be outdated (>3 months old)`,
      suggestion: `Consider re-indexing: ${outdatedRepos.join(', ')}`,
    });
  }

  return warnings;
};

/**
 * Build detailed repository metadata for search results
 *
 * Constructs per-repository metadata including chunk/file counts, version info,
 * and categorization into reference/documentation repos.
 *
 * @param files - Retrieved files
 * @param chunks - Retrieved chunks
 * @param repoMetadata - Repository metadata map
 * @returns Repository metadata arrays
 */
const buildRepositoryMetadata = (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  repoMetadata: Map<string, { repo_type: RepositoryType; metadata: RepositoryMetadata | null }>
): {
  reposSearched: RepositorySearchMetadata[];
  referenceReposIncluded: string[];
  documentationReposIncluded: string[];
} => {
  const reposSearched: RepositorySearchMetadata[] = [];
  const referenceReposIncluded: string[] = [];
  const documentationReposIncluded: string[] = [];

  // Count chunks and files per repository
  const repoChunkCounts = new Map<string, number>();
  const repoFileCounts = new Map<string, number>();

  for (const chunk of chunks) {
    if (chunk.repo_id) {
      repoChunkCounts.set(chunk.repo_id, (repoChunkCounts.get(chunk.repo_id) ?? 0) + 1);
    }
  }

  for (const file of files) {
    if (file.repo_id) {
      repoFileCounts.set(file.repo_id, (repoFileCounts.get(file.repo_id) ?? 0) + 1);
    }
  }

  // Build detailed metadata for each repository
  for (const [repoId, repoInfo] of repoMetadata.entries()) {
    const { repo_type: repoType, metadata } = repoInfo;
    const chunkCount = repoChunkCounts.get(repoId) ?? 0;
    const fileCount = repoFileCounts.get(repoId) ?? 0;

    // Only include repos that contributed results
    if (chunkCount === 0 && fileCount === 0) {
      continue;
    }

    const repoMetadataEntry: RepositorySearchMetadata = {
      repo_id: repoId,
      repo_type: repoType,
      chunk_count: chunkCount,
      file_count: fileCount,
    };

    // Add version info for reference repos
    if (repoType === 'reference' && metadata) {
      if (metadata.version) {
        repoMetadataEntry.version = metadata.version;
      }
      if (metadata.upstream_url) {
        repoMetadataEntry.upstream_url = metadata.upstream_url;
      }
      if (metadata.last_indexed) {
        repoMetadataEntry.last_indexed = metadata.last_indexed;
      }

      referenceReposIncluded.push(repoId);
    }

    // Track documentation repos
    if (repoType === 'documentation') {
      documentationReposIncluded.push(repoId);
    }

    reposSearched.push(repoMetadataEntry);
  }

  return { reposSearched, referenceReposIncluded, documentationReposIncluded };
};

/**
 * Generate warnings based on context size and retrieval issues
 *
 * Warnings:
 * - context_size: Total tokens exceed warn_context_tokens (default: 100k)
 * - partial_results: Some stages returned fewer results than expected
 *
 * @param totalTokens - Total token count
 * @param config - cindex configuration
 * @param metadata - Search metadata
 * @returns Array of warnings
 */
const generateWarnings = (totalTokens: number, config: CindexConfig, metadata: SearchMetadata): SearchWarning[] => {
  const warnings: SearchWarning[] = [];

  // Context size warning
  if (totalTokens > config.performance.warn_context_tokens) {
    warnings.push({
      type: 'context_size',
      severity: 'warning',
      message: `Context size: ${totalTokens.toLocaleString()} tokens (exceeds ${config.performance.warn_context_tokens.toLocaleString()})`,
      suggestion: 'Consider narrowing query or reducing max_snippets parameter',
    });
  }

  // Partial results warning (if no files retrieved)
  if (metadata.files_retrieved === 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'warning',
      message: 'No relevant files found matching query',
      suggestion: 'Try broadening your query or lowering similarity_threshold',
    });
  }

  // Partial results warning (if no chunks after file retrieval)
  if (metadata.files_retrieved > 0 && metadata.chunks_retrieved === 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'info',
      message: 'Files found but no matching code chunks',
      suggestion: 'Query matches file summaries but not specific code blocks',
    });
  }

  return warnings;
};

/**
 * Assemble complete search result from all stages
 *
 * Aggregates:
 * - Stage 1: Relevant files
 * - Stage 2: Code chunks (after deduplication)
 * - Stage 3: Resolved symbols
 * - Stage 4: Import chains
 * - Stage 5: API contracts (multi-project)
 * - Stage 6: Deduplication statistics
 *
 * Generates:
 * - Token count and warnings
 * - Search metadata (counts, timing)
 * - Structured context for LLM
 * - Repository metadata and grouping (multi-project)
 *
 * @param queryEmbedding - Query embedding from Stage 1
 * @param relevantFiles - Files from Stage 1
 * @param dedupResult - Deduplication result from Stage 7
 * @param resolvedSymbols - Symbols from Stage 3
 * @param importChains - Import chains from Stage 4
 * @param apiContext - API contracts from Stage 6 (multi-project)
 * @param config - cindex configuration
 * @param db - Database client (for fetching repository metadata)
 * @param totalQueryTime - Total query execution time in milliseconds
 * @returns Complete search result
 */
export const assembleContext = async (
  queryEmbedding: QueryEmbedding,
  relevantFiles: RelevantFile[],
  dedupResult: DeduplicationResult,
  resolvedSymbols: ResolvedSymbol[],
  importChains: ImportChain[],
  apiContext: APIContext,
  config: CindexConfig,
  db: DatabaseClient,
  totalQueryTime: number
): Promise<SearchResult> => {
  const startTime = Date.now();

  logger.debug('Assembling search context', {
    files: relevantFiles.length,
    chunks: dedupResult.unique_chunks.length,
    symbols: resolvedSymbols.length,
    imports: importChains.length,
    apiEndpoints: apiContext.endpoints.length,
  });

  // Fetch repository metadata for multi-project results
  const repoIds = new Set<string>();
  for (const file of relevantFiles) {
    if (file.repo_id) repoIds.add(file.repo_id);
  }
  for (const chunk of dedupResult.unique_chunks) {
    if (chunk.repo_id) repoIds.add(chunk.repo_id);
  }

  const repoMetadata = await fetchRepositoryMetadata(db, repoIds);

  // Group results by workspace, service, and repo (if multi-project)
  const groupedByWorkspace =
    relevantFiles.some((f) => f.workspace_id) || dedupResult.unique_chunks.some((c) => c.workspace_id)
      ? groupByWorkspace(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains)
      : undefined;

  const groupedByService =
    relevantFiles.some((f) => f.service_id) || dedupResult.unique_chunks.some((c) => c.service_id)
      ? groupByService(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains)
      : undefined;

  const groupedByRepo =
    repoIds.size > 0
      ? groupByRepo(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains, repoMetadata)
      : undefined;

  // Count total tokens
  const totalTokens = countTotalTokens(dedupResult.unique_chunks, resolvedSymbols, importChains);

  // Build detailed repository metadata
  const { reposSearched, referenceReposIncluded, documentationReposIncluded } = buildRepositoryMetadata(
    relevantFiles,
    dedupResult.unique_chunks,
    repoMetadata
  );

  // Count workspaces and services
  const workspaceIds = new Set<string>();
  const serviceIds = new Set<string>();

  for (const file of relevantFiles) {
    if (file.workspace_id) workspaceIds.add(file.workspace_id);
    if (file.service_id) serviceIds.add(file.service_id);
  }

  for (const chunk of dedupResult.unique_chunks) {
    if (chunk.workspace_id) workspaceIds.add(chunk.workspace_id);
    if (chunk.service_id) serviceIds.add(chunk.service_id);
  }

  // Build metadata
  const metadata: SearchMetadata = {
    total_tokens: totalTokens,
    files_retrieved: relevantFiles.length,
    chunks_retrieved: dedupResult.unique_chunks.length + dedupResult.duplicates_removed,
    chunks_after_dedup: dedupResult.unique_chunks.length,
    chunks_deduplicated: dedupResult.duplicates_removed,
    symbols_resolved: resolvedSymbols.length,
    import_depth_reached: Math.max(...importChains.map((ic) => ic.depth), 0),
    query_time_ms: totalQueryTime,
    api_endpoints_found: apiContext.endpoints.length,
    workspaces_searched: workspaceIds.size > 0 ? workspaceIds.size : undefined,
    services_searched: serviceIds.size > 0 ? serviceIds.size : undefined,
    repos_searched: reposSearched.length > 0 ? reposSearched : undefined,
    reference_repos_included: referenceReposIncluded.length > 0 ? referenceReposIncluded : undefined,
    documentation_repos_included: documentationReposIncluded.length > 0 ? documentationReposIncluded : undefined,
  };

  // Generate warnings (merge all warning sources)
  const baseWarnings = generateWarnings(totalTokens, config, metadata);
  const boundaryWarnings = generateBoundaryWarnings(importChains);
  const referenceWarnings = generateReferenceWarnings(repoMetadata);
  const warnings = [...baseWarnings, ...boundaryWarnings, ...referenceWarnings, ...apiContext.api_warnings];

  // Build context
  const context: SearchContext = {
    relevant_files: relevantFiles,
    code_locations: dedupResult.unique_chunks,
    symbols: resolvedSymbols,
    imports: importChains,
    api_context: apiContext.endpoints.length > 0 ? apiContext : undefined,
    by_workspace: groupedByWorkspace,
    by_service: groupedByService,
    by_repo: groupedByRepo,
  };

  // Assemble final result
  const result: SearchResult = {
    query: queryEmbedding.query_text,
    query_type: queryEmbedding.query_type,
    warnings,
    metadata,
    context,
  };

  const assemblyTime = Date.now() - startTime;

  logger.info('Context assembly complete', {
    totalTokens: totalTokens.toLocaleString(),
    warnings: warnings.length,
    assemblyTime,
    queryTimeTotal: totalQueryTime,
  });

  // Log warnings
  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(`Search warning: ${warning.type}`, {
        severity: warning.severity,
        message: warning.message,
        suggestion: warning.suggestion,
      });
    }
  }

  return result;
};

/**
 * Assemble context with multi-project grouping (enhanced version for Phase B)
 *
 * Assembles search results with explicit grouping control based on options.
 * Unlike base assembleContext which auto-detects groupings, this version
 * respects explicit grouping preferences from the caller.
 *
 * Grouping control:
 * - group_by_workspace: Group results by workspace_id (monorepo packages)
 * - group_by_service: Group results by service_id (microservices)
 * - group_by_repo: Group results by repo_id (multi-repository projects)
 *
 * If all options are false, returns ungrouped results (flat structure).
 * If multiple options are true, creates all requested groupings.
 *
 * @param queryEmbedding - Query embedding
 * @param relevantFiles - Files from Stage 1
 * @param dedupResult - Deduplication result
 * @param resolvedSymbols - Symbols from Stage 3
 * @param importChains - Import chains from Stage 4
 * @param apiContext - API context from Stage 5
 * @param config - cindex configuration
 * @param db - Database client
 * @param totalQueryTime - Total query time
 * @param groupingOptions - Multi-project grouping options
 * @returns Search result with workspace/service/repo grouping
 */
export const assembleContextGrouped = async (
  queryEmbedding: QueryEmbedding,
  relevantFiles: RelevantFile[],
  dedupResult: DeduplicationResult,
  resolvedSymbols: ResolvedSymbol[],
  importChains: ImportChain[],
  apiContext: APIContext,
  config: CindexConfig,
  db: DatabaseClient,
  totalQueryTime: number,
  groupingOptions: {
    group_by_workspace?: boolean;
    group_by_service?: boolean;
    group_by_repo?: boolean;
  }
): Promise<SearchResult> => {
  const startTime = Date.now();

  logger.debug('Assembling context with explicit grouping', { groupingOptions });

  // Fetch repository metadata for multi-project results
  const repoIds = new Set<string>();
  for (const file of relevantFiles) {
    if (file.repo_id) repoIds.add(file.repo_id);
  }
  for (const chunk of dedupResult.unique_chunks) {
    if (chunk.repo_id) repoIds.add(chunk.repo_id);
  }

  const repoMetadata = await fetchRepositoryMetadata(db, repoIds);

  // Apply grouping based on options (explicit control)
  const groupByWorkspaceOption = groupingOptions.group_by_workspace ?? false;
  const groupByServiceOption = groupingOptions.group_by_service ?? false;
  const groupByRepoOption = groupingOptions.group_by_repo ?? false;

  let groupedByWorkspace: Record<string, SearchContextGroup> | undefined;
  let groupedByService: Record<string, SearchContextGroup> | undefined;
  let groupedByRepo: Record<string, SearchContextGroup> | undefined;

  // Group by workspace if requested
  if (groupByWorkspaceOption) {
    groupedByWorkspace = groupByWorkspace(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains);
    logger.debug('Grouped by workspace', { workspaceCount: Object.keys(groupedByWorkspace).length });
  }

  // Group by service if requested
  if (groupByServiceOption) {
    groupedByService = groupByService(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains);
    logger.debug('Grouped by service', { serviceCount: Object.keys(groupedByService).length });
  }

  // Group by repo if requested
  if (groupByRepoOption) {
    groupedByRepo = groupByRepo(relevantFiles, dedupResult.unique_chunks, resolvedSymbols, importChains, repoMetadata);
    logger.debug('Grouped by repo', { repoCount: Object.keys(groupedByRepo).length });
  }

  // Count total tokens
  const totalTokens = countTotalTokens(dedupResult.unique_chunks, resolvedSymbols, importChains);

  // Build detailed repository metadata
  const { reposSearched, referenceReposIncluded, documentationReposIncluded } = buildRepositoryMetadata(
    relevantFiles,
    dedupResult.unique_chunks,
    repoMetadata
  );

  // Count workspaces and services
  const workspaceIds = new Set<string>();
  const serviceIds = new Set<string>();

  for (const file of relevantFiles) {
    if (file.workspace_id) workspaceIds.add(file.workspace_id);
    if (file.service_id) serviceIds.add(file.service_id);
  }

  for (const chunk of dedupResult.unique_chunks) {
    if (chunk.workspace_id) workspaceIds.add(chunk.workspace_id);
    if (chunk.service_id) serviceIds.add(chunk.service_id);
  }

  // Build metadata
  const metadata: SearchMetadata = {
    total_tokens: totalTokens,
    files_retrieved: relevantFiles.length,
    chunks_retrieved: dedupResult.unique_chunks.length + dedupResult.duplicates_removed,
    chunks_after_dedup: dedupResult.unique_chunks.length,
    chunks_deduplicated: dedupResult.duplicates_removed,
    symbols_resolved: resolvedSymbols.length,
    import_depth_reached: Math.max(...importChains.map((ic) => ic.depth), 0),
    query_time_ms: totalQueryTime,
    api_endpoints_found: apiContext.endpoints.length,
    workspaces_searched: workspaceIds.size > 0 ? workspaceIds.size : undefined,
    services_searched: serviceIds.size > 0 ? serviceIds.size : undefined,
    repos_searched: reposSearched.length > 0 ? reposSearched : undefined,
    reference_repos_included: referenceReposIncluded.length > 0 ? referenceReposIncluded : undefined,
    documentation_repos_included: documentationReposIncluded.length > 0 ? documentationReposIncluded : undefined,
  };

  // Generate warnings (merge all warning sources)
  const baseWarnings = generateWarnings(totalTokens, config, metadata);
  const boundaryWarnings = generateBoundaryWarnings(importChains);
  const referenceWarnings = generateReferenceWarnings(repoMetadata);
  const warnings = [...baseWarnings, ...boundaryWarnings, ...referenceWarnings, ...apiContext.api_warnings];

  // Build context with explicit groupings
  const context: SearchContext = {
    relevant_files: relevantFiles,
    code_locations: dedupResult.unique_chunks,
    symbols: resolvedSymbols,
    imports: importChains,
    api_context: apiContext.endpoints.length > 0 ? apiContext : undefined,
    by_workspace: groupedByWorkspace,
    by_service: groupedByService,
    by_repo: groupedByRepo,
  };

  // Assemble final result
  const result: SearchResult = {
    query: queryEmbedding.query_text,
    query_type: queryEmbedding.query_type,
    warnings,
    metadata,
    context,
  };

  const assemblyTime = Date.now() - startTime;

  logger.info('Grouped context assembly complete', {
    totalTokens: totalTokens.toLocaleString(),
    warnings: warnings.length,
    assemblyTime,
    queryTimeTotal: totalQueryTime,
    groupings: {
      workspace: groupedByWorkspace ? Object.keys(groupedByWorkspace).length : 0,
      service: groupedByService ? Object.keys(groupedByService).length : 0,
      repo: groupedByRepo ? Object.keys(groupedByRepo).length : 0,
    },
  });

  // Log warnings
  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(`Search warning: ${warning.type}`, {
        severity: warning.severity,
        message: warning.message,
        suggestion: warning.suggestion,
      });
    }
  }

  return result;
};
