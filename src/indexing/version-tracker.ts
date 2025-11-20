/**
 * Version Tracking and Re-indexing Module
 *
 * Manages repository versions and re-indexing decisions for reference repositories.
 * Tracks upstream versions (e.g., NestJS v10.3.0 → v10.4.0) and determines when
 * full re-indexing is needed vs incremental updates.
 *
 * Key workflows:
 * 1. Version comparison: Check if upstream version changed
 * 2. Re-index decision: Decide whether to re-index based on version/age/force flag
 * 3. Data cleanup: Clear old data before re-indexing
 * 4. Repository CRUD: Create, update, delete repository entries
 * 5. Statistics: Track indexing progress and file counts
 *
 * Use cases:
 * - Reference repositories: Track framework versions (NestJS, React, etc.)
 * - All repositories: Track last_indexed timestamp for staleness detection
 * - Manual re-indexing: Force re-index with force_reindex flag
 */
import { type Pool, type QueryResult } from 'pg';

import { logger } from '@utils/logger';
import {
  type CountResult,
  type RepositoryMetadata,
  type RepositoryType,
  type RepositoryVersionQueryResult,
  type RepositoryWithCountResult,
  type RepoTypeQueryResult,
} from '@/types/database';

/**
 * Repository version information
 */
export interface RepositoryVersion {
  repo_id: string;
  current_version?: string; // Version from metadata (e.g., 'v10.3.0')
  last_indexed: Date; // When it was last indexed
  indexed_file_count: number; // Number of files indexed
  metadata: RepositoryMetadata;
}

/**
 * Re-index decision result
 */
export interface ReindexDecision {
  should_reindex: boolean; // Whether to re-index
  reason: string; // Reason for decision
  version_changed: boolean; // Whether version changed
  force_requested: boolean; // Whether force_reindex was requested
}

/**
 * Re-index options
 */
export interface ReindexOptions {
  force_reindex?: boolean; // Force re-indexing regardless of version
  version?: string; // New version to index
  compare_version?: boolean; // Compare versions to decide (default: true)
}

/**
 * Get repository version information from database
 *
 * Queries the repositories table for version metadata and file count.
 * Used to check if a repository is already indexed and what version is stored.
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier (e.g., 'nestjs-v10', 'my-app')
 * @returns Repository version info or null if not indexed
 */
export const getRepositoryVersion = async (db: Pool, repoId: string): Promise<RepositoryVersion | null> => {
  const result = await db.query<RepositoryVersionQueryResult>(
    `SELECT
       repo_id,
       metadata,
       indexed_at,
       (SELECT COUNT(*) FROM code_files WHERE repo_id = $1) as file_count
     FROM repositories
     WHERE repo_id = $1`,
    [repoId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const metadata: RepositoryMetadata = row.metadata;

  return {
    repo_id: row.repo_id,
    current_version: metadata.version,
    last_indexed: row.indexed_at,
    indexed_file_count: parseInt(row.file_count, 10),
    metadata,
  };
};

/**
 * Update repository version in database
 *
 * Merges new version string and metadata with existing repository metadata.
 * Updates last_updated timestamp to track when version changed. Used after
 * successful re-indexing to mark the new version as indexed.
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier
 * @param version - New version string (e.g., 'v10.4.0')
 * @param metadata - Additional metadata to merge (e.g., upstream_url, commit_sha)
 */
export const updateRepositoryVersion = async (
  db: Pool,
  repoId: string,
  version: string,
  metadata?: Partial<RepositoryMetadata>
): Promise<void> => {
  // Get current metadata
  const current = await getRepositoryVersion(db, repoId);
  const currentMetadata = current?.metadata ?? {};

  // Merge metadata
  const updatedMetadata: RepositoryMetadata = {
    ...currentMetadata,
    ...metadata,
    version,
    last_indexed: new Date().toISOString(),
  };

  await db.query(
    `UPDATE repositories
     SET metadata = $1,
         last_updated = NOW()
     WHERE repo_id = $2`,
    [JSON.stringify(updatedMetadata), repoId]
  );

  logger.info('Updated repository version', {
    repo_id: repoId,
    version,
    previous_version: current?.current_version,
  });
};

/**
 * Decide whether to re-index a repository based on version and options
 *
 * Decision logic (priority order):
 * 1. force_reindex=true → Always re-index
 * 2. Not previously indexed → Always re-index
 * 3. Version provided + version changed → Re-index
 * 4. Version provided + version unchanged → Skip (use incremental)
 * 5. No version provided → Skip (use incremental)
 *
 * Use cases:
 * - Reference repos: Compare upstream version to decide
 * - Manual re-index: Set force_reindex=true
 * - First-time indexing: Automatically detected
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier
 * @param options - Re-index options (force, version, compare_version)
 * @returns Re-index decision with reason and flags
 */
export const shouldReindex = async (
  db: Pool,
  repoId: string,
  options: ReindexOptions = {}
): Promise<ReindexDecision> => {
  const { force_reindex: forceReindex = false, version, compare_version: compareVersion = true } = options;

  // Check if repository is already indexed
  const current = await getRepositoryVersion(db, repoId);

  // Force re-index requested
  if (forceReindex) {
    return {
      should_reindex: true,
      reason: 'Force re-index requested',
      version_changed: false,
      force_requested: true,
    };
  }

  // Not previously indexed - always index
  if (!current) {
    return {
      should_reindex: true,
      reason: 'Repository not previously indexed',
      version_changed: false,
      force_requested: false,
    };
  }

  // Version provided and comparison enabled
  if (version && compareVersion) {
    const versionChanged = version !== current.current_version;

    if (versionChanged) {
      return {
        should_reindex: true,
        reason: `Version changed: ${current.current_version ?? 'none'} → ${version}`,
        version_changed: true,
        force_requested: false,
      };
    } else {
      return {
        should_reindex: false,
        reason: `Version unchanged: ${version}`,
        version_changed: false,
        force_requested: false,
      };
    }
  }

  // No version provided or comparison disabled - default to incremental indexing
  return {
    should_reindex: false,
    reason: 'Incremental indexing (no version change)',
    version_changed: false,
    force_requested: false,
  };
};

/**
 * Clear all repository data before full re-indexing
 *
 * Deletes all indexed data for a repository in correct order to respect foreign
 * key constraints. Must be called before re-indexing when shouldReindex returns true.
 *
 * Deletion order (respects foreign keys):
 * 1. code_chunks (references code_files)
 * 2. code_symbols (references code_files)
 * 3. code_files
 * 4. workspace_dependencies (references workspaces)
 * 5. workspace_aliases (references workspaces)
 * 6. workspaces (references repositories)
 * 7. services (references repositories)
 * 8. cross_repo_dependencies (references repositories)
 *
 * Note: Does NOT delete the repository entry itself (keeps metadata/version).
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier to clear data for
 */
export const clearRepositoryData = async (db: Pool, repoId: string): Promise<void> => {
  logger.info('Clearing repository data', { repo_id: repoId });

  // Delete in order to respect foreign key constraints
  await db.query('DELETE FROM code_chunks WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM code_symbols WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM code_files WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM workspace_dependencies WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM workspace_aliases WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM workspaces WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM services WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM cross_repo_dependencies WHERE source_repo_id = $1 OR target_repo_id = $1', [repoId]);

  logger.info('Repository data cleared', { repo_id: repoId });
};

/**
 * Create or update repository entry in database
 *
 * Uses UPSERT (INSERT ... ON CONFLICT DO UPDATE) to create new repository
 * or update existing one. Should be called at the start of indexing to ensure
 * repository metadata is up to date.
 *
 * Metadata can include:
 * - version: Version string (e.g., 'v10.3.0')
 * - upstream_url: GitHub URL for reference repos
 * - commit_sha: Git commit hash
 * - last_indexed: ISO timestamp of last indexing
 *
 * @param db - Database connection pool
 * @param repoId - Unique repository identifier
 * @param repoPath - Absolute filesystem path to repository root
 * @param repoType - Repository type (monolithic, monorepo, microservice, etc.)
 * @param metadata - Optional repository metadata
 */
export const upsertRepository = async (
  db: Pool,
  repoId: string,
  repoPath: string,
  repoType: RepositoryType,
  metadata?: RepositoryMetadata
): Promise<void> => {
  const repoName = repoId; // Use repo_id as name by default

  await db.query(
    `INSERT INTO repositories (repo_id, repo_name, repo_path, repo_type, metadata, indexed_at, last_updated)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (repo_id)
     DO UPDATE SET
       repo_path = $3,
       repo_type = $4,
       metadata = $5,
       last_updated = NOW()`,
    [repoId, repoName, repoPath, repoType, JSON.stringify(metadata ?? {})]
  );

  logger.info('Repository entry created/updated', { repo_id: repoId, repo_type: repoType });
};

/**
 * Get indexing statistics for a repository
 *
 * Queries database to count indexed entities across all tables. Useful for
 * displaying indexing progress and verifying successful indexing.
 *
 * Counts:
 * - file_count: Number of indexed files
 * - chunk_count: Number of code chunks (functions, classes, blocks)
 * - symbol_count: Number of symbols (exported functions, classes, types)
 * - workspace_count: Number of monorepo workspaces
 * - service_count: Number of microservices
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier
 * @returns Indexing statistics with entity counts
 */
export const getIndexingStats = async (
  db: Pool,
  repoId: string
): Promise<{
  file_count: number;
  chunk_count: number;
  symbol_count: number;
  workspace_count: number;
  service_count: number;
}> => {
  const [fileResult, chunkResult, symbolResult, workspaceResult, serviceResult] = await Promise.all([
    db.query<CountResult>('SELECT COUNT(*) FROM code_files WHERE repo_id = $1', [repoId]),
    db.query<CountResult>('SELECT COUNT(*) FROM code_chunks WHERE repo_id = $1', [repoId]),
    db.query<CountResult>('SELECT COUNT(*) FROM code_symbols WHERE repo_id = $1', [repoId]),
    db.query<CountResult>('SELECT COUNT(*) FROM workspaces WHERE repo_id = $1', [repoId]),
    db.query<CountResult>('SELECT COUNT(*) FROM services WHERE repo_id = $1', [repoId]),
  ]);

  const getCount = (result: QueryResult<CountResult>): number => {
    if (result.rows.length === 0) {
      return 0;
    }
    const [row] = result.rows;
    return parseInt(row.count, 10);
  };

  return {
    file_count: getCount(fileResult),
    chunk_count: getCount(chunkResult),
    symbol_count: getCount(symbolResult),
    workspace_count: getCount(workspaceResult),
    service_count: getCount(serviceResult),
  };
};

/**
 * List all indexed repositories with version info
 *
 * Retrieves all repositories from database with their version metadata and
 * file counts. Sorted by indexed_at (most recent first). Useful for displaying
 * indexed repository overview in CLI or UI.
 *
 * @param db - Database connection pool
 * @returns Array of repository version info sorted by last indexed date (desc)
 */
export const listIndexedRepositories = async (db: Pool): Promise<RepositoryVersion[]> => {
  const result: QueryResult<RepositoryWithCountResult> = await db.query<RepositoryWithCountResult>(
    `SELECT
       r.repo_id,
       r.repo_type,
       r.metadata,
       r.indexed_at,
       COUNT(f.id) as file_count
     FROM repositories r
     LEFT JOIN code_files f ON r.repo_id = f.repo_id
     GROUP BY r.repo_id, r.repo_type, r.metadata, r.indexed_at
     ORDER BY r.indexed_at DESC`
  );

  const rows = result.rows;

  return rows.map((row: RepositoryWithCountResult): RepositoryVersion => {
    const metadata: RepositoryMetadata = row.metadata;
    return {
      repo_id: row.repo_id,
      current_version: metadata.version,
      last_indexed: row.indexed_at,
      indexed_file_count: parseInt(row.file_count, 10),
      metadata,
    };
  });
};

/**
 * Get reference repository information
 *
 * Specialized query for reference repositories (external frameworks/libraries
 * like NestJS, React, Vue) with upstream URL and version tracking. Filters
 * for repo_type='reference' only.
 *
 * Used for:
 * - Displaying indexed reference frameworks
 * - Checking which versions are indexed
 * - Suggesting re-indexing for outdated references
 *
 * @param db - Database connection pool
 * @returns Array of reference repositories with upstream metadata
 */
export const listReferenceRepositories = async (
  db: Pool
): Promise<
  {
    repo_id: string;
    repo_path: string;
    upstream_url?: string;
    version?: string;
    last_indexed: Date;
    file_count: number;
  }[]
> => {
  const result: QueryResult<RepositoryWithCountResult> = await db.query<RepositoryWithCountResult>(
    `SELECT
       r.repo_id,
       r.repo_path,
       r.metadata,
       r.indexed_at,
       COUNT(f.id) as file_count
     FROM repositories r
     LEFT JOIN code_files f ON r.repo_id = f.repo_id
     WHERE r.repo_type = 'reference'
     GROUP BY r.repo_id, r.repo_path, r.metadata, r.indexed_at
     ORDER BY r.indexed_at DESC`
  );

  const rows = result.rows;

  return rows.map((row: RepositoryWithCountResult) => {
    const metadata: RepositoryMetadata = row.metadata;
    return {
      repo_id: row.repo_id,
      repo_path: row.repo_path,
      upstream_url: metadata.upstream_url,
      version: metadata.version,
      last_indexed: row.indexed_at,
      file_count: parseInt(row.file_count, 10),
    };
  });
};

/**
 * Check if a repository version is outdated based on time
 *
 * Time-based staleness detection. Complements version-based detection for
 * repositories without explicit version tracking. Useful for suggesting
 * re-indexing for long-unindexed repositories.
 *
 * Typical thresholds:
 * - 7 days: Frequently updated projects
 * - 30 days: Standard projects (default)
 * - 90 days: Reference repositories
 *
 * @param lastIndexed - Date when repository was last indexed
 * @param maxAgeDays - Maximum age in days before considering outdated (default: 30)
 * @returns True if repository is older than threshold
 */
export const isRepositoryOutdated = (lastIndexed: Date, maxAgeDays = 30): boolean => {
  const now = new Date();
  const daysSinceIndex = (now.getTime() - lastIndexed.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceIndex > maxAgeDays;
};

/**
 * Deletion statistics for a repository
 */
export interface DeletionStats {
  repo_id: string;
  repo_type: RepositoryType;
  file_count: number;
  chunk_count: number;
  symbol_count: number;
  workspace_count: number;
  service_count: number;
}

/**
 * Delete repository and all associated data completely
 *
 * Removes repository entry and all indexed data (files, chunks, symbols,
 * workspaces, services). Returns statistics about what was deleted for logging
 * and user feedback.
 *
 * Deletion is permanent and cannot be undone. Use clearRepositoryData() if you
 * want to keep the repository entry and re-index later.
 *
 * @param db - Database connection pool
 * @param repoId - Repository identifier to delete
 * @returns Deletion statistics with entity counts
 * @throws {Error} If repository not found
 */
export const deleteRepository = async (db: Pool, repoId: string): Promise<DeletionStats> => {
  logger.info('Deleting repository', { repo_id: repoId });

  // Get repository info and stats before deletion
  const repoResult: QueryResult<RepoTypeQueryResult> = await db.query<RepoTypeQueryResult>(
    'SELECT repo_type FROM repositories WHERE repo_id = $1',
    [repoId]
  );

  const rows = repoResult.rows;

  if (rows.length === 0) {
    throw new Error(`Repository not found: ${repoId}`);
  }

  const [row] = rows;

  const repoType = row.repo_type;

  // Get statistics before deletion
  const stats = await getIndexingStats(db, repoId);

  // Clear all repository data (respects foreign key constraints)
  await clearRepositoryData(db, repoId);

  // Delete repository entry
  await db.query('DELETE FROM repositories WHERE repo_id = $1', [repoId]);

  logger.info('Repository deleted', {
    repo_id: repoId,
    repo_type: repoType,
    files_deleted: stats.file_count,
    chunks_deleted: stats.chunk_count,
  });

  return {
    repo_id: repoId,
    repo_type: repoType,
    file_count: stats.file_count,
    chunk_count: stats.chunk_count,
    symbol_count: stats.symbol_count,
    workspace_count: stats.workspace_count,
    service_count: stats.service_count,
  };
};
