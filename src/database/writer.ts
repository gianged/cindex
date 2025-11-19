/**
 * Database persistence layer with batch optimization
 *
 * Handles all database write operations for indexing pipeline with batch processing,
 * transactions, and error handling. Optimizes inserts using PostgreSQL bulk operations.
 */

import { type DatabaseClient } from '@database/client';
import { logger } from '@utils/logger';
import {
  type CodeChunk,
  type CodeFile,
  type CodeSymbol,
  type Repository,
  type Workspace,
  type Service,
  type WorkspaceAlias,
  type CrossRepoDependency,
  type WorkspaceDependency,
} from '@/types/database';
import { type BatchInsertResult } from '@/types/indexing';
import { type ParsedAPIEndpoint } from '@/types/api-parsing';

/**
 * Error thrown during database write operations
 */
export class DatabaseWriteError extends Error {
  constructor(
    public readonly table: string,
    public readonly context: string,
    public readonly cause?: Error
  ) {
    super(`Database write failed for ${table}: ${context}`);
    this.name = 'DatabaseWriteError';
  }
}

/**
 * Database writer with batch optimization
 */
export class DatabaseWriter {
  constructor(private readonly dbClient: DatabaseClient) {}

  /**
   * Insert or update file metadata
   *
   * Uses UPSERT (ON CONFLICT DO UPDATE) to handle re-indexing of existing files.
   *
   * @param file - File metadata with summary and embedding
   * @throws {DatabaseWriteError} If insert fails
   */
  public insertFile = async (file: Omit<CodeFile, 'id' | 'indexed_at'>): Promise<void> => {
    logger.debug('Inserting file', {
      file: file.file_path,
      has_summary: !!file.file_summary,
      has_embedding: !!file.summary_embedding,
    });

    const sql = `
      INSERT INTO code_files (
        repo_path, file_path, file_summary, summary_embedding,
        language, total_lines, imports, exports, file_hash,
        last_modified, repo_id, workspace_id, package_name, service_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (file_path) DO UPDATE SET
        file_summary = EXCLUDED.file_summary,
        summary_embedding = EXCLUDED.summary_embedding,
        total_lines = EXCLUDED.total_lines,
        imports = EXCLUDED.imports,
        exports = EXCLUDED.exports,
        file_hash = EXCLUDED.file_hash,
        last_modified = EXCLUDED.last_modified,
        indexed_at = NOW()
    `;

    try {
      await this.dbClient.query(sql, [
        file.repo_path,
        file.file_path,
        file.file_summary,
        file.summary_embedding ? `[${file.summary_embedding.join(',')}]` : null,
        file.language,
        file.total_lines,
        file.imports,
        file.exports,
        file.file_hash,
        file.last_modified,
        file.repo_id ?? null,
        file.workspace_id ?? null,
        file.package_name ?? null,
        file.service_id ?? null,
      ]);

      logger.debug('File inserted', { file: file.file_path });
    } catch (error) {
      throw new DatabaseWriteError('code_files', file.file_path, error as Error);
    }
  };

  /**
   * Batch insert code chunks
   *
   * Processes chunks in batches with transactions for atomic commits.
   * Uses ON CONFLICT DO NOTHING to skip duplicates.
   *
   * @param chunks - Array of code chunks with embeddings
   * @param batchSize - Number of chunks per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertChunks = async (chunks: Omit<CodeChunk, 'id'>[], batchSize = 100): Promise<BatchInsertResult> => {
    logger.info('Batch inserting chunks', {
      total: chunks.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertChunkBatch(batch);
        result.inserted += batch.length;

        logger.debug('Chunk batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Chunk batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Chunk batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of chunks
   *
   * Uses multi-row VALUES for efficient insertion.
   *
   * @param chunks - Batch of chunks to insert
   */
  private insertChunkBatch = async (chunks: Omit<CodeChunk, 'id'>[]): Promise<void> => {
    if (chunks.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const chunk of chunks) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        chunk.repo_path,
        chunk.file_path,
        chunk.chunk_type,
        chunk.chunk_content,
        chunk.start_line,
        chunk.end_line,
        chunk.language,
        chunk.embedding ? `[${chunk.embedding.join(',')}]` : null,
        chunk.token_count,
        chunk.metadata ? JSON.stringify(chunk.metadata) : null,
        chunk.repo_id ?? null,
        chunk.workspace_id ?? null,
        chunk.package_name ?? null,
        chunk.service_id ?? null
      );
    }

    const sql = `
      INSERT INTO code_chunks (
        repo_path, file_path, chunk_type, chunk_content,
        start_line, end_line, language, embedding,
        token_count, metadata, repo_id, workspace_id, package_name, service_id
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT DO NOTHING
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Batch insert code symbols
   *
   * Similar to chunk insertion with batch processing and transactions.
   *
   * @param symbols - Array of code symbols with embeddings
   * @param batchSize - Number of symbols per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertSymbols = async (symbols: Omit<CodeSymbol, 'id'>[], batchSize = 100): Promise<BatchInsertResult> => {
    logger.info('Batch inserting symbols', {
      total: symbols.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, Math.min(i + batchSize, symbols.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertSymbolBatch(batch);
        result.inserted += batch.length;

        logger.debug('Symbol batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Symbol batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Symbol batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of symbols
   *
   * @param symbols - Batch of symbols to insert
   */
  private insertSymbolBatch = async (symbols: Omit<CodeSymbol, 'id'>[]): Promise<void> => {
    if (symbols.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const symbol of symbols) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        symbol.repo_path,
        symbol.symbol_name,
        symbol.symbol_type,
        symbol.file_path,
        symbol.line_number,
        symbol.definition,
        symbol.embedding ? `[${symbol.embedding.join(',')}]` : null,
        symbol.repo_id ?? null,
        symbol.workspace_id ?? null,
        symbol.package_name ?? null
      );
    }

    const sql = `
      INSERT INTO code_symbols (
        repo_path, symbol_name, symbol_type, file_path,
        line_number, definition, embedding,
        repo_id, workspace_id, package_name
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT DO NOTHING
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Insert or update repository metadata
   *
   * Uses UPSERT (ON CONFLICT DO UPDATE) to handle re-indexing of existing repositories.
   *
   * @param repo - Repository metadata
   * @throws {DatabaseWriteError} If insert fails
   */
  public insertRepository = async (repo: Omit<Repository, 'id' | 'indexed_at' | 'last_updated'>): Promise<void> => {
    logger.debug('Inserting repository', {
      repo_id: repo.repo_id,
      repo_type: repo.repo_type,
      repo_path: repo.repo_path,
    });

    const sql = `
      INSERT INTO repositories (
        repo_id, repo_name, repo_path, repo_type, workspace_config,
        workspace_patterns, root_package_json, git_remote_url, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (repo_id) DO UPDATE SET
        repo_name = EXCLUDED.repo_name,
        repo_path = EXCLUDED.repo_path,
        repo_type = EXCLUDED.repo_type,
        workspace_config = EXCLUDED.workspace_config,
        workspace_patterns = EXCLUDED.workspace_patterns,
        root_package_json = EXCLUDED.root_package_json,
        git_remote_url = EXCLUDED.git_remote_url,
        metadata = EXCLUDED.metadata,
        last_updated = NOW()
    `;

    try {
      await this.dbClient.query(sql, [
        repo.repo_id,
        repo.repo_name,
        repo.repo_path,
        repo.repo_type,
        repo.workspace_config ?? null,
        repo.workspace_patterns ?? null,
        repo.root_package_json ?? null,
        repo.git_remote_url ?? null,
        repo.metadata ? JSON.stringify(repo.metadata) : null,
      ]);

      logger.debug('Repository inserted', { repo_id: repo.repo_id });
    } catch (error) {
      throw new DatabaseWriteError('repositories', repo.repo_id, error as Error);
    }
  };

  /**
   * Batch insert workspaces for monorepo support
   *
   * Processes workspaces in batches with UPSERT for re-indexing.
   *
   * @param workspaces - Array of workspace metadata
   * @param batchSize - Number of workspaces per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertWorkspaces = async (
    workspaces: Omit<Workspace, 'id' | 'indexed_at'>[],
    batchSize = 100
  ): Promise<BatchInsertResult> => {
    logger.info('Batch inserting workspaces', {
      total: workspaces.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < workspaces.length; i += batchSize) {
      const batch = workspaces.slice(i, Math.min(i + batchSize, workspaces.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertWorkspaceBatch(batch);
        result.inserted += batch.length;

        logger.debug('Workspace batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Workspace batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Workspace batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of workspaces
   *
   * @param workspaces - Batch of workspaces to insert
   */
  private insertWorkspaceBatch = async (workspaces: Omit<Workspace, 'id' | 'indexed_at'>[]): Promise<void> => {
    if (workspaces.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const workspace of workspaces) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        workspace.repo_id,
        workspace.workspace_id,
        workspace.package_name,
        workspace.workspace_path,
        workspace.package_json_path ?? null,
        workspace.version ?? null,
        workspace.dependencies ? JSON.stringify(workspace.dependencies) : null,
        workspace.dev_dependencies ? JSON.stringify(workspace.dev_dependencies) : null,
        workspace.tsconfig_paths ? JSON.stringify(workspace.tsconfig_paths) : null,
        workspace.metadata ? JSON.stringify(workspace.metadata) : null
      );
    }

    const sql = `
      INSERT INTO workspaces (
        repo_id, workspace_id, package_name, workspace_path,
        package_json_path, version, dependencies, dev_dependencies,
        tsconfig_paths, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (workspace_id) DO UPDATE SET
        package_name = EXCLUDED.package_name,
        workspace_path = EXCLUDED.workspace_path,
        package_json_path = EXCLUDED.package_json_path,
        version = EXCLUDED.version,
        dependencies = EXCLUDED.dependencies,
        dev_dependencies = EXCLUDED.dev_dependencies,
        tsconfig_paths = EXCLUDED.tsconfig_paths,
        metadata = EXCLUDED.metadata,
        indexed_at = NOW()
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Batch insert workspace aliases for import resolution
   *
   * @param aliases - Array of workspace alias mappings
   * @param batchSize - Number of aliases per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertWorkspaceAliases = async (
    aliases: Omit<WorkspaceAlias, 'id'>[],
    batchSize = 100
  ): Promise<BatchInsertResult> => {
    logger.info('Batch inserting workspace aliases', {
      total: aliases.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < aliases.length; i += batchSize) {
      const batch = aliases.slice(i, Math.min(i + batchSize, aliases.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertWorkspaceAliasBatch(batch);
        result.inserted += batch.length;

        logger.debug('Workspace alias batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Workspace alias batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Workspace alias batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of workspace aliases
   *
   * @param aliases - Batch of aliases to insert
   */
  private insertWorkspaceAliasBatch = async (aliases: Omit<WorkspaceAlias, 'id'>[]): Promise<void> => {
    if (aliases.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const alias of aliases) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        alias.repo_id,
        alias.workspace_id,
        alias.alias_type,
        alias.alias_pattern,
        alias.resolved_path,
        alias.metadata ? JSON.stringify(alias.metadata) : null
      );
    }

    const sql = `
      INSERT INTO workspace_aliases (
        repo_id, workspace_id, alias_type, alias_pattern,
        resolved_path, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (repo_id, alias_pattern, resolved_path) DO NOTHING
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Batch insert workspace dependencies for monorepo internal dependencies
   *
   * @param dependencies - Array of workspace dependency relationships
   * @param batchSize - Number of dependencies per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertWorkspaceDependencies = async (
    dependencies: Omit<WorkspaceDependency, 'id' | 'indexed_at'>[],
    batchSize = 100
  ): Promise<BatchInsertResult> => {
    logger.info('Batch inserting workspace dependencies', {
      total: dependencies.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < dependencies.length; i += batchSize) {
      const batch = dependencies.slice(i, Math.min(i + batchSize, dependencies.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertWorkspaceDependencyBatch(batch);
        result.inserted += batch.length;

        logger.debug('Workspace dependency batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Workspace dependency batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Workspace dependency batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of workspace dependencies
   *
   * @param dependencies - Batch of dependencies to insert
   */
  private insertWorkspaceDependencyBatch = async (
    dependencies: Omit<WorkspaceDependency, 'id' | 'indexed_at'>[]
  ): Promise<void> => {
    if (dependencies.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const dep of dependencies) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        dep.repo_id,
        dep.source_workspace_id,
        dep.target_workspace_id,
        dep.dependency_type,
        dep.version_specifier ?? null,
        dep.metadata ? JSON.stringify(dep.metadata) : null
      );
    }

    const sql = `
      INSERT INTO workspace_dependencies (
        repo_id, source_workspace_id, target_workspace_id,
        dependency_type, version_specifier, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (repo_id, source_workspace_id, target_workspace_id, dependency_type) DO UPDATE SET
        version_specifier = EXCLUDED.version_specifier,
        metadata = EXCLUDED.metadata,
        indexed_at = NOW()
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Batch insert services for microservice architecture
   *
   * @param services - Array of service metadata
   * @param batchSize - Number of services per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertServices = async (
    services: Omit<Service, 'id' | 'indexed_at'>[],
    batchSize = 100
  ): Promise<BatchInsertResult> => {
    logger.info('Batch inserting services', {
      total: services.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < services.length; i += batchSize) {
      const batch = services.slice(i, Math.min(i + batchSize, services.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertServiceBatch(batch);
        result.inserted += batch.length;

        logger.debug('Service batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Service batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Service batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of services
   *
   * @param services - Batch of services to insert
   */
  private insertServiceBatch = async (services: Omit<Service, 'id' | 'indexed_at'>[]): Promise<void> => {
    if (services.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const service of services) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        service.service_id,
        service.service_name,
        service.repo_id,
        service.service_path ?? null,
        service.service_type,
        service.api_endpoints ? JSON.stringify(service.api_endpoints) : null,
        service.dependencies ? JSON.stringify(service.dependencies) : null,
        service.metadata ? JSON.stringify(service.metadata) : null
      );
    }

    const sql = `
      INSERT INTO services (
        service_id, service_name, repo_id, service_path,
        service_type, api_endpoints, dependencies, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (service_id) DO UPDATE SET
        service_name = EXCLUDED.service_name,
        service_path = EXCLUDED.service_path,
        service_type = EXCLUDED.service_type,
        api_endpoints = EXCLUDED.api_endpoints,
        dependencies = EXCLUDED.dependencies,
        metadata = EXCLUDED.metadata,
        indexed_at = NOW()
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Batch insert cross-repository dependencies for microservice inter-dependencies
   *
   * @param dependencies - Array of cross-repo dependency relationships
   * @param batchSize - Number of dependencies per batch (default: 100)
   * @returns Batch insert result with stats
   */
  public insertCrossRepoDependencies = async (
    dependencies: Omit<CrossRepoDependency, 'id' | 'indexed_at'>[],
    batchSize = 100
  ): Promise<BatchInsertResult> => {
    logger.info('Batch inserting cross-repo dependencies', {
      total: dependencies.length,
      batch_size: batchSize,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches
    for (let i = 0; i < dependencies.length; i += batchSize) {
      const batch = dependencies.slice(i, Math.min(i + batchSize, dependencies.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await this.insertCrossRepoDependencyBatch(batch);
        result.inserted += batch.length;

        logger.debug('Cross-repo dependency batch inserted', {
          batch: batchNum,
          size: batch.length,
          total_inserted: result.inserted,
        });
      } catch (error) {
        result.failed += batch.length;
        result.errors.push({
          batch: batchNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Cross-repo dependency batch insert failed', {
          batch: batchNum,
          size: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Cross-repo dependency batch insert complete', {
      inserted: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Insert a single batch of cross-repo dependencies
   *
   * @param dependencies - Batch of dependencies to insert
   */
  private insertCrossRepoDependencyBatch = async (
    dependencies: Omit<CrossRepoDependency, 'id' | 'indexed_at'>[]
  ): Promise<void> => {
    if (dependencies.length === 0) return;

    // Build multi-row INSERT statement
    const placeholders: string[] = [];
    const values: unknown[] = [];

    let paramIndex = 1;

    for (const dep of dependencies) {
      placeholders.push(
        `($${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)}, $${String(paramIndex++)})`
      );

      values.push(
        dep.source_repo_id,
        dep.target_repo_id,
        dep.dependency_type,
        dep.source_service_id ?? null,
        dep.target_service_id ?? null,
        dep.api_contracts ? JSON.stringify(dep.api_contracts) : null,
        dep.metadata ? JSON.stringify(dep.metadata) : null
      );
    }

    const sql = `
      INSERT INTO cross_repo_dependencies (
        source_repo_id, target_repo_id, dependency_type,
        source_service_id, target_service_id, api_contracts, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (source_repo_id, target_repo_id, dependency_type) DO UPDATE SET
        source_service_id = EXCLUDED.source_service_id,
        target_service_id = EXCLUDED.target_service_id,
        api_contracts = EXCLUDED.api_contracts,
        metadata = EXCLUDED.metadata,
        indexed_at = NOW()
    `;

    await this.dbClient.query(sql, values);
  };

  /**
   * Update service API endpoints from parsed API specification
   *
   * Merges parsed API endpoints into the service's api_endpoints JSONB field.
   *
   * @param serviceId - Service identifier
   * @param endpoints - Parsed API endpoints from specification
   */
  public updateServiceAPIEndpoints = async (serviceId: string, endpoints: ParsedAPIEndpoint[]): Promise<void> => {
    logger.debug('Updating service API endpoints', {
      service_id: serviceId,
      endpoint_count: endpoints.length,
    });

    const sql = `
      UPDATE services
      SET api_endpoints = $1,
          indexed_at = NOW()
      WHERE service_id = $2
    `;

    try {
      await this.dbClient.query(sql, [JSON.stringify(endpoints), serviceId]);

      logger.debug('Service API endpoints updated', {
        service_id: serviceId,
        endpoint_count: endpoints.length,
      });
    } catch (error) {
      throw new DatabaseWriteError('services', `update API endpoints for ${serviceId}`, error as Error);
    }
  };

  /**
   * Batch update API endpoints for multiple services
   *
   * @param updates - Map of service_id to parsed endpoints
   * @returns Batch update result with stats
   */
  public updateServiceAPIEndpointsBatch = async (
    updates: Map<string, ParsedAPIEndpoint[]>
  ): Promise<BatchInsertResult> => {
    logger.info('Batch updating service API endpoints', {
      service_count: updates.size,
    });

    const result: BatchInsertResult = {
      inserted: 0,
      failed: 0,
      errors: [],
    };

    let serviceNum = 0;
    for (const [serviceId, endpoints] of updates.entries()) {
      serviceNum++;
      try {
        await this.updateServiceAPIEndpoints(serviceId, endpoints);
        result.inserted++;

        logger.debug('Service API endpoints updated', {
          service: serviceNum,
          service_id: serviceId,
          total_updated: result.inserted,
        });
      } catch (error) {
        result.failed++;
        result.errors.push({
          batch: serviceNum,
          error: error instanceof Error ? error.message : String(error),
        });

        logger.error('Service API endpoints update failed', {
          service: serviceNum,
          service_id: serviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Service API endpoints batch update complete', {
      updated: result.inserted,
      failed: result.failed,
      error_count: result.errors.length,
    });

    return result;
  };

  /**
   * Delete all indexed data for a repository
   *
   * Useful for re-indexing or cleanup operations.
   *
   * @param repoPath - Repository path to delete
   * @returns Number of records deleted per table
   */
  public deleteRepository = async (repoPath: string): Promise<{ files: number; chunks: number; symbols: number }> => {
    logger.info('Deleting repository data', { repo: repoPath });

    try {
      // Delete in order to respect foreign key constraints
      const symbolsResult = await this.dbClient.query('DELETE FROM code_symbols WHERE repo_path = $1', [repoPath]);

      const chunksResult = await this.dbClient.query('DELETE FROM code_chunks WHERE repo_path = $1', [repoPath]);

      const filesResult = await this.dbClient.query('DELETE FROM code_files WHERE repo_path = $1', [repoPath]);

      const deleted = {
        files: filesResult.rowCount ?? 0,
        chunks: chunksResult.rowCount ?? 0,
        symbols: symbolsResult.rowCount ?? 0,
      };

      logger.info('Repository data deleted', {
        repo: repoPath,
        deleted,
      });

      return deleted;
    } catch (error) {
      throw new DatabaseWriteError('repository deletion', repoPath, error as Error);
    }
  };
}

/**
 * Create database writer instance
 *
 * @param dbClient - Database client for query execution
 * @returns Initialized DatabaseWriter
 */
export const createDatabaseWriter = (dbClient: DatabaseClient): DatabaseWriter => {
  return new DatabaseWriter(dbClient);
};
