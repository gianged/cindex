#!/usr/bin/env node

/**
 * cindex - MCP Server for semantic code search and context retrieval.
 *
 * Features:
 * - 17 MCP tools for search, indexing, context retrieval, and documentation
 * - PostgreSQL + pgvector for vector similarity search
 * - Ollama for embeddings (bge-m3) and summaries (qwen2.5-coder)
 * - Supports 1M+ LoC with 9-stage retrieval pipeline
 *
 * @see https://github.com/gianged/cindex
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
  DeleteDocumentationSchema,
  DeleteRepositorySchema,
  FindCrossServiceCallsSchema,
  FindCrossWorkspaceUsagesSchema,
  FindSymbolSchema,
  GetFileContextSchema,
  GetServiceContextSchema,
  GetWorkspaceContextSchema,
  IndexDocumentationSchema,
  IndexRepositorySchema,
  ListDocumentationSchema,
  ListIndexedReposSchema,
  ListServicesSchema,
  ListWorkspacesSchema,
  SearchAPIContractsSchema,
  SearchCodebaseSchema,
  SearchDocumentationSchema,
} from '@mcp/schemas';
import {
  deleteDocumentationMCP,
  deleteRepositoryMCP,
  findCrossServiceCallsMCP,
  findCrossWorkspaceUsagesMCP,
  findSymbolMCP,
  getFileContextMCP,
  getServiceContextMCP,
  getWorkspaceContextMCP,
  indexDocumentationMCP,
  indexRepositoryMCP,
  listDocumentationMCP,
  listIndexedReposMCP,
  listServicesMCP,
  listWorkspacesMCP,
  searchAPIContractsMCP,
  searchCodebaseMCP,
  searchDocumentationMCP,
} from '@mcp/tools-mcp';
import { CindexError } from '@utils/errors';
import { initLogger, logger } from '@utils/logger';
import { createOllamaClient } from '@utils/ollama';
import { ProgressTracker } from '@utils/progress';
import { type IndexingOptions } from '@/types/indexing';

// Tool input types (grouped: Search → Context → Index → List → Cross-Ref → Delete)
type SearchCodebaseInput = z.infer<typeof SearchCodebaseSchema>;
type SearchDocumentationInput = z.infer<typeof SearchDocumentationSchema>;
type SearchAPIContractsInput = z.infer<typeof SearchAPIContractsSchema>;
type FindSymbolInput = z.infer<typeof FindSymbolSchema>;
type GetFileContextInput = z.infer<typeof GetFileContextSchema>;
type GetWorkspaceContextInput = z.infer<typeof GetWorkspaceContextSchema>;
type GetServiceContextInput = z.infer<typeof GetServiceContextSchema>;
type IndexRepositoryInput = z.infer<typeof IndexRepositorySchema>;
type IndexDocumentationInput = z.infer<typeof IndexDocumentationSchema>;
type ListIndexedReposInput = z.infer<typeof ListIndexedReposSchema>;
type ListWorkspacesInput = z.infer<typeof ListWorkspacesSchema>;
type ListServicesInput = z.infer<typeof ListServicesSchema>;
type ListDocumentationInput = z.infer<typeof ListDocumentationSchema>;
type FindCrossWorkspaceUsagesInput = z.infer<typeof FindCrossWorkspaceUsagesSchema>;
type FindCrossServiceCallsInput = z.infer<typeof FindCrossServiceCallsSchema>;
type DeleteRepositoryInput = z.infer<typeof DeleteRepositorySchema>;
type DeleteDocumentationInput = z.infer<typeof DeleteDocumentationSchema>;

/** Global application state - initialized during startup */
interface AppState {
  config: ReturnType<typeof loadConfig>; // Environment configuration
  db: ReturnType<typeof createDatabaseClient>; // PostgreSQL connection pool
  ollama: ReturnType<typeof createOllamaClient>; // Ollama API client
  server: McpServer; // MCP server instance
}

let appState: AppState | null = null;

/**
 * Create IndexingOrchestrator with all pipeline components.
 * Called on-demand for each index_repository invocation.
 *
 * Pipeline: file discovery → parsing → chunking → summarization → embedding → persistence
 */
const createOrchestrator = (repoPath: string, options: IndexingOptions): IndexingOrchestrator => {
  if (!appState) throw new Error('Application not initialized');

  const { config, db, ollama } = appState;

  return new IndexingOrchestrator(
    db,
    new FileWalker(repoPath, options),
    new CodeParser(),
    new CodeChunker(),
    new FileSummaryGenerator(ollama, config.summary),
    new EmbeddingGenerator(ollama, config.embedding),
    new SymbolExtractor(new EmbeddingGenerator(ollama, config.embedding)),
    new DatabaseWriter(db.getPool()),
    new ProgressTracker()
  );
};

/**
 * Initialize MCP server and all dependencies.
 *
 * Startup sequence:
 * 1. Load and validate environment configuration
 * 2. Initialize database and Ollama clients
 * 3. Health checks (database, pgvector, Ollama models)
 * 4. Register all 17 MCP tools
 */
const initializeServer = async (): Promise<AppState> => {
  logger.info('Loading configuration...');
  const config = loadConfig();
  validateConfig(config);
  initLogger('INFO');

  logger.startup({ version: '0.1.0', models: [config.embedding.model, config.summary.model] });

  logger.info('Initializing clients...');
  const db = createDatabaseClient(config.database);
  const ollama = createOllamaClient(config.ollama);

  logger.info('Checking Ollama connection...');
  await ollama.healthCheck(config.embedding.model, config.summary.model);

  logger.info('Connecting to database...');
  await db.connect();

  logger.info('Verifying database schema...');
  await db.healthCheck(config.embedding.dimensions);

  const server = new McpServer({ name: 'cindex', version: '0.1.0' }, { capabilities: { tools: {} } });

  // Register all 17 MCP tools grouped by function:
  // Search (4) → Context (3) → Index (2) → List (4) → Cross-Ref (2) → Delete (2)
  logger.debug('Registering MCP tools...');

  // ===================
  // Search Tools (4)
  // ===================

  // 1. search_codebase - Primary code search with 9-stage retrieval
  server.registerTool(
    'search_codebase',
    {
      description:
        'MUST BE USED for all code search, discovery, and understanding tasks. Provides semantic search with multi-stage retrieval and dependency analysis. If results are empty, use list_indexed_repos to check if repository is indexed, then suggest index_repository if needed.',
      inputSchema: toMcpSchema(SearchCodebaseSchema),
    },
    async (params: SearchCodebaseInput) => searchCodebaseMCP(db.getPool(), config, ollama, params)
  );

  // 2. search_documentation - Search markdown docs (syntax.md, Context7 docs)
  server.registerTool(
    'search_documentation',
    {
      description:
        'Search indexed documentation using semantic similarity. Returns ranked results with section context and code blocks. Use for library docs, syntax references, API guides, and any markdown documentation indexed via index_documentation.',
      inputSchema: toMcpSchema(SearchDocumentationSchema),
    },
    async (params: SearchDocumentationInput) => searchDocumentationMCP(db.getPool(), ollama, config, params)
  );

  // 3. search_api_contracts - Search REST/GraphQL/gRPC endpoints
  server.registerTool(
    'search_api_contracts',
    {
      description:
        'Search API endpoints across services with semantic understanding. Use when implementing API integrations, finding endpoints to call, or understanding service communication patterns. Returns endpoint paths, HTTP methods, request/response schemas, and implementation file locations.',
      inputSchema: toMcpSchema(SearchAPIContractsSchema),
    },
    async (params: SearchAPIContractsInput) => searchAPIContractsMCP(db.getPool(), ollama, config, params)
  );

  // 4. find_symbol_definition - Locate functions/classes/variables
  server.registerTool(
    'find_symbol_definition',
    {
      description:
        'Find symbol definitions and optionally show usages across the codebase. Use when you need to locate where a function, class, or variable is defined, or track all usages before refactoring. Returns file path, line number, signature, and optionally all usage locations.',
      inputSchema: toMcpSchema(FindSymbolSchema),
    },
    async (params: FindSymbolInput) => findSymbolMCP(db.getPool(), params)
  );

  // ===================
  // Context Tools (3)
  // ===================

  // 5. get_file_context - File with callers, callees, imports
  server.registerTool(
    'get_file_context',
    {
      description:
        'Get complete context for a file including callers, callees, and import chain. Use BEFORE modifying any file to understand its dependencies, what functions call it, and what it imports. Essential for safe refactoring and understanding code impact.',
      inputSchema: toMcpSchema(GetFileContextSchema),
    },
    async (params: GetFileContextInput) => getFileContextMCP(db.getPool(), params)
  );

  // 6. get_workspace_context - Monorepo package with dependencies
  server.registerTool(
    'get_workspace_context',
    {
      description:
        'Get full context for a workspace including dependencies and dependents. Use when working in monorepos to understand package relationships before making cross-package changes. Returns package dependencies, which packages depend on it, and all files in the workspace.',
      inputSchema: toMcpSchema(GetWorkspaceContextSchema),
    },
    async (params: GetWorkspaceContextInput) => getWorkspaceContextMCP(db.getPool(), params)
  );

  // 7. get_service_context - Microservice with API contracts
  server.registerTool(
    'get_service_context',
    {
      description:
        'Get full context for a service including API contracts and dependencies. Use when implementing features that span microservices, or understanding service API contracts before integration. Returns API endpoints, service dependencies, and all files in the service.',
      inputSchema: toMcpSchema(GetServiceContextSchema),
    },
    async (params: GetServiceContextInput) => getServiceContextMCP(db.getPool(), params)
  );

  // ===================
  // Indexing Tools (2)
  // ===================

  // 8. index_repository - Index codebase with progress tracking
  server.registerTool(
    'index_repository',
    {
      description:
        'Index or re-index a repository with progress notifications and multi-project support. Use list_indexed_repos to check last_indexed timestamp - suggest re-indexing if outdated (>7 days) or after significant code changes. Ask user before re-indexing existing repositories.',
      inputSchema: toMcpSchema(IndexRepositorySchema),
    },
    async (params: IndexRepositoryInput) => {
      // Convert snake_case MCP params to camelCase IndexingOptions
      const indexingOptions: IndexingOptions = {
        incremental: params.incremental,
        languages: params.languages,
        respectGitignore: params.respect_gitignore,
        maxFileSize: params.max_file_size,
        summaryMethod: params.summary_method,
        repoId: params.repo_id,
        repoName: params.repo_name,
        repoType: params.repo_type,
        detectWorkspaces: params.detect_workspaces,
        workspaceConfig: params.workspace_config,
        resolveWorkspaceAliases: params.resolve_workspace_aliases,
        detectServices: params.detect_services,
        serviceConfig: params.service_config,
        detectApiEndpoints: params.detect_api_endpoints,
        linkToRepos: params.link_to_repos,
        updateCrossRepoDeps: params.update_cross_repo_deps,
        version: params.version,
        forceReindex: params.force_reindex,
        metadata: params.metadata,
      };
      const orchestrator = createOrchestrator(params.repo_path, indexingOptions);

      const progressCallback = (progress: {
        stage: string;
        current: number;
        total: number;
        message: string;
        eta_seconds?: number;
      }) => {
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
            logger.error('Failed to send progress notification', { error: err });
          });
      };

      return indexRepositoryMCP(orchestrator, params, progressCallback);
    }
  );

  // 9. index_documentation - Index markdown files (standalone)
  server.registerTool(
    'index_documentation',
    {
      description:
        'Index markdown files for documentation search. Standalone from code indexing. Use for syntax.md, Context7-fetched docs, or any reference documentation.',
      inputSchema: toMcpSchema(IndexDocumentationSchema),
    },
    async (params: IndexDocumentationInput) => indexDocumentationMCP(db.getPool(), ollama, config, params)
  );

  // ===================
  // List/Discovery Tools (4)
  // ===================

  // 10. list_indexed_repos - All indexed repositories
  server.registerTool(
    'list_indexed_repos',
    {
      description:
        'List all indexed repositories with optional metadata, workspace counts, and service counts. Use FIRST to check what codebases are available before searching. Shows last_indexed timestamp to identify outdated indexes.',
      inputSchema: toMcpSchema(ListIndexedReposSchema),
    },
    async (params: ListIndexedReposInput) => listIndexedReposMCP(db.getPool(), params)
  );

  // 11. list_workspaces - Monorepo workspaces/packages
  server.registerTool(
    'list_workspaces',
    {
      description:
        'List all workspaces in indexed repositories for monorepo support. Use to discover available packages before implementing cross-package features or understanding monorepo structure.',
      inputSchema: toMcpSchema(ListWorkspacesSchema),
    },
    async (params: ListWorkspacesInput) => listWorkspacesMCP(db.getPool(), params)
  );

  // 12. list_services - Microservices across repos
  server.registerTool(
    'list_services',
    {
      description:
        'List all services across indexed repositories for microservice support. Use to discover available services and their API endpoints before implementing cross-service features.',
      inputSchema: toMcpSchema(ListServicesSchema),
    },
    async (params: ListServicesInput) => listServicesMCP(db.getPool(), params)
  );

  // 13. list_documentation - Indexed markdown docs
  server.registerTool(
    'list_documentation',
    {
      description: 'List all indexed documentation with optional filtering by doc_id or tags.',
      inputSchema: toMcpSchema(ListDocumentationSchema),
    },
    async (params: ListDocumentationInput) => listDocumentationMCP(db.getPool(), params)
  );

  // ===================
  // Cross-Reference Tools (2)
  // ===================

  // 14. find_cross_workspace_usages - Track package imports across monorepo
  server.registerTool(
    'find_cross_workspace_usages',
    {
      description:
        'Find workspace package usages across the monorepo. Use BEFORE modifying shared packages to understand impact - shows which workspaces import the package and where. Essential for safe refactoring in monorepos.',
      inputSchema: toMcpSchema(FindCrossWorkspaceUsagesSchema),
    },
    async (params: FindCrossWorkspaceUsagesInput) => findCrossWorkspaceUsagesMCP(db.getPool(), params)
  );

  // 15. find_cross_service_calls - Track inter-service API calls
  server.registerTool(
    'find_cross_service_calls',
    {
      description:
        'Find inter-service API calls across microservices. Use BEFORE modifying APIs to understand which services will be affected. Shows call sources, targets, and endpoints to prevent breaking changes.',
      inputSchema: toMcpSchema(FindCrossServiceCallsSchema),
    },
    async (params: FindCrossServiceCallsInput) => findCrossServiceCallsMCP(db.getPool(), params)
  );

  // ===================
  // Delete Tools (2)
  // ===================

  // 16. delete_repository - Remove repo and all data (destructive)
  server.registerTool(
    'delete_repository',
    {
      description:
        'Delete one or more indexed repositories and all associated data. IMPORTANT: ALWAYS ask user for explicit confirmation before executing - this is destructive and cannot be undone.',
      inputSchema: toMcpSchema(DeleteRepositorySchema),
    },
    async (params: DeleteRepositoryInput) => deleteRepositoryMCP(db.getPool(), params)
  );

  // 17. delete_documentation - Remove indexed docs (destructive)
  server.registerTool(
    'delete_documentation',
    {
      description: 'Delete indexed documentation by doc_id. IMPORTANT: Ask user for confirmation before executing.',
      inputSchema: toMcpSchema(DeleteDocumentationSchema),
    },
    async (params: DeleteDocumentationInput) => deleteDocumentationMCP(db.getPool(), params)
  );

  logger.info('MCP server initialized successfully');
  return { config, db, ollama, server };
};

/** Graceful shutdown handler - closes database connections and flushes logs */
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

/** Main entry point - initialize server and connect stdio transport */
const main = async (): Promise<void> => {
  try {
    appState = await initializeServer();

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    const transport = new StdioServerTransport();
    await appState.server.connect(transport);

    logger.info('cindex MCP server is ready');
    logger.info('Waiting for requests...');
  } catch (error) {
    if (error instanceof CindexError) {
      console.error('\n' + error.getFormattedMessage());
    } else {
      logger.errorWithStack(
        'Unexpected error during initialization',
        error instanceof Error ? error : new Error(String(error))
      );
    }
    process.exit(1);
  }
};

void main();
