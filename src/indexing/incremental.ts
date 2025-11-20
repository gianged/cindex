/**
 * Incremental Indexing Module
 *
 * Provides hash-based change detection to skip unchanged files during re-indexing.
 * Uses SHA256 file hashes to identify new, modified, unchanged, and deleted files.
 *
 * Key Features:
 * - Hash comparison: Compare filesystem hashes with database hashes
 * - Change classification: Categorize files into new/modified/unchanged/deleted
 * - Selective processing: Only re-index files that have changed
 * - Stale data cleanup: Remove chunks/symbols for modified/deleted files
 *
 * Performance Target: 100 files processed in <15s (vs 30-60s for full re-index)
 */

import { type DatabaseClient } from '@database/client';
import { logger } from '@utils/logger';
import { type DiscoveredFile } from '@/types/indexing';

/**
 * File change types for incremental indexing
 */
export type FileChangeType = 'new' | 'modified' | 'unchanged' | 'deleted';

/**
 * Classified file changes
 */
export interface FileChanges {
  /** Newly discovered files (not in database) */
  new: DiscoveredFile[];

  /** Files with changed content (different hash) */
  modified: DiscoveredFile[];

  /** Files with identical content (same hash, skip processing) */
  unchanged: DiscoveredFile[];

  /** Files removed from filesystem (in database but not discovered) */
  deleted: string[]; // Array of file_path strings
}

/**
 * Statistics for incremental indexing
 */
export interface IncrementalStats {
  new_files: number;
  modified_files: number;
  unchanged_files: number;
  deleted_files: number;
  total_discovered: number;
  files_to_process: number; // new + modified
  skip_rate: number; // percentage of files skipped
}

/**
 * Database row for file hash query
 */
interface FileHashRow {
  file_path: string;
  file_hash: string;
}

/**
 * Fetch existing file hashes from database
 *
 * Queries the code_files table to get current hashes for all files in a repository.
 * Uses indexed query for fast lookup (idx_files_path exists in schema).
 *
 * @param db - Database client
 * @param repoPath - Repository path to filter files
 * @returns Map of file_path → file_hash
 */
const fetchExistingHashes = async (db: DatabaseClient, repoPath: string): Promise<Map<string, string>> => {
  logger.debug('Fetching existing file hashes from database', { repo: repoPath });

  const query = `
    SELECT file_path, file_hash
    FROM code_files
    WHERE repo_path = $1
  `;

  const result = await db.query<FileHashRow>(query, [repoPath]);

  const hashMap = new Map<string, string>();
  for (const row of result.rows) {
    hashMap.set(row.file_path, row.file_hash);
  }

  logger.debug('Fetched existing file hashes', {
    repo: repoPath,
    filesInDatabase: hashMap.size,
  });

  return hashMap;
};

/**
 * Classify discovered files by comparing with database hashes
 *
 * Compares file hashes between filesystem (discovered files) and database:
 * - New: file_path not in database
 * - Modified: file_path in database but hash changed
 * - Unchanged: file_path in database and hash matches
 * - Deleted: file_path in database but not in discovered files
 *
 * @param discoveredFiles - Files found in filesystem with current hashes
 * @param existingHashes - Map of file_path → hash from database
 * @returns Classified file changes
 */
const classifyFileChanges = (discoveredFiles: DiscoveredFile[], existingHashes: Map<string, string>): FileChanges => {
  const changes: FileChanges = {
    new: [],
    modified: [],
    unchanged: [],
    deleted: [],
  };

  // Track which files we've seen in discovered files
  const discoveredPaths = new Set<string>();

  // Classify each discovered file
  for (const file of discoveredFiles) {
    discoveredPaths.add(file.relative_path);

    const existingHash = existingHashes.get(file.relative_path);

    if (!existingHash) {
      // File not in database = new
      changes.new.push(file);
    } else if (existingHash !== file.file_hash) {
      // File in database but hash changed = modified
      changes.modified.push(file);
    } else {
      // File in database and hash matches = unchanged
      changes.unchanged.push(file);
    }
  }

  // Find deleted files (in database but not discovered)
  for (const [filePath] of existingHashes) {
    if (!discoveredPaths.has(filePath)) {
      changes.deleted.push(filePath);
    }
  }

  return changes;
};

/**
 * Calculate incremental indexing statistics
 *
 * @param changes - Classified file changes
 * @returns Statistics summary
 */
const calculateStats = (changes: FileChanges): IncrementalStats => {
  const newFiles = changes.new.length;
  const modifiedFiles = changes.modified.length;
  const unchangedFiles = changes.unchanged.length;
  const deletedFiles = changes.deleted.length;
  const totalDiscovered = newFiles + modifiedFiles + unchangedFiles;
  const filesToProcess = newFiles + modifiedFiles;
  const skipRate = totalDiscovered > 0 ? (unchangedFiles / totalDiscovered) * 100 : 0;

  return {
    new_files: newFiles,
    modified_files: modifiedFiles,
    unchanged_files: unchangedFiles,
    deleted_files: deletedFiles,
    total_discovered: totalDiscovered,
    files_to_process: filesToProcess,
    skip_rate: skipRate,
  };
};

/**
 * Delete stale data for modified or deleted files
 *
 * Removes chunks and symbols for files that have been modified or deleted.
 * Must be called BEFORE inserting new data to avoid constraint violations.
 *
 * Database cascade rules:
 * - Deleting chunks → automatically deletes dependent symbols (ON DELETE CASCADE)
 * - Must delete chunks before inserting new ones for the same file
 *
 * @param db - Database client
 * @param filePaths - Array of file paths to delete data for
 * @returns Deletion statistics
 */
export const deleteStaleData = async (
  db: DatabaseClient,
  filePaths: string[]
): Promise<{ chunks_deleted: number; symbols_deleted: number }> => {
  if (filePaths.length === 0) {
    return { chunks_deleted: 0, symbols_deleted: 0 };
  }

  logger.debug('Deleting stale data for modified/deleted files', {
    fileCount: filePaths.length,
    files: filePaths.slice(0, 5), // Log first 5 for debugging
  });

  try {
    // Delete symbols first (respects foreign key constraints)
    const symbolsQuery = 'DELETE FROM code_symbols WHERE file_path = ANY($1::text[])';
    const symbolsResult = await db.query(symbolsQuery, [filePaths]);
    const symbolsDeleted = symbolsResult.rowCount ?? 0;

    // Delete chunks
    const chunksQuery = 'DELETE FROM code_chunks WHERE file_path = ANY($1::text[])';
    const chunksResult = await db.query(chunksQuery, [filePaths]);
    const chunksDeleted = chunksResult.rowCount ?? 0;

    logger.info('Deleted stale data', {
      fileCount: filePaths.length,
      chunks_deleted: chunksDeleted,
      symbols_deleted: symbolsDeleted,
    });

    return {
      chunks_deleted: chunksDeleted,
      symbols_deleted: symbolsDeleted,
    };
  } catch (error) {
    logger.error('Failed to delete stale data', {
      error: error instanceof Error ? error.message : String(error),
      fileCount: filePaths.length,
    });
    throw error;
  }
};

/**
 * Detect file changes for incremental indexing
 *
 * Main entry point for incremental indexing. Compares discovered files with
 * database to identify which files need re-processing.
 *
 * Workflow:
 * 1. Fetch existing file hashes from database
 * 2. Compare with discovered file hashes
 * 3. Classify files as new/modified/unchanged/deleted
 * 4. Log statistics
 *
 * @param db - Database client
 * @param repoPath - Repository path
 * @param discoveredFiles - Files discovered in filesystem
 * @returns Classified file changes and statistics
 */
export const detectFileChanges = async (
  db: DatabaseClient,
  repoPath: string,
  discoveredFiles: DiscoveredFile[]
): Promise<{ changes: FileChanges; stats: IncrementalStats }> => {
  const startTime = Date.now();

  logger.info('Starting incremental change detection', {
    repo: repoPath,
    discoveredFiles: discoveredFiles.length,
  });

  // Step 1: Fetch existing hashes from database
  const existingHashes = await fetchExistingHashes(db, repoPath);

  // Step 2: Classify changes
  const changes = classifyFileChanges(discoveredFiles, existingHashes);

  // Step 3: Calculate statistics
  const stats = calculateStats(changes);

  const detectionTime = Date.now() - startTime;

  logger.info('Incremental change detection complete', {
    repo: repoPath,
    new_files: stats.new_files,
    modified_files: stats.modified_files,
    unchanged_files: stats.unchanged_files,
    deleted_files: stats.deleted_files,
    skip_rate: stats.skip_rate.toFixed(1) + '%',
    files_to_process: stats.files_to_process,
    detection_time_ms: detectionTime,
  });

  // Log summary for user visibility
  if (stats.unchanged_files > 0) {
    logger.info(
      `Skipping ${stats.unchanged_files.toLocaleString()} unchanged files (${stats.skip_rate.toFixed(1)}% skip rate)`
    );
  }

  if (stats.deleted_files > 0) {
    logger.info(`Found ${stats.deleted_files.toLocaleString()} deleted files (will be removed from index)`);
  }

  return { changes, stats };
};

/**
 * Process incremental changes
 *
 * Orchestrates the incremental indexing workflow:
 * 1. Delete old chunks/symbols for modified files (required because chunks use ON CONFLICT DO NOTHING)
 * 2. Delete data for deleted files
 * 3. Return files that need processing (new + modified)
 *
 * Why delete modified files?
 * - File records use UPSERT (ON CONFLICT DO UPDATE) - these get replaced atomically
 * - Chunks/symbols use ON CONFLICT DO NOTHING - old data stays, new data is ignored
 * - Therefore, we must delete old chunks/symbols before inserting new ones
 *
 * Transaction safety:
 * - Each file's data (file record + chunks + symbols) is processed atomically
 * - DatabaseWriter.insertFile and insertChunks are separate operations
 * - If indexing fails mid-file, we may have partial data (file but no chunks)
 * - This is acceptable: next incremental run will detect the file as modified (hash differs)
 *   and re-process it, replacing the partial data
 *
 * @param db - Database client
 * @param changes - Classified file changes
 * @returns Files to process (new + modified)
 */
export const processIncrementalChanges = async (
  db: DatabaseClient,
  changes: FileChanges
): Promise<DiscoveredFile[]> => {
  logger.info('Processing incremental changes', {
    new: changes.new.length,
    modified: changes.modified.length,
    deleted: changes.deleted.length,
  });

  // Step 1: Delete old chunks/symbols for modified files
  // Required because chunks use ON CONFLICT DO NOTHING, not UPSERT
  const modifiedPaths = changes.modified.map((f) => f.relative_path);
  if (modifiedPaths.length > 0) {
    await deleteStaleData(db, modifiedPaths);
    logger.info('Deleted old chunks/symbols for modified files', { count: modifiedPaths.length });
  }

  // Step 2: Delete data for deleted files
  if (changes.deleted.length > 0) {
    await deleteStaleData(db, changes.deleted);
    logger.info('Deleted data for removed files', { count: changes.deleted.length });
  }

  // Step 3: Return files to process (new + modified)
  // New files: fresh insert
  // Modified files: file record UPSERTs, chunks/symbols freshly inserted (old ones deleted above)
  const filesToProcess = [...changes.new, ...changes.modified];

  logger.info('Incremental processing prepared', {
    files_to_process: filesToProcess.length,
    new: changes.new.length,
    modified: changes.modified.length,
  });

  return filesToProcess;
};
