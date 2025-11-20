/**
 * Zod schemas for MCP tool inputs
 * Maps to our TypeScript interfaces for type-safe MCP tool registration
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';

/**
 * Zod schema for search_codebase MCP tool
 *
 * Performs semantic code search across indexed repositories with support for:
 * - Multi-project filtering (workspaces, services, repositories)
 * - Reference repository inclusion (frameworks, libraries, documentation)
 * - Import chain expansion and deduplication
 * - Scope-aware search with boundary filtering
 *
 * @property query - Search query string (minimum 2 characters)
 * @property max_files - Maximum files to return (1-50, default: 20)
 * @property max_snippets - Maximum code snippets per file (1-100, default: 3)
 * @property include_imports - Include import chains in results
 * @property import_depth - Maximum import chain depth (1-3, default: 2)
 * @property dedup_threshold - Similarity threshold for deduplication (0-1, default: 0.92)
 * @property similarity_threshold - Minimum similarity score (0-1, default: 0.75)
 * @property workspace_filter - Filter by workspace ID(s)
 * @property package_filter - Filter by package name(s)
 * @property exclude_workspaces - Exclude specific workspaces
 * @property service_filter - Filter by service ID(s)
 * @property service_type_filter - Filter by service type(s)
 * @property exclude_services - Exclude specific services
 * @property repo_filter - Filter by repository ID(s)
 * @property exclude_repos - Exclude specific repositories
 * @property cross_repo - Include cross-repository dependencies
 * @property include_references - Include reference framework/library code
 * @property include_documentation - Include markdown documentation
 * @property max_reference_results - Maximum reference results (1-50, default: 5)
 * @property max_documentation_results - Maximum documentation results (1-50, default: 3)
 * @property exclude_repo_types - Exclude specific repository types
 * @property workspace_scope - Workspace scope configuration (strict/inclusive/unrestricted)
 * @property service_scope - Service scope configuration (strict/inclusive/unrestricted)
 */
export const SearchCodebaseSchema = z.object({
  // Core parameters
  query: z.string().min(2, 'Query must be at least 2 characters'),
  max_files: z.number().int().min(1).max(50).optional(),
  max_snippets: z.number().int().min(1).max(100).optional(),
  include_imports: z.boolean().optional(),
  import_depth: z.number().int().min(1).max(3).optional(),
  dedup_threshold: z.number().min(0).max(1).optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),

  // Multi-project filtering
  workspace_filter: z.union([z.string(), z.array(z.string())]).optional(),
  package_filter: z.union([z.string(), z.array(z.string())]).optional(),
  exclude_workspaces: z.array(z.string()).optional(),
  service_filter: z.union([z.string(), z.array(z.string())]).optional(),
  service_type_filter: z.array(z.string()).optional(),
  exclude_services: z.array(z.string()).optional(),
  repo_filter: z.union([z.string(), z.array(z.string())]).optional(),
  exclude_repos: z.array(z.string()).optional(),
  cross_repo: z.boolean().optional(),

  // Reference repository options
  include_references: z.boolean().optional(),
  include_documentation: z.boolean().optional(),
  max_reference_results: z.number().int().min(1).max(50).optional(),
  max_documentation_results: z.number().int().min(1).max(50).optional(),
  exclude_repo_types: z.array(z.string()).optional(),

  // Workspace/Service scope configuration
  workspace_scope: z
    .object({
      mode: z.enum(['strict', 'inclusive', 'unrestricted']),
      max_depth: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
  service_scope: z
    .object({
      mode: z.enum(['strict', 'inclusive', 'unrestricted']),
      max_depth: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
});

/**
 * Zod schema for get_file_context MCP tool
 *
 * Retrieves complete context for a specific file including:
 * - File content and metadata
 * - Import/export dependencies
 * - Function callers and callees
 * - Workspace and service boundary awareness
 *
 * @property file_path - Absolute or relative path to file
 * @property include_callers - Include functions that call symbols in this file
 * @property include_callees - Include functions called by this file
 * @property import_depth - Maximum import chain depth (1-3, default: 2)
 * @property workspace - Workspace ID to scope search
 * @property include_workspace_only - Only include files from same workspace
 * @property service - Service ID to scope search
 * @property include_service_only - Only include files from same service
 * @property respect_workspace_boundaries - Respect workspace boundaries in import expansion
 * @property respect_service_boundaries - Respect service boundaries in import expansion
 * @property repo_id - Repository ID to scope search
 */
export const GetFileContextSchema = z.object({
  file_path: z.string().min(1, 'File path is required'),
  include_callers: z.boolean().optional(),
  include_callees: z.boolean().optional(),
  import_depth: z.number().int().min(1).max(3).optional(),

  // Multi-project options
  workspace: z.string().optional(),
  include_workspace_only: z.boolean().optional(),
  service: z.string().optional(),
  include_service_only: z.boolean().optional(),
  respect_workspace_boundaries: z.boolean().optional(),
  respect_service_boundaries: z.boolean().optional(),
  repo_id: z.string().optional(),
});

/**
 * Zod schema for find_symbol_definition MCP tool
 *
 * Locates symbol definitions (functions, classes, variables) across the codebase with support for:
 * - Multi-project scope filtering
 * - Usage tracking across workspace and service boundaries
 * - Exported vs internal symbol filtering
 *
 * @property symbol_name - Name of symbol to find
 * @property include_usages - Include all locations where symbol is used
 * @property scope_filter - Filter by symbol visibility (all/exported/internal, default: all)
 * @property workspace_scope - Limit search to specific workspace(s)
 * @property service_scope - Limit search to specific service(s)
 * @property repo_scope - Limit search to specific repository(ies)
 * @property include_cross_workspace - Include usages across workspace boundaries
 * @property include_cross_service - Include usages across service boundaries
 * @property max_usages - Maximum number of usage locations to return (1-100, default: 50)
 */
export const FindSymbolSchema = z.object({
  symbol_name: z.string().min(1, 'Symbol name is required'),
  include_usages: z.boolean().optional(),
  scope_filter: z.enum(['all', 'exported', 'internal']).optional(),

  // Multi-project scope filtering
  workspace_scope: z.union([z.string(), z.array(z.string())]).optional(),
  service_scope: z.union([z.string(), z.array(z.string())]).optional(),
  repo_scope: z.union([z.string(), z.array(z.string())]).optional(),

  // Usage options
  include_cross_workspace: z.boolean().optional(),
  include_cross_service: z.boolean().optional(),
  max_usages: z.number().int().min(1).max(100).optional(),
});

/**
 * Zod schema for index_repository MCP tool
 *
 * Indexes or re-indexes a code repository with comprehensive support for:
 * - Multiple repository types (monolithic, microservice, monorepo, library, reference, documentation)
 * - Workspace detection (pnpm, npm, yarn, lerna, nx, turborepo)
 * - Service detection (Docker Compose, serverless, mobile)
 * - API endpoint parsing (REST, GraphQL, gRPC)
 * - Cross-repository dependency linking
 * - Incremental indexing with version tracking
 *
 * @property repo_path - Absolute or relative path to repository root
 * @property incremental - Use incremental indexing (hash comparison, default: true)
 * @property languages - Specific languages to index (default: all supported)
 * @property include_markdown - Index markdown documentation files
 * @property respect_gitignore - Respect .gitignore exclusions (default: true)
 * @property max_file_size - Maximum file size in KB (100-10000, default: 1000)
 * @property summary_method - Summary generation method (llm/rule-based, default: llm)
 * @property repo_id - Unique repository identifier (auto-generated if not provided)
 * @property repo_name - Human-readable repository name
 * @property repo_type - Repository type classification
 * @property detect_workspaces - Auto-detect monorepo workspaces
 * @property workspace_config - Workspace detection configuration
 * @property resolve_workspace_aliases - Resolve import aliases from tsconfig/package.json
 * @property detect_services - Auto-detect microservices
 * @property service_config - Service detection configuration
 * @property detect_api_endpoints - Parse and index API endpoints
 * @property link_to_repos - Link cross-repository dependencies
 * @property update_cross_repo_deps - Update cross-repo dependency graph
 * @property version - Repository version (for reference repos with version tracking)
 * @property force_reindex - Force full re-index ignoring version check
 * @property metadata - Additional repository metadata
 */
export const IndexRepositorySchema = z.object({
  // Core parameters
  repo_path: z.string().min(1, 'Repository path is required'),
  incremental: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
  include_markdown: z.boolean().optional(),
  respect_gitignore: z.boolean().optional(),
  max_file_size: z.number().int().min(100).max(10000).optional(),
  summary_method: z.enum(['llm', 'rule-based']).optional(),

  // Repository configuration
  repo_id: z.string().optional(),
  repo_name: z.string().optional(),
  repo_type: z.enum(['monolithic', 'microservice', 'monorepo', 'library', 'reference', 'documentation']).optional(),

  // Multi-project options
  detect_workspaces: z.boolean().optional(),
  workspace_config: z
    .object({
      detect_pnpm: z.boolean().optional(),
      detect_npm: z.boolean().optional(),
      detect_yarn: z.boolean().optional(),
      detect_lerna: z.boolean().optional(),
      detect_nx: z.boolean().optional(),
      detect_turborepo: z.boolean().optional(),
      custom_patterns: z.array(z.string()).optional(),
      parse_tsconfig_paths: z.boolean().optional(),
      excluded_workspaces: z.array(z.string()).optional(),
      included_workspaces: z.array(z.string()).optional(),
    })
    .optional(),
  resolve_workspace_aliases: z.boolean().optional(),

  // Service detection
  detect_services: z.boolean().optional(),
  service_config: z
    .object({
      detect_from_directories: z.boolean().optional(),
      detect_from_docker_compose: z.boolean().optional(),
      detect_from_package_json: z.boolean().optional(),
      detect_from_api_routes: z.boolean().optional(),
      custom_patterns: z.array(z.string()).optional(),
      excluded_services: z.array(z.string()).optional(),
      included_services: z.array(z.string()).optional(),
    })
    .optional(),
  detect_api_endpoints: z.boolean().optional(),

  // Multi-repo linking
  link_to_repos: z.array(z.string()).optional(),
  update_cross_repo_deps: z.boolean().optional(),

  // Reference repository options
  version: z.string().optional(),
  force_reindex: z.boolean().optional(),
  metadata: z
    .object({
      upstream_url: z.string().optional(),
      indexed_for: z.string().optional(),
      documentation_type: z.string().optional(),
      exclude_from_default_search: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Zod schema for delete_repository MCP tool
 *
 * Permanently deletes one or more repositories from the index.
 * Removes all associated data including files, chunks, symbols, workspaces, and services.
 *
 * @property repo_ids - Array of repository IDs to delete (minimum 1 required)
 */
export const DeleteRepositorySchema = z.object({
  repo_ids: z.array(z.string().min(1)).min(1, 'At least one repository ID is required'),
});

/**
 * Zod schema for list_indexed_repos MCP tool
 *
 * Lists all indexed repositories with optional metadata and statistics.
 *
 * @property include_metadata - Include repository metadata (version, upstream_url, etc.)
 * @property include_workspace_count - Include count of workspaces per repository
 * @property include_service_count - Include count of services per repository
 */
export const ListIndexedReposSchema = z.object({
  include_metadata: z.boolean().optional(),
  include_workspace_count: z.boolean().optional(),
  include_service_count: z.boolean().optional(),
});

/**
 * Zod schema for list_workspaces MCP tool
 *
 * Lists all workspaces in a monorepo with optional dependency information.
 *
 * @property repo_id - Filter by repository ID (returns all repos if omitted)
 * @property include_dependencies - Include workspace dependency graph
 * @property include_metadata - Include workspace metadata (tsconfig paths, package info)
 */
export const ListWorkspacesSchema = z.object({
  repo_id: z.string().optional(),
  include_dependencies: z.boolean().optional(),
  include_metadata: z.boolean().optional(),
});

/**
 * Zod schema for get_workspace_context MCP tool
 *
 * Retrieves complete context for a monorepo workspace including:
 * - Workspace metadata and configuration
 * - Internal workspace dependencies (dependents and dependencies)
 * - Workspace files and symbols
 * - Dependency traversal with configurable depth
 *
 * @property workspace_id - Workspace ID (workspace_id or package_name required)
 * @property package_name - Package name from package.json (workspace_id or package_name required)
 * @property repo_id - Repository ID to narrow search scope
 * @property include_dependencies - Include workspaces this workspace depends on
 * @property include_dependents - Include workspaces that depend on this workspace
 * @property dependency_depth - Maximum dependency traversal depth (1-5, default: 2)
 */
export const GetWorkspaceContextSchema = z.object({
  workspace_id: z.string().optional(),
  package_name: z.string().optional(),
  repo_id: z.string().optional(),
  include_dependencies: z.boolean().optional(),
  include_dependents: z.boolean().optional(),
  dependency_depth: z.number().int().min(1).max(5).optional(),
});

/**
 * Zod schema for find_cross_workspace_usages MCP tool
 *
 * Finds all cross-workspace usages of a workspace or symbol in a monorepo.
 * Tracks how workspaces import and use each other's code.
 *
 * @property workspace_id - Source workspace ID (workspace_id or package_name required)
 * @property package_name - Source package name (workspace_id or package_name required)
 * @property symbol_name - Specific symbol to track (optional, searches all if omitted)
 * @property include_indirect - Include indirect usages (transitive dependencies)
 * @property max_depth - Maximum traversal depth for indirect usages (1-5, default: 3)
 */
export const FindCrossWorkspaceUsagesSchema = z.object({
  workspace_id: z.string().optional(),
  package_name: z.string().optional(),
  symbol_name: z.string().optional(),
  include_indirect: z.boolean().optional(),
  max_depth: z.number().int().min(1).max(5).optional(),
});

/**
 * Zod schema for list_services MCP tool
 *
 * Lists all detected services in microservice or monorepo architectures.
 *
 * @property repo_id - Filter by repository ID (returns all repos if omitted)
 * @property service_type - Filter by service type (docker, serverless, mobile)
 * @property include_dependencies - Include service dependency graph
 * @property include_api_endpoints - Include parsed API endpoint information
 */
export const ListServicesSchema = z.object({
  repo_id: z.string().optional(),
  service_type: z.array(z.string()).optional(),
  include_dependencies: z.boolean().optional(),
  include_api_endpoints: z.boolean().optional(),
});

/**
 * Zod schema for get_service_context MCP tool
 *
 * Retrieves complete context for a microservice including:
 * - Service metadata and configuration
 * - Inter-service dependencies
 * - API contracts and endpoints
 * - Service files and symbols
 *
 * @property service_id - Service ID (service_id or service_name required)
 * @property service_name - Service name (service_id or service_name required)
 * @property repo_id - Repository ID to narrow search scope
 * @property include_dependencies - Include services this service depends on
 * @property include_dependents - Include services that depend on this service
 * @property include_api_contracts - Include parsed API endpoint definitions
 * @property dependency_depth - Maximum dependency traversal depth (1-5, default: 2)
 */
export const GetServiceContextSchema = z.object({
  service_id: z.string().optional(),
  service_name: z.string().optional(),
  repo_id: z.string().optional(),
  include_dependencies: z.boolean().optional(),
  include_dependents: z.boolean().optional(),
  include_api_contracts: z.boolean().optional(),
  dependency_depth: z.number().int().min(1).max(5).optional(),
});

/**
 * Zod schema for find_cross_service_calls MCP tool
 *
 * Finds cross-service API calls in microservice architectures.
 * Tracks HTTP/REST/GraphQL/gRPC calls between services.
 *
 * @property source_service_id - Source service making the API call
 * @property target_service_id - Target service being called
 * @property endpoint_pattern - Regex pattern to match endpoint paths
 * @property include_reverse - Include reverse calls (target calling source)
 */
export const FindCrossServiceCallsSchema = z.object({
  source_service_id: z.string().optional(),
  target_service_id: z.string().optional(),
  endpoint_pattern: z.string().optional(),
  include_reverse: z.boolean().optional(),
});

/**
 * Zod schema for search_api_contracts MCP tool
 *
 * Semantic search across API endpoint definitions (REST, GraphQL, gRPC).
 * Searches endpoint paths, operation IDs, descriptions, and parameters.
 *
 * @property query - Search query for API endpoints (minimum 2 characters)
 * @property api_types - Filter by API type (rest, graphql, grpc)
 * @property service_filter - Filter by service ID(s)
 * @property repo_filter - Filter by repository ID(s)
 * @property include_deprecated - Include deprecated endpoints
 * @property max_results - Maximum results to return (1-100, default: 20)
 * @property similarity_threshold - Minimum similarity score (0-1, default: 0.75)
 */
export const SearchAPIContractsSchema = z.object({
  query: z.string().min(2, 'Query must be at least 2 characters'),
  api_types: z.array(z.enum(['rest', 'graphql', 'grpc'])).optional(),
  service_filter: z.array(z.string()).optional(),
  repo_filter: z.array(z.string()).optional(),
  include_deprecated: z.boolean().optional(),
  max_results: z.number().int().min(1).max(100).optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),
});
