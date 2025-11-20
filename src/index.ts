#!/usr/bin/env node

/**
 * cindex - RAG MCP Server for Code Context
 * Entry point for the MCP server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type z } from 'zod';

import { loadConfig, validateConfig } from '@config/env';
import { createDatabaseClient } from '@database/client';
import { DatabaseWriter } from '@database/writer';
import { CodeChunker } from '@indexing/chunker';
import { EmbeddingGenerator } from '@indexing/embeddings';
import { FileWalker } from '@indexing/file-walker';
import { IndexingOrchestrator } from '@indexing/orchestrator';
import { CodeParser } from '@indexing/parser';
import { FileSummaryGenerator } from '@indexing/summary';
import { SymbolExtractor } from '@indexing/symbols';
import { toMcpSchema } from '@mcp/schema-adapter';
import {
  DeleteRepositorySchema,
  FindCrossServiceCallsSchema,
  FindCrossWorkspaceUsagesSchema,
  FindSymbolSchema,
  GetFileContextSchema,
  GetServiceContextSchema,
  GetWorkspaceContextSchema,
  IndexRepositorySchema,
  ListIndexedReposSchema,
  ListServicesSchema,
  ListWorkspacesSchema,
  SearchAPIContractsSchema,
  SearchCodebaseSchema,
} from '@mcp/schemas';
import {
  deleteRepositoryMCP,
  findCrossServiceCallsMCP,
  findCrossWorkspaceUsagesMCP,
  findSymbolMCP,
  getFileContextMCP,
  getServiceContextMCP,
  getWorkspaceContextMCP,
  indexRepositoryMCP,
  listIndexedReposMCP,
  listServicesMCP,
  listWorkspacesMCP,
  searchAPIContractsMCP,
  searchCodebaseMCP,
} from '@mcp/tools-mcp';
import { CindexError } from '@utils/errors';
import { initLogger, logger } from '@utils/logger';
import { createOllamaClient } from '@utils/ollama';
import { ProgressTracker } from '@utils/progress';
import { type IndexingOptions } from '@/types/indexing';

// Derive TypeScript types from Zod schemas
type SearchCodebaseInput = z.infer<typeof SearchCodebaseSchema>;
type GetFileContextInput = z.infer<typeof GetFileContextSchema>;
type FindSymbolInput = z.infer<typeof FindSymbolSchema>;
type IndexRepositoryInput = z.infer<typeof IndexRepositorySchema>;
type DeleteRepositoryInput = z.infer<typeof DeleteRepositorySchema>;
type ListIndexedReposInput = z.infer<typeof ListIndexedReposSchema>;
type ListWorkspacesInput = z.infer<typeof ListWorkspacesSchema>;
type ListServicesInput = z.infer<typeof ListServicesSchema>;
type GetWorkspaceContextInput = z.infer<typeof GetWorkspaceContextSchema>;
type GetServiceContextInput = z.infer<typeof GetServiceContextSchema>;
type FindCrossWorkspaceUsagesInput = z.infer<typeof FindCrossWorkspaceUsagesSchema>;
type FindCrossServiceCallsInput = z.infer<typeof FindCrossServiceCallsSchema>;
type SearchAPIContractsInput = z.infer<typeof SearchAPIContractsSchema>;

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
 * Create IndexingOrchestrator for a specific repository
 *
 * Factory function that instantiates all required dependencies for the indexing pipeline.
 * Called on-demand when index_repository tool is invoked.
 *
 * @param repoPath - Repository root path
 * @param options - Indexing options
 * @returns Configured orchestrator instance
 */
const createOrchestrator = (repoPath: string, options: IndexingOptions): IndexingOrchestrator => {
  if (!appState) {
    throw new Error('Application not initialized');
  }

  const { config, db, ollama } = appState;

  // Create required components
  const fileWalker = new FileWalker(repoPath, options);
  const parser = new CodeParser(); // Default Language.Unknown, language set per-file
  const chunker = new CodeChunker();
  const summaryGenerator = new FileSummaryGenerator(ollama, config.summary);
  const embeddingGenerator = new EmbeddingGenerator(ollama, config.embedding);
  const symbolExtractor = new SymbolExtractor(embeddingGenerator);
  const dbWriter = new DatabaseWriter(db.getPool());
  const progressTracker = new ProgressTracker();

  // Create orchestrator (API parsing components optional for now)
  return new IndexingOrchestrator(
    fileWalker,
    parser,
    chunker,
    summaryGenerator,
    embeddingGenerator,
    symbolExtractor,
    dbWriter,
    progressTracker
  );
};

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

  // Register MCP tools
  logger.debug('Registering MCP tools...');

  // 1. search_codebase - Semantic code search
  server.registerTool(
    'search_codebase',
    {
      description: 'Search codebase with semantic understanding, multi-stage retrieval, and dependency analysis',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(SearchCodebaseSchema),
    },
    async (params: SearchCodebaseInput) => searchCodebaseMCP(db.getPool(), config, ollama, params)
  );

  // 2. get_file_context - Get full file context with dependencies
  server.registerTool(
    'get_file_context',
    {
      description: 'Get complete context for a file including callers, callees, and import chain',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(GetFileContextSchema),
    },
    async (params: GetFileContextInput) => getFileContextMCP(db.getPool(), params)
  );

  // 3. find_symbol_definition - Locate symbol definitions and usages
  server.registerTool(
    'find_symbol_definition',
    {
      description: 'Find symbol definitions and optionally show usages across the codebase',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(FindSymbolSchema),
    },
    async (params: FindSymbolInput) => findSymbolMCP(db.getPool(), params)
  );

  // 4. index_repository - Index or re-index a codebase
  server.registerTool(
    'index_repository',
    {
      description: 'Index or re-index a repository with progress notifications and multi-project support',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(IndexRepositorySchema),
    },
    async (params: IndexRepositoryInput) => {
      // Note: params is IndexRepositoryInput (snake_case), but IndexingOptions expects camelCase.
      // indexRepositoryTool handles the conversion. FileWalker accepts Partial<IndexingOptions>
      // and only uses the properties it needs, so this type assertion is safe.
      const orchestrator = createOrchestrator(params.repo_path, params as unknown as IndexingOptions);

      // Create progress callback that sends MCP logging messages
      const progressCallback = (progress: {
        stage: string;
        current: number;
        total: number;
        message: string;
        eta_seconds?: number;
      }) => {
        // Send progress as structured logging message to MCP client
        server
          .sendLoggingMessage({
            level: 'info',
            logger: 'cindex.indexing',
            data: {
              type: 'progress',
              stage: progress.stage,
              current: progress.current,
              total: progress.total,
              percentage: progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0,
              message: progress.message,
              eta_seconds: progress.eta_seconds,
              timestamp: new Date().toISOString(),
            },
          })
          .catch((err: unknown) => {
            // Don't fail indexing if notification fails
            logger.error('Failed to send progress notification', { error: err });
          });
      };

      return indexRepositoryMCP(orchestrator, params, progressCallback);
    }
  );

  // 5. delete_repository - Remove indexed repository data
  server.registerTool(
    'delete_repository',
    {
      description: 'Delete one or more indexed repositories and all associated data',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(DeleteRepositorySchema),
    },
    async (params: DeleteRepositoryInput) => deleteRepositoryMCP(db.getPool(), params)
  );

  // 6. list_indexed_repos - List all indexed repositories
  server.registerTool(
    'list_indexed_repos',
    {
      description: 'List all indexed repositories with optional metadata, workspace counts, and service counts',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(ListIndexedReposSchema),
    },
    async (params: ListIndexedReposInput) => listIndexedReposMCP(db.getPool(), params)
  );

  // 7. list_workspaces - List workspaces in monorepo
  server.registerTool(
    'list_workspaces',
    {
      description: 'List all workspaces in indexed repositories for monorepo support',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(ListWorkspacesSchema),
    },
    async (params: ListWorkspacesInput) => listWorkspacesMCP(db.getPool(), params)
  );

  // 8. list_services - List services across repositories
  server.registerTool(
    'list_services',
    {
      description: 'List all services across indexed repositories for microservice support',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(ListServicesSchema),
    },
    async (params: ListServicesInput) => listServicesMCP(db.getPool(), params)
  );

  // 9. get_workspace_context - Get workspace context with dependencies
  server.registerTool(
    'get_workspace_context',
    {
      description: 'Get full context for a workspace including dependencies and dependents',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(GetWorkspaceContextSchema),
    },
    async (params: GetWorkspaceContextInput) => getWorkspaceContextMCP(db.getPool(), params)
  );

  // 10. get_service_context - Get service context with API contracts
  server.registerTool(
    'get_service_context',
    {
      description: 'Get full context for a service including API contracts and dependencies',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(GetServiceContextSchema),
    },
    async (params: GetServiceContextInput) => getServiceContextMCP(db.getPool(), params)
  );

  // 11. find_cross_workspace_usages - Track workspace package usages
  server.registerTool(
    'find_cross_workspace_usages',
    {
      description: 'Find workspace package usages across the monorepo',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(FindCrossWorkspaceUsagesSchema),
    },
    async (params: FindCrossWorkspaceUsagesInput) => findCrossWorkspaceUsagesMCP(db.getPool(), params)
  );

  // 12. find_cross_service_calls - Identify inter-service API calls
  server.registerTool(
    'find_cross_service_calls',
    {
      description: 'Find inter-service API calls across microservices',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(FindCrossServiceCallsSchema),
    },
    async (params: FindCrossServiceCallsInput) => findCrossServiceCallsMCP(db.getPool(), params)
  );

  // 13. search_api_contracts - Search API endpoints
  server.registerTool(
    'search_api_contracts',
    {
      description: 'Search API endpoints across services with semantic understanding',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(SearchAPIContractsSchema),
    },
    async (params: SearchAPIContractsInput) => searchAPIContractsMCP(db.getPool(), ollama, config, params)
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
