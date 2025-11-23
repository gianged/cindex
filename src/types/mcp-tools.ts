/**
 * MCP Tool parameter types with workspace and service support
 * Extends the core MCP tools with filtering and boundary-aware features
 */

/**
 * Extended search_codebase tool parameters
 */
export interface SearchCodebaseParams {
  // Original parameters
  query: string; // Natural language or code snippet
  max_files?: number; // Default: 15
  max_snippets?: number; // Default: 25
  include_imports?: boolean; // Default: true
  import_depth?: number; // Default: 3
  dedup_threshold?: number; // Default: 0.92
  similarity_threshold?: number; // Default: 0.75

  // NEW: Workspace filtering
  workspace_filter?: string | string[]; // Filter by workspace ID(s)
  package_filter?: string | string[]; // Filter by package name(s)
  exclude_workspaces?: string[]; // Exclude workspaces
  workspace_scope?: WorkspaceScope; // How to handle workspace boundaries

  // NEW: Service filtering
  service_filter?: string | string[]; // Filter by service ID(s)
  service_type_filter?: string[]; // Filter by service types
  exclude_services?: string[]; // Exclude services
  service_scope?: ServiceScope; // How to handle service boundaries

  // NEW: Repository filtering (multi-repo)
  repo_filter?: string | string[]; // Filter by repo ID(s)
  exclude_repos?: string[]; // Exclude repositories
  cross_repo?: boolean; // Allow cross-repo results (default: false)
}

/**
 * Workspace scope configuration
 */
export interface WorkspaceScope {
  mode: 'strict' | 'inclusive' | 'unrestricted';
  // strict: Only within specified workspace(s), don't expand dependencies
  // inclusive: Include workspace dependencies (depth 1)
  // unrestricted: Ignore workspace boundaries (default)
  max_depth?: number; // Max dependency depth for inclusive mode
}

/**
 * Service scope configuration
 */
export interface ServiceScope {
  mode: 'strict' | 'inclusive' | 'unrestricted';
  // strict: Only within specified service(s), don't expand
  // inclusive: Include service dependencies (depth 1)
  // unrestricted: Ignore service boundaries (default)
  max_depth?: number; // Max dependency depth for inclusive mode
}

/**
 * Extended get_file_context tool parameters
 */
export interface GetFileContextParams {
  // Original parameters
  file_path: string;
  include_callers?: boolean; // Default: false
  include_callees?: boolean; // Default: true
  import_depth?: number; // Default: 3

  // NEW: Workspace context
  workspace?: string; // Limit context to this workspace
  include_workspace_only?: boolean; // Don't cross workspace boundaries
  respect_workspace_boundaries?: boolean; // Honor workspace boundaries

  // NEW: Service context
  service?: string; // Limit context to this service
  include_service_only?: boolean; // Don't cross service boundaries
  respect_service_boundaries?: boolean; // Honor service boundaries

  // NEW: Repository context
  repo_id?: string; // Specify repository ID
}

/**
 * Extended find_symbol_definition tool parameters
 */
export interface FindSymbolDefinitionParams {
  // Original parameters
  symbol_name: string;
  include_usages?: boolean; // Default: false

  // NEW: Scope filtering
  workspace_scope?: string | string[]; // Limit to workspace(s)
  service_scope?: string | string[]; // Limit to service(s)
  repo_scope?: string | string[]; // Limit to repository(s)

  // NEW: Context options
  include_cross_workspace?: boolean; // Include cross-workspace usages
  include_cross_service?: boolean; // Include cross-service usages
  max_usages?: number; // Limit number of usages returned
}

/**
 * Extended index_repository tool parameters
 */
export interface IndexRepositoryParams {
  // Original parameters
  repo_path: string;
  incremental?: boolean; // Default: true
  languages?: string[]; // Filter by language
  respect_gitignore?: boolean; // Default: true
  max_file_size?: number; // Default: 5000 lines
  summary_method?: 'llm' | 'rule-based'; // Default: 'llm'

  // NEW: Repository configuration
  repo_id?: string; // Unique repository ID (auto-generated if not provided)
  repo_name?: string; // Human-readable name
  repo_type?: 'monorepo' | 'microservice' | 'monolithic' | 'library';

  // NEW: Workspace detection
  detect_workspaces?: boolean; // Default: true
  workspace_config?: WorkspaceDetectionConfig;
  resolve_workspace_aliases?: boolean; // Default: true

  // NEW: Service detection
  detect_services?: boolean; // Default: true
  service_config?: ServiceDetectionConfig;
  detect_api_endpoints?: boolean; // Default: true

  // NEW: Multi-repo linking
  link_to_repos?: string[]; // Link to other indexed repos
  update_cross_repo_deps?: boolean; // Update cross-repo dependencies
}

/**
 * Workspace detection configuration
 */
export interface WorkspaceDetectionConfig {
  enabled: boolean;
  detect_pnpm?: boolean; // Default: true
  detect_npm?: boolean; // Default: true
  detect_yarn?: boolean; // Default: true
  detect_lerna?: boolean; // Default: true
  detect_nx?: boolean; // Default: true
  detect_turborepo?: boolean; // Default: true
  custom_patterns?: string[]; // Custom glob patterns
  parse_tsconfig_paths?: boolean; // Default: true
  excluded_workspaces?: string[];
  included_workspaces?: string[];
}

/**
 * Service detection configuration
 */
export interface ServiceDetectionConfig {
  enabled: boolean;
  detect_from_directories?: boolean; // Default: true (services/*, apps/*)
  detect_from_docker_compose?: boolean; // Default: true
  detect_from_package_json?: boolean; // Default: true
  detect_from_api_routes?: boolean; // Default: true
  custom_patterns?: string[];
  excluded_services?: string[];
  included_services?: string[];
}

/**
 * NEW TOOL: list_workspaces
 * Returns all workspaces in indexed repository
 */
export interface ListWorkspacesParams {
  repo_id?: string; // Filter by repository ID
  include_dependencies?: boolean; // Include dependency graph
  include_metadata?: boolean; // Include full package.json metadata
}

/**
 * NEW TOOL: list_services
 * Returns all services in indexed repository/repositories
 */
export interface ListServicesParams {
  repo_id?: string; // Filter by repository ID
  service_type?: string[]; // Filter by service types
  include_dependencies?: boolean; // Include service dependency graph
  include_api_endpoints?: boolean; // Include API endpoint definitions
}

/**
 * NEW TOOL: get_workspace_context
 * Get full context for a specific workspace
 */
export interface GetWorkspaceContextParams {
  workspace_id?: string; // Workspace ID
  package_name?: string; // Or package name
  repo_id?: string; // Repository ID (required if multiple repos)
  include_dependencies?: boolean; // Include workspace dependencies
  include_dependents?: boolean; // Include workspaces that depend on this
  dependency_depth?: number; // Max depth for dependency tree
}

/**
 * NEW TOOL: get_service_context
 * Get full context for a specific service
 */
export interface GetServiceContextParams {
  service_id?: string; // Service ID
  service_name?: string; // Or service name
  repo_id?: string; // Repository ID (required if multiple repos)
  include_dependencies?: boolean; // Include service dependencies
  include_dependents?: boolean; // Include services that depend on this
  include_api_contracts?: boolean; // Include API definitions
  dependency_depth?: number; // Max depth for dependency tree
}

/**
 * NEW TOOL: find_cross_workspace_usages
 * Find where a workspace package is used across the monorepo
 */
export interface FindCrossWorkspaceUsagesParams {
  workspace_id?: string; // Workspace ID
  package_name?: string; // Or package name
  symbol_name?: string; // Optional: specific symbol to track
  include_indirect?: boolean; // Include transitive usages
  max_depth?: number; // Max dependency depth
}

/**
 * NEW TOOL: find_cross_service_calls
 * Find inter-service API calls
 */
export interface FindCrossServiceCallsParams {
  source_service_id?: string; // Filter by calling service
  target_service_id?: string; // Filter by target service
  endpoint_pattern?: string; // Filter by endpoint (regex)
  include_reverse?: boolean; // Include reverse calls (target → source)
}

/**
 * Search result with workspace/service context
 */
export interface SearchResult {
  query: string;
  warnings: Warning[];
  metadata: SearchMetadata;
  context: SearchContext;
}

/**
 * Search warnings
 */
export interface Warning {
  type: 'context_size' | 'boundary_crossed' | 'partial_results' | 'timeout';
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string;
}

/**
 * Search metadata (extended with workspace/service info)
 */
export interface SearchMetadata {
  total_tokens: number;
  files_retrieved: number;
  chunks_retrieved: number;
  chunks_deduplicated: number;
  import_depth_reached: number;
  query_time_ms: number;
  // NEW: Workspace/service metadata
  workspaces_searched?: number;
  services_searched?: number;
  repos_searched?: number;
  boundaries_respected?: string[]; // Which boundaries were respected
}

/**
 * Search context (extended with workspace/service grouping)
 */
export interface SearchContext {
  relevant_files: RelevantFile[];
  code_locations: CodeLocation[];
  imports: ImportMap;
  code_snippets: CodeSnippet[];
  // NEW: Workspace/service grouping
  by_workspace?: Record<string, SearchContextGroup>;
  by_service?: Record<string, SearchContextGroup>;
  by_repo?: Record<string, SearchContextGroup>;
}

/**
 * Grouped search context (by workspace/service/repo)
 */
export interface SearchContextGroup {
  id: string;
  name: string;
  files: RelevantFile[];
  locations: CodeLocation[];
  snippets: CodeSnippet[];
}

/**
 * Relevant file (extended with workspace/service context)
 */
export interface RelevantFile {
  path: string;
  summary: string;
  relevance_score: number;
  total_lines: number;
  language: string;
  file_hash: string;
  // NEW: Context
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
  repo_id?: string;
}

/**
 * Code location (extended with workspace/service context)
 */
export interface CodeLocation {
  file: string;
  lines: string; // e.g., "45-67"
  relevance_score: number;
  chunk_type: string;
  context: string;
  token_count: number;
  // NEW: Context
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
  repo_id?: string;
}

/**
 * Import map
 */
export type ImportMap = Record<string, ImportEntry[]>;

/**
 * Import entry (extended with workspace/service context)
 */
export interface ImportEntry {
  symbol: string;
  from: string;
  line: number;
  definition: string;
  depth: number;
  // NEW: Context
  is_internal?: boolean; // Internal workspace/service import
  workspace_id?: string;
  service_id?: string;
  cross_boundary?: boolean; // Crosses workspace/service boundary
}

/**
 * Code snippet (extended with workspace/service context)
 */
export interface CodeSnippet {
  file: string;
  lines: string;
  code: string;
  symbols: string[];
  token_count: number;
  truncated: boolean;
  // NEW: Context
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
  repo_id?: string;
}
