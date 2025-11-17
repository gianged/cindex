# Phase 1: Foundation & Infrastructure

**Estimated Duration:** 2-3 days **Priority:** Critical - All subsequent phases depend on this
foundation

---

## Overview

Establish the foundational infrastructure for the cindex RAG system. This phase delivers the
database schema, configuration system, and validates connectivity to all external services
(PostgreSQL, pgvector, Ollama). No code indexing or retrieval logic yet—pure infrastructure setup.

---

## Checklist

### 1. Database Schema (PostgreSQL + pgvector)

#### Setup

- [ ] Install PostgreSQL 16+
- [ ] Install pgvector extension (version 0.5.0+)
- [ ] Create database: `cindex_rag_codebase`
- [ ] Enable pgvector extension in database

#### Table: `code_files` (File-level metadata)

- [ ] Create table with columns:
  - [ ] `file_path` TEXT PRIMARY KEY
  - [ ] `file_hash` CHAR(64) NOT NULL (SHA256)
  - [ ] `file_summary` TEXT
  - [ ] `summary_embedding` VECTOR(1024)
  - [ ] `imports` TEXT[]
  - [ ] `exports` TEXT[]
  - [ ] `language` VARCHAR(50)
  - [ ] `line_count` INTEGER
  - [ ] `created_at` TIMESTAMP DEFAULT NOW()
  - [ ] `updated_at` TIMESTAMP DEFAULT NOW()

#### Table: `code_chunks` (Core embeddings table)

- [ ] Create table with columns:
  - [ ] `chunk_id` UUID PRIMARY KEY
  - [ ] `file_path` TEXT REFERENCES code_files(file_path) ON DELETE CASCADE
  - [ ] `chunk_content` TEXT NOT NULL
  - [ ] `embedding` VECTOR(1024) NOT NULL
  - [ ] `chunk_type` VARCHAR(50) NOT NULL (file_summary, function, class, import_block, fallback)
  - [ ] `start_line` INTEGER
  - [ ] `end_line` INTEGER
  - [ ] `token_count` INTEGER
  - [ ] `metadata` JSONB
  - [ ] `created_at` TIMESTAMP DEFAULT NOW()

#### Table: `code_symbols` (Symbol registry)

- [ ] Create table with columns:
  - [ ] `symbol_id` UUID PRIMARY KEY
  - [ ] `symbol_name` VARCHAR(255) NOT NULL
  - [ ] `symbol_type` VARCHAR(50) NOT NULL (function, class, variable, interface, type)
  - [ ] `file_path` TEXT REFERENCES code_files(file_path) ON DELETE CASCADE
  - [ ] `line_number` INTEGER
  - [ ] `definition` TEXT
  - [ ] `embedding` VECTOR(1024)
  - [ ] `scope` VARCHAR(20) (exported, internal)
  - [ ] `created_at` TIMESTAMP DEFAULT NOW()

#### Indexes

- [ ] Create IVFFlat index on `code_files.summary_embedding`
- [ ] Create IVFFlat index on `code_chunks.embedding`
- [ ] Create IVFFlat index on `code_symbols.embedding`
- [ ] Create B-tree index on `code_files.file_path`
- [ ] Create B-tree index on `code_chunks.file_path`
- [ ] Create B-tree index on `code_symbols.symbol_name`
- [ ] Create GIN index on `code_chunks.metadata`
- [ ] Create hash index on `code_files.file_hash`

#### Validation

- [ ] Verify all 3 tables exist: `psql -d cindex_rag_codebase -c "\dt"`
- [ ] Verify all indexes exist: `psql -d cindex_rag_codebase -c "\di"`
- [ ] Test vector column insert/query

### 2. Configuration System

#### Environment Variables

- [ ] Define `EMBEDDING_MODEL` (default: mxbai-embed-large)
- [ ] Define `EMBEDDING_DIMENSIONS` (default: 1024)
- [ ] Define `SUMMARY_MODEL` (default: qwen2.5-coder:1.5b)
- [ ] Define `OLLAMA_HOST` (default: http://localhost:11434)
- [ ] Define `POSTGRES_HOST` (default: localhost)
- [ ] Define `POSTGRES_PORT` (default: 5432)
- [ ] Define `POSTGRES_DB` (default: cindex_rag_codebase)
- [ ] Define `POSTGRES_USER` (default: postgres)
- [ ] Define `POSTGRES_PASSWORD` (required, no default)
- [ ] Define `HNSW_EF_SEARCH` (default: 300)
- [ ] Define `HNSW_EF_CONSTRUCTION` (default: 200)
- [ ] Define `SIMILARITY_THRESHOLD` (default: 0.75)
- [ ] Define `DEDUP_THRESHOLD` (default: 0.92)

#### Parser Implementation

- [ ] Create `src/config/env.ts`
- [ ] Implement environment variable parser
- [ ] Add default values for optional variables
- [ ] Add validation logic for all variables
- [ ] Create TypeScript type definitions for config
- [ ] Throw clear error when `POSTGRES_PASSWORD` missing
- [ ] Validate numeric values in acceptable ranges

#### Validation

- [ ] Test with all defaults (except password)
- [ ] Test with custom values
- [ ] Test error when required variable missing
- [ ] Test error on invalid numeric ranges

### 3. External Service Connectivity

#### PostgreSQL

- [ ] Create connection pool configuration
  - [ ] Set min connections: 2
  - [ ] Set max connections: 10
  - [ ] Set connection timeout: 5000ms
  - [ ] Set query timeout: 30000ms
  - [ ] Set idle timeout: 30000ms
- [ ] Implement health check query (SELECT 1)
- [ ] Add automatic reconnection on failure
- [ ] Validate pgvector extension loaded
- [ ] Create `src/database/client.ts`

#### Ollama

- [ ] Create HTTP client with configurable host/port
- [ ] Implement model availability check for embedding model
- [ ] Implement model availability check for summary model
- [ ] Add retry logic (3 retries, exponential backoff)
- [ ] Provide clear error when model not found
- [ ] Suggest `ollama pull` command in error
- [ ] Create `src/utils/ollama.ts`

#### Validation

- [ ] PostgreSQL connection pool connects successfully
- [ ] Health check query executes
- [ ] Ollama API responds
- [ ] Embedding model available: `mxbai-embed-large`
- [ ] Summary model available: `qwen2.5-coder:1.5b`
- [ ] Dimension mismatch detected and reported

### 4. Project Structure & Dependencies

#### Directory Structure

- [ ] Create `src/` directory
- [ ] Create `src/index.ts` (MCP server entry point)
- [ ] Create `src/config/` directory
- [ ] Create `src/database/` directory
- [ ] Create `src/database/migrations/` directory
- [ ] Create `src/types/` directory
- [ ] Create `src/utils/` directory
- [ ] Create `tests/` directory
- [ ] Create `tests/unit/` directory
- [ ] Create `tests/integration/` directory
- [ ] Create `tests/fixtures/` directory
- [ ] Create `tests/helpers/` directory

#### Dependencies

- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Install `pg`
- [ ] Install `pgvector`
- [ ] Install TypeScript (dev)
- [ ] Install ESLint (dev)
- [ ] Install Prettier (dev)
- [ ] Install `dotenv` (dev)

#### Build System

- [ ] Configure `tsconfig.json`
- [ ] Configure ESLint
- [ ] Configure Prettier
- [ ] Add build script to `package.json`
- [ ] Add dev script to `package.json`
- [ ] Add test script to `package.json`
- [ ] Verify `npm run build` succeeds

### 5. Logging & Error Handling

#### Logger

- [ ] Create `src/utils/logger.ts`
- [ ] Implement log levels: debug, info, warn, error
- [ ] Add timestamp formatting
- [ ] Configure output to stderr
- [ ] Add structured logging support

#### Error Types

- [ ] Define `ConfigurationError`
- [ ] Define `DatabaseConnectionError`
- [ ] Define `OllamaConnectionError`
- [ ] Define `ModelNotFoundError`
- [ ] Define `VectorDimensionMismatchError`
- [ ] Add clear error messages for each type

#### Startup Validation

- [ ] Create startup validation in `src/index.ts`
- [ ] Validate configuration loaded
- [ ] Validate PostgreSQL connection
- [ ] Validate Ollama connection
- [ ] Validate models available
- [ ] Report readiness status
- [ ] Log all validation steps

### 6. Testing

#### Unit Tests

- [ ] Create test for config parser (valid values)
- [ ] Create test for config parser (defaults)
- [ ] Create test for config parser (missing required)
- [ ] Create test for config parser (invalid ranges)
- [ ] Create test for database pool initialization
- [ ] Create test for database health check
- [ ] Create test for Ollama model check
- [ ] Create test for Ollama retry logic

#### Integration Tests

- [ ] Create test database: `cindex_rag_codebase_test`
- [ ] Create test for PostgreSQL connection
- [ ] Create test for pgvector extension validation
- [ ] Create test for vector column operations
- [ ] Create test for Ollama connectivity
- [ ] Create test for embedding generation
- [ ] Create test for end-to-end startup

#### Test Fixtures

- [ ] Create mock configuration JSON
- [ ] Create test database schema script
- [ ] Create database cleanup script

### 7. Documentation

- [ ] Document prerequisites in README.md
- [ ] Document PostgreSQL installation
- [ ] Document pgvector installation
- [ ] Document Ollama installation
- [ ] Document model pulling: `ollama pull mxbai-embed-large`
- [ ] Document model pulling: `ollama pull qwen2.5-coder:1.5b`
- [ ] Document database setup commands
- [ ] Document configuration examples
- [ ] Document validation commands

---

## Success Criteria

**Phase 1 is complete when ALL items below are checked:**

- [ ] Database schema created successfully via SQL script
- [ ] All three tables exist with correct columns and types
- [ ] pgvector extension enabled and vector columns operational
- [ ] IVFFlat indexes created on all vector columns
- [ ] Configuration system parses all environment variables
- [ ] Default values applied when optional variables missing
- [ ] Clear error when `POSTGRES_PASSWORD` not provided
- [ ] PostgreSQL connection pool connects successfully
- [ ] Health check query executes (SELECT 1)
- [ ] Ollama API responds to health check
- [ ] Both embedding and summary models available in Ollama
- [ ] Dimension mismatch detected (if EMBEDDING_DIMENSIONS ≠ actual model output)
- [ ] TypeScript project builds without errors
- [ ] All core dependencies installed
- [ ] Logger outputs structured messages
- [ ] Startup validation runs and reports status
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

**External services required:**

- [ ] PostgreSQL 16+ installed and running
- [ ] pgvector extension installed (version 0.5.0+)
- [ ] Ollama installed and running
- [ ] Embedding model pulled: `ollama pull mxbai-embed-large`
- [ ] Summary model pulled: `ollama pull qwen2.5-coder:1.5b`

**No dependencies on other phases** - This is the foundation.

---

## Output Artifacts

**At completion, you should have:**

- [ ] `src/database/schema.sql` - Database schema
- [ ] `src/config/env.ts` - Configuration parser
- [ ] `src/database/client.ts` - Database client with pooling
- [ ] `src/utils/ollama.ts` - Ollama API client
- [ ] `src/utils/logger.ts` - Logging system
- [ ] `src/index.ts` - Entry point with validation
- [ ] `tests/unit/` - Unit tests
- [ ] `tests/integration/` - Integration tests
- [ ] README.md updated with setup instructions

---

## Risk Mitigation

- [ ] Handle pgvector not installed (provide install commands)
- [ ] Handle Ollama models not pulled (provide pull commands)
- [ ] Handle PostgreSQL version too old (require 16+)
- [ ] Handle vector dimension mismatch (clear error message)
- [ ] Handle port conflicts (suggest alternatives)

---

## Next Phase

**Phase 2 builds on this foundation:**

- File discovery walks directory tree
- SHA256 hashing uses database connection
- Tree-sitter parsing extracts chunks
- Chunks inserted into code_chunks table
- Configuration determines which files to index

**✅ Phase 1 must be 100% complete before starting Phase 2.**
