/**
 * MCP Tool: delete_repository
 * Deletes one or more repositories and all associated data
 */
import type { Pool } from 'pg';

import { deleteRepository, type DeletionStats } from '@indexing/version-tracker';
import { logger } from '@utils/logger';

/**
 * Input schema for delete_repository tool
 */
export interface DeleteRepositoryInput {
  repo_ids: string[]; // Array of repository IDs to delete
}

/**
 * Output schema for delete_repository tool
 */
export interface DeleteRepositoryOutput {
  deleted: number; // Number of repositories deleted
  repositories: DeletionStats[]; // Statistics for each deleted repository
}

/**
 * Validate repository IDs before deletion
 * Fail-fast approach: if any repo_id is invalid, reject entire request
 *
 * @param db - Database connection pool
 * @param repoIds - Array of repository IDs to validate
 * @returns Array of invalid repo_ids (empty if all valid)
 */
const validateRepositoryIds = async (db: Pool, repoIds: string[]): Promise<string[]> => {
  const invalidIds: string[] = [];

  for (const repoId of repoIds) {
    const result = await db.query('SELECT repo_id FROM repositories WHERE repo_id = $1', [repoId]);

    if (result.rows.length === 0) {
      invalidIds.push(repoId);
    }
  }

  return invalidIds;
};

/**
 * Delete repositories MCP tool implementation
 * Validates all repo_ids exist before deleting any
 *
 * @param db - Database connection pool
 * @param input - Delete repository input (repo_ids array)
 * @returns Deletion statistics for all repositories
 */
export const deleteRepositoryTool = async (db: Pool, input: DeleteRepositoryInput): Promise<DeleteRepositoryOutput> => {
  const { repo_ids: repoIds } = input;

  // Input validation
  if (!Array.isArray(repoIds) || repoIds.length === 0) {
    throw new Error('repo_ids must be a non-empty array');
  }

  // Validate all repo_ids exist (fail-fast)
  logger.info('Validating repository IDs', { count: repoIds.length });
  const invalidIds = await validateRepositoryIds(db, repoIds);

  if (invalidIds.length > 0) {
    throw new Error(`Invalid repository IDs: ${invalidIds.join(', ')}. No repositories were deleted.`);
  }

  // All valid - proceed with deletion
  logger.info('Deleting repositories', { repo_ids: repoIds });

  const deletionStats: DeletionStats[] = [];

  for (const repoId of repoIds) {
    try {
      const stats = await deleteRepository(db, repoId);
      deletionStats.push(stats);
    } catch (error) {
      logger.error('Failed to delete repository', {
        repo_id: repoId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to delete repository ${repoId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  logger.info('Repositories deleted successfully', {
    deleted: deletionStats.length,
    repo_ids: repoIds,
  });

  return {
    deleted: deletionStats.length,
    repositories: deletionStats,
  };
};

/**
 * Format deletion output as Markdown
 *
 * @param output - Deletion statistics output
 * @returns Formatted Markdown string
 */
export const formatDeletionOutput = (output: DeleteRepositoryOutput): string => {
  const lines: string[] = [];

  lines.push(`# Repository Deletion Complete\n`);
  lines.push(`**Deleted:** ${String(output.deleted)} ${output.deleted === 1 ? 'repository' : 'repositories'}\n`);

  for (const stats of output.repositories) {
    lines.push(`## ${stats.repo_id}`);
    lines.push(`**Type:** ${stats.repo_type}\n`);
    lines.push(`**Statistics:**`);
    lines.push(`- Files: ${String(stats.file_count)}`);
    lines.push(`- Code chunks: ${String(stats.chunk_count)}`);
    lines.push(`- Symbols: ${String(stats.symbol_count)}`);
    lines.push(`- Workspaces: ${String(stats.workspace_count)}`);
    lines.push(`- Services: ${String(stats.service_count)}`);
    lines.push('');
  }

  return lines.join('\n');
};
