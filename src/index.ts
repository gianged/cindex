#!/usr/bin/env node

/**
 * cindex - RAG MCP Server for Code Context
 *
 * Entry point for the Model Context Protocol (MCP) server that provides semantic code search
 * and context retrieval for large codebases. Supports single repositories, monorepos, and
 * multi-project setups with up to 1M+ lines of code.
 *
 * Architecture:
 * - Initializes database (PostgreSQL + pgvector), Ollama client, and MCP server
 * - Registers 13 MCP tools for code search, indexing, and context retrieval
 * - Manages lifecycle (startup health checks, graceful shutdown)
 * - Communicates via stdio transport for Claude Code integration
 *
 * @see {@link https://github.com/gianged/cindex} Project repository
 * @see {@link docs/overview.md} Complete technical specification
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

// Derive TypeScript types from Zod schemas for compile-time type safety
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
 * Global application state container
 *
 * Holds initialized clients and configuration for the MCP server lifecycle.
 * Set during startup and accessed by tool handlers for database/API operations.
 */
interface AppState {
  /** Loaded and validated environment configuration */
  config: ReturnType<typeof loadConfig>;
  /** PostgreSQL client with connection pooling */
  db: ReturnType<typeof createDatabaseClient>;
  /** Ollama API client for embeddings and summaries */
  ollama: ReturnType<typeof createOllamaClient>;
  /** MCP server instance with registered tools */
  server: McpServer;
}

/**
 * Global application state, initialized during server startup
 * Null until initializeServer() completes successfully
 */
let appState: AppState | null = null;

/**
 * Create IndexingOrchestrator for a specific repository
 *
 * Factory function that instantiates all required dependencies for the indexing pipeline.
 * Creates fresh instances for each indexing operation to ensure clean state and avoid
 * cross-repository contamination during parallel indexing operations.
 *
 * Called on-demand when index_repository tool is invoked. The orchestrator coordinates
 * the complete indexing workflow: file discovery → parsing → chunking → summarization
 * → embedding generation → symbol extraction → database persistence.
 *
 * @param repoPath - Absolute path to repository root directory
 * @param options - Indexing configuration (repo_id, repo_type, incremental mode, etc.)
 * @returns Fully configured orchestrator instance ready for indexing
 * @throws {Error} If application state is not initialized (server startup failed)
 */
const createOrchestrator = (repoPath: string, options: IndexingOptions): IndexingOrchestrator => {
  if (!appState) {
    throw new Error('Application not initialized');
  }

  const { config, db, ollama } = appState;

  // Create pipeline components with appropriate configuration
  const fileWalker = new FileWalker(repoPath, options);
  const parser = new CodeParser(); // Language detection happens per-file via tree-sitter
  const chunker = new CodeChunker();
  const summaryGenerator = new FileSummaryGenerator(ollama, config.summary);
  const embeddingGenerator = new EmbeddingGenerator(ollama, config.embedding);
  const symbolExtractor = new SymbolExtractor(embeddingGenerator);
  const dbWriter = new DatabaseWriter(db.getPool());
  const progressTracker = new ProgressTracker();

  // Assemble orchestrator with all pipeline stages
  // Database client enables incremental indexing via hash comparison
  return new IndexingOrchestrator(
    db,
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
 * Initialize the MCP server and all dependencies
 *
 * Performs complete server startup sequence with health checks for all external dependencies.
 * This function runs synchronously during server startup and blocks until all resources are ready.
 *
 * Startup sequence:
 * 1. Load and validate environment configuration (POSTGRES_*, OLLAMA_HOST, model names)
 * 2. Initialize logger and display startup banner
 * 3. Create database and Ollama clients
 * 4. Perform health checks (database connection, pgvector extension, Ollama availability)
 * 5. Create MCP server instance
 * 6. Register all 13 MCP tools with input schemas and handlers
 *
 * @returns Initialized application state (config, db, ollama, server)
 * @throws {CindexError} If configuration is invalid or dependencies are unavailable
 * @throws {Error} For unexpected initialization failures
 */
const initializeServer = async (): Promise<AppState> => {
  // Load configuration from environment variables
  logger.info('Loading configuration...');
  const config = loadConfig();
  validateConfig(config);

  // Set log level from config (defaults to INFO)
  initLogger('INFO');

  // Display startup banner with version and model information
  logger.startup({
    version: '0.1.0',
    models: [config.embedding.model, config.summary.model],
  });

  // Initialize external clients (PostgreSQL + pgvector, Ollama)
  logger.info('Initializing clients...');
  const db = createDatabaseClient(config.database);
  const ollama = createOllamaClient(config.ollama);

  // Verify Ollama is running and models are available
  logger.info('Checking Ollama connection...');
  await ollama.healthCheck(config.embedding.model, config.summary.model);

  // Establish database connection pool
  logger.info('Connecting to database...');
  await db.connect();

  // Verify pgvector extension and schema tables exist with correct vector dimensions
  logger.info('Verifying database schema...');
  await db.healthCheck(config.embedding.dimensions);

  // Create MCP server instance with metadata
  const server = new McpServer(
    {
      name: 'cindex',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {}, // Tool list generated dynamically from registered tools
      },
    }
  );

  // Register all MCP tools with Zod schemas for input validation
  logger.debug('Registering MCP tools...');

  // Core MCP Tools (4): Search, context retrieval, symbol lookup, indexing

  // 1. search_codebase - Semantic code search with 9-stage retrieval pipeline
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

  // 4. index_repository - Index or re-index a codebase with progress tracking
  server.registerTool(
    'index_repository',
    {
      description: 'Index or re-index a repository with progress notifications and multi-project support',
      // @ts-expect-error - MCP SDK v1.22.0 type definitions incompatible with Zod v4.1 (works at runtime)
      inputSchema: toMcpSchema(IndexRepositorySchema),
    },
    async (params: IndexRepositoryInput) => {
      // Create fresh orchestrator instance for this indexing operation
      // Type assertion is safe: FileWalker only uses specific properties from IndexingOptions
      const orchestrator = createOrchestrator(params.repo_path, params as unknown as IndexingOptions);

      // Progress callback sends real-time updates to MCP client via logging messages
      // Enables Claude Code to display indexing progress in UI
      const progressCallback = (progress: {
        stage: string;
        current: number;
        total: number;
        message: string;
        eta_seconds?: number;
      }) => {
        // Format progress as structured MCP logging message
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
            // Log notification failures but don't interrupt indexing
            logger.error('Failed to send progress notification', { error: err });
          });
      };

      return indexRepositoryMCP(orchestrator, params, progressCallback);
    }
  );

  // Multi-Project Management Tools (9): Repository listing, workspace/service queries, cross-reference tracking

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

  // 13. search_api_contracts - Search API endpoints with semantic search
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
 * Graceful shutdown handler for SIGINT and SIGTERM signals
 *
 * Ensures clean resource cleanup when server is terminated:
 * - Closes database connection pool (releases all connections)
 * - Flushes logger buffers
 * - Exits process with success code
 *
 * Registered in main() to handle Ctrl+C (SIGINT) and kill (SIGTERM) signals.
 *
 * @param signal - Signal name that triggered shutdown (SIGINT, SIGTERM)
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down...`);

  if (appState) {
    try {
      // Close database connection pool and release all connections
      await appState.db.close();
      logger.info('Database connection closed');
    } catch (error) {
      // Log but don't block shutdown on cleanup errors
      logger.errorWithStack('Error closing database', error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Flush logger and close file handles
  logger.shutdown();
  process.exit(0);
};

/**
 * Main entry point and server lifecycle coordinator
 *
 * Orchestrates complete server startup and operation:
 * 1. Initialize server and dependencies (database, Ollama, MCP tools)
 * 2. Register signal handlers for graceful shutdown
 * 3. Connect to stdio transport for MCP communication
 * 4. Enter event loop to handle incoming MCP requests
 *
 * Error handling:
 * - CindexError: User-friendly formatted messages (config errors, missing dependencies)
 * - Other errors: Full stack traces for debugging unexpected failures
 *
 * Exit codes:
 * - 0: Graceful shutdown via signal handler
 * - 1: Initialization failure (exits immediately)
 */
const main = async (): Promise<void> => {
  try {
    // Initialize server and all dependencies
    appState = await initializeServer();

    // Register signal handlers for clean shutdown
    // Ctrl+C in terminal → SIGINT
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    // kill <pid> → SIGTERM
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });

    // Connect MCP server to stdio transport (reads stdin, writes stdout)
    // Claude Code communicates with server via JSON-RPC over stdio
    const transport = new StdioServerTransport();
    await appState.server.connect(transport);

    logger.info('cindex MCP server is ready');
    logger.info('Waiting for requests...');
  } catch (error) {
    // Handle initialization errors with appropriate formatting
    if (error instanceof CindexError) {
      // User-friendly error message with resolution hints
      console.error('\n' + error.getFormattedMessage());
    } else {
      // Unexpected error - show full stack trace for debugging
      logger.errorWithStack(
        'Unexpected error during initialization',
        error instanceof Error ? error : new Error(String(error))
      );
    }

    process.exit(1);
  }
};

// Start the server - entry point execution
void main();
