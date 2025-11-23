/**
 * Configuration types for cindex MCP server
 *
 * Defines environment variables, runtime configuration, and indexing options
 */

/**
 * Main server configuration loaded from environment variables
 */
export interface CindexConfig {
  /** Embedding model settings */
  embedding: EmbeddingConfig;
  /** Summary generation settings */
  summary: SummaryConfig;
  /** Ollama API settings */
  ollama: OllamaConfig;
  /** PostgreSQL database settings */
  database: DatabaseConfig;
  /** Performance tuning parameters */
  performance: PerformanceConfig;
  /** Feature flags for optional features */
  features: FeatureFlags;
  /** Default indexing options */
  indexing: IndexingDefaults;
}

/**
 * Embedding model configuration
 */
export interface EmbeddingConfig {
  /** Model name (default: 'bge-m3:567m') */
  model: string;
  /** Embedding vector dimensions (default: 1024) */
  dimensions: number;
  /** Batch size for embedding generation (default: 100) */
  batch_size: number;
  /** Context window in tokens (default: 4096) */
  context_window?: number;
}

/**
 * File summary generation configuration
 */
export interface SummaryConfig {
  /** LLM model name (default: 'qwen2.5-coder:7b') */
  model: string;
  /** Summary generation method (default: 'llm') */
  method: 'llm' | 'rule-based';
  /** Maximum lines to send to LLM (default: 100) */
  max_lines: number;
  /** Context window in tokens (default: 4096) */
  context_window?: number;
}

/**
 * Ollama API client configuration
 */
export interface OllamaConfig {
  /** Ollama server URL (default: 'http://localhost:11434') */
  host: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout: number;
  /** Number of retry attempts (default: 3) */
  retry_attempts: number;
}

/**
 * PostgreSQL database connection configuration
 */
export interface DatabaseConfig {
  /** Database host (default: 'localhost') */
  host: string;
  /** Database port (default: 5432) */
  port: number;
  /** Database name (default: 'cindex_rag_codebase') */
  database: string;
  /** Database user (default: 'postgres') */
  user: string;
  /** Database password (required) */
  password: string;
  /** Maximum connection pool size (default: 10) */
  max_connections: number;
  /** Idle connection timeout in milliseconds (default: 30000) */
  idle_timeout: number;
}

/**
 * Performance tuning configuration
 */
export interface PerformanceConfig {
  /** HNSW index search parameter (default: 300) - higher = more accurate */
  hnsw_ef_search: number;
  /** HNSW index construction parameter (default: 200) - higher = better quality */
  hnsw_ef_construction: number;
  /** Minimum similarity score for file-level retrieval (default: 0.3) */
  similarity_threshold: number;
  /** Minimum similarity score for chunk-level retrieval (default: 0.2, uses enhanced embedding) */
  chunk_similarity_threshold: number;
  /** Similarity threshold for deduplication (default: 0.92) */
  dedup_threshold: number;
  /** Maximum import chain depth (default: 3) */
  import_depth: number;
  /** Maximum workspace boundary traversal depth (default: 2) */
  workspace_depth: number;
  /** Maximum service boundary traversal depth (default: 1) */
  service_depth: number;
  /** Maximum context tokens before warning (default: 100000) */
  max_context_tokens: number;
  /** Token count to trigger warning (default: 100000) */
  warn_context_tokens: number;
  /** Batch size for database insertions (default: 100) */
  indexing_batch_size: number;
  /** Batch size for embedding generation (default: 50) */
  embedding_batch_size: number;
  /** Weight for vector similarity in hybrid search (default: 0.7) */
  hybrid_vector_weight: number;
  /** Weight for keyword (BM25) score in hybrid search (default: 0.3) */
  hybrid_keyword_weight: number;
}

/**
 * Feature flags for enabling/disabling optional features
 */
export interface FeatureFlags {
  /** Enable monorepo workspace detection (default: true) */
  enable_workspace_detection: boolean;
  /** Enable microservice detection (default: true) */
  enable_service_detection: boolean;
  /** Enable multi-repository support (default: false) */
  enable_multi_repo: boolean;
  /** Enable API endpoint detection (default: true) */
  enable_api_endpoint_detection: boolean;
  /** Enable result deduplication (default: true) */
  enable_deduplication: boolean;
  /** Enable incremental indexing (default: true) */
  enable_incremental_indexing: boolean;
  /** Enable LLM-based summaries (default: true) */
  enable_llm_summaries: boolean;
  /** Enable TypeScript path mapping (default: true) */
  enable_tsconfig_paths: boolean;
  /** Enable hybrid search combining vector + full-text search (default: true) */
  enable_hybrid_search: boolean;
}

/**
 * Default indexing options
 */
export interface IndexingDefaults {
  /** Respect .gitignore patterns (default: true) */
  respect_gitignore: boolean;
  /** Maximum file size in lines (default: 5000) */
  max_file_size: number;
  /** Enable secret file protection (default: true) */
  protect_secrets: boolean;
  /** Custom secret file patterns (default: []) */
  secret_patterns: string[];
  /** Languages to index (default: [] = all) */
  languages: string[];
  /** Enable workspace detection (default: true) */
  detect_workspaces: boolean;
  /** Resolve workspace import aliases (default: true) */
  resolve_workspace_aliases: boolean;
  /** Parse tsconfig.json paths (default: true) */
  parse_tsconfig_paths: boolean;
  /** Enable service detection (default: true) */
  detect_services: boolean;
  /** Detect API endpoints (default: true) */
  detect_api_endpoints: boolean;
  /** Parse docker-compose.yml (default: true) */
  detect_from_docker_compose: boolean;
}

/**
 * Runtime state managed internally (not from configuration)
 */
export interface RuntimeState {
  /** Indexed repository metadata cache */
  indexed_repos: Map<string, IndexedRepoState>;
  /** Workspace information cache */
  workspace_cache: Map<string, WorkspaceCacheEntry>;
  /** Service information cache */
  service_cache: Map<string, ServiceCacheEntry>;
  /** Import alias resolution cache (alias → resolved path) */
  alias_cache: Map<string, string>;
}

/**
 * Indexed repository state information
 */
export interface IndexedRepoState {
  /** Repository identifier */
  repo_id: string;
  /** Absolute path to repository */
  repo_path: string;
  /** Last indexing timestamp */
  last_indexed: Date;
  /** Number of indexed files */
  file_count: number;
  /** Number of detected workspaces */
  workspace_count: number;
  /** Number of detected services */
  service_count: number;
  /** Whether repository is a monorepo */
  is_monorepo: boolean;
}

/**
 * Workspace cache entry for fast lookups
 */
export interface WorkspaceCacheEntry {
  /** Workspace identifier */
  workspace_id: string;
  /** Package name */
  package_name: string;
  /** Relative path from repository root */
  workspace_path: string;
  /** Internal workspace dependencies (package names) */
  dependencies: string[];
  /** Workspaces that depend on this one (package names) */
  dependents: string[];
}

/**
 * Service cache entry for fast lookups
 */
export interface ServiceCacheEntry {
  /** Service identifier */
  service_id: string;
  /** Service name */
  service_name: string;
  /** Service type */
  service_type: string;
  /** Exposed API endpoints */
  api_endpoints: string[];
  /** Service dependencies (service IDs) */
  dependencies: string[];
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
  CHUNK_SIMILARITY_THRESHOLD: 'CHUNK_SIMILARITY_THRESHOLD',
  DEDUP_THRESHOLD: 'DEDUP_THRESHOLD',
  HYBRID_VECTOR_WEIGHT: 'HYBRID_VECTOR_WEIGHT',
  HYBRID_KEYWORD_WEIGHT: 'HYBRID_KEYWORD_WEIGHT',

  // Depths
  IMPORT_DEPTH: 'IMPORT_DEPTH',
  WORKSPACE_DEPTH: 'WORKSPACE_DEPTH',
  SERVICE_DEPTH: 'SERVICE_DEPTH',

  // Indexing
  MAX_FILE_SIZE: 'MAX_FILE_SIZE',
  PROTECT_SECRETS: 'PROTECT_SECRETS',
  SECRET_PATTERNS: 'SECRET_PATTERNS',

  // Feature flags
  ENABLE_WORKSPACE_DETECTION: 'ENABLE_WORKSPACE_DETECTION',
  ENABLE_SERVICE_DETECTION: 'ENABLE_SERVICE_DETECTION',
  ENABLE_MULTI_REPO: 'ENABLE_MULTI_REPO',
  ENABLE_API_ENDPOINT_DETECTION: 'ENABLE_API_ENDPOINT_DETECTION',
  ENABLE_HYBRID_SEARCH: 'ENABLE_HYBRID_SEARCH',
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
    similarity_threshold: 0.3,
    chunk_similarity_threshold: 0.2,
    dedup_threshold: 0.92,
    import_depth: 3,
    workspace_depth: 2,
    service_depth: 1,
    max_context_tokens: 100000,
    warn_context_tokens: 100000,
    indexing_batch_size: 100,
    embedding_batch_size: 50,
    hybrid_vector_weight: 0.7,
    hybrid_keyword_weight: 0.3,
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
    enable_hybrid_search: true,
  },
  indexing: {
    respect_gitignore: true,
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
