/**
 * Configuration types for cindex MCP server
 * Environment variables, runtime configuration, and indexing options
 */

/**
 * Main server configuration (from environment variables)
 */
export interface CindexConfig {
  // Model settings
  embedding: EmbeddingConfig;
  summary: SummaryConfig;
  ollama: OllamaConfig;

  // Database settings
  database: DatabaseConfig;

  // Performance tuning
  performance: PerformanceConfig;

  // Feature flags
  features: FeatureFlags;

  // Indexing defaults
  indexing: IndexingDefaults;
}

/**
 * Embedding model configuration
 */
export interface EmbeddingConfig {
  model: string; // Default: 'mxbai-embed-large'
  dimensions: number; // Default: 1024
  batch_size: number; // Default: 100
  context_window?: number; // Default: 4096 (tokens, optional)
}

/**
 * Summary generation configuration
 */
export interface SummaryConfig {
  model: string; // Default: 'qwen2.5-coder:1.5b'
  method: 'llm' | 'rule-based'; // Default: 'llm'
  max_lines: number; // Default: 100 (first N lines for LLM)
  context_window?: number; // Default: 4096 (tokens, optional)
}

/**
 * Ollama configuration
 */
export interface OllamaConfig {
  host: string; // Default: 'http://localhost:11434'
  timeout: number; // Default: 30000ms
  retry_attempts: number; // Default: 3
}

/**
 * PostgreSQL database configuration
 */
export interface DatabaseConfig {
  host: string; // Default: 'localhost'
  port: number; // Default: 5432
  database: string; // Default: 'cindex_rag_codebase'
  user: string; // Default: 'postgres'
  password: string; // Required
  max_connections: number; // Default: 10
  idle_timeout: number; // Default: 30000ms
}

/**
 * Performance tuning configuration
 */
export interface PerformanceConfig {
  // HNSW parameters
  hnsw_ef_search: number; // Default: 300
  hnsw_ef_construction: number; // Default: 200

  // Retrieval thresholds
  similarity_threshold: number; // Default: 0.75
  dedup_threshold: number; // Default: 0.92

  // Import chain limits
  import_depth: number; // Default: 3
  workspace_depth: number; // Default: 2
  service_depth: number; // Default: 1

  // Context limits
  max_context_tokens: number; // Default: 100000
  warn_context_tokens: number; // Default: 100000

  // Batch processing
  indexing_batch_size: number; // Default: 100
  embedding_batch_size: number; // Default: 50
}

/**
 * Feature flags (enable/disable features)
 */
export interface FeatureFlags {
  enable_workspace_detection: boolean; // Default: true
  enable_service_detection: boolean; // Default: true
  enable_multi_repo: boolean; // Default: false
  enable_api_endpoint_detection: boolean; // Default: true
  enable_deduplication: boolean; // Default: true
  enable_incremental_indexing: boolean; // Default: true
  enable_llm_summaries: boolean; // Default: true
  enable_tsconfig_paths: boolean; // Default: true
}

/**
 * Indexing defaults
 */
export interface IndexingDefaults {
  // File filtering
  respect_gitignore: boolean; // Default: true
  include_markdown: boolean; // Default: false
  max_file_size: number; // Default: 5000 lines
  protect_secrets: boolean; // Default: true
  secret_patterns: string[]; // Default: [] (use built-in patterns)

  // Language detection
  languages: string[]; // Default: [] (all)

  // Workspace detection
  detect_workspaces: boolean; // Default: true
  resolve_workspace_aliases: boolean; // Default: true
  parse_tsconfig_paths: boolean; // Default: true

  // Service detection
  detect_services: boolean; // Default: true
  detect_api_endpoints: boolean; // Default: true
  detect_from_docker_compose: boolean; // Default: true
}

/**
 * Runtime state (not from config, managed internally)
 */
export interface RuntimeState {
  indexed_repos: Map<string, IndexedRepoState>;
  workspace_cache: Map<string, WorkspaceCacheEntry>;
  service_cache: Map<string, ServiceCacheEntry>;
  alias_cache: Map<string, string>; // alias → resolved path
}

/**
 * Indexed repository state
 */
export interface IndexedRepoState {
  repo_id: string;
  repo_path: string;
  last_indexed: Date;
  file_count: number;
  workspace_count: number;
  service_count: number;
  is_monorepo: boolean;
}

/**
 * Workspace cache entry
 */
export interface WorkspaceCacheEntry {
  workspace_id: string;
  package_name: string;
  workspace_path: string;
  dependencies: string[]; // Package names
  dependents: string[]; // Package names
}

/**
 * Service cache entry
 */
export interface ServiceCacheEntry {
  service_id: string;
  service_name: string;
  service_type: string;
  api_endpoints: string[];
  dependencies: string[]; // Service IDs
}

/**
 * Environment variable keys
 */
export const ENV_VARS = {
  // Models
  EMBEDDING_MODEL: 'EMBEDDING_MODEL',
  EMBEDDING_DIMENSIONS: 'EMBEDDING_DIMENSIONS',
  EMBEDDING_CONTEXT_WINDOW: 'EMBEDDING_CONTEXT_WINDOW',
  SUMMARY_MODEL: 'SUMMARY_MODEL',
  SUMMARY_CONTEXT_WINDOW: 'SUMMARY_CONTEXT_WINDOW',
  OLLAMA_HOST: 'OLLAMA_HOST',
  OLLAMA_TIMEOUT: 'OLLAMA_TIMEOUT',

  // Database
  POSTGRES_HOST: 'POSTGRES_HOST',
  POSTGRES_PORT: 'POSTGRES_PORT',
  POSTGRES_DB: 'POSTGRES_DB',
  POSTGRES_USER: 'POSTGRES_USER',
  POSTGRES_PASSWORD: 'POSTGRES_PASSWORD',
  POSTGRES_MAX_CONNECTIONS: 'POSTGRES_MAX_CONNECTIONS',

  // Performance
  HNSW_EF_SEARCH: 'HNSW_EF_SEARCH',
  HNSW_EF_CONSTRUCTION: 'HNSW_EF_CONSTRUCTION',
  SIMILARITY_THRESHOLD: 'SIMILARITY_THRESHOLD',
  DEDUP_THRESHOLD: 'DEDUP_THRESHOLD',

  // Depths
  IMPORT_DEPTH: 'IMPORT_DEPTH',
  WORKSPACE_DEPTH: 'WORKSPACE_DEPTH',
  SERVICE_DEPTH: 'SERVICE_DEPTH',

  // Indexing
  MAX_FILE_SIZE: 'MAX_FILE_SIZE',
  INCLUDE_MARKDOWN: 'INCLUDE_MARKDOWN',
  PROTECT_SECRETS: 'PROTECT_SECRETS',
  SECRET_PATTERNS: 'SECRET_PATTERNS',

  // Feature flags
  ENABLE_WORKSPACE_DETECTION: 'ENABLE_WORKSPACE_DETECTION',
  ENABLE_SERVICE_DETECTION: 'ENABLE_SERVICE_DETECTION',
  ENABLE_MULTI_REPO: 'ENABLE_MULTI_REPO',
  ENABLE_API_ENDPOINT_DETECTION: 'ENABLE_API_ENDPOINT_DETECTION',
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: CindexConfig = {
  embedding: {
    model: 'bge-m3:567m',
    dimensions: 1024,
    batch_size: 100,
    context_window: 4096,
  },
  summary: {
    model: 'qwen2.5-coder:7b',
    method: 'llm',
    max_lines: 100,
    context_window: 4096,
  },
  ollama: {
    host: 'http://localhost:11434',
    timeout: 30000,
    retry_attempts: 3,
  },
  database: {
    host: 'localhost',
    port: 5432,
    database: 'cindex_rag_codebase',
    user: 'postgres',
    password: '', // Must be provided
    max_connections: 10,
    idle_timeout: 30000,
  },
  performance: {
    hnsw_ef_search: 300,
    hnsw_ef_construction: 200,
    similarity_threshold: 0.75,
    dedup_threshold: 0.92,
    import_depth: 3,
    workspace_depth: 2,
    service_depth: 1,
    max_context_tokens: 100000,
    warn_context_tokens: 100000,
    indexing_batch_size: 100,
    embedding_batch_size: 50,
  },
  features: {
    enable_workspace_detection: true,
    enable_service_detection: true,
    enable_multi_repo: false,
    enable_api_endpoint_detection: true,
    enable_deduplication: true,
    enable_incremental_indexing: true,
    enable_llm_summaries: true,
    enable_tsconfig_paths: true,
  },
  indexing: {
    respect_gitignore: true,
    include_markdown: false,
    max_file_size: 5000,
    protect_secrets: true,
    secret_patterns: [],
    languages: [],
    detect_workspaces: true,
    resolve_workspace_aliases: true,
    parse_tsconfig_paths: true,
    detect_services: true,
    detect_api_endpoints: true,
    detect_from_docker_compose: true,
  },
};
