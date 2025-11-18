/**
 * Database setup helper for tests
 * Creates and tears down test database
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { createDatabaseClient } from '@database/client';
import type { DatabaseConfig } from '@/types/config';

const execAsync = promisify(exec);

/**
 * Test database name
 */
export const TEST_DB_NAME = 'cindex_rag_codebase_test';

/**
 * Get test database configuration
 */
export const getTestDbConfig = (): DatabaseConfig => {
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: TEST_DB_NAME,
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? '',
    max_connections: 5,
    idle_timeout: 10000,
  };
};

/**
 * Create test database
 */
export const createTestDatabase = async (): Promise<void> => {
  try {
    await execAsync(`createdb ${TEST_DB_NAME}`);
    console.log(`Created test database: ${TEST_DB_NAME}`);
  } catch (error) {
    // Database might already exist
    if (error instanceof Error && !error.message.includes('already exists')) {
      throw error;
    }
  }
};

/**
 * Drop test database
 */
export const dropTestDatabase = async (): Promise<void> => {
  try {
    await execAsync(`dropdb ${TEST_DB_NAME}`);
    console.log(`Dropped test database: ${TEST_DB_NAME}`);
  } catch (error) {
    // Database might not exist
    if (error instanceof Error && !error.message.includes('does not exist')) {
      throw error;
    }
  }
};

/**
 * Initialize test database with schema
 */
export const initTestSchema = async (): Promise<void> => {
  try {
    await execAsync(`psql ${TEST_DB_NAME} -f database.sql`);
    console.log(`Initialized schema for test database: ${TEST_DB_NAME}`);
  } catch (error) {
    console.error('Failed to initialize test schema:', error);
    throw error;
  }
};

/**
 * Setup test database - drop if exists, create, and initialize
 */
export const setupTestDatabase = async (): Promise<void> => {
  await dropTestDatabase();
  await createTestDatabase();
  await initTestSchema();
};

/**
 * Get connected test database client
 */
export const getTestDbClient = async () => {
  const config = getTestDbConfig();
  const client = createDatabaseClient(config);
  await client.connect();
  return client;
};

/**
 * Clean all tables in test database
 */
export const cleanTestTables = async () => {
  const client = await getTestDbClient();
  try {
    await client.query('TRUNCATE TABLE code_chunks, code_files, code_symbols CASCADE', []);
    console.log('Cleaned test tables');
  } finally {
    await client.close();
  }
};
