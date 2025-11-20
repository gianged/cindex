/**
 * MCP Tool: find_cross_workspace_usages
 * Find workspace package usages across the monorepo
 */
import { type Pool } from 'pg';

import { findCrossWorkspaceUsages, type CrossWorkspaceUsageDetail } from '@database/queries';
import { formatCrossWorkspaceUsages } from '@mcp/formatter';
import { validateBoolean, validateNumberInRange, validateString, validateWorkspaceId } from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for find_cross_workspace_usages tool
 */
export interface FindCrossWorkspaceUsagesInput {
  workspace_id?: string; // Workspace ID (required if package_name not provided)
  package_name?: string; // Package name (required if workspace_id not provided)
  symbol_name?: string; // Optional: Filter by specific symbol
  include_indirect?: boolean; // Default: false - Include indirect usages (transitive dependencies)
  max_depth?: number; // Default: 3, Range: 1-5 - Maximum dependency depth to search
}

/**
 * Output schema for find_cross_workspace_usages tool
 */
export interface FindCrossWorkspaceUsagesOutput {
  formatted_result: string; // Markdown-formatted usage results
  usages: {
    source_workspace_id: string;
    source_package_name: string;
    symbol_name?: string;
    file_path: string;
    line_number: number;
    depth: number;
  }[];
  total_usages: number;
}

/**
 * Find cross-workspace usages MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - Find cross-workspace usages parameters
 * @returns Formatted usage results
 */
export const findCrossWorkspaceUsagesTool = async (
  db: Pool,
  input: FindCrossWorkspaceUsagesInput
): Promise<FindCrossWorkspaceUsagesOutput> => {
  logger.info('find_cross_workspace_usages tool invoked', {
    workspace_id: input.workspace_id,
    package_name: input.package_name,
  });

  // Validate required parameters (either workspace_id or package_name)
  const workspaceId = validateWorkspaceId(input.workspace_id, false);
  const packageName = validateString('package_name', input.package_name, false);

  if (!workspaceId && !packageName) {
    throw new Error('Either workspace_id or package_name is required');
  }

  // Validate optional parameters
  const symbolName = validateString('symbol_name', input.symbol_name, false);
  const includeIndirect = validateBoolean('include_indirect', input.include_indirect, false) ?? false;
  const maxDepth = validateNumberInRange('max_depth', input.max_depth, 1, 5, false) ?? 3;

  logger.debug('Finding cross-workspace usages', {
    workspaceId,
    packageName,
    symbolName,
    includeIndirect,
    maxDepth,
  });

  // Get cross-workspace usages from database
  const dbUsages = await findCrossWorkspaceUsages(db, {
    workspaceId,
    packageName,
    symbolName,
    includeIndirect,
    maxDepth,
  });

  if (dbUsages.length === 0) {
    const identifier = packageName ?? workspaceId ?? 'unknown';
    const message = `# Cross-Workspace Usages\n\nNo usages found for workspace package \`${identifier}\`.\n\n**Tip:** This workspace may not be used by other packages in the monorepo.`;

    logger.info('No cross-workspace usages found', {
      workspace_id: workspaceId,
      package_name: packageName,
    });

    return {
      formatted_result: message,
      usages: [],
      total_usages: 0,
    };
  }

  // Transform database results to match expected output format
  // Flatten file-level imports into individual usage records
  const usages = dbUsages.flatMap((workspaceUsage: CrossWorkspaceUsageDetail) =>
    workspaceUsage.file_imports.map((fileImport) => ({
      source_workspace_id: workspaceUsage.workspace_id,
      source_package_name: workspaceUsage.package_name,
      symbol_name: symbolName ?? fileImport.symbols.join(', '), // Use symbol filter or list all imported symbols
      file_path: fileImport.file_path,
      line_number: fileImport.line_number,
      depth: 1, // Currently only direct imports supported (transitive tracking in future)
    }))
  );

  // Format output
  const formattedResult = formatCrossWorkspaceUsages(usages, packageName ?? workspaceId ?? 'unknown');

  logger.info('find_cross_workspace_usages completed', {
    workspace_id: workspaceId,
    package_name: packageName,
    total_usages: usages.length,
  });

  return {
    formatted_result: formattedResult,
    usages,
    total_usages: usages.length,
  };
};
