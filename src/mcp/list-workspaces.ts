/**
 * MCP Tool: list_workspaces
 * List all workspaces in indexed repositories (monorepo support)
 */
import { type Pool } from 'pg';

import { getWorkspaceDependencies, getWorkspaceDependents, listWorkspaces } from '@database/queries';
import { formatWorkspaceList, type WorkspaceInfo } from '@mcp/formatter';
import { validateBoolean, validateRepoId } from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for list_workspaces tool
 */
export interface ListWorkspacesInput {
  repo_id?: string; // Optional: Filter by repository ID
  include_dependencies?: boolean; // Default: false - Include workspace dependencies
  include_metadata?: boolean; // Default: false - Include workspace metadata
}

/**
 * Output schema for list_workspaces tool
 */
export interface ListWorkspacesOutput {
  formatted_result: string; // Markdown-formatted workspace list
  workspaces: WorkspaceInfo[]; // Transformed workspace data
  total_count: number; // Total number of workspaces
}

/**
 * List workspaces MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - List workspaces parameters
 * @returns Formatted workspace list
 */
export const listWorkspacesTool = async (db: Pool, input: ListWorkspacesInput): Promise<ListWorkspacesOutput> => {
  logger.info('list_workspaces tool invoked', { repo_id: input.repo_id });

  // Validate optional parameters
  const repoId = validateRepoId(input.repo_id, false);
  const includeDependencies = validateBoolean('include_dependencies', input.include_dependencies, false) ?? false;
  const includeMetadata = validateBoolean('include_metadata', input.include_metadata, false) ?? false;

  logger.debug('Listing workspaces', {
    repoId,
    includeDependencies,
    includeMetadata,
  });

  // Get workspaces from database
  const dbWorkspaces = await listWorkspaces(db, repoId, {
    includeDependencies,
    includeMetadata,
  });

  if (dbWorkspaces.length === 0) {
    const message = repoId
      ? `# Workspaces\n\nNo workspaces found in repository \`${repoId}\`.\n\n**Tip:** Workspaces are detected during indexing for monorepo projects.`
      : '# Workspaces\n\nNo workspaces found in any indexed repository.\n\n**Tip:** Workspaces are detected during indexing for monorepo projects.';

    logger.info('No workspaces found', { repo_id: repoId });

    return {
      formatted_result: message,
      workspaces: [],
      total_count: 0,
    };
  }

  // Transform workspaces to match formatter's expected type
  const workspaces: WorkspaceInfo[] = await Promise.all(
    dbWorkspaces.map(async (workspace) => ({
      workspace_id: workspace.workspace_id,
      package_name: workspace.package_name,
      workspace_path: workspace.workspace_path,
      dependencies: includeDependencies ? await getWorkspaceDependencies(db, workspace.workspace_id) : undefined,
      dependents: includeDependencies ? await getWorkspaceDependents(db, workspace.package_name) : undefined,
    }))
  );

  // Format output (note: formatWorkspaceList only accepts workspaces array, not repoId as second parameter)
  const formattedResult = formatWorkspaceList(workspaces);

  logger.info('list_workspaces completed', {
    total_count: workspaces.length,
    repo_id: repoId,
  });

  return {
    formatted_result: formattedResult,
    workspaces,
    total_count: workspaces.length,
  };
};
