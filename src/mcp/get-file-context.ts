/**
 * MCP Tool: get_file_context
 * Get full context for a specific file with callers, callees, and dependencies
 */
import { type Pool } from 'pg';

import { getFileContext } from '@database/queries';
import { formatFilePath, formatRelevantChunk } from '@mcp/formatter';
import {
  validateBoolean,
  validateFilePath,
  validateImportDepth,
  validateRepoId,
  validateServiceId,
  validateWorkspaceId,
} from '@mcp/validator';
import { logger } from '@utils/logger';
import { getImportPaths, type CodeFile } from '@/types/database';

/**
 * Input schema for get_file_context tool
 */
export interface GetFileContextInput {
  file_path: string; // Absolute file path
  include_callers?: boolean; // Default: true - Include files that import this file
  include_callees?: boolean; // Default: true - Include files imported by this file
  import_depth?: number; // Default: 2, Range: 1-3 - Depth of import chain expansion

  // Multi-project options
  workspace?: string; // Limit context to this workspace
  include_workspace_only?: boolean; // Default: false - Don't cross workspace boundaries
  service?: string; // Limit context to this service
  include_service_only?: boolean; // Default: false - Don't cross service boundaries
  respect_workspace_boundaries?: boolean; // Default: false - Honor workspace boundaries
  respect_service_boundaries?: boolean; // Default: false - Honor service boundaries
  repo_id?: string; // Specify repository ID
}

/**
 * Output schema for get_file_context tool
 */
export interface GetFileContextOutput {
  formatted_result: string; // Markdown-formatted file context
  file: CodeFile; // File metadata
  total_callers: number; // Number of callers found
  total_callees: number; // Number of callees found
  total_chunks: number; // Number of code chunks
}

/**
 * Filter imports based on workspace/service boundaries
 *
 * Queries the database to get workspace_id/service_id for each import,
 * then filters based on boundary options by comparing with source file context.
 *
 * @param imports - List of import paths to filter
 * @param file - Source file with workspace_id/service_id context
 * @param options - Boundary filtering options
 * @param db - Database connection pool
 * @returns Filtered list of imports respecting boundaries
 */
const filterImportsByBoundaries = async (
  imports: string[],
  file: CodeFile,
  options: {
    workspace?: string;
    includeWorkspaceOnly?: boolean;
    service?: string;
    includeServiceOnly?: boolean;
    respectWorkspaceBoundaries?: boolean;
    respectServiceBoundaries?: boolean;
  },
  db: Pool
): Promise<string[]> => {
  // If no boundary restrictions, return all imports
  if (
    !options.includeWorkspaceOnly &&
    !options.includeServiceOnly &&
    !options.respectWorkspaceBoundaries &&
    !options.respectServiceBoundaries
  ) {
    return imports;
  }

  // If no imports, return empty array
  if (imports.length === 0) {
    return [];
  }

  // Query code_files to get workspace_id/service_id for all imports
  const query = `
    SELECT file_path, workspace_id, service_id
    FROM code_files
    WHERE file_path = ANY($1)
  `;

  const result = await db.query<{
    file_path: string;
    workspace_id: string | null;
    service_id: string | null;
  }>(query, [imports]);

  // Create a map for fast lookup
  const importMetadata = new Map<string, { workspace_id: string | null; service_id: string | null }>();
  for (const row of result.rows) {
    importMetadata.set(row.file_path, {
      workspace_id: row.workspace_id,
      service_id: row.service_id,
    });
  }

  // Filter imports based on boundary options
  const filteredImports: string[] = [];

  for (const importPath of imports) {
    const metadata = importMetadata.get(importPath);

    // If import not found in database, keep it (might be external package)
    if (!metadata) {
      filteredImports.push(importPath);
      continue;
    }

    let shouldInclude = true;

    // includeWorkspaceOnly: Only include imports within same workspace
    if (options.includeWorkspaceOnly) {
      if (file.workspace_id && metadata.workspace_id !== file.workspace_id) {
        shouldInclude = false;
      }
    }

    // includeServiceOnly: Only include imports within same service
    if (options.includeServiceOnly) {
      if (file.service_id && metadata.service_id !== file.service_id) {
        shouldInclude = false;
      }
    }

    // respectWorkspaceBoundaries: Stop at workspace boundaries
    if (options.respectWorkspaceBoundaries) {
      if (file.workspace_id && metadata.workspace_id && metadata.workspace_id !== file.workspace_id) {
        shouldInclude = false;
      }
    }

    // respectServiceBoundaries: Stop at service boundaries
    if (options.respectServiceBoundaries) {
      if (file.service_id && metadata.service_id && metadata.service_id !== file.service_id) {
        shouldInclude = false;
      }
    }

    if (shouldInclude) {
      filteredImports.push(importPath);
    }
  }

  return filteredImports;
};

/**
 * Expand import chain recursively with boundary-aware filtering
 *
 * @param db - Database connection pool
 * @param filePath - File path to expand
 * @param depth - Current depth in the import chain
 * @param maxDepth - Maximum depth to traverse
 * @param visited - Set of already visited files (prevents circular imports)
 * @param boundaryOptions - Boundary filtering options
 * @param sourceFile - Source file context for boundary comparison
 * @returns Map of file paths to their metadata (summary, exports, depth)
 */
const expandImportChain = async (
  db: Pool,
  filePath: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>,
  boundaryOptions: {
    workspace?: string;
    includeWorkspaceOnly?: boolean;
    service?: string;
    includeServiceOnly?: boolean;
    respectWorkspaceBoundaries?: boolean;
    respectServiceBoundaries?: boolean;
  },
  sourceFile: CodeFile
): Promise<Map<string, { summary: string; exports: string[]; depth: number }>> => {
  const result = new Map<string, { summary: string; exports: string[]; depth: number }>();

  if (depth >= maxDepth || visited.has(filePath)) {
    return result;
  }

  visited.add(filePath);

  // Get file metadata (need workspace_id/service_id for boundary filtering)
  const fileResult = await db.query<CodeFile>(
    `SELECT file_path, file_summary, exports, imports, workspace_id, service_id FROM code_files WHERE file_path = $1`,
    [filePath]
  );

  if (fileResult.rows.length === 0) {
    return result;
  }

  const file = fileResult.rows[0];

  // Add current file to result
  result.set(filePath, {
    summary: file.file_summary ?? '',
    exports: file.exports ?? [],
    depth,
  });

  // Get imports and apply boundary filtering
  const imports = getImportPaths(file.imports);
  const filteredImports = await filterImportsByBoundaries(imports, sourceFile, boundaryOptions, db);

  // Recursively expand filtered imports
  for (const importPath of filteredImports) {
    if (!visited.has(importPath)) {
      const subImports = await expandImportChain(
        db,
        importPath,
        depth + 1,
        maxDepth,
        visited,
        boundaryOptions,
        sourceFile
      );
      for (const [path, data] of subImports) {
        result.set(path, data);
      }
    }
  }

  return result;
};

/**
 * Format import chain as Markdown tree
 */
const formatImportTree = (
  imports: Map<string, { summary: string; exports: string[]; depth: number }>,
  maxDepth: number
): string => {
  const lines: string[] = [];

  // Group by depth
  const byDepth = new Map<number, string[]>();
  for (const [path, data] of imports) {
    if (!byDepth.has(data.depth)) {
      byDepth.set(data.depth, []);
    }
    const depthPaths = byDepth.get(data.depth);
    if (depthPaths) {
      depthPaths.push(path);
    }
  }

  // Format each depth level
  for (let d = 0; d <= maxDepth; d++) {
    const paths = byDepth.get(d);
    if (!paths || paths.length === 0) continue;

    if (d === 0) {
      lines.push('**Direct Imports:**\n');
    } else {
      lines.push(`**Depth ${String(d)}:**\n`);
    }

    for (const path of paths) {
      const data = imports.get(path);
      if (!data) continue;

      const indent = '  '.repeat(d);
      lines.push(`${indent}- ${formatFilePath(path)}`);

      if (data.exports.length > 0) {
        lines.push(
          `${indent}  _Exports:_ ${data.exports.slice(0, 5).join(', ')}${data.exports.length > 5 ? '...' : ''}`
        );
      }
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Get file context MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - Get file context parameters
 * @returns Formatted file context with callers, callees, and chunks
 */
export const getFileContextTool = async (db: Pool, input: GetFileContextInput): Promise<GetFileContextOutput> => {
  logger.info('get_file_context tool invoked', { file_path: input.file_path });

  // Validate required parameters
  const filePath = validateFilePath(input.file_path, true);
  if (!filePath) throw new Error('file_path validation failed');

  // Validate optional parameters
  const includeCallers = validateBoolean('include_callers', input.include_callers, false) ?? true;
  const includeCallees = validateBoolean('include_callees', input.include_callees, false) ?? true;
  const importDepth = validateImportDepth(input.import_depth, false) ?? 2;

  // Validate multi-project options
  const workspace = validateWorkspaceId(input.workspace, false);
  const includeWorkspaceOnly = validateBoolean('include_workspace_only', input.include_workspace_only, false) ?? false;
  const service = validateServiceId(input.service, false);
  const includeServiceOnly = validateBoolean('include_service_only', input.include_service_only, false) ?? false;
  const respectWorkspaceBoundaries =
    validateBoolean('respect_workspace_boundaries', input.respect_workspace_boundaries, false) ?? false;
  const respectServiceBoundaries =
    validateBoolean('respect_service_boundaries', input.respect_service_boundaries, false) ?? false;
  // Note: repo_id validation exists but not currently used in boundary filtering
  validateRepoId(input.repo_id, false);

  logger.debug('Getting file context', {
    filePath,
    includeCallers,
    includeCallees,
    importDepth,
    workspace,
    service,
  });

  // Get file context from database
  const context = await getFileContext(db, filePath, includeCallers, includeCallees);

  if (!context) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Filter imports based on boundaries
  const filteredCallees = await filterImportsByBoundaries(
    context.callees,
    context.file,
    {
      workspace,
      includeWorkspaceOnly,
      service,
      includeServiceOnly,
      respectWorkspaceBoundaries,
      respectServiceBoundaries,
    },
    db
  );

  // Expand import chain with boundary filtering
  const importChain = await expandImportChain(
    db,
    filePath,
    0,
    importDepth,
    new Set<string>(),
    {
      workspace,
      includeWorkspaceOnly,
      service,
      includeServiceOnly,
      respectWorkspaceBoundaries,
      respectServiceBoundaries,
    },
    context.file
  );

  // Format output
  const lines: string[] = [];

  lines.push(`# File Context: ${formatFilePath(filePath)}\n`);

  // File metadata
  lines.push('## File Metadata\n');
  lines.push(`**Language:** ${context.file.language}`);
  lines.push(`**Lines:** ${String(context.file.total_lines)}`);

  // Multi-project context
  if (context.file.repo_id) lines.push(`**Repository:** \`${context.file.repo_id}\``);
  if (context.file.workspace_id) lines.push(`**Workspace:** \`${context.file.workspace_id}\``);
  if (context.file.package_name) lines.push(`**Package:** \`${context.file.package_name}\``);
  if (context.file.service_id) lines.push(`**Service:** \`${context.file.service_id}\``);

  lines.push(`\n**Summary:** ${context.file.file_summary ?? 'No summary available'}\n`);

  // Exports
  if (context.file.exports && context.file.exports.length > 0) {
    lines.push('## Exports\n');
    lines.push(context.file.exports.map((exp) => `- \`${exp}\``).join('\n'));
    lines.push('');
  }

  // Callers (files that import this file)
  if (includeCallers && context.callers.length > 0) {
    lines.push('## Callers (Files that import this file)\n');
    lines.push(`**Total:** ${String(context.callers.length)}\n`);
    for (const caller of context.callers.slice(0, 20)) {
      lines.push(`- ${formatFilePath(caller)}`);
    }
    if (context.callers.length > 20) {
      lines.push(`- _... and ${String(context.callers.length - 20)} more_`);
    }
    lines.push('');
  }

  // Callees (imports) with expansion
  if (includeCallees && filteredCallees.length > 0) {
    lines.push('## Dependencies (Import Chain)\n');
    lines.push(`**Direct Imports:** ${String(filteredCallees.length)}`);
    lines.push(`**Import Depth:** ${String(importDepth)}`);
    lines.push(`**Total Files in Chain:** ${String(importChain.size)}\n`);

    if (importChain.size > 0) {
      lines.push(formatImportTree(importChain, importDepth));
    } else {
      for (const callee of filteredCallees.slice(0, 20)) {
        lines.push(`- ${formatFilePath(callee)}`);
      }
      if (filteredCallees.length > 20) {
        lines.push(`- _... and ${String(filteredCallees.length - 20)} more_`);
      }
      lines.push('');
    }
  }

  // Code chunks
  if (context.chunks.length > 0) {
    lines.push('## Code Chunks\n');
    lines.push(`**Total:** ${String(context.chunks.length)} chunks\n`);

    for (const chunk of context.chunks) {
      lines.push(
        formatRelevantChunk({
          chunk_id: String(chunk.id),
          file_path: chunk.file_path,
          chunk_content: chunk.chunk_content,
          chunk_type: chunk.chunk_type,
          start_line: chunk.start_line,
          end_line: chunk.end_line,
          token_count: chunk.token_count ?? 0,
          metadata: chunk.metadata as Record<string, unknown>,
          similarity: 1.0, // Not a search result, so similarity is 1.0
          workspace_id: chunk.workspace_id ?? undefined,
          package_name: chunk.package_name ?? undefined,
          service_id: chunk.service_id ?? undefined,
          repo_id: chunk.repo_id ?? undefined,
        })
      );
      lines.push('');
    }
  }

  const formattedResult = lines.join('\n');

  logger.info('get_file_context completed', {
    file_path: filePath,
    total_callers: context.callers.length,
    total_callees: filteredCallees.length,
    total_chunks: context.chunks.length,
  });

  return {
    formatted_result: formattedResult,
    file: context.file,
    total_callers: context.callers.length,
    total_callees: filteredCallees.length,
    total_chunks: context.chunks.length,
  };
};
