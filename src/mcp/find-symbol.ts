/**
 * MCP Tool: find_symbol_definition
 * Locate symbol definitions and optionally show usages across the codebase
 */
import { type Pool } from 'pg';

import { searchSymbols } from '@database/queries';
import { formatCodeBlock, formatFilePath, formatResolvedSymbol } from '@mcp/formatter';
import {
  validateArray,
  validateBoolean,
  validateMaxResults,
  validateScopeFilter,
  validateSymbolName,
} from '@mcp/validator';
import { logger } from '@utils/logger';
import { type ResolvedSymbol } from '@/types/retrieval';

/**
 * Input schema for find_symbol_definition tool
 */
export interface FindSymbolInput {
  symbol_name: string; // Symbol name to search for (supports partial match)
  include_usages?: boolean; // Default: false - Include symbol usages
  scope_filter?: 'all' | 'exported' | 'internal'; // Default: all - Filter by scope

  // Multi-project scope filtering
  workspace_scope?: string | string[]; // Limit to workspace(s)
  service_scope?: string | string[]; // Limit to service(s)
  repo_scope?: string | string[]; // Limit to repository(s)

  // Usage options
  include_cross_workspace?: boolean; // Default: false - Include cross-workspace usages
  include_cross_service?: boolean; // Default: false - Include cross-service usages
  max_usages?: number; // Default: 50, Range: 1-100 - Limit number of usages returned
}

/**
 * Symbol usage location
 */
export interface SymbolUsage {
  file_path: string;
  line_number: number;
  chunk_content: string;
  chunk_type: string;
  workspace_id?: string;
  service_id?: string;
  repo_id?: string;
}

/**
 * Output schema for find_symbol_definition tool
 */
export interface FindSymbolOutput {
  formatted_result: string; // Markdown-formatted symbol definitions and usages
  symbols: ResolvedSymbol[]; // Symbol definitions found
  total_usages?: number; // Total usages found (if include_usages is true)
}

/**
 * Normalize scope filter parameter
 */
const normalizeScope = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return [value];
  }

  const arr = validateArray('scope', value, false) as string[] | undefined;
  return arr;
};

/**
 * Find symbol usages in code chunks
 */
const findSymbolUsages = async (
  db: Pool,
  symbolName: string,
  options: {
    workspaceScope?: string[];
    serviceScope?: string[];
    repoScope?: string[];
    includeCrossWorkspace?: boolean;
    includeCrossService?: boolean;
    maxUsages?: number;
  }
): Promise<SymbolUsage[]> => {
  try {
    const conditions: string[] = [`chunk_content ILIKE $1`];
    const params: unknown[] = [`%${symbolName}%`];
    let paramIndex = 2;

    // Workspace scope filter
    if (options.workspaceScope && options.workspaceScope.length > 0) {
      conditions.push(`workspace_id = ANY($${String(paramIndex++)})`);
      params.push(options.workspaceScope);
    }

    // Service scope filter
    if (options.serviceScope && options.serviceScope.length > 0) {
      conditions.push(`service_id = ANY($${String(paramIndex++)})`);
      params.push(options.serviceScope);
    }

    // Repository scope filter
    if (options.repoScope && options.repoScope.length > 0) {
      conditions.push(`repo_id = ANY($${String(paramIndex++)})`);
      params.push(options.repoScope);
    }

    const limit = options.maxUsages ?? 50;

    const sql = `
      SELECT
        file_path,
        start_line as line_number,
        chunk_content,
        chunk_type,
        workspace_id,
        service_id,
        repo_id
      FROM code_chunks
      WHERE ${conditions.join(' AND ')}
      ORDER BY file_path, start_line
      LIMIT ${String(limit)}
    `;

    const result = await db.query<SymbolUsage>(sql, params);

    return result.rows;
  } catch (error) {
    logger.error('Failed to find symbol usages', { symbol_name: symbolName, error });
    return [];
  }
};

/**
 * Format symbol usages as Markdown
 */
const formatSymbolUsages = (usages: SymbolUsage[]): string => {
  const lines: string[] = [];

  // Group by file
  const byFile = new Map<string, SymbolUsage[]>();
  for (const usage of usages) {
    if (!byFile.has(usage.file_path)) {
      byFile.set(usage.file_path, []);
    }
    const fileGroup = byFile.get(usage.file_path);
    if (fileGroup) {
      fileGroup.push(usage);
    }
  }

  lines.push('## Symbol Usages\n');
  lines.push(`**Total Locations:** ${String(usages.length)}\n`);

  for (const [filePath, fileUsages] of byFile) {
    lines.push(`### ${formatFilePath(filePath)}\n`);
    lines.push(`**Occurrences:** ${String(fileUsages.length)}\n`);

    for (const usage of fileUsages.slice(0, 5)) {
      // Detect language from file extension
      const language = filePath.split('.').pop() ?? 'text';

      lines.push(`#### Line ${String(usage.line_number)}`);

      // Multi-project context
      const contextParts: string[] = [];
      if (usage.repo_id) contextParts.push(`Repo: \`${usage.repo_id}\``);
      if (usage.workspace_id) contextParts.push(`Workspace: \`${usage.workspace_id}\``);
      if (usage.service_id) contextParts.push(`Service: \`${usage.service_id}\``);

      if (contextParts.length > 0) {
        lines.push(`**Context:** ${contextParts.join(' | ')}`);
      }

      lines.push(`\n${formatCodeBlock(usage.chunk_content, language)}\n`);
    }

    if (fileUsages.length > 5) {
      lines.push(`_... and ${String(fileUsages.length - 5)} more occurrences in this file_\n`);
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Find symbol definition MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - Find symbol parameters
 * @returns Formatted symbol definitions and usages
 */
export const findSymbolTool = async (db: Pool, input: FindSymbolInput): Promise<FindSymbolOutput> => {
  logger.info('find_symbol_definition tool invoked', { symbol_name: input.symbol_name });

  // Validate required parameters
  const symbolName = validateSymbolName(input.symbol_name, true);
  if (!symbolName) throw new Error('symbol_name validation failed');

  // Validate optional parameters
  const includeUsages = validateBoolean('include_usages', input.include_usages, false) ?? false;
  const scopeFilter = validateScopeFilter(input.scope_filter, false) ?? 'all';

  // Validate multi-project scope filters
  const workspaceScope = normalizeScope(input.workspace_scope);
  const serviceScope = normalizeScope(input.service_scope);
  const repoScope = normalizeScope(input.repo_scope);

  // Validate usage options
  const includeCrossWorkspace =
    validateBoolean('include_cross_workspace', input.include_cross_workspace, false) ?? false;
  const includeCrossService = validateBoolean('include_cross_service', input.include_cross_service, false) ?? false;
  const maxUsages = validateMaxResults(input.max_usages, false) ?? 50;

  logger.debug('Searching for symbol', {
    symbolName,
    scopeFilter,
    includeUsages,
    workspaceScope,
    serviceScope,
    repoScope,
  });

  // Search for symbol definitions
  const searchOptions: {
    scope?: 'all' | 'exported' | 'internal';
    workspaceId?: string;
    serviceId?: string;
    repoId?: string;
    limit?: number;
  } = {
    scope: scopeFilter,
    limit: 50,
  };

  // Apply single workspace/service/repo filter (use first if array)
  if (workspaceScope && workspaceScope.length > 0) {
    searchOptions.workspaceId = workspaceScope[0];
  }
  if (serviceScope && serviceScope.length > 0) {
    searchOptions.serviceId = serviceScope[0];
  }
  if (repoScope && repoScope.length > 0) {
    searchOptions.repoId = repoScope[0];
  }

  const symbols = await searchSymbols(db, symbolName, searchOptions);

  if (symbols.length === 0) {
    logger.info('No symbols found', { symbol_name: symbolName });

    return {
      formatted_result: `# Symbol Not Found: \`${symbolName}\`\n\nNo symbols matching this name were found in the indexed codebase.`,
      symbols: [],
      total_usages: 0,
    };
  }

  // Find usages if requested
  let usages: SymbolUsage[] = [];
  if (includeUsages) {
    usages = await findSymbolUsages(db, symbolName, {
      workspaceScope,
      serviceScope,
      repoScope,
      includeCrossWorkspace,
      includeCrossService,
      maxUsages,
    });
  }

  // Format output
  const lines: string[] = [];

  lines.push(`# Symbol Definitions: \`${symbolName}\`\n`);
  lines.push(`**Total Definitions:** ${String(symbols.length)}\n`);

  // Group by scope (exported first)
  const exported = symbols.filter((s) => s.scope === 'exported');
  const internal = symbols.filter((s) => s.scope === 'internal');

  if (exported.length > 0) {
    lines.push('## Exported Symbols\n');
    for (const symbol of exported) {
      lines.push(formatResolvedSymbol(symbol));
      lines.push('');
    }
  }

  if (internal.length > 0) {
    lines.push('## Internal Symbols\n');
    for (const symbol of internal) {
      lines.push(formatResolvedSymbol(symbol));
      lines.push('');
    }
  }

  // Add usages section
  if (includeUsages && usages.length > 0) {
    lines.push(formatSymbolUsages(usages));
  } else if (includeUsages && usages.length === 0) {
    lines.push('## Symbol Usages\n');
    lines.push('No usages found in indexed code.\n');
  }

  const formattedResult = lines.join('\n');

  logger.info('find_symbol_definition completed', {
    symbol_name: symbolName,
    total_definitions: symbols.length,
    total_usages: usages.length,
  });

  return {
    formatted_result: formattedResult,
    symbols,
    total_usages: usages.length,
  };
};
