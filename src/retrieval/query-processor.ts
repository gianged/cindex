/**
 * Query Processing (Stage 1 of retrieval pipeline)
 *
 * Handles query preprocessing, type detection, and embedding generation with caching.
 * Converts user queries into 1024-dimensional vectors for semantic search.
 */

import { queryEmbeddingCache } from '@utils/cache';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';
import { type QueryEmbedding, type QueryType } from '@/types/retrieval';

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
 * @returns The detected query type ('code_snippet' or 'natural_language')
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

  // Calculate special character density (code has higher density of {}, (), [], etc.)
  const specialChars = query.match(/[{}()[\]=<>]/g) ?? [];
  const specialCharDensity = specialChars.length / query.length;

  // Decision logic: prioritize code snippet detection
  // 2+ code keywords OR 1+ code symbols OR >10% special char density = code
  if (codeKeywordCount >= 2 || codeSymbolCount >= 1 || specialCharDensity > 0.1) {
    return 'code_snippet';
  }

  // 1+ natural language patterns OR question mark = natural language
  if (naturalLanguageCount >= 1 || query.includes('?')) {
    return 'natural_language';
  }

  // Default: natural language (safer assumption for ambiguous queries)
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
 * Caches embeddings for 30 minutes to avoid redundant API calls (saves ~80% of Ollama requests).
 *
 * @param query - User query text
 * @param config - cindex configuration
 * @param ollamaClient - Ollama API client
 * @returns Query embedding result with query type, embedding vector, and generation time
 * @throws Error if embedding generation fails (Ollama connection issues, model not found)
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
  const cachedEmbedding = queryEmbeddingCache.get(processedQuery);
  if (cachedEmbedding) {
    const cacheStats = queryEmbeddingCache.getStats();
    logger.debug('Query embedding retrieved from cache', {
      query: processedQuery,
      cacheSize: cacheStats.size,
      hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
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
  queryEmbeddingCache.set(processedQuery, embedding);
  const cacheStats = queryEmbeddingCache.getStats();
  logger.debug('Query embedding cached', {
    query: processedQuery,
    cacheSize: cacheStats.size,
    hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
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
