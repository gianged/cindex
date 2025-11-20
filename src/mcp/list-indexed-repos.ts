/**
 * MCP Tool: list_indexed_repos
 * List all indexed repositories with optional metadata and counts
 */
import { type Pool } from 'pg';

import { listIndexedRepositories } from '@database/queries';
import { formatRepositoryList, type RepositoryInfo } from '@mcp/formatter';
import { validateBoolean } from '@mcp/validator';
import { logger } from '@utils/logger';
import { type RepositoryType } from '@/types/database';

/**
 * Input schema for list_indexed_repos tool
 */
export interface ListIndexedReposInput {
  include_metadata?: boolean; // Default: false - Include repository metadata (version, upstream_url)
  include_workspace_count?: boolean; // Default: false - Include workspace count per repository
  include_service_count?: boolean; // Default: false - Include service count per repository
}

/**
 * Output schema for list_indexed_repos tool
 */
export interface ListIndexedReposOutput {
  formatted_result: string; // Markdown-formatted repository list
  repositories: RepositoryInfo[]; // Raw repository data
  total_count: number; // Total number of indexed repositories
}

/**
 * List indexed repositories MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - List indexed repos parameters
 * @returns Formatted repository list with metadata
 */
export const listIndexedReposTool = async (db: Pool, input: ListIndexedReposInput): Promise<ListIndexedReposOutput> => {
  logger.info('list_indexed_repos tool invoked');

  // Validate optional parameters
  const includeMetadata = validateBoolean('include_metadata', input.include_metadata, false) ?? false;
  const includeWorkspaceCount =
    validateBoolean('include_workspace_count', input.include_workspace_count, false) ?? false;
  const includeServiceCount = validateBoolean('include_service_count', input.include_service_count, false) ?? false;

  logger.debug('Listing indexed repositories', {
    includeMetadata,
    includeWorkspaceCount,
    includeServiceCount,
  });

  // Get repositories from database
  const dbRepositories = await listIndexedRepositories(db, {
    includeMetadata,
    includeWorkspaceCount,
    includeServiceCount,
  });

  if (dbRepositories.length === 0) {
    logger.info('No repositories found');

    return {
      formatted_result:
        '# Indexed Repositories\n\nNo repositories have been indexed yet.\n\n**Tip:** Use `index_repository` to index your first codebase.',
      repositories: [],
      total_count: 0,
    };
  }

  // Transform repositories to match formatter's expected type
  const repositories: RepositoryInfo[] = dbRepositories.map((repo) => ({
    repo_id: repo.repo_id,
    repo_name: repo.repo_name,
    repo_type: repo.repo_type as RepositoryType,
    file_count: repo.file_count,
    workspace_count: repo.workspace_count,
    service_count: repo.service_count,
    indexed_at: repo.indexed_at,
    version: repo.version,
    upstream_url: repo.upstream_url,
  }));

  // Format output
  const formattedResult = formatRepositoryList(repositories);

  logger.info('list_indexed_repos completed', {
    total_count: repositories.length,
  });

  return {
    formatted_result: formattedResult,
    repositories,
    total_count: repositories.length,
  };
};
