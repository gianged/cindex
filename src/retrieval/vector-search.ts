/**
 * Vector similarity search with scope filtering
 * Supports filtering by repository type, excluding references and documentation by default
 */
import { type Pool, type QueryResult } from 'pg';

import {
  type CodeChunk,
  type CodeFile,
  type RepoIdQueryResult,
  type RepositoryType,
  type RepoTypeQueryResult,
} from '@/types/database';

/**
 * Search scope options
 */
export type SearchScope = 'global' | 'repository' | 'service' | 'boundary-aware';

/**
 * Search filter options (Stage 0: Scope Filtering)
 */
export interface SearchFilter {
  scope?: SearchScope; // Default: 'repository'
  repo_id?: string; // Required for 'repository' scope
  service_id?: string; // Required for 'service' scope
  workspace_id?: string; // Optional workspace filter

  // Reference filtering options
  include_references?: boolean; // Include reference repos (default: false)
  include_documentation?: boolean; // Include documentation repos (default: false)
  exclude_repo_types?: RepositoryType[]; // Explicitly exclude repo types

  // Dependency expansion (for boundary-aware scope)
  include_dependencies?: boolean; // Expand to dependencies
  dependency_depth?: number; // Max depth for dependency expansion
}

/**
 * Search parameters
 */
export interface SearchParams {
  query_embedding: number[]; // Query vector
  filter: SearchFilter; // Scope and repo filters
  similarity_threshold?: number; // Min similarity score (default: 0.75)
  limit?: number; // Max results (default: 20)
}

/**
 * Search result with similarity score
 */
export interface SearchResult<T> {
  item: T;
  similarity: number;
  priority: number; // Priority multiplier based on repo_type
}

/**
 * Determine which repository IDs to include based on search filter
 * Stage 0: Scope Filtering
 */
const determineSearchScope = async (db: Pool, filter: SearchFilter): Promise<string[] | null> => {
  const {
    scope = 'repository',
    repo_id: repoId,
    service_id: serviceId,
    workspace_id: _workspaceId,
    include_references: includeReferences = false,
    include_documentation: includeDocumentation = false,
    exclude_repo_types: excludeRepoTypes = [],
  } = filter;

  // Build exclusion list based on repo types
  const excludedTypes: RepositoryType[] = [...excludeRepoTypes];

  // Exclude references and documentation by default unless explicitly included
  if (!includeReferences) {
    excludedTypes.push('reference');
  }
  if (!includeDocumentation) {
    excludedTypes.push('documentation');
  }

  // Handle different scopes
  switch (scope) {
    case 'repository': {
      // Search within specific repository
      if (!repoId) {
        throw new Error('repo_id is required for repository scope');
      }

      // Check if the repo itself is excluded by type
      const repoResult: QueryResult<RepoTypeQueryResult> = await db.query<RepoTypeQueryResult>(
        `SELECT repo_type FROM repositories WHERE repo_id = $1`,
        [repoId]
      );

      const rows = repoResult.rows;

      if (rows.length === 0) {
        throw new Error(`Repository not found: ${repoId}`);
      }

      const row = rows[0];

      const repoType: RepositoryType = row.repo_type;
      if (excludedTypes.includes(repoType)) {
        // Return empty array if the target repo is excluded
        return [];
      }

      return [repoId];
    }

    case 'service': {
      // Search within specific service
      if (!serviceId) {
        throw new Error('service_id is required for service scope');
      }

      // Get repo_id for the service
      const serviceResult: QueryResult<RepoIdQueryResult> = await db.query<RepoIdQueryResult>(
        `SELECT repo_id FROM services WHERE service_id = $1`,
        [serviceId]
      );

      if (serviceResult.rows.length === 0) {
        throw new Error(`Service not found: ${serviceId}`);
      }

      const serviceRows: RepoIdQueryResult[] = serviceResult.rows;
      const serviceRow = serviceRows[0];

      const repoId: string = serviceRow.repo_id;
      return [repoId];
    }

    case 'global': {
      // Search across all repositories, excluding filtered types
      if (excludedTypes.length === 0) {
        // No filtering needed
        return null;
      }

      // Get all non-excluded repo IDs
      const paramCount = excludedTypes.length;
      const paramIndices = Array.from({ length: paramCount }, (_, i) => i + 1);
      const placeholders = paramIndices.map((idx) => `$${String(idx)}`).join(', ');
      const globalResult: QueryResult<RepoIdQueryResult> = await db.query<RepoIdQueryResult>(
        `SELECT repo_id FROM repositories
         WHERE repo_type NOT IN (${placeholders})
         OR repo_type IS NULL`,
        excludedTypes
      );

      return globalResult.rows.map((row: RepoIdQueryResult): string => row.repo_id);
    }

    case 'boundary-aware': {
      // Start from a repository and expand to dependencies
      // TODO: Implement dependency graph traversal in Phase 5
      // For now, same as repository scope
      if (!repoId) {
        throw new Error('repo_id is required for boundary-aware scope');
      }
      return [repoId];
    }

    default: {
      const exhaustiveCheck: never = scope;
      throw new Error(`Unknown search scope: ${String(exhaustiveCheck)}`);
    }
  }
};

/**
 * Build SQL WHERE clause for repository filtering
 */
const buildRepoFilter = (repoIds: string[] | null): { clause: string; params: string[] } => {
  if (repoIds === null) {
    // No filtering
    return { clause: '', params: [] };
  }

  if (repoIds.length === 0) {
    // Empty list means exclude all (repo was excluded by type)
    return { clause: 'AND FALSE', params: [] };
  }

  // Filter by repo_id list
  return {
    clause: `AND repo_id = ANY($REPOFILTER)`,
    params: repoIds,
  };
};

/**
 * Search for similar files using file-level summary embeddings
 * Stage 1: File-Level Retrieval
 */
export const searchFiles = async (db: Pool, params: SearchParams): Promise<SearchResult<CodeFile>[]> => {
  const {
    query_embedding: queryEmbedding,
    filter,
    similarity_threshold: similarityThreshold = 0.75,
    limit = 20,
  } = params;

  // Stage 0: Determine scope
  const repoIds = await determineSearchScope(db, filter);
  const repoFilter = buildRepoFilter(repoIds);

  // Build query with optional repo filtering
  const hasRepoFilter = repoFilter.params.length > 0;
  const limitParamIndex = hasRepoFilter ? 4 : 3;
  const limitPlaceholder = `$${String(limitParamIndex)}`;
  const query = `
    SELECT
      *,
      1 - (summary_embedding <=> $1::vector) AS similarity
    FROM code_files
    WHERE summary_embedding IS NOT NULL
      AND 1 - (summary_embedding <=> $1::vector) > $2
      ${repoFilter.clause.replace('$REPOFILTER', '$3')}
    ORDER BY summary_embedding <=> $1::vector
    LIMIT ${limitPlaceholder}
  `;

  const queryParams = [
    `[${queryEmbedding.join(',')}]`, // $1: query vector
    similarityThreshold, // $2: threshold
    ...(repoFilter.params.length > 0 ? [repoFilter.params] : []), // $3: repo IDs (if filtering)
    limit, // $4: limit
  ];

  type FileWithSimilarity = CodeFile & { similarity: number };

  const result = await db.query<FileWithSimilarity>(query, queryParams);

  const rows = result.rows;

  return rows.map((row: FileWithSimilarity) => ({
    item: row,
    similarity: row.similarity,
    priority: 1.0, // Will be calculated in prioritization phase
  }));
};

/**
 * Search for similar code chunks within specific files
 * Stage 2: Chunk-Level Retrieval
 */
export const searchChunks = async (
  db: Pool,
  params: SearchParams,
  filePaths?: string[]
): Promise<SearchResult<CodeChunk>[]> => {
  const {
    query_embedding: queryEmbedding,
    filter,
    similarity_threshold: similarityThreshold = 0.75,
    limit = 50,
  } = params;

  // Stage 0: Determine scope
  const repoIds = await determineSearchScope(db, filter);
  const repoFilter = buildRepoFilter(repoIds);

  // Build file path filter if provided
  const hasRepoFilter = repoFilter.params.length > 0;
  const hasFileFilter = filePaths !== undefined && filePaths.length > 0;
  const fileParamIndex = hasRepoFilter ? 4 : 3;
  const fileFilterPlaceholder = `$${String(fileParamIndex)}`;
  const fileFilter = hasFileFilter ? `AND file_path = ANY(${fileFilterPlaceholder})` : '';

  // Build query with optional repo and file filtering
  const limitParamIndex = hasRepoFilter ? (hasFileFilter ? 5 : 4) : hasFileFilter ? 4 : 3;
  const limitPlaceholder = `$${String(limitParamIndex)}`;
  const query = `
    SELECT
      *,
      1 - (embedding <=> $1::vector) AS similarity
    FROM code_chunks
    WHERE embedding IS NOT NULL
      AND 1 - (embedding <=> $1::vector) > $2
      ${repoFilter.clause.replace('$REPOFILTER', '$3')}
      ${fileFilter}
    ORDER BY embedding <=> $1::vector
    LIMIT ${limitPlaceholder}
  `;

  const queryParams = [
    `[${queryEmbedding.join(',')}]`, // $1: query vector
    similarityThreshold, // $2: threshold
    ...(repoFilter.params.length > 0 ? [repoFilter.params] : []), // $3: repo IDs (if filtering)
    ...(filePaths && filePaths.length > 0 ? [filePaths] : []), // $4: file paths (if provided)
    limit, // $5: limit
  ];

  type ChunkWithSimilarity = CodeChunk & { similarity: number };

  const result = await db.query<ChunkWithSimilarity>(query, queryParams);

  const rows = result.rows;

  return rows.map((row: ChunkWithSimilarity) => ({
    item: row,
    similarity: row.similarity,
    priority: 1.0, // Will be calculated in prioritization phase
  }));
};

/**
 * Combined search: files + chunks with scope filtering
 * Implements Stage 0 + Stage 1 + Stage 2 of multi-stage retrieval
 */
export const performVectorSearch = async (
  db: Pool,
  params: SearchParams
): Promise<{
  files: SearchResult<CodeFile>[];
  chunks: SearchResult<CodeChunk>[];
}> => {
  // Stage 1: File-level retrieval
  const files = await searchFiles(db, params);

  // Stage 2: Chunk-level retrieval (optionally scoped to top files)
  const topFilePaths = files.slice(0, 10).map((r) => r.item.file_path);
  const chunks = await searchChunks(db, params, topFilePaths);

  return { files, chunks };
};
