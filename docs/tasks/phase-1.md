# Phase 1: Foundation & Infrastructure

**Estimated Duration:** 2-3 days **Priority:** Critical - All subsequent phases depend on this
foundation

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
- [ ] Create `code_files` table: file_path (PK), file_hash (SHA256 CHAR64), file_summary,
      summary_embedding (vector 1024), imports[], exports[], language, line_count, timestamps
- [ ] Create `code_chunks` table: chunk_id (PK UUID), file_path (FK CASCADE), chunk_content,
      embedding (vector 1024), chunk_type (file_summary|function|class|import_block|fallback),
      start_line, end_line, token_count, metadata (JSONB), created_at
- [ ] Create `code_symbols` table: symbol_id (PK UUID), symbol_name, symbol_type
      (function|class|variable|interface|type), file_path (FK CASCADE), line_number, definition,
      embedding (vector 1024), scope (exported|internal), created_at
- [ ] Create IVFFlat indexes on all vector columns (code_files.summary_embedding,
      code_chunks.embedding, code_symbols.embedding)
- [ ] Create supporting indexes: B-tree on file_path/symbol_name, GIN on code_chunks.metadata, hash
      on file_hash
- [ ] Verify: `psql -d cindex_rag_codebase -c "\dt"` shows 3 tables, `\di` shows all indexes, test
      vector insert/query

### 2. Configuration System

- [ ] Create `src/config/env.ts` with environment variable parser and TypeScript types
- [ ] Define all env vars with defaults: EMBEDDING*MODEL (mxbai-embed-large), EMBEDDING_DIMENSIONS
      (1024), SUMMARY_MODEL (qwen2.5-coder:1.5b), OLLAMA_HOST (http://localhost:11434), POSTGRES*\*
      (host/port/db/user), HNSW_EF_SEARCH (300), HNSW_EF_CONSTRUCTION (200), SIMILARITY_THRESHOLD
      (0.75), DEDUP_THRESHOLD (0.92)
- [ ] Implement validation: require POSTGRES_PASSWORD, validate numeric ranges, throw clear errors
- [ ] Test: valid values, defaults, missing required, invalid ranges

### 3. External Service Connectivity

- [ ] Create `src/database/client.ts`: connection pool (min 2, max 10), timeouts (connection 5s,
      query 30s, idle 30s), health check (SELECT 1), auto-reconnect, pgvector validation
- [ ] Create `src/utils/ollama.ts`: HTTP client, model availability checks (embedding + summary),
      retry logic (3 attempts, exponential backoff 1s/2s/4s), clear errors with `ollama pull`
      suggestions
- [ ] Test connectivity: PostgreSQL pool + health check, Ollama API + models available
      (mxbai-embed-large, qwen2.5-coder:1.5b), dimension mismatch detection

### 4. Project Structure

- [ ] Create directory structure: src/{index.ts, config/, database/{client.ts, schema.sql,
      migrations/}, types/, utils/}, tests/{unit/, integration/, fixtures/, helpers/}
- [ ] Install dependencies: @modelcontextprotocol/sdk, pg, pgvector | dev: TypeScript, ESLint,
      Prettier, dotenv
- [ ] Configure build: tsconfig.json, ESLint, Prettier, npm scripts (build/dev/test)
- [ ] Verify `npm run build` succeeds

### 5. Logging & Error Handling

- [ ] Create `src/utils/logger.ts`: log levels (debug/info/warn/error), timestamps, stderr output,
      structured logging
- [ ] Define error types with clear messages: ConfigurationError, DatabaseConnectionError,
      OllamaConnectionError, ModelNotFoundError, VectorDimensionMismatchError
- [ ] Implement `src/index.ts` startup validation: load config → connect PostgreSQL → connect Ollama
      → validate models → report readiness

### 6. Testing

- [ ] Create test database `cindex_rag_codebase_test` with identical schema
- [ ] Unit tests: config parser (valid/defaults/missing/invalid), database pool + health check,
      Ollama client + retry logic
- [ ] Integration tests: PostgreSQL connection, pgvector validation, vector operations, Ollama
      connectivity, embedding generation, end-to-end startup
- [ ] Test fixtures: mock config JSON, test schema script, cleanup script
- [ ] Verify all tests pass

### 7. Documentation

- [ ] Update README.md: prerequisites (PostgreSQL 16+, pgvector, Ollama), installation commands,
      model pulling (ollama pull mxbai-embed-large, ollama pull qwen2.5-coder:1.5b), database setup,
      configuration examples

---

## Success Criteria

Phase 1 is complete when:

- [ ] All 3 database tables created with correct schema, indexes, and constraints
- [ ] PostgreSQL connection pool connects with health checks working
- [ ] Ollama API accessible with both required models available
- [ ] Configuration system validates inputs and applies defaults correctly
- [ ] Dimension mismatch detection working (EMBEDDING_DIMENSIONS vs model output)
- [ ] TypeScript project builds without errors
- [ ] All unit and integration tests passing
- [ ] Startup validation reports all services ready

---

## Dependencies

**External services required:**

- [ ] PostgreSQL 16+ installed and running
- [ ] pgvector extension installed (version 0.5.0+)
- [ ] Ollama installed and running
- [ ] Models pulled: `ollama pull mxbai-embed-large` and `ollama pull qwen2.5-coder:1.5b`

---

## Output Artifacts

- `src/database/schema.sql` - Complete database schema
- `src/config/env.ts` - Configuration parser with validation
- `src/database/client.ts` - PostgreSQL client with connection pooling
- `src/utils/ollama.ts` - Ollama API client with retry logic
- `src/utils/logger.ts` - Logging system with error types
- `src/index.ts` - Entry point with startup validation
- `tests/unit/` and `tests/integration/` - Test suites
- README.md - Setup and configuration documentation

---

## Next Phase

**Phase 2: Core Indexing Pipeline**

- File discovery with gitignore support and SHA256 hashing
- Tree-sitter parsing with regex fallback
- Semantic chunking (functions, classes, blocks)
- Metadata extraction (imports, exports, symbols)

**✅ Phase 1 must be 100% complete before starting Phase 2.**
