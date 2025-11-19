/**
 * Core database types for cindex MCP server
 * Matches the PostgreSQL schema in database.sql
 */

/**
 * Base repository context (added to all core tables for multi-repo support)
 */
export interface RepositoryContext {
  repo_id: string | null;
  workspace_id: string | null;
  package_name: string | null;
  service_id: string | null;
}

/**
 * Code chunk with embeddings (extended with workspace/service context)
 */
export interface CodeChunk extends RepositoryContext {
  id: number;
  repo_path: string;
  file_path: string;
  chunk_type: ChunkType;
  chunk_content: string;
  start_line: number;
  end_line: number;
  language: string;
  embedding: number[] | null; // pgvector array
  token_count: number | null;
  metadata: ChunkMetadata | null;
  indexed_at: Date;
}

/**
 * Chunk types (semantic code structure)
 */
export type ChunkType = 'file_summary' | 'function' | 'class' | 'import_block' | 'fallback';

/**
 * Metadata for code chunks (JSONB)
 */
export interface ChunkMetadata {
  function_name?: string;
  class_name?: string;
  complexity?: number;
  dependencies?: string[];
  [key: string]: unknown; // Allow additional custom fields
}

/**
 * File-level metadata (extended with workspace/service context)
 */
export interface CodeFile extends RepositoryContext {
  id: number;
  repo_path: string;
  file_path: string;
  file_summary: string | null;
  summary_embedding: number[] | null;
  language: string;
  total_lines: number | null;
  imports: string[] | null;
  exports: string[] | null;
  file_hash: string; // SHA256
  last_modified: Date | null;
  indexed_at: Date;
}

/**
 * Symbol registry (extended with workspace/service context)
 */
export interface CodeSymbol extends RepositoryContext {
  id: number;
  repo_path: string;
  symbol_name: string;
  symbol_type: SymbolType;
  file_path: string;
  line_number: number;
  definition: string | null;
  embedding: number[] | null;
}

/**
 * Symbol types
 */
export type SymbolType = 'function' | 'class' | 'variable' | 'interface' | 'type' | 'constant' | 'method';

/**
 * Workspace/package registry for monorepo support
 */
export interface Workspace {
  id: number;
  repo_id: string;
  workspace_id: string; // Unique identifier (e.g., 'auth-workspace')
  package_name: string; // From package.json (e.g., '@workspace/auth')
  workspace_path: string; // Relative path from repo root
  package_json_path: string | null;
  version: string | null;
  dependencies: Record<string, string> | null; // JSONB
  dev_dependencies: Record<string, string> | null; // JSONB
  tsconfig_paths: Record<string, string[]> | null; // JSONB - TypeScript path aliases
  metadata: WorkspaceMetadata | null;
  indexed_at: Date;
}

/**
 * Workspace metadata (JSONB)
 */
export interface WorkspaceMetadata {
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
  main?: string;
  types?: string;
  [key: string]: unknown;
}

/**
 * Service registry for microservice architecture
 */
export interface Service {
  id: number;
  service_id: string; // Unique identifier (e.g., 'auth-service')
  service_name: string;
  repo_id: string;
  service_path: string | null; // For monorepo services
  service_type: ServiceType;
  api_endpoints: APIEndpoint[] | null; // JSONB
  dependencies: ServiceDependency[] | null; // JSONB
  metadata: ServiceMetadata | null;
  indexed_at: Date;
}

/**
 * Service types
 */
export type ServiceType = 'rest' | 'graphql' | 'grpc' | 'library' | 'other';

/**
 * API endpoint definition
 */
export interface APIEndpoint {
  method?: string; // HTTP method (GET, POST, etc.)
  path: string;
  description?: string;
  schema?: unknown; // OpenAPI/GraphQL schema
}

/**
 * Service-to-service dependency
 */
export interface ServiceDependency {
  service_id: string;
  dependency_type: 'api' | 'library' | 'event' | 'database';
  version?: string;
}

/**
 * Service metadata (JSONB)
 */
export interface ServiceMetadata {
  port?: number;
  version?: string;
  protocol?: string;
  [key: string]: unknown;
}

/**
 * Repository registry for multi-repo support
 */
export interface Repository {
  id: number;
  repo_id: string;
  repo_name: string;
  repo_path: string;
  repo_type: RepositoryType;
  workspace_config: string | null; // Config file name
  workspace_patterns: string[] | null; // Glob patterns
  root_package_json: string | null;
  git_remote_url: string | null;
  metadata: RepositoryMetadata | null;
  indexed_at: Date;
  last_updated: Date | null;
}

/**
 * Repository types
 * - monorepo: Multi-package repository with workspace support
 * - microservice: Individual microservice repository
 * - monolithic: Traditional single-application repository
 * - library: Shared library repository (your own libraries)
 * - reference: External framework/library cloned for learning and reference
 * - documentation: Markdown documentation files (e.g., /docs/libraries/)
 */
export type RepositoryType = 'monorepo' | 'microservice' | 'monolithic' | 'library' | 'reference' | 'documentation';

/**
 * Repository metadata (JSONB)
 */
export interface RepositoryMetadata {
  // General metadata
  tool?: string; // 'turborepo', 'nx', 'lerna', 'pnpm', etc.
  branch?: string;
  commit?: string;

  // Reference repository metadata (repo_type = 'reference')
  upstream_url?: string; // Original repository URL (e.g., https://github.com/nestjs/nest)
  version?: string; // Version/tag when indexed (e.g., 'v10.3.0')
  last_indexed?: string; // ISO timestamp of last indexing
  exclude_from_default_search?: boolean; // Don't include in default searches

  // Documentation repository metadata (repo_type = 'documentation')
  indexed_for?: string; // Purpose: 'learning', 'reference', 'api-docs'
  documentation_type?: string; // 'markdown', 'jsdoc', 'api-reference'

  [key: string]: unknown;
}

/**
 * Workspace alias resolution (resolve @workspace/pkg → filesystem path)
 */
export interface WorkspaceAlias {
  id: number;
  repo_id: string;
  workspace_id: string;
  alias_type: AliasType;
  alias_pattern: string; // e.g., '@workspace/*', '@/*'
  resolved_path: string;
  metadata: AliasMetadata | null;
}

/**
 * Alias types
 */
export type AliasType = 'npm_workspace' | 'tsconfig_path' | 'custom';

/**
 * Alias metadata (JSONB)
 */
export interface AliasMetadata {
  source?: string; // 'package.json', 'tsconfig.json', etc.
  [key: string]: unknown;
}

/**
 * Cross-repository dependencies (microservice inter-dependencies)
 */
export interface CrossRepoDependency {
  id: number;
  source_repo_id: string;
  target_repo_id: string;
  dependency_type: CrossRepoDependencyType;
  source_service_id: string | null;
  target_service_id: string | null;
  api_contracts: APIContract[] | null; // JSONB
  metadata: CrossRepoDependencyMetadata | null;
  indexed_at: Date;
}

/**
 * Cross-repo dependency types
 */
export type CrossRepoDependencyType = 'service' | 'library' | 'api' | 'shared';

/**
 * API contract definition
 */
export interface APIContract {
  type: 'rest' | 'graphql' | 'grpc' | 'websocket';
  endpoints?: APIEndpoint[];
  schema_url?: string;
  [key: string]: unknown;
}

/**
 * Cross-repo dependency metadata (JSONB)
 */
export interface CrossRepoDependencyMetadata {
  version?: string;
  protocol?: string;
  [key: string]: unknown;
}

/**
 * Workspace dependencies (internal monorepo dependencies)
 */
export interface WorkspaceDependency {
  id: number;
  repo_id: string;
  source_workspace_id: string;
  target_workspace_id: string;
  dependency_type: WorkspaceDependencyType;
  version_specifier: string | null;
  metadata: WorkspaceDependencyMetadata | null;
  indexed_at: Date;
}

/**
 * Workspace dependency types
 */
export type WorkspaceDependencyType = 'runtime' | 'dev' | 'peer';

/**
 * Workspace dependency metadata (JSONB)
 */
export interface WorkspaceDependencyMetadata {
  required?: boolean;
  circular?: boolean;
  [key: string]: unknown;
}

/**
 * Database Query Result Types
 * These interfaces represent the shape of data returned by specific queries
 */

/**
 * Result from COUNT(*) queries
 */
export interface CountResult {
  count: string; // PostgreSQL returns count as string
}

/**
 * Result from repository queries with version info
 */
export interface RepositoryVersionQueryResult {
  repo_id: string;
  metadata: RepositoryMetadata;
  indexed_at: Date;
  file_count: string; // COUNT result as string
}

/**
 * Result from simple repository type queries
 */
export interface RepoTypeQueryResult {
  repo_type: RepositoryType;
}

/**
 * Result from repository queries with file count
 */
export interface RepositoryWithCountResult {
  repo_id: string;
  repo_type: RepositoryType;
  repo_path: string;
  metadata: RepositoryMetadata;
  indexed_at: Date;
  file_count: string; // COUNT result as string
}

/**
 * Result from simple repo_id queries
 */
export interface RepoIdQueryResult {
  repo_id: string;
}

/**
 * Result from similarity search queries (includes computed similarity column)
 */
export interface SimilarityResult {
  similarity: number;
}
