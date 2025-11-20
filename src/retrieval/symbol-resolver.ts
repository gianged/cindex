/**
 * Symbol Resolution (Stage 3 of retrieval pipeline)
 *
 * Resolves symbols referenced in code chunks to their definitions.
 * Extracts dependencies from chunk metadata and queries code_symbols table.
 */

import { type DatabaseClient } from '@database/client';
import { logger } from '@utils/logger';
import { type RelevantChunk, type ResolvedSymbol } from '@/types/retrieval';

/**
 * Database row type for symbol resolution
 */
interface SymbolResolutionRow {
  symbol_id: string;
  symbol_name: string;
  symbol_type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'constant' | 'method';
  file_path: string;
  line_number: number;
  definition: string;
  scope: 'exported' | 'internal';
  workspace_id: string | null;
  service_id: string | null;
}

/**
 * Extract symbols from chunk metadata
 *
 * Looks for symbols in chunk metadata (populated during indexing):
 * - dependencies: imported symbols (e.g., ['UserService', 'AuthController'])
 * - imported_symbols: explicitly imported names
 * - function_names: functions defined in chunk
 * - class_names: classes defined in chunk
 *
 * @param chunks - Relevant chunks from Stage 2
 * @returns Set of unique symbol names to resolve (de-duplicated)
 */
const extractSymbolsFromChunks = (chunks: RelevantChunk[]): Set<string> => {
  const symbols = new Set<string>();

  for (const chunk of chunks) {
    // Extract dependencies (imported/used symbols)
    if (Array.isArray(chunk.metadata.dependencies)) {
      for (const dep of chunk.metadata.dependencies) {
        if (typeof dep === 'string' && dep.trim().length > 0) {
          symbols.add(dep.trim());
        }
      }
    }

    // Extract imported symbols
    if (Array.isArray(chunk.metadata.imported_symbols)) {
      for (const symbol of chunk.metadata.imported_symbols) {
        if (typeof symbol === 'string' && symbol.trim().length > 0) {
          symbols.add(symbol.trim());
        }
      }
    }

    // Extract function names (for cross-references)
    if (Array.isArray(chunk.metadata.function_names)) {
      for (const funcName of chunk.metadata.function_names) {
        if (typeof funcName === 'string' && funcName.trim().length > 0) {
          symbols.add(funcName.trim());
        }
      }
    }

    // Extract class names (for cross-references)
    if (Array.isArray(chunk.metadata.class_names)) {
      for (const className of chunk.metadata.class_names) {
        if (typeof className === 'string' && className.trim().length > 0) {
          symbols.add(className.trim());
        }
      }
    }
  }

  return symbols;
};

/**
 * Resolve symbols to their definitions
 *
 * Queries code_symbols table for symbol definitions.
 * Filters by scope='exported' to find public APIs (avoids internal implementation details).
 * Returns definitions with file paths and line numbers for context.
 *
 * @param chunks - Relevant chunks from Stage 2
 * @param db - Database client
 * @returns Array of resolved symbol definitions (may include multiple definitions per symbol name)
 * @throws Error if database query fails
 */
export const resolveSymbols = async (chunks: RelevantChunk[], db: DatabaseClient): Promise<ResolvedSymbol[]> => {
  const startTime = Date.now();

  // Step 1: Extract unique symbols from chunk metadata
  const symbolNames = extractSymbolsFromChunks(chunks);

  if (symbolNames.size === 0) {
    logger.debug('No symbols found in chunk metadata');
    return [];
  }

  logger.debug('Extracted symbols from chunks', {
    chunksAnalyzed: chunks.length,
    uniqueSymbols: symbolNames.size,
  });

  // Step 2: Query code_symbols table
  // Filter by scope='exported' to get public APIs (avoids polluting context with internal symbols)
  const symbolNamesArray = Array.from(symbolNames);

  const query = `
    SELECT
      symbol_id,
      symbol_name,
      symbol_type,
      file_path,
      line_number,
      definition,
      scope,
      workspace_id,
      service_id
    FROM code_symbols
    WHERE symbol_name = ANY($1::text[])
      AND scope = 'exported'
    ORDER BY symbol_name, file_path
  `;

  const params = [symbolNamesArray];

  try {
    const result = await db.query<SymbolResolutionRow>(query, params);

    const resolvedSymbols: ResolvedSymbol[] = result.rows.map((row) => ({
      symbol_name: row.symbol_name,
      symbol_type: row.symbol_type,
      file_path: row.file_path,
      line_number: row.line_number,
      definition: row.definition,
      scope: row.scope,
      // Multi-project context (nullable)
      workspace_id: row.workspace_id ?? undefined,
      service_id: row.service_id ?? undefined,
      is_internal: row.workspace_id !== null || row.service_id !== null,
    }));

    const resolutionTime = Date.now() - startTime;

    // Calculate statistics
    const symbolsByType = resolvedSymbols.reduce<Record<string, number>>((acc, symbol) => {
      acc[symbol.symbol_type] = (acc[symbol.symbol_type] || 0) + 1;
      return acc;
    }, {});

    const resolvedCount = new Set(resolvedSymbols.map((s) => s.symbol_name)).size;
    const unresolvedCount = symbolNames.size - resolvedCount;

    logger.info('Symbol resolution complete', {
      symbolsExtracted: symbolNames.size,
      symbolsResolved: resolvedCount,
      symbolsUnresolved: unresolvedCount,
      totalDefinitions: resolvedSymbols.length,
      symbolsByType,
      resolutionTime,
    });

    // Log unresolved symbols for debugging (at debug level)
    if (unresolvedCount > 0) {
      const resolvedNames = new Set(resolvedSymbols.map((s) => s.symbol_name));
      const unresolvedNames = Array.from(symbolNames).filter((name) => !resolvedNames.has(name));
      logger.debug('Unresolved symbols', {
        count: unresolvedCount,
        symbols: unresolvedNames.slice(0, 10), // Log first 10 only
      });
    }

    return resolvedSymbols;
  } catch (error) {
    logger.error('Symbol resolution failed', {
      error: error instanceof Error ? error.message : String(error),
      symbolsToResolve: symbolNames.size,
    });
    throw error;
  }
};

/**
 * Resolve symbols with workspace/service filtering (multi-project support)
 *
 * This is a filtered version for multi-project mode (will be enhanced in Phase B).
 * Adds filtering by workspace_id or service_id to find internal vs external symbols.
 *
 * @param chunks - Relevant chunks from Stage 2
 * @param db - Database client
 * @param filters - Optional filters for multi-project
 * @returns Array of resolved symbols within specified scope
 */
export const resolveSymbolsFiltered = async (
  chunks: RelevantChunk[],
  db: DatabaseClient,
  filters: {
    workspace_ids?: string[];
    service_ids?: string[];
    include_internal?: boolean; // Include internal (non-exported) symbols
  }
): Promise<ResolvedSymbol[]> => {
  const startTime = Date.now();

  const symbolNames = extractSymbolsFromChunks(chunks);

  if (symbolNames.size === 0) {
    logger.debug('No symbols found in chunk metadata (filtered)');
    return [];
  }

  logger.debug('Extracted symbols from chunks (filtered)', {
    chunksAnalyzed: chunks.length,
    uniqueSymbols: symbolNames.size,
    filters,
  });

  const symbolNamesArray = Array.from(symbolNames);

  // Build dynamic WHERE clause
  const whereClauses: string[] = ['symbol_name = ANY($1::text[])'];
  const params: unknown[] = [symbolNamesArray];

  // Filter by scope unless include_internal is true
  if (!filters.include_internal) {
    whereClauses.push("scope = 'exported'");
  }

  if (filters.workspace_ids && filters.workspace_ids.length > 0) {
    whereClauses.push(`workspace_id = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.workspace_ids);
  }

  if (filters.service_ids && filters.service_ids.length > 0) {
    whereClauses.push(`service_id = ANY($${String(params.length + 1)}::text[])`);
    params.push(filters.service_ids);
  }

  const query = `
    SELECT
      symbol_id,
      symbol_name,
      symbol_type,
      file_path,
      line_number,
      definition,
      scope,
      workspace_id,
      service_id
    FROM code_symbols
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY symbol_name, file_path
  `;

  try {
    const result = await db.query<SymbolResolutionRow>(query, params);

    const resolvedSymbols: ResolvedSymbol[] = result.rows.map((row) => ({
      symbol_name: row.symbol_name,
      symbol_type: row.symbol_type,
      file_path: row.file_path,
      line_number: row.line_number,
      definition: row.definition,
      scope: row.scope,
      workspace_id: row.workspace_id ?? undefined,
      service_id: row.service_id ?? undefined,
      is_internal: row.workspace_id !== null || row.service_id !== null,
    }));

    const resolutionTime = Date.now() - startTime;

    logger.info('Filtered symbol resolution complete', {
      symbolsExtracted: symbolNames.size,
      symbolsResolved: new Set(resolvedSymbols.map((s) => s.symbol_name)).size,
      totalDefinitions: resolvedSymbols.length,
      filters,
      resolutionTime,
    });

    return resolvedSymbols;
  } catch (error) {
    logger.error('Filtered symbol resolution failed', {
      error: error instanceof Error ? error.message : String(error),
      symbolsToResolve: symbolNames.size,
      filters,
    });
    throw error;
  }
};
