/**
 * Hybrid Search Utility
 *
 * Combines vector similarity search with PostgreSQL full-text search (tsvector/ts_rank_cd)
 * for improved natural language query handling.
 *
 * Hybrid Score Formula:
 *   hybrid_score = (vector_weight * vector_similarity) + (keyword_weight * ts_rank_cd_score)
 *
 * Default weights: vector=0.7, keyword=0.3
 * - Vector search excels at semantic understanding
 * - Keyword search catches exact term matches that semantic search might miss
 */

import { type CindexConfig } from '@/types/config';

/**
 * Hybrid search configuration for SQL query building
 */
export interface HybridSearchConfig {
  /** Weight for vector similarity (default: 0.7) */
  vectorWeight: number;
  /** Weight for keyword/BM25 score (default: 0.3) */
  keywordWeight: number;
  /** Whether hybrid search is enabled */
  enabled: boolean;
}

/**
 * SQL components for hybrid search queries
 */
export interface HybridSqlComponents {
  /** SELECT expressions for similarity scores */
  selectExpressions: string;
  /** WHERE clause conditions for hybrid filtering */
  whereCondition: string;
  /** ORDER BY clause for ranking */
  orderBy: string;
  /** Parameter placeholder for the query text (for ts_rank) */
  queryTextParam: string;
}

/**
 * Get hybrid search configuration from cindex config
 *
 * @param config - cindex configuration
 * @returns Hybrid search configuration
 */
export const getHybridConfig = (config: CindexConfig): HybridSearchConfig => ({
  vectorWeight: config.performance.hybrid_vector_weight,
  keywordWeight: config.performance.hybrid_keyword_weight,
  enabled: config.features.enable_hybrid_search,
});

/**
 * Build SQL components for hybrid file-level search
 *
 * Uses summary_embedding for vector search and summary_tsv for full-text search.
 * Falls back to vector-only search when tsvector column is NULL.
 *
 * @param embeddingParamIndex - Parameter index for embedding vector ($N)
 * @param queryTextParamIndex - Parameter index for query text ($N)
 * @param thresholdParamIndex - Parameter index for similarity threshold ($N)
 * @param hybridConfig - Hybrid search weights and settings
 * @returns SQL components for hybrid search
 */
export const buildFileLevelHybridSql = (
  embeddingParamIndex: number,
  queryTextParamIndex: number,
  thresholdParamIndex: number,
  hybridConfig: HybridSearchConfig
): HybridSqlComponents => {
  const { vectorWeight, keywordWeight, enabled } = hybridConfig;

  if (!enabled) {
    // Vector-only fallback
    return {
      selectExpressions: `1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector) AS similarity`,
      whereCondition: `1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector) > $${thresholdParamIndex.toString()}`,
      orderBy: `summary_embedding <=> $${embeddingParamIndex.toString()}::vector`,
      queryTextParam: '',
    };
  }

  // Hybrid search with vector + full-text
  // COALESCE handles NULL tsvector (not yet populated)
  // ts_rank_cd uses cover density ranking (better for code/summaries)
  return {
    selectExpressions: `
      1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector) AS vector_similarity,
      COALESCE(ts_rank_cd(summary_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0) AS keyword_score,
      (${vectorWeight.toString()} * (1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector))) +
      (${keywordWeight.toString()} * COALESCE(ts_rank_cd(summary_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0)) AS similarity`,
    whereCondition: `(
      1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector) > $${thresholdParamIndex.toString()}
      OR (summary_tsv IS NOT NULL AND ts_rank_cd(summary_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})) > 0.01)
    )`,
    orderBy: `(${vectorWeight.toString()} * (1 - (summary_embedding <=> $${embeddingParamIndex.toString()}::vector))) +
      (${keywordWeight.toString()} * COALESCE(ts_rank_cd(summary_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0)) DESC`,
    queryTextParam: `$${queryTextParamIndex.toString()}`,
  };
};

/**
 * Build SQL components for hybrid chunk-level search
 *
 * Uses embedding for vector search and content_tsv for full-text search.
 * Falls back to vector-only search when tsvector column is NULL.
 *
 * @param embeddingParamIndex - Parameter index for embedding vector ($N)
 * @param queryTextParamIndex - Parameter index for query text ($N)
 * @param thresholdParamIndex - Parameter index for similarity threshold ($N)
 * @param hybridConfig - Hybrid search weights and settings
 * @returns SQL components for hybrid search
 */
export const buildChunkLevelHybridSql = (
  embeddingParamIndex: number,
  queryTextParamIndex: number,
  thresholdParamIndex: number,
  hybridConfig: HybridSearchConfig
): HybridSqlComponents => {
  const { vectorWeight, keywordWeight, enabled } = hybridConfig;

  if (!enabled) {
    // Vector-only fallback
    return {
      selectExpressions: `1 - (embedding <=> $${embeddingParamIndex.toString()}::vector) AS similarity`,
      whereCondition: `1 - (embedding <=> $${embeddingParamIndex.toString()}::vector) > $${thresholdParamIndex.toString()}`,
      orderBy: `embedding <=> $${embeddingParamIndex.toString()}::vector`,
      queryTextParam: '',
    };
  }

  // Hybrid search with vector + full-text
  return {
    selectExpressions: `
      1 - (embedding <=> $${embeddingParamIndex.toString()}::vector) AS vector_similarity,
      COALESCE(ts_rank_cd(content_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0) AS keyword_score,
      (${vectorWeight.toString()} * (1 - (embedding <=> $${embeddingParamIndex.toString()}::vector))) +
      (${keywordWeight.toString()} * COALESCE(ts_rank_cd(content_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0)) AS similarity`,
    whereCondition: `(
      1 - (embedding <=> $${embeddingParamIndex.toString()}::vector) > $${thresholdParamIndex.toString()}
      OR (content_tsv IS NOT NULL AND ts_rank_cd(content_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})) > 0.01)
    )`,
    orderBy: `(${vectorWeight.toString()} * (1 - (embedding <=> $${embeddingParamIndex.toString()}::vector))) +
      (${keywordWeight.toString()} * COALESCE(ts_rank_cd(content_tsv, plainto_tsquery('english', $${queryTextParamIndex.toString()})), 0)) DESC`,
    queryTextParam: `$${queryTextParamIndex.toString()}`,
  };
};

/**
 * Sanitize query text for PostgreSQL full-text search
 *
 * Removes characters that could cause tsquery parsing errors.
 * plainto_tsquery is already forgiving, but this adds extra safety.
 *
 * @param queryText - Raw query text from user
 * @returns Sanitized query text safe for tsquery
 */
export const sanitizeQueryForFts = (queryText: string): string => {
  // Remove special characters that could break tsquery parsing
  // Keep alphanumeric, spaces, and common programming characters
  return queryText
    .replace(/[&|!():*<>]/g, ' ') // Remove tsquery operators
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
};

/**
 * Generate tsvector value from text for database insertion
 *
 * Used during indexing to populate content_tsv/summary_tsv columns.
 *
 * @param text - Text to convert to tsvector
 * @returns SQL expression for tsvector generation
 */
export const generateTsvectorSql = (text: string): string => {
  // Escape single quotes for SQL safety
  const escaped = text.replace(/'/g, "''");
  return `to_tsvector('english', '${escaped}')`;
};

/**
 * Build SQL for updating tsvector column with parameterized text
 *
 * @param columnName - Name of the tsvector column to update
 * @param textParamIndex - Parameter index for the source text ($N)
 * @returns SQL expression for tsvector generation with parameter
 */
export const buildTsvectorUpdateSql = (columnName: string, textParamIndex: number): string =>
  `${columnName} = to_tsvector('english', COALESCE($${textParamIndex.toString()}, ''))`;

/**
 * Build tsvector column value for INSERT statement
 *
 * @param textParamIndex - Parameter index for the source text ($N)
 * @returns SQL expression for tsvector generation in INSERT
 */
export const buildTsvectorInsertValue = (textParamIndex: number): string =>
  `to_tsvector('english', COALESCE($${textParamIndex.toString()}, ''))`;
