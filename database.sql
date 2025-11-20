-- cindex - RAG MCP for Code Context - Database Schema
-- PostgreSQL 16+ with pgvector extension required
--
-- CRITICAL: Vector dimensions (1024) must match EMBEDDING_MODEL in MCP config
-- mxbai-embed-large: 1024, nomic-embed-text: 768
-- Update all vector(1024) declarations if changing models

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Core Tables

CREATE TABLE code_chunks (
    id BIGSERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    chunk_content TEXT NOT NULL,
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    language TEXT NOT NULL,
    embedding vector(1024), -- Must match EMBEDDING_DIMENSIONS
    token_count INT,
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE code_files (
    id SERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_summary TEXT,
    summary_embedding vector(1024), -- Must match EMBEDDING_DIMENSIONS
    language TEXT NOT NULL,
    total_lines INT,
    imports JSONB,
    exports TEXT[],
    file_hash TEXT NOT NULL,
    last_modified TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE code_symbols (
    id SERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_number INT NOT NULL,
    definition TEXT,
    embedding vector(1024) -- Must match EMBEDDING_DIMENSIONS
);

-- Indexes
CREATE INDEX idx_chunks_file ON code_chunks(file_path);
CREATE INDEX idx_chunks_type ON code_chunks(chunk_type);
CREATE INDEX idx_files_hash ON code_files(file_hash);
CREATE INDEX idx_symbols_name ON code_symbols(symbol_name);

-- Vector indexes: HNSW for production (20-30min build for 1M+ vectors), IVFFlat for testing
CREATE INDEX idx_chunks_vector ON code_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_files_vector ON code_files USING hnsw (summary_embedding vector_cosine_ops);
CREATE INDEX idx_symbols_vector ON code_symbols USING hnsw (embedding vector_cosine_ops);

-- IVFFlat alternative (faster build, slower queries):
-- CREATE INDEX idx_chunks_vector ON code_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- HNSW performance tuning (override via MCP env: HNSW_EF_SEARCH, HNSW_EF_CONSTRUCTION)
SET hnsw.ef_search = 300; -- Higher = better accuracy, slower queries (200-400 for accuracy mode)

-- Table and column comments (complex fields only)
COMMENT ON COLUMN code_chunks.chunk_type IS 'file_summary, function, class, import_block, fallback';
COMMENT ON COLUMN code_chunks.metadata IS 'JSONB: {function_name, class_name, complexity, dependencies, is_exported, parent_class}';
COMMENT ON COLUMN code_chunks.embedding IS 'Enhanced text format: "FILE: path | TYPE: type | LANG: lang | CODE: content | SYMBOLS: list"';

COMMENT ON COLUMN code_files.imports IS 'JSONB format: { "imports": [{ "path": "express", "line": 1, "symbols": ["default"], "type": "external" }] }. Types: "external", "workspace", "relative", "absolute"';
COMMENT ON COLUMN code_files.exports IS 'Array format: ["exportedFunction", "MyClass", "API_KEY"]';

-- Multi-Project Support (nullable columns for backward compatibility)
-- Add repo/workspace/service context columns
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS repo_id TEXT;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS package_name TEXT;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS service_id TEXT;

ALTER TABLE code_files ADD COLUMN IF NOT EXISTS repo_id TEXT;
ALTER TABLE code_files ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE code_files ADD COLUMN IF NOT EXISTS package_name TEXT;
ALTER TABLE code_files ADD COLUMN IF NOT EXISTS service_id TEXT;

ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS repo_id TEXT;
ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS package_name TEXT;
ALTER TABLE code_symbols ADD COLUMN IF NOT EXISTS service_id TEXT;

CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    repo_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL UNIQUE,
    package_name TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    package_json_path TEXT,
    version TEXT,
    dependencies JSONB,
    dev_dependencies JSONB,
    tsconfig_paths JSONB, -- TypeScript path aliases from tsconfig.json
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    service_id TEXT NOT NULL UNIQUE,
    service_name TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    service_path TEXT,
    service_type TEXT, -- rest, graphql, grpc, library, other
    api_endpoints JSONB,
    dependencies JSONB,
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    repo_id TEXT NOT NULL UNIQUE,
    repo_name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    repo_type TEXT, -- monorepo, microservice, monolithic, library, reference, documentation
    workspace_config TEXT, -- pnpm-workspace.yaml, package.json, nx.json, lerna.json
    workspace_patterns TEXT[], -- e.g., ['packages/*', 'apps/*']
    root_package_json TEXT,
    git_remote_url TEXT,
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW(),
    last_updated TIMESTAMP
);

-- Comment on repo_type column
COMMENT ON COLUMN repositories.repo_type IS
  'Repository types:
  - monorepo: Multi-package repository with workspace support (pnpm, nx, lerna, turborepo)
  - microservice: Individual microservice repository with API contracts
  - monolithic: Traditional single-application repository
  - library: Shared library repository (your own libraries)
  - reference: External framework/library cloned for learning (e.g., NestJS, React)
  - documentation: Markdown documentation files (e.g., /docs/libraries/)';

-- Comment on metadata column
COMMENT ON COLUMN repositories.metadata IS
  'JSONB metadata:
  General: { tool, branch, commit }
  Reference repos: { upstream_url, version, last_indexed, exclude_from_default_search }
  Documentation: { indexed_for, documentation_type }';

CREATE TABLE IF NOT EXISTS workspace_aliases (
    id SERIAL PRIMARY KEY,
    repo_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    alias_type TEXT NOT NULL, -- npm_workspace, tsconfig_path, custom
    alias_pattern TEXT NOT NULL, -- e.g., '@workspace/*', '@/*'
    resolved_path TEXT NOT NULL,
    metadata JSONB,
    UNIQUE(repo_id, alias_pattern, resolved_path)
);

CREATE TABLE IF NOT EXISTS cross_repo_dependencies (
    id SERIAL PRIMARY KEY,
    source_repo_id TEXT NOT NULL,
    target_repo_id TEXT NOT NULL,
    dependency_type TEXT NOT NULL, -- service, library, api, shared
    source_service_id TEXT,
    target_service_id TEXT,
    api_contracts JSONB, -- REST endpoints, GraphQL schemas, gRPC protos
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_repo_id, target_repo_id, dependency_type)
);

CREATE TABLE IF NOT EXISTS workspace_dependencies (
    id SERIAL PRIMARY KEY,
    repo_id TEXT NOT NULL,
    source_workspace_id TEXT NOT NULL,
    target_workspace_id TEXT NOT NULL,
    dependency_type TEXT NOT NULL, -- runtime, dev, peer
    version_specifier TEXT, -- e.g., '^1.0.0', 'workspace:*'
    metadata JSONB,
    indexed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(repo_id, source_workspace_id, target_workspace_id, dependency_type)
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo ON code_chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_workspace ON code_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chunks_service ON code_chunks(service_id);
CREATE INDEX IF NOT EXISTS idx_chunks_package ON code_chunks(package_name);

CREATE INDEX IF NOT EXISTS idx_files_repo ON code_files(repo_id);
CREATE INDEX IF NOT EXISTS idx_files_workspace ON code_files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_service ON code_files(service_id);
CREATE INDEX IF NOT EXISTS idx_files_package ON code_files(package_name);

CREATE INDEX IF NOT EXISTS idx_symbols_repo ON code_symbols(repo_id);
CREATE INDEX IF NOT EXISTS idx_symbols_workspace ON code_symbols(workspace_id);
CREATE INDEX IF NOT EXISTS idx_symbols_service ON code_symbols(service_id);
CREATE INDEX IF NOT EXISTS idx_symbols_package ON code_symbols(package_name);

CREATE INDEX IF NOT EXISTS idx_workspaces_repo ON workspaces(repo_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_package ON workspaces(package_name);

CREATE INDEX IF NOT EXISTS idx_services_repo ON services(repo_id);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);

CREATE INDEX IF NOT EXISTS idx_aliases_repo ON workspace_aliases(repo_id);
CREATE INDEX IF NOT EXISTS idx_aliases_workspace ON workspace_aliases(workspace_id);
CREATE INDEX IF NOT EXISTS idx_aliases_pattern ON workspace_aliases(alias_pattern);

CREATE INDEX IF NOT EXISTS idx_cross_deps_source ON cross_repo_dependencies(source_repo_id);
CREATE INDEX IF NOT EXISTS idx_cross_deps_target ON cross_repo_dependencies(target_repo_id);

CREATE INDEX IF NOT EXISTS idx_workspace_deps_source ON workspace_dependencies(source_workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_deps_target ON workspace_dependencies(target_workspace_id);

-- Multi-project comments (complex fields only)
COMMENT ON COLUMN workspaces.tsconfig_paths IS 'JSONB: {"@/*": ["src/*"], "~/*": ["./*"]}';
COMMENT ON COLUMN services.api_endpoints IS 'JSONB: [{type: "rest", path: "/api/auth", method: "POST", summary: "..."}]';
COMMENT ON COLUMN services.dependencies IS 'JSONB: {"auth-service": "HTTP", "user-db": "PostgreSQL"}';
COMMENT ON COLUMN repositories.workspace_patterns IS 'Array: ["packages/*", "apps/*"]';
COMMENT ON COLUMN cross_repo_dependencies.api_contracts IS 'JSONB: {endpoints: [{path: "/api/auth", method: "POST"}], schemas: {...}}';

-- API Contract Support (OpenAPI, GraphQL, gRPC)
ALTER TABLE services ADD COLUMN IF NOT EXISTS api_embedding vector(1024);
CREATE INDEX IF NOT EXISTS idx_services_api_vector ON services USING hnsw (api_embedding vector_cosine_ops);

-- Endpoint path format: REST="/api/auth", GraphQL="Query.getUser", gRPC="Service.Method"
CREATE TABLE IF NOT EXISTS api_endpoints (
    id BIGSERIAL PRIMARY KEY,
    service_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    api_type TEXT NOT NULL, -- rest, graphql_query, graphql_mutation, graphql_subscription, grpc
    endpoint_path TEXT NOT NULL,
    http_method TEXT, -- REST only: GET, POST, PUT, DELETE, PATCH
    operation_id TEXT,
    summary TEXT,
    description TEXT,
    tags TEXT[],
    request_schema JSONB,
    response_schema JSONB,
    implementation_file TEXT,
    implementation_lines TEXT, -- e.g., "45-67"
    implementation_chunk_id BIGINT,
    implementation_function TEXT,
    embedding vector(1024), -- Must match EMBEDDING_DIMENSIONS
    deprecated BOOLEAN DEFAULT FALSE,
    indexed_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_api_service FOREIGN KEY (service_id) REFERENCES services(service_id) ON DELETE CASCADE,
    CONSTRAINT fk_api_chunk FOREIGN KEY (implementation_chunk_id) REFERENCES code_chunks(id) ON DELETE SET NULL,
    CONSTRAINT chk_api_type CHECK (api_type IN ('rest', 'graphql_query', 'graphql_mutation', 'graphql_subscription', 'grpc')),
    CONSTRAINT chk_http_method CHECK (http_method IS NULL OR http_method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD')),
    CONSTRAINT chk_rest_has_method CHECK (api_type != 'rest' OR http_method IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_service ON api_endpoints(service_id);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_repo ON api_endpoints(repo_id);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_type ON api_endpoints(api_type);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_path ON api_endpoints(endpoint_path);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_method ON api_endpoints(http_method) WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_endpoints_vector ON api_endpoints USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_tags ON api_endpoints USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_service_type ON api_endpoints(service_id, api_type);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_repo_type ON api_endpoints(repo_id, api_type);

-- Usage Examples

-- Vector similarity search
-- SELECT * FROM code_chunks WHERE 1 - (embedding <=> query_embedding) > 0.75 LIMIT 20;

-- API endpoint search
-- SELECT endpoint_path, http_method, summary FROM api_endpoints
-- WHERE api_type = 'rest' AND 1 - (embedding <=> query_embedding) > 0.75 LIMIT 10;

-- Multi-repo search with filtering
-- SELECT r.repo_name, c.file_path FROM code_chunks c JOIN repositories r ON c.repo_id = r.repo_id
-- WHERE r.repo_id IN ('auth-service', 'user-service') AND 1 - (c.embedding <=> query_embedding) > 0.75;

-- Migration Notes
-- All ALTER TABLE use IF NOT EXISTS (backward compatible, nullable columns)
-- Re-index repos to populate workspace data
