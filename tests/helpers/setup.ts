/**
 * Global test setup
 * Runs before all tests
 */

import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set default test environment variables if not provided
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'test';
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5432';
process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'postgres';
process.env.OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

console.log('Test environment initialized');
