/**
 * Query Processing (Stage 1 of retrieval pipeline)
 *
 * Handles query preprocessing, type detection, and embedding generation with caching.
 * Converts user queries into 1024-dimensional vectors for semantic search.
 */

import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';
import { type QueryEmbedding, type QueryType } from '@/types/retrieval';

/**
 * Cache entry for query embeddings
 */
interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

/**
 * Query embedding cache
 * Uses Map with TTL-based expiration (1 hour)
 */
class QueryEmbeddingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60 * 60 * 1000; // 1 hour

  /**
   * Get cached embedding if exists and not expired
   */
  get(query: string): number[] | null {
    const entry = this.cache.get(query);
    if (!entry) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > this.ttlMs;
    if (isExpired) {
      this.cache.delete(query);
      return null;
    }

    return entry.embedding;
  }

  /**
   * Store embedding in cache
   */
  set(query: string, embedding: number[]): void {
    this.cache.set(query, {
      embedding,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear expired entries from cache
   */
  cleanExpired(): void {
    const now = Date.now();
    for (const [query, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(query);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; ttl_ms: number } {
    return {
      size: this.cache.size,
      ttl_ms: this.ttlMs,
    };
  }
}

/**
 * Global query embedding cache instance
 */
const queryCache = new QueryEmbeddingCache();

/**
 * Detect query type based on content patterns
 *
 * Code snippets typically contain:
 * - Programming language keywords (function, class, const, let, var, def, etc.)
 * - Special characters in higher density ({}, (), [], =>, ===, etc.)
 * - Code syntax patterns (import, export, return, if, for, while)
 *
 * Natural language queries:
 * - Conversational tone (how to, where is, find, search, show me)
 * - Lower special character density
 * - Question patterns (?, what, when, how, why, where)
 *
 * @param query - The query text to classify
 * @returns The detected query type
 */
const detectQueryType = (query: string): QueryType => {
  const lowerQuery = query.toLowerCase();

  // Code indicators
  const codeKeywords = [
    'function',
    'const',
    'let',
    'var',
    'class',
    'interface',
    'type',
    'import',
    'export',
    'return',
    'async',
    'await',
    'def',
    'public',
    'private',
    'static',
  ];

  const codeSymbols = ['=>', '===', '!==', '++', '--', '&&', '||', '::'];

  // Natural language indicators
  const naturalLanguagePatterns = [
    'how to',
    'how do',
    'where is',
    'find',
    'search',
    'show me',
    'what is',
    'when',
    'why',
    'explain',
  ];

  // Count code indicators
  const codeKeywordCount = codeKeywords.filter((keyword) => lowerQuery.includes(keyword)).length;
  const codeSymbolCount = codeSymbols.filter((symbol) => query.includes(symbol)).length;

  // Count natural language indicators
  const naturalLanguageCount = naturalLanguagePatterns.filter((pattern) => lowerQuery.includes(pattern)).length;

  // Calculate special character density
  const specialChars = query.match(/[{}()[\]=<>]/g) ?? [];
  const specialCharDensity = specialChars.length / query.length;

  // Decision logic
  if (codeKeywordCount >= 2 || codeSymbolCount >= 1 || specialCharDensity > 0.1) {
    return 'code_snippet';
  }

  if (naturalLanguageCount >= 1 || query.includes('?')) {
    return 'natural_language';
  }

  // Default: natural language
  return 'natural_language';
};

/**
 * Preprocess query text
 *
 * Normalizes whitespace and removes special characters that don't affect semantic meaning.
 * Preserves code syntax for code snippets.
 *
 * @param query - Raw query text
 * @param queryType - Detected query type
 * @returns Preprocessed query text
 */
const preprocessQuery = (query: string, queryType: QueryType): string => {
  // Trim leading/trailing whitespace
  let processed = query.trim();

  // Normalize internal whitespace (multiple spaces → single space)
  processed = processed.replace(/\s+/g, ' ');

  // For natural language: remove extra punctuation at the end
  if (queryType === 'natural_language') {
    processed = processed.replace(/[.!?]+$/, '');
  }

  // For code snippets: preserve all syntax including special characters
  // No additional preprocessing needed

  return processed;
};

/**
 * Generate query embedding with caching
 *
 * Converts user query into a 1024-dimensional vector for semantic search.
 * Caches embeddings for 1 hour to avoid redundant API calls.
 *
 * @param query - User query text
 * @param config - cindex configuration
 * @param ollamaClient - Ollama API client
 * @returns Query embedding result
 */
export const processQuery = async (
  query: string,
  config: CindexConfig,
  ollamaClient: OllamaClient
): Promise<QueryEmbedding> => {
  const startTime = Date.now();

  // Step 1: Detect query type
  const queryType = detectQueryType(query);
  logger.debug('Query type detected', { query, queryType });

  // Step 2: Preprocess query
  const processedQuery = preprocessQuery(query, queryType);
  logger.debug('Query preprocessed', { original: query, processed: processedQuery });

  // Step 3: Check cache
  const cachedEmbedding = queryCache.get(processedQuery);
  if (cachedEmbedding) {
    logger.debug('Query embedding retrieved from cache', {
      query: processedQuery,
      cacheStats: queryCache.getStats(),
    });

    return {
      query_text: processedQuery,
      query_type: queryType,
      embedding: cachedEmbedding,
      generation_time_ms: Date.now() - startTime,
    };
  }

  // Step 4: Generate embedding via Ollama
  logger.debug('Generating query embedding', {
    query: processedQuery,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const embedding = await ollamaClient.generateEmbedding(
    config.embedding.model,
    processedQuery,
    config.embedding.dimensions,
    config.embedding.context_window
  );

  // Step 5: Cache the embedding
  queryCache.set(processedQuery, embedding);
  logger.debug('Query embedding cached', {
    query: processedQuery,
    cacheStats: queryCache.getStats(),
  });

  const generationTime = Date.now() - startTime;

  logger.info('Query embedding generated', {
    query: processedQuery,
    queryType,
    dimensions: embedding.length,
    generationTime,
  });

  return {
    query_text: processedQuery,
    query_type: queryType,
    embedding,
    generation_time_ms: generationTime,
  };
};

/**
 * Clear expired cache entries
 * Should be called periodically (e.g., every hour) to prevent memory leaks
 */
export const cleanQueryCache = (): void => {
  queryCache.cleanExpired();
  logger.debug('Query cache cleaned', queryCache.getStats());
};

/**
 * Get query cache statistics
 */
export const getQueryCacheStats = (): { size: number; ttl_ms: number } => {
  return queryCache.getStats();
};
