/**
 * PostgreSQL client with pgvector support and comprehensive error handling
 */

import pg from 'pg';

import {
  DatabaseConnectionError,
  DatabaseNotConnectedError,
  DatabaseNotFoundError,
  DatabaseQueryError,
  VectorExtensionError,
} from '@utils/errors';
import { logger } from '@utils/logger';
import { type DatabaseConfig } from '@/types/config';

/**
 * Allowed schemas (only public schema for cindex)
 */
const ALLOWED_SCHEMA = 'public';

/**
 * Database client class with security validation
 */
export class DatabaseClient {
  private pool: pg.Pool | null = null;
  private isConnected = false;
  private readonly configuredDatabase: string;

  /**
   * Create a new database client instance
   * @param config - Database configuration including connection details
   */
  constructor(private config: DatabaseConfig) {
    this.configuredDatabase = config.database;
  }

  /**
   * Initialize database connection pool with security verification
   * @throws {DatabaseNotFoundError} If database does not exist
   * @throws {DatabaseConnectionError} If connection fails or database verification fails
   */
  async connect(): Promise<void> {
    logger.debug('Connecting to PostgreSQL', {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
    });

    try {
      this.pool = new pg.Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: this.config.max_connections,
        idleTimeoutMillis: this.config.idle_timeout,
        connectionTimeoutMillis: 10000,
      });

      // Test connection and verify database
      const client = await this.pool.connect();
      try {
        // Security: Verify we're connected to the correct database
        await this.verifyConnectedDatabase(client);
      } finally {
        client.release();
      }

      this.isConnected = true;
      logger.connected('PostgreSQL', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Check if database doesn't exist
      if (err.message.includes('database') && err.message.includes('does not exist')) {
        throw new DatabaseNotFoundError(this.config.database, this.config.host, this.config.port);
      }

      // Connection error
      throw DatabaseConnectionError.cannotConnect(this.config.host, this.config.port, this.config.database, err);
    }
  }

  /**
   * Security: Verify we're connected to the correct database
   * This prevents accidental connections to wrong databases
   *
   * @param client - PostgreSQL client to verify
   * @throws DatabaseConnectionError if connected to wrong database
   */
  private async verifyConnectedDatabase(client: pg.PoolClient): Promise<void> {
    try {
      const result = await client.query<{ current_database: string }>('SELECT current_database()');
      const actualDatabase = result.rows[0]?.current_database;

      if (actualDatabase !== this.configuredDatabase) {
        throw new Error(
          `Security: Connected to wrong database. Expected '${this.configuredDatabase}', got '${actualDatabase || 'unknown'}'`
        );
      }

      logger.debug('Database connection verified', {
        database: actualDatabase,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw DatabaseConnectionError.cannotConnect(
        this.config.host,
        this.config.port,
        this.config.database,
        new Error(`Database verification failed: ${err.message}`)
      );
    }
  }

  /**
   * Security: Validate query against dangerous operations
   * Prevents operations that could affect other databases or system tables
   *
   * @param sql - SQL query to validate
   * @throws Error if query contains dangerous operations
   */
  private validateQuerySecurity(sql: string): void {
    const normalizedSql = sql.toLowerCase().trim();

    // Block dangerous database-level operations that could affect other databases or connections
    const dangerousPatterns = [
      /\bdrop\s+database\b/, // Prevents accidental database deletion
      /\bcreate\s+database\b/, // Prevents database creation
      /\balter\s+database\b/, // Prevents database modification
      /\bpg_terminate_backend\b/, // Prevents killing other connections
      /\bpg_cancel_backend\b/, // Prevents canceling other queries
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(normalizedSql)) {
        throw new Error(`Security: Query contains dangerous operation: ${pattern.toString()}`);
      }
    }

    // Validate schema references to prevent cross-schema access
    if (normalizedSql.includes('from') || normalizedSql.includes('into') || normalizedSql.includes('update')) {
      // Extract schema.table patterns from query
      const schemaPattern = /\b(\w+)\.\w+/g;
      const matches = [...normalizedSql.matchAll(schemaPattern)];

      for (const match of matches) {
        const schema = match[1];
        // Allow public schema and system schemas needed for metadata queries
        if (
          schema !== ALLOWED_SCHEMA &&
          schema !== 'information_schema' &&
          schema !== 'pg_type' && // PostgreSQL type system
          schema !== 'pg_extension' // Extension metadata
        ) {
          logger.warn('Query references non-standard schema', {
            schema,
            query: sql.substring(0, 100),
          });
        }
      }
    }
  }

  /**
   * Health check - verify database and pgvector extension
   * @param expectedVectorDimensions - Expected vector dimensions for validation
   * @throws {DatabaseNotConnectedError} If not connected to database
   * @throws {VectorExtensionError} If pgvector extension is not installed
   */
  async healthCheck(expectedVectorDimensions: number): Promise<void> {
    if (!this.isConnected || !this.pool) {
      throw new DatabaseNotConnectedError('health check');
    }

    logger.debug('Performing database health check');

    // Check pgvector extension
    await this.checkPgvectorExtension();

    // Check vector dimensions in tables
    await this.checkVectorDimensions(expectedVectorDimensions);

    logger.healthCheck('PostgreSQL', 'OK', {
      database: this.config.database,
      vectorDimensions: expectedVectorDimensions,
    });
  }

  /**
   * Check if pgvector extension is installed
   * @throws {VectorExtensionError} If pgvector extension is not found
   */
  private async checkPgvectorExtension(): Promise<void> {
    try {
      const result = await this.query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
        []
      );

      if (result.rows.length === 0) {
        throw new VectorExtensionError(this.config.database);
      }
    } catch (error) {
      if (error instanceof VectorExtensionError) {
        throw error;
      }
      throw new VectorExtensionError(
        this.config.database,
        error instanceof Error ? { error: error.message } : undefined
      );
    }
  }

  /**
   * Check vector dimensions in database tables
   * Verifies that vector columns exist in code_chunks, code_files, and code_symbols tables
   * @param _expected - Expected vector dimensions (reserved for future dimension validation)
   */
  private async checkVectorDimensions(_expected: number): Promise<void> {
    try {
      // Check if tables exist
      const tablesExist = await this.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
         AND table_name IN ('code_chunks', 'code_files', 'code_symbols')`,
        []
      );

      if (tablesExist.rows.length === 0) {
        logger.warn('Database tables not yet created', {
          suggestion: 'Run database.sql to create tables',
        });
        return;
      }

      // Check vector column dimensions (if tables exist)
      const dimensionCheck = await this.query<{
        table_name: string;
        column_name: string;
        type_name: string;
      }>(
        `SELECT
          c.table_name,
          c.column_name,
          t.typname as type_name
        FROM information_schema.columns c
        JOIN pg_type t ON c.udt_name = t.typname
        WHERE c.table_schema = 'public'
        AND c.table_name IN ('code_chunks', 'code_files', 'code_symbols')
        AND t.typname = 'vector'`,
        []
      );

      logger.debug('Vector columns found', {
        count: dimensionCheck.rows.length,
      });
    } catch (error) {
      logger.warn('Could not check vector dimensions', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute a query with error handling and security validation
   * @param sql - SQL query string (parameterized)
   * @param params - Query parameters (use parameterized queries for security)
   * @returns Query result with typed rows
   * @throws {DatabaseNotConnectedError} If not connected to database
   * @throws {DatabaseQueryError} If query execution fails
   */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[]
  ): Promise<pg.QueryResult<T>> {
    if (!this.isConnected || !this.pool) {
      throw new DatabaseNotConnectedError('query execution');
    }

    // Security: Validate query before execution
    this.validateQuerySecurity(sql);

    try {
      return await this.pool.query<T>(sql, params);
    } catch (error) {
      throw new DatabaseQueryError(sql, params, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute a query within a transaction with automatic rollback on error
   * @param callback - Async function that receives a database client for transactional operations
   * @returns Result from the callback function
   * @throws {DatabaseNotConnectedError} If not connected to database
   * @throws Any error thrown by the callback (transaction will be rolled back)
   */
  async transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new DatabaseNotConnectedError('transaction');
    }

    const client = await this.pool.connect();

    try {
      // Start transaction
      await client.query('BEGIN');
      const result = await callback(client);
      // Commit if callback succeeds
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // Rollback on any error to maintain data consistency
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Always release client back to pool
      client.release();
    }
  }

  /**
   * Close database connection pool and release all connections
   */
  async close(): Promise<void> {
    if (this.pool) {
      logger.debug('Closing database connection pool');
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  /**
   * Check if currently connected to database
   * @returns True if connected, false otherwise
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get underlying connection pool
   * Required for MCP tools that expect pg.Pool
   *
   * @throws DatabaseNotConnectedError if database not connected
   */
  getPool(): pg.Pool {
    if (!this.pool) {
      throw new DatabaseNotConnectedError('getPool');
    }
    return this.pool;
  }

  /**
   * Get pool statistics for monitoring connection usage
   * @returns Connection pool statistics or null if not connected
   */
  getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
  } | null {
    if (!this.pool) {
      return null;
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }
}

/**
 * Create database client instance
 * @param config - Database configuration including host, port, credentials, and pool settings
 * @returns Initialized DatabaseClient (call connect() to establish connection)
 */
export const createDatabaseClient = (config: DatabaseConfig): DatabaseClient => {
  return new DatabaseClient(config);
};
