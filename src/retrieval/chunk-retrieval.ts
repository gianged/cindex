/**
 * Chunk-Level Retrieval (Stage 2 of retrieval pipeline)
 *
 * Performs precise chunk-level semantic search within top files from Stage 1.
 * Returns code chunks ranked by cosine similarity with higher threshold than file-level search.
 */

import { type DatabaseClient } from '@database/client';
import { type ScopeFilter } from '@retrieval/scope-filter';
import { logger } from '@utils/logger';
import { type CindexConfig } from '@/types/config';
import { type QueryEmbedding, type RelevantChunk, type RelevantFile } from '@/types/retrieval';

/**
 * Database row type for chunk retrieval
 */
interface ChunkRetrievalRow {
  chunk_id: string;
  file_path: string;
  chunk_content: string;
  chunk_type: string;
  start_line: number;
  end_line: number;
  token_count: number;
  metadata: Record<string, unknown>;
  similarity: number;
  embedding: string; // pgvector returns as string
  workspace_id: string | null;
  package_name: string | null;
  service_id: string | null;
  repo_id: string | null;
}

/**
 * Retrieve relevant code chunks from top files
 *
 * Searches for semantically similar chunks within files from Stage 1.
 * Uses higher similarity threshold (0.75 vs 0.70) for more precise results.
 * Excludes file_summary chunks to avoid redundancy.
 *
 * Note: Scope filtering is applied through relevantFiles (already filtered in Stage 1),
 * so scopeFilter is mainly used for logging and future direct database queries.
 *
 * @param queryEmbedding - Query embedding from processQuery()
 * @param relevantFiles - Top files from Stage 1 (retrieveFiles)
 * @param config - cindex configuration (unused, reserved for future thresholds)
 * @param db - Database client
 * @param scopeFilter - Scope filter from Stage 0 (optional, null for single-repo mode)
 * @param maxChunks - Maximum chunks to return (default: 100, before dedup)
 * @param chunkSimilarityThreshold - Minimum similarity score (default: 0.75, higher than Stage 1)
 * @returns Array of relevant chunks ranked by similarity (includes embedding for deduplication)
 * @throws Error if database query fails or no files provided
 */
export const retrieveChunks = async (
  queryEmbedding: QueryEmbedding,
  relevantFiles: RelevantFile[],
  _config: CindexConfig,
  db: DatabaseClient,
  scopeFilter: ScopeFilter | null = null,
  maxChunks = 100,
  chunkSimilarityThreshold?: number
): Promise<RelevantChunk[]> => {
  const startTime = Date.now();

  // Use moderate threshold for chunks (default: 0.30)
  // Note: Chunks include file summaries but still score lower than file-level matches
  const threshold = chunkSimilarityThreshold ?? 0.3;

  // Extract file paths from Stage 1 results
  const filePaths = relevantFiles.map((f) => f.file_path);

  if (filePaths.length === 0) {
    logger.warn('No files provided for chunk retrieval');
    return [];
  }

  logger.debug('Starting chunk-level retrieval', {
    queryType: queryEmbedding.query_type,
    filesProvided: filePaths.length,
    maxChunks,
    threshold,
    scopeFilter: scopeFilter ? `${scopeFilter.mode} (${scopeFilter.repo_ids.length.toString()} repos)` : 'inherited',
  });

  // Convert embedding array to pgvector format
  const embeddingVector = `[${queryEmbedding.embedding.join(',')}]`;

  // SQL query with file path filtering
  // IMPORTANT:
  // - Only search within files from Stage 1 (file_path = ANY($4))
  // - Exclude file_summary chunks (chunk_type != 'file_summary')
  // - Higher threshold than Stage 1 (0.75 vs 0.70)
  // - Use ORDER BY embedding <=> query for index optimization
  const query = `
    SELECT
      id AS chunk_id,
      file_path,
      chunk_content,
      chunk_type,
      start_line,
      end_line,
      token_count,
      metadata,
      1 - (embedding <=> $1::vector) AS similarity,
      embedding::text,
      workspace_id,
      package_name,
      service_id,
      repo_id
    FROM code_chunks
    WHERE file_path = ANY($4::text[])
      AND chunk_type != 'file_summary'
      AND 1 - (embedding <=> $1::vector) > $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `;

  const params = [embeddingVector, threshold, maxChunks, filePaths];

  try {
    const result = await db.query<ChunkRetrievalRow>(query, params);

    const chunks: RelevantChunk[] = result.rows.map((row) => {
      // Parse embedding string back to number array (for Stage 7 deduplication)
      // pgvector returns embedding as string "[1.2, 3.4, ...]"
      let embeddingArray: number[] | undefined;
      try {
        embeddingArray = JSON.parse(row.embedding) as number[];
      } catch {
        // If parsing fails, embedding will be undefined (deduplication will skip this chunk)
        logger.warn('Failed to parse embedding for chunk', { chunk_id: row.chunk_id });
      }

      return {
        chunk_id: row.chunk_id,
        file_path: row.file_path,
        chunk_content: row.chunk_content,
        chunk_type: row.chunk_type,
        start_line: row.start_line,
        end_line: row.end_line,
        token_count: row.token_count,
        metadata: row.metadata,
        similarity: row.similarity,
        embedding: embeddingArray,
        // Multi-project context (nullable)
        workspace_id: row.workspace_id ?? undefined,
        package_name: row.package_name ?? undefined,
        service_id: row.service_id ?? undefined,
        repo_id: row.repo_id ?? undefined,
      };
    });

    const retrievalTime = Date.now() - startTime;

    // Calculate statistics
    const chunksByFile = chunks.reduce<Record<string, number>>((acc, chunk) => {
      acc[chunk.file_path] = (acc[chunk.file_path] || 0) + 1;
      return acc;
    }, {});

    logger.info('Chunk-level retrieval complete', {
      chunksRetrieved: chunks.length,
      filesWithChunks: Object.keys(chunksByFile).length,
      threshold,
      retrievalTime,
      topSimilarity: chunks[0]?.similarity.toFixed(3),
      lowestSimilarity: chunks[chunks.length - 1]?.similarity.toFixed(3),
      avgChunksPerFile: (chunks.length / Object.keys(chunksByFile).length).toFixed(1),
    });

    return chunks;
  } catch (error) {
    logger.error('Chunk-level retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      filesProvided: filePaths.length,
      threshold,
      maxChunks,
    });
    throw error;
  }
};

/**
 * Retrieve chunks with explicit repository/workspace/service filtering (multi-project support)
 *
 * This is a filtered version for multi-project mode (will be enhanced in Phase B).
 * Adds additional filtering by repo_id, workspace_id, or service_id.
 *
 * @param queryEmbedding - Query embedding
 * @param relevantFiles - Top files from Stage 1
 * @param config - cindex configuration
 * @param db - Database client
 * @param filters - Optional filters for multi-project
 * @param maxChunks - Maximum chunks to return
 * @param chunkSimilarityThreshold - Minimum similarity score
 * @returns Array of relevant chunks from specified scope
 */
export const retrieveChunksFiltered = async (
  queryEmbedding: QueryEmbedding,
  relevantFiles: RelevantFile[],
  _config: CindexConfig,
  db: DatabaseClient,
  filters: {
    repo_ids?: string[];
    workspace_ids?: string[];
    service_ids?: string[];
    package_names?: string[];
  },
  maxChunks = 100,
  chunkSimilarityThreshold?: number
): Promise<RelevantChunk[]> => {
  const startTime = Date.now();
  const threshold = chunkSimilarityThreshold ?? 0.3;
  const filePaths = relevantFiles.map((f) => f.file_path);

  if (filePaths.length === 0) {
    logger.warn('No files provided for filtered chunk retrieval');
    return [];
  }

  logger.debug('Starting filtered chunk-level retrieval', {
    queryType: queryEmbedding.query_type,
    filesProvided: filePaths.length,
    filters,
    maxChunks,
    threshold,
  });

  const embeddingVector = `[${queryEmbedding.embedding.join(',')}]`;

  // Build dynamic WHERE clause based on filters
  const whereClauses: string[] = [
    'file_path = ANY($4::text[])',
    "chunk_type != 'file_summary'",
    '1 - (embedding <=> $1::vector) > $2',
  ];

  const params: unknown[] = [embeddingVector, threshold, maxChunks, filePaths];

  if (filters.repo_ids && filters.repo_ids.length > 0) {
    whereClauses.push(`repo_id = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.repo_ids);
  }

  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    whereClauses.push(`workspace_id = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.workspace_ids);
  }

  if (filters.service_ids && filters.service_ids.length > 0) {
    whereClauses.push(`service_id = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.service_ids);
  }

  if (filters.package_names && filters.package_names.length > 0) {
    whereClauses.push(`package_name = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.package_names);
  }

  const query = `
    SELECT
      id AS chunk_id,
      file_path,
      chunk_content,
      chunk_type,
      start_line,
      end_line,
      token_count,
      metadata,
      1 - (embedding <=> $1::vector) AS similarity,
      embedding::text,
      workspace_id,
      package_name,
      service_id,
      repo_id
    FROM code_chunks
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `;

  try {
    const result = await db.query<ChunkRetrievalRow>(query, params);

    const chunks: RelevantChunk[] = result.rows.map((row) => {
      let embeddingArray: number[] | undefined;
      try {
        embeddingArray = JSON.parse(row.embedding) as number[];
      } catch {
        logger.warn('Failed to parse embedding for chunk', { chunk_id: row.chunk_id });
      }

      return {
        chunk_id: row.chunk_id,
        file_path: row.file_path,
        chunk_content: row.chunk_content,
        chunk_type: row.chunk_type,
        start_line: row.start_line,
        end_line: row.end_line,
        token_count: row.token_count,
        metadata: row.metadata,
        similarity: row.similarity,
        embedding: embeddingArray,
        workspace_id: row.workspace_id ?? undefined,
        package_name: row.package_name ?? undefined,
        service_id: row.service_id ?? undefined,
        repo_id: row.repo_id ?? undefined,
      };
    });

    const retrievalTime = Date.now() - startTime;

    logger.info('Filtered chunk-level retrieval complete', {
      chunksRetrieved: chunks.length,
      filters,
      threshold,
      retrievalTime,
    });

    return chunks;
  } catch (error) {
    logger.error('Filtered chunk-level retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      filters,
      threshold,
      maxChunks,
    });
    throw error;
  }
};
