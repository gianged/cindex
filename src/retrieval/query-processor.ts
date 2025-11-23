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
 * Enhance natural language query with code-like context for chunk search
 *
 * Chunk embeddings are ~95% code content with only ~5% natural language summary.
 * To bridge this semantic gap, we enhance natural language queries with:
 * 1. Code structure keywords (function, class, export, import)
 * 2. Programming concepts related to the query
 * 3. Common implementation patterns
 *
 * This creates an embedding that's closer to how chunk embeddings are built,
 * significantly improving retrieval accuracy for natural language queries.
 *
 * @param query - Preprocessed natural language query
 * @returns Enhanced query text with code-like context
 */
const enhanceQueryForChunkSearch = (query: string): string => {
  const lowerQuery = query.toLowerCase();

  // Map common natural language concepts to code patterns
  const conceptMappings: Record<string, string[]> = {
    // Error handling concepts
    error: ['try', 'catch', 'throw', 'Error', 'exception', 'error handling'],
    exception: ['try', 'catch', 'throw', 'Error', 'exception handling'],
    handle: ['handler', 'catch', 'process', 'callback', 'event handler'],

    // Authentication/Authorization
    auth: ['authenticate', 'authorize', 'login', 'logout', 'token', 'session', 'password'],
    login: ['authenticate', 'signin', 'credentials', 'session', 'user authentication'],
    permission: ['authorize', 'role', 'access', 'permission check', 'authorization'],

    // Data operations
    fetch: ['fetch', 'get', 'request', 'API call', 'HTTP', 'async', 'await'],
    save: ['save', 'store', 'write', 'persist', 'database', 'insert', 'update'],
    delete: ['delete', 'remove', 'destroy', 'drop', 'database'],
    update: ['update', 'modify', 'patch', 'set', 'database'],
    query: ['query', 'select', 'find', 'search', 'filter', 'database'],

    // Validation
    valid: ['validate', 'check', 'verify', 'schema', 'validation', 'sanitize'],
    check: ['validate', 'verify', 'test', 'condition', 'guard', 'assertion'],

    // Cache/Performance
    cache: ['cache', 'memoize', 'store', 'invalidate', 'TTL', 'memory'],
    optim: ['optimize', 'performance', 'efficient', 'cache', 'lazy'],

    // Async patterns
    async: ['async', 'await', 'Promise', 'callback', 'then', 'concurrent'],
    parallel: ['Promise.all', 'concurrent', 'parallel', 'async', 'batch'],

    // Testing
    test: ['test', 'spec', 'describe', 'it', 'expect', 'mock', 'jest', 'vitest'],

    // Logging/Debug
    log: ['logger', 'console', 'debug', 'info', 'warn', 'error', 'logging'],
    debug: ['debug', 'trace', 'log', 'inspect', 'breakpoint'],

    // Configuration
    config: ['config', 'settings', 'options', 'environment', 'env', 'configuration'],
    env: ['environment', 'config', 'process.env', 'dotenv', 'settings'],

    // Database
    database: ['database', 'db', 'query', 'SQL', 'PostgreSQL', 'connection', 'pool'],
    sql: ['SQL', 'query', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'JOIN'],

    // API
    api: ['API', 'endpoint', 'route', 'REST', 'HTTP', 'request', 'response'],
    endpoint: ['endpoint', 'route', 'handler', 'controller', 'API'],
    route: ['route', 'router', 'path', 'endpoint', 'handler', 'middleware'],

    // Components/UI
    component: ['component', 'render', 'props', 'state', 'hook', 'JSX', 'React'],
    render: ['render', 'component', 'JSX', 'template', 'view', 'display'],

    // State management
    state: ['state', 'store', 'reducer', 'action', 'context', 'useState'],
    store: ['store', 'state', 'reducer', 'dispatch', 'action', 'redux'],

    // Parsing/Processing
    parse: ['parse', 'parser', 'tokenize', 'AST', 'transform', 'process'],
    process: ['process', 'handle', 'transform', 'pipeline', 'middleware'],

    // File operations
    file: ['file', 'read', 'write', 'fs', 'path', 'stream', 'buffer'],
    read: ['read', 'file', 'load', 'parse', 'input', 'stream'],
    write: ['write', 'save', 'output', 'file', 'stream', 'buffer'],

    // Import/Export
    import: ['import', 'require', 'module', 'dependency', 'from'],
    export: ['export', 'module', 'default', 'named export', 'public'],

    // Functions/Methods
    function: ['function', 'method', 'async', 'arrow', 'callback', 'handler', 'return'],
    method: ['method', 'function', 'class', 'prototype', 'this', 'call'],
    call: ['call', 'invoke', 'execute', 'function', 'method', 'callback'],

    // Search/Indexing
    search: ['search', 'find', 'query', 'filter', 'match', 'lookup', 'index'],
    index: ['index', 'indexing', 'indexed', 'search', 'vector', 'embedding'],
    embed: ['embedding', 'vector', 'encode', 'model', 'semantic', 'similarity'],

    // Types/Interfaces
    type: ['type', 'interface', 'typeof', 'generic', 'TypeScript', 'definition'],
    interface: ['interface', 'type', 'contract', 'shape', 'definition'],
    class: ['class', 'constructor', 'new', 'instance', 'prototype', 'extends'],

    // Work/Process
    work: ['process', 'handle', 'execute', 'run', 'perform', 'function'],
    generate: ['generate', 'create', 'build', 'produce', 'make', 'construct'],
    create: ['create', 'new', 'generate', 'initialize', 'construct', 'build'],

    // Connection/Network
    connect: ['connect', 'connection', 'pool', 'client', 'socket', 'network'],
    client: ['client', 'connection', 'pool', 'request', 'API', 'http'],
    pool: ['pool', 'connection', 'database', 'client', 'manage'],

    // Retrieve/Get
    retriev: ['retrieve', 'get', 'fetch', 'query', 'find', 'return', 'load'],
    get: ['get', 'retrieve', 'fetch', 'find', 'load', 'return', 'accessor'],

    // Transform/Convert
    transform: ['transform', 'convert', 'map', 'parse', 'process', 'modify'],
    convert: ['convert', 'transform', 'parse', 'cast', 'serialize', 'format'],

    // Repository/Code
    repo: ['repository', 'git', 'codebase', 'project', 'source', 'code'],
    code: ['code', 'source', 'file', 'chunk', 'snippet', 'function'],
  };

  // Collect relevant code patterns based on query words
  const enhancementParts: string[] = [];
  const addedPatterns = new Set<string>();

  for (const [concept, patterns] of Object.entries(conceptMappings)) {
    if (lowerQuery.includes(concept)) {
      for (const pattern of patterns) {
        if (!addedPatterns.has(pattern.toLowerCase())) {
          enhancementParts.push(pattern);
          addedPatterns.add(pattern.toLowerCase());
        }
      }
    }
  }

  // Add generic code structure keywords that help match any code chunk
  const codeStructureHints = ['function', 'const', 'export', 'import', 'return', 'async', 'class', 'interface', 'type'];

  // Only add structure hints if we don't have many specific enhancements
  if (enhancementParts.length < 5) {
    for (const hint of codeStructureHints.slice(0, 5 - enhancementParts.length)) {
      if (!addedPatterns.has(hint)) {
        enhancementParts.push(hint);
        addedPatterns.add(hint);
      }
    }
  }

  // Build enhanced query: original query + code context
  // Format matches how chunk embeddings include summary + code
  const enhancedQuery =
    enhancementParts.length > 0 ? `${query}\n\nCode context: ${enhancementParts.join(', ')}` : query;

  return enhancedQuery;
};

/**
 * Generate query embedding with caching
 *
 * Converts user query into a 1024-dimensional vector for semantic search.
 * Caches embeddings for 30 minutes to avoid redundant API calls (saves ~80% of Ollama requests).
 *
 * For natural language queries, generates two embeddings:
 * 1. `embedding` - Raw query embedding (used for file-level search, matches natural language summaries)
 * 2. `chunk_embedding` - Enhanced embedding with code context (used for chunk-level search)
 *
 * This dual-embedding approach bridges the semantic gap between natural language queries
 * and code-dominated chunk embeddings (~95% code content).
 *
 * @param query - User query text
 * @param config - cindex configuration
 * @param ollamaClient - Ollama API client
 * @returns Query embedding result with query type, embedding vector(s), and generation time
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

  // Step 3: Check cache for raw embedding
  const cacheKey = processedQuery;
  const cachedEmbedding = queryEmbeddingCache.get(cacheKey);

  // Step 4: Generate or retrieve raw embedding
  let embedding: number[];
  if (cachedEmbedding) {
    embedding = cachedEmbedding;
    const cacheStats = queryEmbeddingCache.getStats();
    logger.debug('Query embedding retrieved from cache', {
      query: processedQuery,
      cacheSize: cacheStats.size,
      hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
    });
  } else {
    logger.debug('Generating query embedding', {
      query: processedQuery,
      model: config.embedding.model,
      dimensions: config.embedding.dimensions,
    });

    embedding = await ollamaClient.generateEmbedding(
      config.embedding.model,
      processedQuery,
      config.embedding.dimensions,
      config.embedding.context_window
    );

    // Cache the raw embedding
    queryEmbeddingCache.set(cacheKey, embedding);
    const cacheStats = queryEmbeddingCache.getStats();
    logger.debug('Query embedding cached', {
      query: processedQuery,
      cacheSize: cacheStats.size,
      hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
    });
  }

  // Step 5: Generate enhanced embedding for chunk search (all query types)
  // Chunk embeddings are ~95% code, so even code-like queries benefit from enhancement
  // to include related concepts (e.g., "function" → "async, export, return")
  let chunkEmbedding: number[] | undefined;

  const enhancedQuery = enhanceQueryForChunkSearch(processedQuery);
  // Only generate enhanced embedding if the query was actually enhanced
  const wasEnhanced = enhancedQuery !== processedQuery;

  if (wasEnhanced) {
    const enhancedCacheKey = `enhanced:${processedQuery}`;
    const cachedEnhanced = queryEmbeddingCache.get(enhancedCacheKey);

    if (cachedEnhanced) {
      chunkEmbedding = cachedEnhanced;
      logger.debug('Enhanced embedding retrieved from cache', {
        originalQuery: processedQuery,
      });
    } else {
      logger.debug('Generating enhanced embedding for chunk search', {
        originalQuery: processedQuery,
        enhancedQuery: enhancedQuery.substring(0, 200),
        queryType,
      });

      chunkEmbedding = await ollamaClient.generateEmbedding(
        config.embedding.model,
        enhancedQuery,
        config.embedding.dimensions,
        config.embedding.context_window
      );

      // Cache the enhanced embedding
      queryEmbeddingCache.set(enhancedCacheKey, chunkEmbedding);
      logger.debug('Enhanced embedding cached');
    }
  }

  const generationTime = Date.now() - startTime;

  logger.info('Query embedding generated', {
    query: processedQuery,
    queryType,
    dimensions: embedding.length,
    hasChunkEmbedding: chunkEmbedding !== undefined,
    generationTime,
  });

  return {
    query_text: processedQuery,
    query_type: queryType,
    embedding,
    chunk_embedding: chunkEmbedding,
    generation_time_ms: generationTime,
  };
};
