/**
 * Type definitions for Phase 4: Multi-Stage Retrieval System
 *
 * Defines interfaces and types for the 7-stage retrieval pipeline:
 * - Stage 0: Scope Filtering (multi-project)
 * - Stage 1: File-level retrieval
 * - Stage 2: Chunk-level retrieval
 * - Stage 3: Symbol resolution
 * - Stage 4: Import chain expansion
 * - Stage 5: API contract enrichment (multi-project)
 * - Stage 6: Deduplication
 * - Stage 7: Context assembly
 */

import { type RepositoryType } from './database';

/**
 * Query type classification
 */
export type QueryType = 'natural_language' | 'code_snippet';

/**
 * Query embedding result (Stage 1 input)
 */
export interface QueryEmbedding {
  /** Original query text */
  query_text: string;

  /** Detected query type */
  query_type: QueryType;

  /** Generated embedding vector (1024 dimensions for bge-m3:567m) */
  embedding: number[];

  /** Time taken to generate embedding in milliseconds */
  generation_time_ms: number;
}

/**
 * File-level retrieval result (Stage 1 output)
 */
export interface RelevantFile {
  /** File path relative to repository root */
  file_path: string;

  /** LLM-generated file summary */
  file_summary: string;

  /** Programming language */
  language: string;

  /** Total lines in file */
  line_count: number;

  /** Imported modules */
  imports: string[];

  /** Exported symbols */
  exports: string[];

  /** Cosine similarity score (0.0-1.0) */
  similarity: number;

  // Multi-project context (optional)
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
  repo_id?: string;
}

/**
 * Chunk-level retrieval result (Stage 2 output)
 */
export interface RelevantChunk {
  /** Chunk UUID */
  chunk_id: string;

  /** File path */
  file_path: string;

  /** Raw code content */
  chunk_content: string;

  /** Chunk type classification */
  chunk_type: string;

  /** Starting line number (1-indexed) */
  start_line: number;

  /** Ending line number (1-indexed) */
  end_line: number;

  /** Estimated token count */
  token_count: number;

  /** Chunk metadata (JSONB) */
  metadata: Record<string, unknown>;

  /** Cosine similarity score (0.0-1.0) */
  similarity: number;

  /** Embedding vector (for deduplication) */
  embedding?: number[];

  // Multi-project context (optional)
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
  repo_id?: string;
}

/**
 * Resolved symbol definition (Stage 3 output)
 */
export interface ResolvedSymbol {
  /** Symbol name */
  symbol_name: string;

  /** Symbol type */
  symbol_type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'constant' | 'method';

  /** File path where symbol is defined */
  file_path: string;

  /** Line number of definition */
  line_number: number;

  /** Symbol definition text */
  definition: string;

  /** Symbol scope */
  scope: 'exported' | 'internal';

  // Multi-project context (optional)
  workspace_id?: string;
  service_id?: string;
  is_internal?: boolean; // Internal to workspace/service
}

/**
 * Import chain entry (Stage 4 output)
 */
export interface ImportChain {
  /** File path */
  file_path: string;

  /** Parent file that imported this (undefined for root files) */
  imported_from?: string;

  /** Depth in import chain (0 = root, max 3) */
  depth: number;

  /** File summary */
  file_summary?: string;

  /** Exported symbols */
  exports?: string[];

  /** Whether this import creates a circular dependency */
  circular?: boolean;

  /** Whether chain was truncated */
  truncated?: boolean;

  /** Reason for truncation */
  truncation_reason?: 'depth_limit' | 'external_dependency' | 'boundary_crossed';

  // Multi-project context (optional)
  cross_workspace?: boolean;
  cross_service?: boolean;
  workspace_id?: string;
  service_id?: string;
}

/**
 * API endpoint match (Stage 5 output)
 */
export interface APIEndpointMatch {
  /** Endpoint path */
  endpoint_path: string;

  /** HTTP method (GET, POST, etc.) or operation type (query/mutation for GraphQL) */
  method: string;

  /** Service that exposes this endpoint */
  service_id: string;

  /** Service name */
  service_name: string;

  /** API type */
  api_type: 'rest' | 'graphql' | 'grpc' | 'websocket';

  /** Endpoint description */
  description?: string;

  /** Request schema (OpenAPI/GraphQL/Proto) */
  request_schema?: Record<string, unknown>;

  /** Response schema (OpenAPI/GraphQL/Proto) */
  response_schema?: Record<string, unknown>;

  /** Implementation chunk ID (if linked) */
  implementation_chunk_id?: string;

  /** Implementation file path */
  implementation_file?: string;

  /** Implementation line range */
  implementation_lines?: string;

  /** Similarity score to query (if found via embedding search) */
  similarity?: number;

  /** Whether this endpoint is deprecated */
  deprecated?: boolean;

  /** Deprecation message */
  deprecation_message?: string;
}

/**
 * Cross-service API call detected in code (Stage 5 output)
 */
export interface CrossServiceCall {
  /** Chunk ID where call was detected */
  source_chunk_id: string;

  /** Source file path */
  source_file: string;

  /** Source service ID */
  source_service_id: string;

  /** Target service ID (if resolved) */
  target_service_id?: string;

  /** Called endpoint */
  endpoint_path: string;

  /** HTTP method or operation type */
  method: string;

  /** Call type detected */
  call_type: 'http' | 'graphql' | 'grpc';

  /** Line number where call occurs */
  line_number?: number;

  /** Whether the endpoint was found in API registry */
  endpoint_found: boolean;

  /** Matched API endpoint (if found) */
  matched_endpoint?: APIEndpointMatch;
}

/**
 * Contract link between code chunk and API endpoint (Stage 5 output)
 */
export interface ContractLink {
  /** Chunk ID */
  chunk_id: string;

  /** Linked API endpoints */
  endpoints: APIEndpointMatch[];

  /** Link type */
  link_type: 'implementation' | 'consumer' | 'related';

  /** Confidence score (0.0-1.0) */
  confidence: number;
}

/**
 * API context result (Stage 5 output)
 */
export interface APIContext {
  /** All API endpoints found in searched services */
  endpoints: APIEndpointMatch[];

  /** Cross-service API calls detected in code */
  cross_service_calls: CrossServiceCall[];

  /** Links between chunks and API contracts */
  contract_links: ContractLink[];

  /** API-related warnings */
  api_warnings: SearchWarning[];

  /** Mapping: service_id → exposed APIs */
  apis_by_service: Record<string, APIEndpointMatch[]>;

  /** Mapping: chunk_id → related endpoints */
  endpoints_by_chunk: Record<string, APIEndpointMatch[]>;
}

/**
 * Deduplication result (Stage 6 output)
 */
export interface DeduplicationResult {
  /** Unique chunks after deduplication */
  unique_chunks: RelevantChunk[];

  /** Number of duplicates removed */
  duplicates_removed: number;

  /** Mapping of duplicate chunk IDs to kept chunk IDs */
  duplicate_map: Map<string, string>;

  /** Whether architecture context was preserved (multi-project) */
  architecture_context_preserved?: boolean;
}

/**
 * Search result warning
 */
export interface SearchWarning {
  /** Warning type */
  type: 'context_size' | 'boundary_crossed' | 'partial_results' | 'timeout' | 'deprecated_api';

  /** Severity level */
  severity: 'info' | 'warning' | 'error';

  /** Warning message */
  message: string;

  /** Suggested action */
  suggestion?: string;
}

/**
 * Repository metadata in search results (per-repository details)
 */
export interface RepositorySearchMetadata {
  /** Repository ID */
  repo_id: string;

  /** Repository type */
  repo_type: RepositoryType;

  /** Number of chunks from this repository in results */
  chunk_count: number;

  /** Number of files from this repository in results */
  file_count: number;

  /** Version (for reference repositories) */
  version?: string;

  /** Upstream URL (for reference repositories) */
  upstream_url?: string;

  /** Last indexed timestamp (for staleness warnings) */
  last_indexed?: string;
}

/**
 * Search metadata (Stage 7 metadata)
 */
export interface SearchMetadata {
  /** Total tokens in assembled context */
  total_tokens: number;

  /** Number of files retrieved */
  files_retrieved: number;

  /** Number of chunks retrieved (before dedup) */
  chunks_retrieved: number;

  /** Number of chunks after deduplication */
  chunks_after_dedup: number;

  /** Number of chunks deduplicated */
  chunks_deduplicated: number;

  /** Number of symbols resolved */
  symbols_resolved: number;

  /** Maximum import depth reached */
  import_depth_reached: number;

  /** Total query execution time in milliseconds */
  query_time_ms: number;

  // Multi-project metadata (optional)
  workspaces_searched?: number;
  services_searched?: number;
  api_endpoints_found?: number;

  /** Detailed repository metadata (replaces simple repos_searched counter) */
  repos_searched?: RepositorySearchMetadata[];

  /** Reference repositories included in results */
  reference_repos_included?: string[];

  /** Documentation repositories included in results */
  documentation_repos_included?: string[];
}

/**
 * Search context (Stage 7 context assembly)
 */
export interface SearchContext {
  /** Relevant files from Stage 1 */
  relevant_files: RelevantFile[];

  /** Code chunks from Stage 2 (after dedup) */
  code_locations: RelevantChunk[];

  /** Resolved symbols from Stage 3 */
  symbols: ResolvedSymbol[];

  /** Import chains from Stage 4 */
  imports: ImportChain[];

  /** API contracts from Stage 5 (multi-project only) */
  api_context?: APIContext;

  // Multi-project groupings (optional)
  by_workspace?: Record<string, SearchContextGroup>;
  by_service?: Record<string, SearchContextGroup>;
  by_repo?: Record<string, SearchContextGroup>;
}

/**
 * Grouped search context (multi-project)
 */
export interface SearchContextGroup {
  /** Workspace/service/repo ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Files in this group */
  files: RelevantFile[];

  /** Chunks in this group */
  chunks: RelevantChunk[];

  /** Symbols in this group */
  symbols: ResolvedSymbol[];

  /** Imports in this group */
  imports: ImportChain[];
}

/**
 * Complete search result (Stage 7 output)
 */
export interface SearchResult {
  /** Original query text */
  query: string;

  /** Detected query type */
  query_type: QueryType;

  /** Warnings generated during search */
  warnings: SearchWarning[];

  /** Search metadata */
  metadata: SearchMetadata;

  /** Assembled context */
  context: SearchContext;
}

/**
 * Search options (for search orchestrator)
 */
export interface SearchOptions {
  // ============================================================================
  // Base options (single-repo)
  // ============================================================================

  /** Maximum files to retrieve (Stage 1) */
  max_files?: number; // Default: 15

  /** Maximum code snippets to return (Stage 2) */
  max_snippets?: number; // Default: 25

  /** Include import chain expansion (Stage 4) */
  include_imports?: boolean; // Default: true

  /** Maximum import depth (Stage 4) */
  import_depth?: number; // Default: 3

  /** Deduplication threshold (Stage 6) */
  dedup_threshold?: number; // Default: 0.92

  /** Similarity threshold (Stage 1: File-level retrieval) */
  similarity_threshold?: number; // Default: 0.5

  /** Chunk similarity threshold (Stage 2: Chunk-level retrieval) */
  chunk_similarity_threshold?: number; // Default: uses similarity_threshold if not specified

  // ============================================================================
  // Multi-project filtering options (Stage 0)
  // ============================================================================

  /** Repository IDs to search within (explicit inclusion) */
  repo_filter?: string[];

  /** Workspace IDs to search within (monorepo filtering) */
  workspace_filter?: string[];

  /** Package names to filter by (package.json name field) */
  package_filter?: string[];

  /** Service IDs to search within (microservice filtering) */
  service_filter?: string[];

  /** Service types to filter by (docker, serverless, mobile, library, other) */
  service_type_filter?: string[];

  /** Repository IDs to exclude from search */
  exclude_repos?: string[];

  /** Workspace IDs to exclude from search */
  exclude_workspaces?: string[];

  /** Service IDs to exclude from search */
  exclude_services?: string[];

  /** Repository types to exclude (e.g., ['reference', 'documentation']) */
  exclude_repo_types?: RepositoryType[];

  /** Enable cross-repository search (default: false for single-repo, true for multi-project) */
  cross_repo?: boolean;

  // ============================================================================
  // Reference repository options (Stage 0)
  // ============================================================================

  /** Include reference repositories in search (default: false) */
  include_references?: boolean;

  /** Include documentation repositories in search (default: false) */
  include_documentation?: boolean;

  /** Maximum reference repository results to include (default: 5) */
  max_reference_results?: number;

  /** Maximum documentation repository results to include (default: 3) */
  max_documentation_results?: number;

  // ============================================================================
  // API contract enrichment options (Stage 5)
  // ============================================================================

  /** Enable API contract enrichment (default: true for multi-project, false for single-repo) */
  search_api_contracts?: boolean;

  /** Filter by API types (default: all types) */
  api_types?: ('rest' | 'graphql_query' | 'graphql_mutation' | 'graphql_subscription' | 'grpc')[];

  /** Include deprecated APIs in results (default: false) */
  include_deprecated_apis?: boolean;

  /** Similarity threshold for semantic API search (default: 0.75) */
  api_similarity_threshold?: number;

  /** Maximum API endpoints to retrieve (default: 50) */
  max_api_endpoints?: number;

  /** Only include endpoints with implementations in retrieved chunks (default: false) */
  require_implementation_match?: boolean;

  // ============================================================================
  // Boundary-aware search options (Stage 0 + Stage 4)
  // ============================================================================

  /** Maximum depth for workspace boundary traversal (default: 2) */
  workspace_depth?: number;

  /** Maximum depth for service boundary traversal (default: 1) */
  service_depth?: number;

  /** Strict workspace scope (don't cross workspace boundaries, default: false) */
  strict_workspace_scope?: boolean;

  /** Strict service scope (don't cross service boundaries, default: false) */
  strict_service_scope?: boolean;

  /** Workspace scope configuration (advanced boundary control) */
  workspace_scope?: {
    mode: 'strict' | 'inclusive' | 'unrestricted';
    max_depth?: number;
  };

  /** Service scope configuration (advanced boundary control) */
  service_scope?: {
    mode: 'strict' | 'inclusive' | 'unrestricted';
    max_depth?: number;
  };
}
