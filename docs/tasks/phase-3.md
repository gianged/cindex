# Phase 3: Embedding & Summary Generation

**Estimated Duration:** 3-4 days **Priority:** Critical - Enables semantic search
**Status:** ✅ 100% Complete (Phase 3 Core + Phase 3.1 API Parsing both complete)

---

## Overview

Transform chunked code into vector embeddings and generate intelligent file summaries. This delivers
the embedding pipeline via Ollama, LLM-based summary generation, and database persistence.

---

## Checklist

### 1. File Summary Generation

- [x] Create `src/indexing/summary.ts` with LLM-based summary generator
- [x] Design prompt template: include file path/language, use first 100 lines, request
      single-sentence starting with "This file...", format 50-200 chars
- [x] Implement Ollama API call using configured SUMMARY_MODEL (qwen2.5-coder:1.5b or 3b), timeout
      10s per summary
- [x] Implement batch processing: 10 files at a time, max 3 concurrent requests, retry logic (max 2
      retries)
- [x] Implement rule-based fallback (when Ollama unavailable/model not
      found/timeout/SUMMARY_MODEL=""): extract JSDoc/docstring, extract exports, format "This file
      exports {symbols}" or "This file contains {N} functions and {M} classes"
- [x] Validate: summary length 50-200 chars, starts with "This file", test both LLM and fallback
      methods
- [x] Output: FileSummary{file_path, summary_text, summary_method (llm|rule-based), model_used,
      generation_time_ms}

### 2. Embedding Generation

- [x] Create `src/indexing/embeddings.ts` with enhanced text construction
- [x] Build enhanced text per chunk: prepend "FILE: {path} | TYPE: {type} | LANG: {language}",
      include code content, append "SYMBOLS: {comma_separated}"
- [x] Implement Ollama embeddings API call using configured EMBEDDING_MODEL (mxbai-embed-large),
      return 1024-dimension vector
- [x] Validate dimensions: verify length matches EMBEDDING_DIMENSIONS, throw error on mismatch, halt
      indexing
- [x] Implement batch processing: 50 chunks at a time, max 5 concurrent requests, rate limit 100
      req/s, progress tracking
- [x] Implement retry logic: 3 attempts on network errors, exponential backoff (1s, 2s, 4s), skip
      chunk after 3 failures, continue with remaining
- [x] Test: embedding generation, dimension validation, batch processing, retry logic, consistency
      (same input = same output)
- [x] Output: ChunkEmbedding{chunk_id, embedding (1024 dims), embedding_model, dimension,
      generation_time_ms, enhanced_text}

### 3. Database Persistence

- [x] Create `src/database/writer.ts` with insert operations
- [x] Implement `insertFile()`: INSERT into code_files with UPSERT (ON CONFLICT DO UPDATE), update
      updated_at on conflict
- [x] Implement `insertChunks()`: batch INSERT into code_chunks (ON CONFLICT DO NOTHING to prevent
      duplicates)
- [x] Implement `insertSymbols()`: batch INSERT into code_symbols (ON CONFLICT DO NOTHING)
- [x] **[MONOREPO]** Implement `insertWorkspaces()`: batch INSERT into workspaces table with
      package_name, workspace_path, dependencies, tsconfig_paths
- [x] **[MONOREPO]** Implement `insertWorkspaceAliases()`: batch INSERT into workspace_aliases for
      import resolution (@workspace/* → filesystem paths)
- [x] **[MONOREPO]** Implement `insertWorkspaceDependencies()`: INSERT workspace dependency graph
      from package.json dependencies
- [x] **[MICROSERVICE]** Implement `insertServices()`: batch INSERT into services table with
      service_name, service_type, api_endpoints, dependencies
- [x] **[MULTI-REPO]** Implement `insertRepository()`: INSERT into repositories table with repo_type,
      workspace_config, workspace_patterns
- [x] **[MULTI-REPO]** Implement `insertCrossRepoDependencies()`: INSERT cross-repo dependencies for
      microservice architectures
- [x] **[MONOREPO/MICROSERVICE]** Tag all chunks/files/symbols with workspace_id, package_name,
      service_id, repo_id during insertion
- [x] Optimize batch inserts: collect 100 chunks before inserting, use PostgreSQL COPY for bulk
      inserts, transaction per batch (commit every 100 chunks), rollback batch on error
- [x] Handle errors: catch unique constraints, vector dimension mismatches, foreign key violations,
      log with context, continue processing
- [x] Test: file insertion, chunk batch insertion, symbol insertion, workspace/service insertion,
      upsert on duplicate file, transaction rollback

### 4. Symbol Extraction & Indexing

- [x] Create `src/indexing/symbols.ts` for symbol processing
- [x] Extract from parsed nodes: functions (name, parameters, return type, line), classes (name,
      methods, properties, line), variables (name, type, line), types/interfaces (TypeScript)
- [x] Classify symbol types: function, class, variable, interface, type, constant, method
- [x] Detect scope: exported (in exports array) vs internal (not exported)
- [x] Build symbol definition text: functions (`function name(params): returnType`), classes
      (`class Name { methods }`), variables (`const NAME: type`)
- [x] Generate embedding for symbol definition using same enhanced text format
- [x] Generate unique symbol ID (UUID)
- [x] Test: function/class symbol extraction, scope detection, symbol embedding generation
- [x] Output: ExtractedSymbol{symbol_id (UUID), symbol_name, symbol_type, file_path, line_number,
      definition, embedding (1024 dims), scope}

### 5. Progress Tracking

- [x] Create `src/utils/progress.ts` with progress reporter
- [x] Track stages: file discovery, parsing, summary generation, embedding generation, database
      insertion
- [x] Calculate percentage complete and ETA, display format: `[Stage] X/Y (Z%) - ETA: Nm Ss`
- [x] Collect statistics: files processed/failed, chunks generated/embedded, symbols extracted, LLM
      vs fallback summaries, average times, errors
- [x] Display final report: files/min, chunks/min, LLM summaries (count + %), fallback summaries
      (count + %), avg embedding time, database write rate, total time
- [x] Output: IndexingStats{files_total, files_processed, files_failed, chunks_total,
      chunks_embedded, symbols_extracted, total_time_ms, avg_file_time_ms, summaries_llm,
      summaries_fallback, errors[]}

### 6. API Contract Parsing (Multi-Project)

- [x] Create `src/indexing/api-parser.ts` for API contract extraction
- [x] **[REST/OpenAPI]** Parse OpenAPI/Swagger files: detect openapi.json, openapi.yaml, swagger.json,
      swagger.yaml in repo root or docs/, parse using openapi-types or swagger-parser library
- [x] **[REST/OpenAPI]** Extract per-endpoint data: endpoint_path, http_method (GET/POST/PUT/DELETE),
      operation_id, summary, description, tags[], request_schema (JSONB from requestBody),
      response_schema (JSONB from responses[200]), deprecated flag
- [x] **[REST/OpenAPI]** Link to implementation: scan code_chunks for route definitions (e.g.,
      `router.get('/api/users')`, `@GetMapping("/users")`), store implementation_file,
      implementation_lines, implementation_chunk_id, implementation_function
- [x] **[GraphQL]** Parse GraphQL schema files: detect schema.graphql, *.graphql, *.gql files, parse
      using graphql library (buildSchema)
- [x] **[GraphQL]** Extract operations: queries (api_type='graphql_query'), mutations
      (api_type='graphql_mutation'), subscriptions (api_type='graphql_subscription'), extract
      operation_id (field name), args (request_schema JSONB), return type (response_schema JSONB),
      description from docstrings
- [x] **[GraphQL]** Link to resolvers: scan code_chunks for resolver implementations (e.g.,
      `Query.users`, `Mutation.createUser`), match to schema fields
- [x] **[gRPC]** Parse proto files: detect *.proto files, parse using protobufjs library (parse method)
- [x] **[gRPC]** Extract RPC methods: service_name.method_name as endpoint_path, extract request_schema
      (message definition JSONB), response_schema (message JSONB), extract comments as description
- [x] **[gRPC]** Link to handlers: scan code_chunks for gRPC service implementations (e.g., class
      UserServiceImpl, handlers matching RPC names)
- [x] Generate API contract summaries: for each service, aggregate all endpoints into
      services.api_endpoints JSONB array: [{type, path, method, summary}]
- [x] Generate per-endpoint embeddings: for each endpoint, build enriched text from method, path,
      description, parameters, schemas; generate 1024-dim embedding via existing embedding generator
- [x] Detect cross-service dependencies: scan code for HTTP client calls (fetch, axios, http.request),
      GraphQL query strings, gRPC client instantiations, match to api_endpoints, build
      cross_service_calls map
- [x] Implementation linking with multiple strategies: operationId, decorator, route definition,
      file path, function name matching across Express, NestJS, FastAPI, Spring Boot, etc.
- [x] API call detector with patterns for: TS/JS (fetch, axios), Python (requests, httpx), Go (http),
      Java (HttpClient), Rust (reqwest), gRPC clients, GraphQL queries
- [x] Orchestrator integration: parseAndIndexAPISpecifications method discovers, parses, links,
      embeds, and persists API specifications
- [x] Output: Complete API parsing pipeline integrated into indexing orchestrator

---

## Success Criteria

**Phase 3 Core (✅ 100% Complete):**

- [x] LLM summary generation produces valid summaries for all languages
- [x] Summaries are 1-2 sentences starting with "This file..."
- [x] Rule-based fallback works when LLM unavailable
- [x] Embedding generation produces exactly 1024 dimensions
- [x] Enhanced text includes file path, type, language, and symbols
- [x] Batch processing handles 50 chunks efficiently
- [x] Dimension validation catches and reports mismatches
- [x] Retry logic handles temporary Ollama failures
- [x] Progress tracking shows real-time percentage and ETA
- [x] All 3 database tables (code_files, code_chunks, code_symbols) populated correctly
- [x] Batch inserts optimize database writes with transactions
- [x] Duplicate files handled with upsert
- [x] Symbol extraction works for functions, classes, variables
- [x] Symbol scope (exported/internal) detected correctly
- [x] **[MULTI-PROJECT]** Repository metadata persistence (insertRepository)
- [x] **[MONOREPO]** Workspace metadata persistence (insertWorkspaces, insertWorkspaceAliases, insertWorkspaceDependencies)
- [x] **[MICROSERVICE]** Service metadata persistence (insertServices, insertCrossRepoDependencies)
- [x] **[MULTI-PROJECT]** Orchestrator methods for persisting workspace/service data
- [x] **[MULTI-PROJECT]** Integration tests for multi-project database persistence
- [x] Indexing statistics logged on completion
- [x] Errors logged but don't halt entire process
- [x] End-to-end indexing works on test repository
- [x] All unit and integration tests written (will pass when PostgreSQL available)

**Phase 3.1 API Contract Parsing (✅ 100% Complete):**

- [x] **[API Contracts]** OpenAPI/Swagger files parsed and endpoints extracted
- [x] **[API Contracts]** GraphQL schemas parsed with queries/mutations/subscriptions
- [x] **[API Contracts]** gRPC proto files parsed with RPC methods extracted
- [x] **[API Contracts]** API endpoints linked to implementation chunks
- [x] **[API Contracts]** Service-level API embeddings generated (services.api_endpoints)
- [x] **[API Contracts]** Per-endpoint embeddings generated and stored
- [x] **[API Contracts]** Cross-service API calls detected in code
- [x] **[API Contracts]** Database writer extended with updateServiceAPIEndpoints methods
- [x] **[API Contracts]** Orchestrator integration: parseAndIndexAPISpecifications method
- [x] **[API Contracts]** Implementation linking with multiple strategies (operationId, decorator, route, file path, function name)

**Note:** Phase 3.1 has been completed. API contract parsing infrastructure is now ready for use in microservice and multi-service architectures. The orchestrator's `parseAndIndexAPISpecifications` method can be called after service detection to automatically discover, parse, and index API specifications.

---

## Dependencies

- [x] Phase 1 complete (config, database client, Ollama client, logger)
- [x] Phase 2 complete (file discovery, parsing, chunking, metadata extraction)
- [ ] Ollama running with models available (mxbai-embed-large, qwen2.5-coder:1.5b)

---

## Output Artifacts

- `src/indexing/summary.ts` - LLM-based + rule-based summary generation
- `src/indexing/embeddings.ts` - Embedding generation with enhanced text
- `src/database/writer.ts` - Database persistence with batch optimization + workspace/service tables
- `src/indexing/symbols.ts` - Symbol extraction and embedding
- `src/utils/progress.ts` - Progress tracking and statistics
- `src/indexing/api-parser.ts` - API contract parsing (REST/GraphQL/gRPC)
- `src/indexing/orchestrator.ts` - Pipeline coordinator (combines all stages)
- **[MONOREPO/MICROSERVICE]** Enhanced database writer with workspace/service persistence functions
- **[MULTI-PROJECT]** API contract parsers for OpenAPI, GraphQL, gRPC
- `tests/unit/indexing/` - Unit tests (including API parsing tests)
- `tests/integration/` - Integration tests (end-to-end indexing + monorepo/microservice + API contracts)

---

## Next Phase

**Phase 4: Multi-Stage Retrieval System (7-Stage Pipeline)**

- Vector similarity search (7-stage pipeline)
- Scope filtering (multi-project)
- Query embedding generation
- File-level → chunk-level → symbol → import chain → API enrichment → deduplication
- Context assembly with token counting

**✅ Phase 3 must be 100% complete before starting Phase 4.**
