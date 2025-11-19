# Phase 1: Foundation & Infrastructure

**Estimated Duration:** 2-3 days **Priority:** Critical - All subsequent phases depend on this
foundation
**Status:** ✅ 100% Complete

---

## Overview

Establish the foundational infrastructure for the cindex RAG system. This phase delivers the
database schema, configuration system, and validates connectivity to all external services
(PostgreSQL, pgvector, Ollama).

---

## Checklist

### 1. Database Schema

- [x] Install PostgreSQL 16+ and pgvector extension (version 0.5.0+)
- [x] Create database `cindex_rag_codebase` and enable pgvector extension
- [x] Create `code_files` table: file_path (PK), file_hash (SHA256 CHAR64), file_summary,
      summary_embedding (vector 1024), imports[], exports[], language, line_count, timestamps
- [x] Create `code_chunks` table: chunk_id (PK UUID), file_path (FK CASCADE), chunk_content,
      embedding (vector 1024), chunk_type (file_summary|function|class|import_block|fallback),
      start_line, end_line, token_count, metadata (JSONB), created_at
- [x] Create `code_symbols` table: symbol_id (PK UUID), symbol_name, symbol_type
      (function|class|variable|interface|type), file_path (FK CASCADE), line_number, definition,
      embedding (vector 1024), scope (exported|internal), created_at
- [x] **[MONOREPO/MICROSERVICE]** Add workspace/service columns to core tables: ALTER TABLE
      code_chunks/code_files/code_symbols ADD COLUMN repo_id, workspace_id, package_name, service_id
      (all nullable for backward compatibility)
- [x] **[MONOREPO/MICROSERVICE]** Create `workspaces` table: workspace registry with package_name,
      workspace_path, dependencies, tsconfig_paths
- [x] **[MONOREPO/MICROSERVICE]** Create `services` table: service registry with service_name,
      service_type, api_endpoints, dependencies
- [x] **[MONOREPO/MICROSERVICE]** Create `repositories` table: multi-repo registry with repo_type,
      workspace_config, workspace_patterns
- [x] **[MONOREPO/MICROSERVICE]** Create `workspace_aliases` table: resolve @workspace/pkg to
      filesystem paths
- [x] **[MONOREPO/MICROSERVICE]** Create `cross_repo_dependencies` and `workspace_dependencies`
      tables for dependency tracking
- [x] **[REFERENCE REPOS]** Update repositories table comments to document repo_type values: 'monorepo', 'microservice', 'monolithic', 'library', 'reference', 'documentation'
- [x] **[REFERENCE REPOS]** Document metadata JSONB column usage: version (for reference repos), upstream_url (original repo URL), last_indexed (ISO timestamp), exclude_from_default_search, indexed_for, documentation_type
- [x] Create IVFFlat indexes on all vector columns (code_files.summary_embedding,
      code_chunks.embedding, code_symbols.embedding)
- [x] Create supporting indexes: B-tree on file_path/symbol_name, GIN on code_chunks.metadata, hash
      on file_hash
- [x] **[MONOREPO/MICROSERVICE]** Create workspace/service indexes: 18 new indexes on repo_id,
      workspace_id, service_id, package_name (6 indexes per core table)
- [x] Verify: `psql -d cindex_rag_codebase -c "\dt"` shows 9 tables (3 core + 6 new), `\di` shows
      all indexes, test vector insert/query with workspace_id

### 2. Configuration System

- [x] Create `src/config/env.ts` with environment variable parser and TypeScript types
- [x] Define all env vars with defaults: EMBEDDING*MODEL (mxbai-embed-large), EMBEDDING_DIMENSIONS
      (1024), SUMMARY_MODEL (qwen2.5-coder:1.5b), OLLAMA_HOST (http://localhost:11434), POSTGRES*\*
      (host/port/db/user), HNSW_EF_SEARCH (300), HNSW_EF_CONSTRUCTION (200), SIMILARITY_THRESHOLD
      (0.75), DEDUP_THRESHOLD (0.92)
- [x] **[MONOREPO/MICROSERVICE]** Add workspace/service env vars: WORKSPACE_DEPTH (2), SERVICE_DEPTH
      (1), IMPORT_DEPTH (3), ENABLE_WORKSPACE_DETECTION (true), ENABLE_SERVICE_DETECTION (true),
      ENABLE_MULTI_REPO (false), ENABLE_API_ENDPOINT_DETECTION (true)
- [x] Implement validation: require POSTGRES_PASSWORD, validate numeric ranges, throw clear errors
- [x] Test: valid values, defaults, missing required, invalid ranges

### 3. External Service Connectivity

- [x] Create `src/database/client.ts`: connection pool (min 2, max 10), timeouts (connection 5s,
      query 30s, idle 30s), health check (SELECT 1), auto-reconnect, pgvector validation
- [x] Create `src/utils/ollama.ts`: HTTP client, model availability checks (embedding + summary),
      retry logic (3 attempts, exponential backoff 1s/2s/4s), clear errors with `ollama pull`
      suggestions
- [x] Test connectivity: PostgreSQL pool + health check, Ollama API + models available
      (mxbai-embed-large, qwen2.5-coder:1.5b), dimension mismatch detection

### 4. Project Structure

- [x] Create directory structure: src/{index.ts, config/, database/{client.ts, schema.sql,
      migrations/}, types/, utils/}, tests/{unit/, integration/, fixtures/, helpers/}
- [x] **[MONOREPO/MICROSERVICE]** Create comprehensive type system: src/types/{database.ts,
      workspace.ts, service.ts, mcp-tools.ts, config.ts, index.ts}
- [x] Install dependencies: @modelcontextprotocol/sdk, pg, pgvector, ignore | dev: TypeScript,
      ESLint, Prettier, dotenv, esbuild
- [x] Configure build: tsconfig.json, ESLint, Prettier, npm scripts with esbuild
      (build/dev/test/type-check)
- [x] Verify `npm run build` succeeds and produces bundled dist/index.js

### 5. Logging & Error Handling

- [x] Create `src/utils/logger.ts`: log levels (debug/info/warn/error), timestamps, stderr output,
      structured logging
- [x] Define error types with clear messages: ConfigurationError, DatabaseConnectionError,
      OllamaConnectionError, ModelNotFoundError, VectorDimensionMismatchError
- [x] Implement `src/index.ts` startup validation: load config → connect PostgreSQL → connect Ollama
      → validate models → report readiness

### 6. Testing

- [x] Create test database `cindex_rag_codebase_test` with identical schema
- [x] Unit tests: config parser (valid/defaults/missing/invalid), database pool + health check,
      Ollama client + retry logic
- [x] Integration tests: PostgreSQL connection, pgvector validation, vector operations, Ollama
      connectivity, embedding generation, end-to-end startup
- [x] Test fixtures: mock config JSON, test schema script, cleanup script
- [x] Verify all tests pass

### 7. Documentation

- [x] Update README.md: prerequisites (PostgreSQL 16+, pgvector, Ollama), installation commands,
      model pulling (ollama pull mxbai-embed-large, ollama pull qwen2.5-coder:1.5b), database setup,
      configuration examples

---

## Success Criteria

Phase 1 is complete when:

- [x] All 3 database tables created with correct schema, indexes, and constraints
- [x] PostgreSQL connection pool connects with health checks working
- [x] Ollama API accessible with both required models available
- [x] Configuration system validates inputs and applies defaults correctly
- [x] Dimension mismatch detection working (EMBEDDING_DIMENSIONS vs model output)
- [x] TypeScript project builds without errors
- [x] All unit and integration tests passing
- [x] Startup validation reports all services ready

---

## Dependencies

**External services required:**

- [x] PostgreSQL 16+ installed and running
- [x] pgvector extension installed (version 0.5.0+)
- [x] Ollama installed and running
- [x] Models pulled: `ollama pull mxbai-embed-large` and `ollama pull qwen2.5-coder:1.5b`

---

## Output Artifacts

- `database.sql` - Complete database schema with monorepo/microservice tables
- `src/types/` - Comprehensive type system (database, workspace, service, mcp-tools, config)
- `src/config/env.ts` - Configuration parser with validation
- `src/database/client.ts` - PostgreSQL client with connection pooling
- `src/utils/ollama.ts` - Ollama API client with retry logic
- `src/utils/logger.ts` - Logging system with error types
- `src/index.ts` - Entry point with startup validation
- `tests/unit/` and `tests/integration/` - Test suites
- `package.json` - Updated with esbuild build system
- README.md - Setup and configuration documentation

---

## Next Phase

**Phase 2: Core Indexing Pipeline**

- File discovery with gitignore support and SHA256 hashing
- Tree-sitter parsing with regex fallback
- Semantic chunking (functions, classes, blocks)
- Metadata extraction (imports, exports, symbols)

**✅ Phase 1 must be 100% complete before starting Phase 2.**
