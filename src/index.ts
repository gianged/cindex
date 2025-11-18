#!/usr/bin/env node

/**
 * cindex - RAG MCP Server for Code Context
 * Entry point for the MCP server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig, validateConfig } from '@config/env';
import { createDatabaseClient } from '@database/client';
import { CindexError } from '@utils/errors';
import { initLogger, logger } from '@utils/logger';
import { createOllamaClient } from '@utils/ollama';

/**
 * Application state
 */
interface AppState {
  config: ReturnType<typeof loadConfig>;
  db: ReturnType<typeof createDatabaseClient>;
  ollama: ReturnType<typeof createOllamaClient>;
  server: McpServer;
}

let appState: AppState | null = null;

/**
 * Initialize the MCP server
 */
const initializeServer = async (): Promise<AppState> => {
  // Load and validate configuration
  logger.info('Loading configuration...');
  const config = loadConfig();
  validateConfig(config);

  // Initialize logger with configured level
  initLogger('INFO');

  // Log startup banner
  logger.startup({
    version: '0.1.0',
    models: [config.embedding.model, config.summary.model],
  });

  // Create clients
  logger.info('Initializing clients...');
  const db = createDatabaseClient(config.database);
  const ollama = createOllamaClient(config.ollama);

  // Test Ollama connection and models
  logger.info('Checking Ollama connection...');
  await ollama.healthCheck(config.embedding.model, config.summary.model);

  // Test database connection
  logger.info('Connecting to database...');
  await db.connect();

  // Verify pgvector and schema
  logger.info('Verifying database schema...');
  await db.healthCheck(config.embedding.dimensions);

  // Create MCP server
  const server = new McpServer(
    {
      name: 'cindex',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools (placeholder - will be implemented in later phases)
  logger.debug('Registering MCP tools...');
  server.registerTool(
    'placeholder',
    {
      description: 'Placeholder tool - full implementation coming soon',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      inputSchema: z.object({}) as any,
    },
    () => {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Tool implementation coming in Phase 5',
          },
        ],
      };
    }
  );

  logger.info('MCP server initialized successfully');

  return { config, db, ollama, server };
};

/**
 * Shutdown handler - cleanup resources
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down...`);

  if (appState) {
    try {
      await appState.db.close();
      logger.info('Database connection closed');
    } catch (error) {
      logger.errorWithStack('Error closing database', error instanceof Error ? error : new Error(String(error)));
    }
  }

  logger.shutdown();
  process.exit(0);
};

/**
 * Main entry point
 */
const main = async (): Promise<void> => {
  try {
    // Initialize server
    appState = await initializeServer();

    // Setup signal handlers
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    // Connect server to stdio transport
    const transport = new StdioServerTransport();
    await appState.server.connect(transport);

    logger.info('cindex MCP server is ready');
    logger.info('Waiting for requests...');
  } catch (error) {
    // Handle initialization errors
    if (error instanceof CindexError) {
      // User-friendly error message
      console.error('\n' + error.getFormattedMessage());
    } else {
      // Unexpected error
      logger.errorWithStack(
        'Unexpected error during initialization',
        error instanceof Error ? error : new Error(String(error))
      );
    }

    process.exit(1);
  }
};

// Start the server
void main();
