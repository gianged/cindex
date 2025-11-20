/**
 * File-Level Retrieval (Stage 1 of retrieval pipeline)
 *
 * Performs broad file-level semantic search using summary embeddings.
 * Returns top N relevant files ranked by cosine similarity.
 */

import { type DatabaseClient } from '@database/client';
import { type ScopeFilter } from '@retrieval/scope-filter';
import { logger } from '@utils/logger';
import { type CindexConfig } from '@/types/config';
import { type QueryEmbedding, type RelevantFile } from '@/types/retrieval';

/**
 * Database row type for file retrieval
 */
interface FileRetrievalRow {
  file_path: string;
  file_summary: string;
  language: string;
  total_lines: number;
  imports: string[];
  exports: string[];
  similarity: number;
  workspace_id: string | null;
  package_name: string | null;
  service_id: string | null;
  repo_id: string | null;
}

/**
 * Retrieve relevant files using vector similarity search
 *
 * Uses pgvector cosine distance operator (<=>)  to find files with summaries
 * semantically similar to the query. Applies similarity threshold filtering
 * and returns top N files ranked by relevance.
 *
 * SQL Query Pattern (from syntax.md):
 * ```sql
 * -- Cosine similarity calculation
 * SELECT 1 - (embedding <=> query_embedding) AS similarity
 * FROM table
 * WHERE 1 - (embedding <=> query_embedding) > threshold
 * ORDER BY embedding <=> query_embedding  -- Index-optimized
 * LIMIT N
 * ```
 *
 * @param queryEmbedding - Query embedding from processQuery()
 * @param config - cindex configuration
 * @param db - Database client
 * @param scopeFilter - Scope filter from Stage 0 (optional, null for single-repo mode)
 * @param maxFiles - Maximum files to return (default: 15)
 * @param similarityThreshold - Minimum similarity score (default: 0.70)
 * @returns Array of relevant files ranked by similarity (includes metadata like imports, exports, line count)
 * @throws Error if database query fails or embedding dimensions mismatch
 */
export const retrieveFiles = async (
  queryEmbedding: QueryEmbedding,
  config: CindexConfig,
  db: DatabaseClient,
  scopeFilter: ScopeFilter | null = null,
  maxFiles = 15,
  similarityThreshold?: number
): Promise<RelevantFile[]> => {
  const startTime = Date.now();

  // Use config threshold if not provided
  const threshold = similarityThreshold ?? config.performance.similarity_threshold;

  logger.debug('Starting file-level retrieval', {
    queryType: queryEmbedding.query_type,
    maxFiles,
    threshold,
    scopeFilter: scopeFilter ? `${scopeFilter.mode} (${scopeFilter.repo_ids.length.toString()} repos)` : 'none',
  });

  // Convert embedding array to pgvector format
  const embeddingVector = `[${queryEmbedding.embedding.join(',')}]`;

  // Build WHERE clauses for scope filtering
  const whereClauses: string[] = ['1 - (summary_embedding <=> $1::vector) > $2'];
  const params: unknown[] = [embeddingVector, threshold];
  let paramIndex = 3;

  // Apply scope filtering if provided (multi-project mode)
  // Filter by repository IDs (from Stage 0)
  if (scopeFilter && scopeFilter.repo_ids.length > 0) {
    whereClauses.push(`repo_id = ANY($${paramIndex.toString()}::text[])`);
    params.push(scopeFilter.repo_ids);
    paramIndex++;
  }

  // Filter by workspace IDs (monorepo packages)
  if (scopeFilter && scopeFilter.workspace_ids.length > 0) {
    whereClauses.push(`workspace_id = ANY($${paramIndex.toString()}::text[])`);
    params.push(scopeFilter.workspace_ids);
    paramIndex++;
  }

  // Filter by service IDs (microservices)
  if (scopeFilter && scopeFilter.service_ids.length > 0) {
    whereClauses.push(`service_id = ANY($${paramIndex.toString()}::text[])`);
    params.push(scopeFilter.service_ids);
    paramIndex++;
  }

  // Filter by package names (package.json name field)
  if (scopeFilter?.package_names && scopeFilter.package_names.length > 0) {
    whereClauses.push(`package_name = ANY($${paramIndex.toString()}::text[])`);
    params.push(scopeFilter.package_names);
    paramIndex++;
  }

  // Add maxFiles as final parameter
  params.push(maxFiles);

  // SQL query with pgvector cosine distance and scope filtering
  // IMPORTANT: Use ORDER BY embedding <=> query for index optimization
  // Reference: docs/syntax.md#L389-L393 (pgvector distance operators)
  const query = `
    SELECT
      file_path,
      file_summary,
      language,
      total_lines,
      COALESCE(imports, '{}') AS imports,
      COALESCE(exports, '{}') AS exports,
      1 - (summary_embedding <=> $1::vector) AS similarity,
      workspace_id,
      package_name,
      service_id,
      repo_id
    FROM code_files
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY summary_embedding <=> $1::vector
    LIMIT $${paramIndex.toString()}
  `;

  try {
    const result = await db.query<FileRetrievalRow>(query, params);

    const files: RelevantFile[] = result.rows.map((row) => ({
      file_path: row.file_path,
      file_summary: row.file_summary,
      language: row.language,
      line_count: row.total_lines,
      imports: row.imports,
      exports: row.exports,
      similarity: row.similarity,
      // Multi-project context (nullable)
      workspace_id: row.workspace_id ?? undefined,
      package_name: row.package_name ?? undefined,
      service_id: row.service_id ?? undefined,
      repo_id: row.repo_id ?? undefined,
    }));

    const retrievalTime = Date.now() - startTime;

    logger.info('File-level retrieval complete', {
      filesRetrieved: files.length,
      threshold,
      retrievalTime,
      topSimilarity: files[0]?.similarity.toFixed(3),
      lowestSimilarity: files[files.length - 1]?.similarity.toFixed(3),
    });

    return files;
  } catch (error) {
    logger.error('File-level retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      threshold,
      maxFiles,
    });
    throw error;
  }
};

/**
 * Retrieve files with explicit repository filtering (multi-project support)
 *
 * This is a filtered version for multi-project mode (will be enhanced in Phase B).
 * For now, it's a simple wrapper around retrieveFiles().
 *
 * @param queryEmbedding - Query embedding
 * @param config - cindex configuration
 * @param db - Database client
 * @param repoIds - Repository IDs to filter by
 * @param maxFiles - Maximum files to return
 * @param similarityThreshold - Minimum similarity score
 * @returns Array of relevant files from specified repositories
 */
export const retrieveFilesFiltered = async (
  queryEmbedding: QueryEmbedding,
  config: CindexConfig,
  db: DatabaseClient,
  repoIds: string[],
  maxFiles = 15,
  similarityThreshold?: number
): Promise<RelevantFile[]> => {
  const startTime = Date.now();
  const threshold = similarityThreshold ?? config.performance.similarity_threshold;

  logger.debug('Starting filtered file-level retrieval', {
    queryType: queryEmbedding.query_type,
    repoIds,
    maxFiles,
    threshold,
  });

  const embeddingVector = `[${queryEmbedding.embedding.join(',')}]`;

  // Add repo_id filter to query
  const query = `
    SELECT
      file_path,
      file_summary,
      language,
      total_lines,
      COALESCE(imports, '{}') AS imports,
      COALESCE(exports, '{}') AS exports,
      1 - (summary_embedding <=> $1::vector) AS similarity,
      workspace_id,
      package_name,
      service_id,
      repo_id
    FROM code_files
    WHERE 1 - (summary_embedding <=> $1::vector) > $2
      AND repo_id = ANY($4::text[])
    ORDER BY summary_embedding <=> $1::vector
    LIMIT $3
  `;

  const params = [embeddingVector, threshold, maxFiles, repoIds];

  try {
    const result = await db.query<FileRetrievalRow>(query, params);

    const files: RelevantFile[] = result.rows.map((row) => ({
      file_path: row.file_path,
      file_summary: row.file_summary,
      language: row.language,
      line_count: row.total_lines,
      imports: row.imports,
      exports: row.exports,
      similarity: row.similarity,
      workspace_id: row.workspace_id ?? undefined,
      package_name: row.package_name ?? undefined,
      service_id: row.service_id ?? undefined,
      repo_id: row.repo_id ?? undefined,
    }));

    const retrievalTime = Date.now() - startTime;

    logger.info('Filtered file-level retrieval complete', {
      filesRetrieved: files.length,
      repoIds,
      threshold,
      retrievalTime,
    });

    return files;
  } catch (error) {
    logger.error('Filtered file-level retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      repoIds,
      threshold,
      maxFiles,
    });
    throw error;
  }
};
