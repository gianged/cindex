/**
 * Integration tests for database connection and pgvector
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createDatabaseClient } from '@database/client';

import { dropTestDatabase, getTestDbConfig, setupTestDatabase } from '../helpers/db-setup';

describe('Database Integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();

    // Create client and connect
    const config = getTestDbConfig();
    db = createDatabaseClient(config);
    await db.connect();
  });

  afterAll(async () => {
    // Cleanup
    if (db.connected) {
      await db.close();
    }
    await dropTestDatabase();
  });

  describe('Connection', () => {
    it('should connect to database successfully', () => {
      expect(db.connected).toBe(true);
    });

    it('should execute simple query', async () => {
      const result = await db.query<{ result: number }>('SELECT 1 as result', []);
      expect(result.rows[0].result).toBe(1);
    });

    it('should provide pool statistics', () => {
      const stats = db.getPoolStats();
      expect(stats).not.toBeNull();
      expect(stats?.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('pgvector Extension', () => {
    it('should have pgvector extension installed', async () => {
      const result = await db.query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
        []
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].extname).toBe('vector');
    });

    it('should perform health check successfully', async () => {
      await expect(db.healthCheck(1024)).resolves.not.toThrow();
    });
  });

  describe('Schema', () => {
    it('should have code_files table', async () => {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'code_files'`,
        []
      );
      expect(result.rows.length).toBe(1);
    });

    it('should have code_chunks table', async () => {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'code_chunks'`,
        []
      );
      expect(result.rows.length).toBe(1);
    });

    it('should have code_symbols table', async () => {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'code_symbols'`,
        []
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe('Vector Operations', () => {
    it('should insert and query vector data', async () => {
      // Create a test vector
      const testVector = Array.from({ length: 1024 }, () => Math.random());

      // Insert test data
      await db.query(
        `INSERT INTO code_files (file_path, file_hash, summary_embedding, language, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        ['test.ts', 'a'.repeat(64), JSON.stringify(testVector), 'typescript']
      );

      // Query vector similarity
      const result = await db.query<{ file_path: string; similarity: number }>(
        `SELECT file_path, 1 - (summary_embedding <=> $1) as similarity
         FROM code_files
         WHERE file_path = $2`,
        [JSON.stringify(testVector), 'test.ts']
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].similarity).toBeCloseTo(1.0, 2); // Should be very close to 1.0
    });
  });

  describe('Transactions', () => {
    it('should commit transaction successfully', async () => {
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO code_files (file_path, file_hash, summary_embedding, language, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          ['transaction-test.ts', 'b'.repeat(64), JSON.stringify(Array(1024).fill(0)), 'typescript']
        );
      });

      // Verify data was committed
      const result = await db.query('SELECT file_path FROM code_files WHERE file_path = $1', ['transaction-test.ts']);
      expect(result.rows.length).toBe(1);
    });

    it('should rollback transaction on error', async () => {
      await expect(
        db.transaction(async (client) => {
          await client.query(
            `INSERT INTO code_files (file_path, file_hash, summary_embedding, language, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            ['rollback-test.ts', 'c'.repeat(64), JSON.stringify(Array(1024).fill(0)), 'typescript']
          );

          // Force an error
          throw new Error('Test rollback');
        })
      ).rejects.toThrow('Test rollback');

      // Verify data was rolled back
      const result = await db.query('SELECT file_path FROM code_files WHERE file_path = $1', ['rollback-test.ts']);
      expect(result.rows.length).toBe(0);
    });
  });

  describe('Security Validation', () => {
    it('should verify connected to correct database on connect', async () => {
      // This is implicitly tested by successful connection
      // The verifyConnectedDatabase method is called in connect()
      expect(db.connected).toBe(true);
    });

    it('should block DROP DATABASE queries', async () => {
      await expect(db.query('DROP DATABASE some_other_db', [])).rejects.toThrow(
        /Security: Query contains dangerous operation/
      );
    });

    it('should block CREATE DATABASE queries', async () => {
      await expect(db.query('CREATE DATABASE malicious_db', [])).rejects.toThrow(
        /Security: Query contains dangerous operation/
      );
    });

    it('should block ALTER DATABASE queries', async () => {
      await expect(db.query('ALTER DATABASE postgres RENAME TO hacked', [])).rejects.toThrow(
        /Security: Query contains dangerous operation/
      );
    });

    it('should block pg_terminate_backend calls', async () => {
      await expect(db.query('SELECT pg_terminate_backend(123)', [])).rejects.toThrow(
        /Security: Query contains dangerous operation/
      );
    });

    it('should block pg_cancel_backend calls', async () => {
      await expect(db.query('SELECT pg_cancel_backend(123)', [])).rejects.toThrow(
        /Security: Query contains dangerous operation/
      );
    });

    it('should allow normal SELECT queries', async () => {
      const result = await db.query('SELECT 1 as test', []);
      expect(result.rows[0].test).toBe(1);
    });

    it('should allow queries on public schema tables', async () => {
      const result = await db.query('SELECT COUNT(*) as count FROM code_files', []);
      expect(result.rows.length).toBe(1);
    });

    it('should allow metadata queries on information_schema', async () => {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 1`,
        []
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(0);
    });
  });
});
