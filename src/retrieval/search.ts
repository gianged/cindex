/**
 * Search Orchestrator (Main Entry Point)
 *
 * Coordinates the 5-stage retrieval pipeline for single-repository RAG search.
 * Main function: searchCodebase()
 *
 * Pipeline stages:
 * 1. Query Processing → Generate embedding
 * 2. File Retrieval → Find relevant files
 * 3. Chunk Retrieval → Find relevant chunks within files
 * 4. Symbol Resolution → Resolve imported symbols
 * 5. Import Expansion → Build dependency graph (optional)
 * 6. Deduplication → Remove duplicate chunks
 * 7. Context Assembly → Build final SearchResult
 */

import { type DatabaseClient } from '@database/client';
import { enrichWithAPIContracts } from '@retrieval/api-enricher';
import { retrieveChunks } from '@retrieval/chunk-retrieval';
import { assembleContext } from '@retrieval/context-assembler';
import { deduplicateChunksBase } from '@retrieval/deduplicator';
import { retrieveFiles } from '@retrieval/file-retrieval';
import { expandImports } from '@retrieval/import-expander';
import { processQuery } from '@retrieval/query-processor';
import { resolveSymbols } from '@retrieval/symbol-resolver';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';
import { type SearchOptions, type SearchResult } from '@/types/retrieval';

/**
 * Search codebase with semantic RAG retrieval
 *
 * Executes the 7-stage retrieval pipeline:
 * 1. Query Processing: Convert user query to embedding vector
 * 2. File Retrieval: Find top N relevant files (broad search)
 * 3. Chunk Retrieval: Find relevant chunks within top files (precise search)
 * 4. Symbol Resolution: Resolve imported symbols to definitions
 * 5. Import Expansion: Build dependency graph (optional)
 * 6. API Contract Enrichment: Add API contract information (multi-project)
 * 7. Deduplication: Remove duplicate chunks
 * 8. Context Assembly: Build final result with metadata
 *
 * @param query - User query (natural language or code snippet)
 * @param config - cindex configuration
 * @param db - Database client
 * @param ollama - Ollama client for embedding generation
 * @param options - Search options (optional)
 * @returns Search result with relevant files, chunks, symbols, and imports
 */
export const searchCodebase = async (
  query: string,
  config: CindexConfig,
  db: DatabaseClient,
  ollama: OllamaClient,
  options: SearchOptions = {}
): Promise<SearchResult> => {
  const startTime = Date.now();

  // Extract options with defaults
  const maxFiles = options.max_files ?? 15;
  const maxSnippets = options.max_snippets ?? 25;
  const includeImports = options.include_imports ?? true;
  const importDepth = options.import_depth ?? config.performance.import_depth;
  const dedupThreshold = options.dedup_threshold ?? config.performance.dedup_threshold;
  const similarityThreshold = options.similarity_threshold ?? config.performance.similarity_threshold;

  logger.info('Starting codebase search', {
    query: query.substring(0, 100), // Log first 100 chars
    maxFiles,
    maxSnippets,
    includeImports,
    importDepth,
    dedupThreshold,
    similarityThreshold,
  });

  // ============================================================================
  // STAGE 1: Query Processing
  // ============================================================================
  logger.debug('Stage 1: Query processing');
  const queryEmbedding = await processQuery(query, config, ollama);

  // ============================================================================
  // STAGE 2: File-Level Retrieval
  // ============================================================================
  logger.debug('Stage 2: File-level retrieval');
  const relevantFiles = await retrieveFiles(queryEmbedding, config, db, maxFiles, similarityThreshold);

  if (relevantFiles.length === 0) {
    logger.warn('No relevant files found', { query });

    // Early return with empty result
    return assembleContext(
      queryEmbedding,
      [],
      { unique_chunks: [], duplicates_removed: 0, duplicate_map: new Map() },
      [],
      [],
      {
        endpoints: [],
        cross_service_calls: [],
        contract_links: [],
        api_warnings: [],
        apis_by_service: {},
        endpoints_by_chunk: {},
      },
      config,
      db,
      Date.now() - startTime
    );
  }

  // ============================================================================
  // STAGE 3: Chunk-Level Retrieval
  // ============================================================================
  logger.debug('Stage 3: Chunk-level retrieval');
  const relevantChunks = await retrieveChunks(
    queryEmbedding,
    relevantFiles,
    config,
    db,
    maxSnippets * 4, // Retrieve 4x maxSnippets before dedup (expect ~75% dedup rate)
    0.75 // Higher threshold for chunks
  );

  if (relevantChunks.length === 0) {
    logger.info('No relevant chunks found in top files', {
      filesSearched: relevantFiles.length,
    });

    // Return with files but no chunks
    return assembleContext(
      queryEmbedding,
      relevantFiles,
      { unique_chunks: [], duplicates_removed: 0, duplicate_map: new Map() },
      [],
      [],
      {
        endpoints: [],
        cross_service_calls: [],
        contract_links: [],
        api_warnings: [],
        apis_by_service: {},
        endpoints_by_chunk: {},
      },
      config,
      db,
      Date.now() - startTime
    );
  }

  // ============================================================================
  // STAGE 4: Symbol Resolution
  // ============================================================================
  logger.debug('Stage 4: Symbol resolution');
  const resolvedSymbols = await resolveSymbols(relevantChunks, db);

  // ============================================================================
  // STAGE 5: Import Chain Expansion (Optional)
  // ============================================================================
  let importChains: Awaited<ReturnType<typeof expandImports>> = [];
  if (includeImports) {
    logger.debug('Stage 5: Import chain expansion');
    importChains = await expandImports(
      relevantFiles,
      config,
      db,
      10, // Expand top 10 files
      importDepth
    );
  } else {
    logger.debug('Stage 5: Import chain expansion (skipped)');
  }

  // ============================================================================
  // STAGE 6: API Contract Enrichment (Multi-Project)
  // ============================================================================
  logger.debug('Stage 6: API contract enrichment');
  const apiContext = await enrichWithAPIContracts(relevantFiles, relevantChunks, db, queryEmbedding, options);

  // ============================================================================
  // STAGE 7: Deduplication
  // ============================================================================
  logger.debug('Stage 7: Deduplication');
  const dedupResult = deduplicateChunksBase(relevantChunks, dedupThreshold);

  // ============================================================================
  // STAGE 8: Context Assembly
  // ============================================================================
  logger.debug('Stage 8: Context assembly');
  const totalQueryTime = Date.now() - startTime;
  const result = await assembleContext(
    queryEmbedding,
    relevantFiles,
    dedupResult,
    resolvedSymbols,
    importChains,
    apiContext,
    config,
    db,
    totalQueryTime
  );

  logger.info('Codebase search complete', {
    query: query.substring(0, 100),
    filesRetrieved: result.metadata.files_retrieved,
    chunksRetrieved: result.metadata.chunks_retrieved,
    chunksAfterDedup: result.metadata.chunks_after_dedup,
    symbolsResolved: result.metadata.symbols_resolved,
    importDepthReached: result.metadata.import_depth_reached,
    totalTokens: result.metadata.total_tokens.toLocaleString(),
    warnings: result.warnings.length,
    queryTime: totalQueryTime,
  });

  return result;
};

/**
 * Search codebase with explicit repository filtering (multi-project support)
 *
 * Filters search results to only include content from specified repositories.
 * Applies filtering at multiple stages:
 * - Pre-filtering via SearchOptions.repo_filter
 * - Post-filtering on retrieved results
 *
 * Note: Full integration with Stage 0 scope filtering will be completed when
 * retrieval functions are refactored to use vector-search.ts filtering.
 *
 * @param query - User query
 * @param config - cindex configuration
 * @param db - Database client
 * @param ollama - Ollama client
 * @param repoIds - Repository IDs to search within
 * @param options - Search options
 * @returns Search result filtered by repositories
 */
export const searchCodebaseFiltered = async (
  query: string,
  config: CindexConfig,
  db: DatabaseClient,
  ollama: OllamaClient,
  repoIds: string[],
  options: SearchOptions = {}
): Promise<SearchResult> => {
  logger.info('Starting filtered codebase search', {
    query: query.substring(0, 100),
    repoIds,
  });

  // Validate repo IDs
  if (repoIds.length === 0) {
    logger.warn('Empty repo_ids filter provided, returning empty result');

    const startTime = Date.now();
    return assembleContext(
      { query_text: query, query_type: 'natural_language', embedding: [], generation_time_ms: 0 },
      [],
      { unique_chunks: [], duplicates_removed: 0, duplicate_map: new Map() },
      [],
      [],
      {
        endpoints: [],
        cross_service_calls: [],
        contract_links: [],
        api_warnings: [],
        apis_by_service: {},
        endpoints_by_chunk: {},
      },
      config,
      db,
      Date.now() - startTime
    );
  }

  // Set repo_filter in options for future integration with Stage 0 filtering
  const filteredOptions: SearchOptions = {
    ...options,
    repo_filter: repoIds,
  };

  // Perform base search
  const result = await searchCodebase(query, config, db, ollama, filteredOptions);

  // Post-filter results by repository (until full Stage 0 integration is complete)
  const repoIdSet = new Set(repoIds);

  // Filter files
  const filteredFiles = result.context.relevant_files.filter((file) => !file.repo_id || repoIdSet.has(file.repo_id));

  // Filter chunks
  const filteredChunks = result.context.code_locations.filter(
    (chunk) => !chunk.repo_id || repoIdSet.has(chunk.repo_id)
  );

  // Create set of filtered file paths for symbol and import filtering
  const filteredFilePaths = new Set(filteredFiles.map((f) => f.file_path));

  // Filter symbols (based on whether their file is in filtered files)
  const filteredSymbols = result.context.symbols.filter((symbol) => filteredFilePaths.has(symbol.file_path));

  // Filter imports (keep imports from files within filtered repos)
  const filteredImports = result.context.imports.filter((importChain) => filteredFilePaths.has(importChain.file_path));

  // Update metadata
  const filteredMetadata = {
    ...result.metadata,
    files_retrieved: filteredFiles.length,
    chunks_retrieved: filteredChunks.length,
    chunks_after_dedup: filteredChunks.length,
    symbols_resolved: filteredSymbols.length,
    import_depth_reached: filteredImports.length > 0 ? Math.max(...filteredImports.map((ic) => ic.depth)) : 0,
  };

  // Add filtering note to warnings if significant filtering occurred
  const warnings = [...result.warnings];
  const filesFiltered = result.context.relevant_files.length - filteredFiles.length;
  const chunksFiltered = result.context.code_locations.length - filteredChunks.length;

  if (filesFiltered > 0 || chunksFiltered > 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'info',
      message: `Filtered results to ${repoIds.length.toString()} repository/repositories`,
      suggestion: `Excluded ${filesFiltered.toString()} file(s) and ${chunksFiltered.toString()} chunk(s) from other repositories`,
    });
  }

  logger.info('Filtered codebase search complete', {
    reposSearched: repoIds.length,
    filesBeforeFilter: result.context.relevant_files.length,
    filesAfterFilter: filteredFiles.length,
    chunksBeforeFilter: result.context.code_locations.length,
    chunksAfterFilter: filteredChunks.length,
  });

  return {
    ...result,
    warnings,
    metadata: filteredMetadata,
    context: {
      ...result.context,
      relevant_files: filteredFiles,
      code_locations: filteredChunks,
      symbols: filteredSymbols,
      imports: filteredImports,
    },
  };
};
