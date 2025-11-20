/**
 * MCP Tool: get_workspace_context
 * Get full context for a workspace with dependency tree (monorepo support)
 */
import { type Pool } from 'pg';

import { getWorkspaceContext, type WorkspaceContext } from '@database/queries';
import { formatWorkspaceContext } from '@mcp/formatter';
import {
  validateBoolean,
  validateNumberInRange,
  validateRepoId,
  validateString,
  validateWorkspaceId,
} from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for get_workspace_context tool
 */
export interface GetWorkspaceContextInput {
  workspace_id?: string; // Workspace ID (required if package_name not provided)
  package_name?: string; // Package name (required if workspace_id not provided)
  repo_id?: string; // Optional: Repository ID for disambiguation
  include_dependencies?: boolean; // Default: true - Include workspace dependencies
  include_dependents?: boolean; // Default: true - Include workspaces that depend on this one
  dependency_depth?: number; // Default: 2, Range: 1-5 - Depth of dependency tree
}

/**
 * Output schema for get_workspace_context tool
 */
export interface GetWorkspaceContextOutput {
  formatted_result: string; // Markdown-formatted workspace context
  context: WorkspaceContext; // Raw workspace context
}

/**
 * Get workspace context MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - Get workspace context parameters
 * @returns Formatted workspace context with dependencies
 */
export const getWorkspaceContextTool = async (
  db: Pool,
  input: GetWorkspaceContextInput
): Promise<GetWorkspaceContextOutput> => {
  logger.info('get_workspace_context tool invoked', {
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
  const repoId = validateRepoId(input.repo_id, false);
  const includeDependencies = validateBoolean('include_dependencies', input.include_dependencies, false) ?? true;
  const includeDependents = validateBoolean('include_dependents', input.include_dependents, false) ?? true;
  const dependencyDepth = validateNumberInRange('dependency_depth', input.dependency_depth, 1, 5, false) ?? 2;

  logger.debug('Getting workspace context', {
    workspaceId,
    packageName,
    repoId,
    includeDependencies,
    includeDependents,
    dependencyDepth,
  });

  // Get workspace context from database
  const context = await getWorkspaceContext(db, {
    workspaceId,
    packageName,
    repoId,
    includeDependencies,
    includeDependents,
    dependencyDepth,
  });

  if (!context) {
    const identifier = workspaceId ?? packageName ?? 'unknown';
    throw new Error(`Workspace not found: ${identifier}`);
  }

  // Format output
  const formattedResult = formatWorkspaceContext(context);

  logger.info('get_workspace_context completed', {
    workspace_id: context.workspace.id,
    package_name: context.workspace.package_name,
    dependencies_count: context.dependencies.length,
    dependents_count: context.dependents.length,
  });

  return {
    formatted_result: formattedResult,
    context,
  };
};
