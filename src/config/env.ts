/**
 * Environment configuration loader and validator
 * Loads configuration from environment variables with validation and defaults
 */

import { ConfigurationError } from '@utils/errors';
import { DEFAULT_CONFIG, ENV_VARS, type CindexConfig } from '@/types/config';

/**
 * Get environment variable with default
 */
const getEnv = (key: string, defaultValue?: string): string | undefined => {
  return process.env[key] ?? defaultValue;
};

/**
 * Get required environment variable
 */
const getEnvRequired = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw ConfigurationError.missingRequired(key);
  }
  return value;
};

/**
 * Parse integer from environment variable
 */
const parseEnvInt = (key: string, defaultValue: number, min?: number, max?: number): number => {
  const value = getEnv(key);
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw ConfigurationError.invalidValue(key, value, 'valid integer');
  }

  if (min !== undefined && parsed < min) {
    throw ConfigurationError.invalidValue(key, String(parsed), `>= ${String(min)}`);
  }

  if (max !== undefined && parsed > max) {
    throw ConfigurationError.invalidValue(key, String(parsed), `<= ${String(max)}`);
  }

  return parsed;
};

/**
 * Parse float from environment variable
 */
const parseEnvFloat = (key: string, defaultValue: number, min?: number, max?: number): number => {
  const value = getEnv(key);
  if (!value) {
    return defaultValue;
  }

  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw ConfigurationError.invalidValue(key, value, 'valid number');
  }

  if (min !== undefined && parsed < min) {
    throw ConfigurationError.invalidValue(key, String(parsed), `>= ${String(min)}`);
  }

  if (max !== undefined && parsed > max) {
    throw ConfigurationError.invalidValue(key, String(parsed), `<= ${String(max)}`);
  }

  return parsed;
};

/**
 * Parse boolean from environment variable
 */
const parseEnvBool = (key: string, defaultValue: boolean): boolean => {
  const value = getEnv(key);
  if (!value) {
    return defaultValue;
  }

  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') {
    return true;
  }
  if (lower === 'false' || lower === '0' || lower === 'no') {
    return false;
  }

  throw ConfigurationError.invalidValue(key, value, 'true/false, 1/0, or yes/no');
};

/**
 * Parse array from environment variable (comma-separated)
 * Currently unused but reserved for future feature flags that accept arrays
 */
// const parseEnvArray = (key: string, defaultValue: string[]): string[] => {
//   const value = getEnv(key);
//   if (!value) {
//     return defaultValue;
//   }
//
//   return value
//     .split(',')
//     .map((s) => s.trim())
//     .filter((s) => s.length > 0);
// };

/**
 * Load and validate configuration from environment variables
 */
export const loadConfig = (): CindexConfig => {
  // Load embedding configuration
  const embeddingModel =
    getEnv(ENV_VARS.EMBEDDING_MODEL, DEFAULT_CONFIG.embedding.model) ?? DEFAULT_CONFIG.embedding.model;
  const embeddingDimensions = parseEnvInt(ENV_VARS.EMBEDDING_DIMENSIONS, DEFAULT_CONFIG.embedding.dimensions, 1, 4096);
  const embeddingContextWindow = parseEnvInt(
    ENV_VARS.EMBEDDING_CONTEXT_WINDOW,
    DEFAULT_CONFIG.embedding.context_window ?? 4096,
    512,
    131072
  );

  // Load summary configuration
  const summaryModel = getEnv(ENV_VARS.SUMMARY_MODEL, DEFAULT_CONFIG.summary.model) ?? DEFAULT_CONFIG.summary.model;
  const summaryContextWindow = parseEnvInt(
    ENV_VARS.SUMMARY_CONTEXT_WINDOW,
    DEFAULT_CONFIG.summary.context_window ?? 4096,
    512,
    131072
  );

  // Load Ollama configuration
  const ollamaHost = getEnv(ENV_VARS.OLLAMA_HOST, DEFAULT_CONFIG.ollama.host) ?? DEFAULT_CONFIG.ollama.host;
  const ollamaTimeout = parseEnvInt(ENV_VARS.OLLAMA_TIMEOUT, DEFAULT_CONFIG.ollama.timeout, 1000, 300000);

  // Load database configuration (password is required)
  const postgresHost = getEnv(ENV_VARS.POSTGRES_HOST, DEFAULT_CONFIG.database.host) ?? DEFAULT_CONFIG.database.host;
  const postgresPort = parseEnvInt(ENV_VARS.POSTGRES_PORT, DEFAULT_CONFIG.database.port, 1, 65535);
  const postgresDb = getEnv(ENV_VARS.POSTGRES_DB, DEFAULT_CONFIG.database.database) ?? DEFAULT_CONFIG.database.database;
  const postgresUser = getEnv(ENV_VARS.POSTGRES_USER, DEFAULT_CONFIG.database.user) ?? DEFAULT_CONFIG.database.user;
  const postgresPassword = getEnvRequired(ENV_VARS.POSTGRES_PASSWORD);
  const maxConnections = parseEnvInt(
    ENV_VARS.POSTGRES_MAX_CONNECTIONS,
    DEFAULT_CONFIG.database.max_connections,
    1,
    100
  );

  // Load performance configuration
  const hnswEfSearch = parseEnvInt(ENV_VARS.HNSW_EF_SEARCH, DEFAULT_CONFIG.performance.hnsw_ef_search, 10, 1000);
  const hnswEfConstruction = parseEnvInt(
    ENV_VARS.HNSW_EF_CONSTRUCTION,
    DEFAULT_CONFIG.performance.hnsw_ef_construction,
    10,
    1000
  );
  const similarityThreshold = parseEnvFloat(
    ENV_VARS.SIMILARITY_THRESHOLD,
    DEFAULT_CONFIG.performance.similarity_threshold,
    0.0,
    1.0
  );
  const dedupThreshold = parseEnvFloat(ENV_VARS.DEDUP_THRESHOLD, DEFAULT_CONFIG.performance.dedup_threshold, 0.0, 1.0);
  const importDepth = parseEnvInt(ENV_VARS.IMPORT_DEPTH, DEFAULT_CONFIG.performance.import_depth, 1, 10);
  const workspaceDepth = parseEnvInt(ENV_VARS.WORKSPACE_DEPTH, DEFAULT_CONFIG.performance.workspace_depth, 1, 10);
  const serviceDepth = parseEnvInt(ENV_VARS.SERVICE_DEPTH, DEFAULT_CONFIG.performance.service_depth, 1, 10);

  // Load indexing configuration
  const maxFileSize = parseEnvInt(ENV_VARS.MAX_FILE_SIZE, DEFAULT_CONFIG.indexing.max_file_size, 100, 100000);
  const includeMarkdown = parseEnvBool(ENV_VARS.INCLUDE_MARKDOWN, DEFAULT_CONFIG.indexing.include_markdown);

  // Load feature flags
  const enableWorkspaceDetection = parseEnvBool(
    ENV_VARS.ENABLE_WORKSPACE_DETECTION,
    DEFAULT_CONFIG.features.enable_workspace_detection
  );
  const enableServiceDetection = parseEnvBool(
    ENV_VARS.ENABLE_SERVICE_DETECTION,
    DEFAULT_CONFIG.features.enable_service_detection
  );
  const enableMultiRepo = parseEnvBool(ENV_VARS.ENABLE_MULTI_REPO, DEFAULT_CONFIG.features.enable_multi_repo);
  const enableApiEndpointDetection = parseEnvBool(
    ENV_VARS.ENABLE_API_ENDPOINT_DETECTION,
    DEFAULT_CONFIG.features.enable_api_endpoint_detection
  );

  // Build final configuration
  const config: CindexConfig = {
    embedding: {
      model: embeddingModel,
      dimensions: embeddingDimensions,
      batch_size: DEFAULT_CONFIG.embedding.batch_size,
      context_window: embeddingContextWindow,
    },
    summary: {
      model: summaryModel,
      method: DEFAULT_CONFIG.summary.method,
      max_lines: DEFAULT_CONFIG.summary.max_lines,
      context_window: summaryContextWindow,
    },
    ollama: {
      host: ollamaHost,
      timeout: ollamaTimeout,
      retry_attempts: DEFAULT_CONFIG.ollama.retry_attempts,
    },
    database: {
      host: postgresHost,
      port: postgresPort,
      database: postgresDb,
      user: postgresUser,
      password: postgresPassword,
      max_connections: maxConnections,
      idle_timeout: DEFAULT_CONFIG.database.idle_timeout,
    },
    performance: {
      hnsw_ef_search: hnswEfSearch,
      hnsw_ef_construction: hnswEfConstruction,
      similarity_threshold: similarityThreshold,
      dedup_threshold: dedupThreshold,
      import_depth: importDepth,
      workspace_depth: workspaceDepth,
      service_depth: serviceDepth,
      max_context_tokens: DEFAULT_CONFIG.performance.max_context_tokens,
      warn_context_tokens: DEFAULT_CONFIG.performance.warn_context_tokens,
      indexing_batch_size: DEFAULT_CONFIG.performance.indexing_batch_size,
      embedding_batch_size: DEFAULT_CONFIG.performance.embedding_batch_size,
    },
    features: {
      enable_workspace_detection: enableWorkspaceDetection,
      enable_service_detection: enableServiceDetection,
      enable_multi_repo: enableMultiRepo,
      enable_api_endpoint_detection: enableApiEndpointDetection,
      enable_deduplication: DEFAULT_CONFIG.features.enable_deduplication,
      enable_incremental_indexing: DEFAULT_CONFIG.features.enable_incremental_indexing,
      enable_llm_summaries: DEFAULT_CONFIG.features.enable_llm_summaries,
      enable_tsconfig_paths: DEFAULT_CONFIG.features.enable_tsconfig_paths,
    },
    indexing: {
      respect_gitignore: DEFAULT_CONFIG.indexing.respect_gitignore,
      include_markdown: includeMarkdown,
      max_file_size: maxFileSize,
      languages: DEFAULT_CONFIG.indexing.languages,
      detect_workspaces: DEFAULT_CONFIG.indexing.detect_workspaces,
      resolve_workspace_aliases: DEFAULT_CONFIG.indexing.resolve_workspace_aliases,
      parse_tsconfig_paths: DEFAULT_CONFIG.indexing.parse_tsconfig_paths,
      detect_services: DEFAULT_CONFIG.indexing.detect_services,
      detect_api_endpoints: DEFAULT_CONFIG.indexing.detect_api_endpoints,
      detect_from_docker_compose: DEFAULT_CONFIG.indexing.detect_from_docker_compose,
    },
  };

  return config;
};

/**
 * Validate configuration (additional semantic validation beyond type checking)
 */
export const validateConfig = (config: CindexConfig): void => {
  // Validate embedding dimensions match common models
  const validDimensions = [384, 768, 1024, 1536, 3072];
  if (!validDimensions.includes(config.embedding.dimensions)) {
    throw new ConfigurationError(
      `Unusual embedding dimensions: ${String(config.embedding.dimensions)}`,
      { dimensions: config.embedding.dimensions },
      `Common dimensions: ${validDimensions.join(', ')}. Make sure this matches your embedding model output.`
    );
  }

  // Validate similarity thresholds
  if (config.performance.similarity_threshold > config.performance.dedup_threshold) {
    throw new ConfigurationError(
      'SIMILARITY_THRESHOLD should be <= DEDUP_THRESHOLD',
      {
        similarity: config.performance.similarity_threshold,
        dedup: config.performance.dedup_threshold,
      },
      'Typically: SIMILARITY_THRESHOLD=0.75, DEDUP_THRESHOLD=0.92'
    );
  }

  // Validate HNSW parameters
  if (config.performance.hnsw_ef_search < config.performance.hnsw_ef_construction) {
    // This is just a warning, not an error
    console.warn(
      `Warning: HNSW_EF_SEARCH (${String(config.performance.hnsw_ef_search)}) < HNSW_EF_CONSTRUCTION (${String(config.performance.hnsw_ef_construction)}). This may reduce search accuracy.`
    );
  }
};
