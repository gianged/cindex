# Phase 4: Multi-Stage Retrieval System (7-Stage Pipeline)

**Estimated Duration:** 4-5 days
**Priority:** Critical - Core RAG functionality
**Status:** ❌ Not Started (0%)

---

## Overview

Implement the **7-stage retrieval pipeline** that progressively narrows from broad file-level search to precise code locations with dependency context. This delivers:

- **Stage 0:** Scope Filtering (repo/workspace/service filtering for multi-project)
- **Stage 1:** File-level semantic search
- **Stage 2:** Chunk-level retrieval within top files
- **Stage 3:** Symbol resolution for dependencies
- **Stage 4:** Import chain expansion with depth limits
- **Stage 5:** API Contract Enrichment (REST/GraphQL/gRPC contracts)
- **Stage 6:** Deduplication (architecture-aware)
- **Stage 7:** Context assembly with token counting

**Note:** Stages 0 and 5 are specifically for multi-project architectures. Single-repo search uses the 5-stage pipeline (1→2→3→4→6).

---

## Checklist

### 0. Stage 0: Scope Filtering (Multi-Project)

- [ ] Create `src/retrieval/scope-filter.ts` for multi-project filtering
- [ ] Implement repository filtering: WHERE repo_id IN (...), support exclude_repos[]
- [ ] Implement service filtering: WHERE service_id IN (...), WHERE service_type IN (...), support exclude_services[]
- [ ] Implement workspace filtering: WHERE workspace_id IN (...), support exclude_workspaces[]
- [ ] Support cross-repo search: if cross_repo=true, search across all indexed repositories
- [ ] Implement scope modes: 'global' (all repos), 'repository' (single repo), 'service' (single service), 'boundary-aware' (start point + dependencies)
- [ ] For boundary-aware: use start_repo/start_service as entry point, expand based on cross_repo_dependencies and workspace_dependencies tables
- [ ] **[REFERENCE REPOS]** Implement reference/documentation exclusion by default: exclude repo_type IN ('reference', 'documentation') unless explicitly requested
- [ ] **[REFERENCE REPOS]** Add filter parameters: `include_references` (default: false), `include_documentation` (default: false)
- [ ] **[REFERENCE REPOS]** Support explicit exclusion: `exclude_repo_types[]` parameter to block specific types
- [ ] **[REFERENCE REPOS]** Update `determineSearchScope()`: check include_references flag, check include_documentation flag, build exclusion list, apply to repo filter query
- [ ] Apply scope filters to all downstream stages (1-6)
- [ ] Output: ScopeFilter{repo_ids[], service_ids[], workspace_ids[], mode, cross_repo, include_references?, include_documentation?, exclude_repo_types[], boundary_config{max_depth, follow_dependencies}}

### 1. Query Processing

- [ ] Create `src/retrieval/query-processor.ts` for query handling
- [ ] Detect query type: natural language vs code snippet
- [ ] Preprocess query: trim whitespace, normalize text, remove special characters (except in code)
- [ ] Generate query embedding via Ollama (1024 dimensions)
- [ ] Cache query embeddings: same query text = reuse embedding, 1 hour TTL
- [ ] Output: QueryEmbedding{query_text, query_type, embedding (1024 dims), generation_time_ms}

### 2. Stage 1: File-Level Retrieval

- [ ] Create `src/retrieval/file-retrieval.ts` for broad file search
- [ ] Implement SQL query: SELECT from code_files, calculate cosine similarity `1 - (summary_embedding <=> query_embedding)`, WHERE similarity > SIMILARITY_THRESHOLD (0.70), ORDER BY similarity DESC, LIMIT max_files (default 15)
- [ ] **[MONOREPO/MICROSERVICE]** Add workspace/service filtering: WHERE workspace_id IN (...), WHERE service_id IN (...), WHERE repo_id IN (...), support exclude filters
- [ ] Return relevant files: file_path, file_summary, language, line_count, imports[], exports[], similarity score
- [ ] **[MONOREPO/MICROSERVICE]** Include context in results: workspace_id, package_name, service_id, repo_id
- [ ] Rank files by relevance (descending)
- [ ] Output: RelevantFile{file_path, file_summary, language, line_count, imports, exports, similarity, workspace_id?, package_name?, service_id?, repo_id?}

### 3. Stage 2: Chunk-Level Retrieval

- [ ] Create `src/retrieval/chunk-retrieval.ts` for precise chunk search
- [ ] Implement SQL query: SELECT from code_chunks, WHERE file_path IN (top files from Stage 1), AND similarity > 0.75 (higher than Stage 1), AND chunk_type != 'file_summary', ORDER BY similarity DESC, LIMIT 100 (before deduplication)
- [ ] **[MONOREPO/MICROSERVICE]** Apply workspace/service scope: if workspace_scope='strict', only chunks from same workspace; if service_scope='strict', only chunks from same service
- [ ] Return relevant chunks: chunk_id, file_path, chunk_content, chunk_type, start_line, end_line, token_count, metadata, similarity score
- [ ] **[MONOREPO/MICROSERVICE]** Include context: workspace_id, package_name, service_id, repo_id
- [ ] Rank chunks by relevance
- [ ] Output: RelevantChunk{chunk_id, file_path, chunk_content, chunk_type, start_line, end_line, token_count, metadata, similarity, workspace_id?, package_name?, service_id?, repo_id?}

### 4. Stage 3: Symbol Resolution

- [ ] Create `src/retrieval/symbol-resolver.ts` for dependency resolution
- [ ] Extract symbols from chunk metadata: dependencies (imported/used symbols), function names, class names
- [ ] **[MONOREPO]** Resolve workspace imports: use workspace_aliases table to resolve @workspace/* imports to actual file paths
- [ ] Implement SQL query: SELECT from code_symbols, WHERE symbol_name IN (extracted symbols), AND scope = 'exported', ORDER BY symbol_name
- [ ] **[MONOREPO]** Distinguish internal vs external: mark is_internal=true for workspace symbols, is_internal=false for external
- [ ] Return resolved symbols: symbol_name, symbol_type, file_path, line_number, definition, scope
- [ ] **[MONOREPO/MICROSERVICE]** Include context: workspace_id, service_id, is_internal flag
- [ ] Output: ResolvedSymbol{symbol_name, symbol_type, file_path, line_number, definition, scope, workspace_id?, service_id?, is_internal?}

### 5. Stage 4: Import Chain Expansion

- [ ] Create `src/retrieval/import-expander.ts` for dependency graph building
- [ ] Select top N files (N=5-10) from Stage 1 for import expansion
- [ ] **[MONOREPO/MICROSERVICE]** Configure depth per boundary type: workspace_depth (default: 2), service_depth (default: 1), import_depth (default: 3)
- [ ] **[MONOREPO/MICROSERVICE]** Implement boundary-aware expansion: if workspace_scope='strict', don't cross workspace boundaries; if service_scope='strict', don't cross service boundaries
- [ ] Traverse imports recursively: depth 1 (direct imports), depth 2 (second-order), depth 3 (third-order, stop here)
- [ ] For each file: extract imports from code_files.imports, filter to internal imports (in indexed repo), fetch file summary, track visited files
- [ ] **[MONOREPO]** Resolve workspace imports: use workspace_aliases to expand @workspace/* imports
- [ ] Detect circular imports: use Set for visited files, skip if already visited, mark as circular in metadata
- [ ] Mark truncated chains: depth limit reached (>3), external dependency (not in repo), boundary crossed
- [ ] **[MONOREPO/MICROSERVICE]** Track boundary crossings: mark cross_workspace=true, cross_service=true when boundaries crossed
- [ ] Output: ImportChain{file_path, imported_from (parent), depth (0-3), file_summary, exports[], circular flag, truncated flag, cross_workspace?, cross_service?, workspace_id?, service_id?}

### 6. Stage 5: API Contract Enrichment (Multi-Project)

- [ ] Create `src/retrieval/api-enricher.ts` for API contract context
- [ ] Query api_endpoints table: WHERE service_id IN (services from Stages 1-4), calculate cosine similarity on endpoint embeddings
- [ ] Filter by API type if specified: api_type IN ('rest', 'graphql_query', 'graphql_mutation', 'grpc')
- [ ] Match endpoints to implementation chunks: JOIN on implementation_chunk_id from Stage 2 results
- [ ] Extract contract details: endpoint_path, http_method, operation_id, summary, request_schema, response_schema, tags
- [ ] Identify cross-service API calls: match HTTP calls in chunks to api_endpoints from different services
- [ ] Link GraphQL queries to schema: match GraphQL operation names to graphql_query/graphql_mutation endpoints
- [ ] Link gRPC calls to proto: match service.Method calls to grpc endpoints
- [ ] Build API context map: {chunk_id -> [related_endpoints], service_id -> [exposed_apis], cross_service_calls[]}
- [ ] Add contract warnings: deprecated endpoints, missing implementations, schema mismatches
- [ ] Output: APIContext{endpoints[], cross_service_calls[], api_warnings[], contract_links{chunk_id -> endpoint_ids}}

### 7. Stage 6: Deduplication

- [ ] Create `src/retrieval/deduplicator.ts` for similarity-based dedup
- [ ] **[MONOREPO/MICROSERVICE]** Implement architecture-aware dedup: keep duplicates from different services (legitimate separation), deduplicate within workspace (shared utilities), use workspace/service context in similarity scoring
- [ ] Sort chunks by similarity score (descending)
- [ ] For each chunk: compare embedding to all higher-ranked chunks, calculate cosine similarity, if similarity > DEDUP_THRESHOLD (0.92): mark as duplicate IF same workspace/service, track reference to kept chunk
- [ ] **[MICROSERVICE]** Special handling: if chunks from different service_ids, don't deduplicate even if similar (legitimate code duplication across services)
- [ ] **[REFERENCE REPOS]** Handle cross-repo duplicates differently: same repo = remove duplicate (keep higher score), different repos = tag instead of remove (may be intentional)
- [ ] **[REFERENCE REPOS]** Implement reference vs main code duplicate detection: if reference duplicate of main code, keep main code and mark reference as similar; if main code duplicate of reference, replace reference with main code
- [ ] **[REFERENCE REPOS]** Add metadata tags: `similar_to_main_code`, `similar_file`, `similar_repo` for cross-repo duplicates
- [ ] Filter out duplicates, return deduplicated chunks (typically 25-35 from 100)
- [ ] Track duplicate count and mapping
- [ ] Output: DeduplicationResult{unique_chunks[], duplicates_removed count, duplicate_map (duplicate_id -> kept_id), architecture_context_preserved?}

### 7.5. Result Prioritization by Repository Type

- [ ] **[REFERENCE REPOS]** Create priority multipliers in `src/retrieval/deduplicator.ts`: monolithic/microservice/monorepo (1.0), library (0.9), reference (0.6), documentation (0.5)
- [ ] **[REFERENCE REPOS]** Implement `prioritizeResults()`: fetch repo_type for each result, apply priority multiplier, sort by (similarity * priority)
- [ ] **[REFERENCE REPOS]** Cache repo types: use Map to avoid repeated DB queries for same repo_id
- [ ] **[REFERENCE REPOS]** Implement `groupByRepoType()`: group results into primary_code[], libraries[], references[], documentation[] arrays
- [ ] **[REFERENCE REPOS]** Implement `limitSecondaryResults()`: max 5 reference results, max 3 documentation results, no limit on primary code
- [ ] **[REFERENCE REPOS]** Output: GroupedResults{primary_code[], libraries[], references[], documentation[]}

### 8. Stage 7: Context Assembly

- [ ] Create `src/retrieval/context-assembler.ts` for result aggregation
- [ ] Aggregate all 7 stages: scope filter (Stage 0), relevant files (Stage 1), relevant chunks (Stage 2, after dedup), resolved symbols (Stage 3), import chains (Stage 4), API contracts (Stage 5)
- [ ] **[MONOREPO/MICROSERVICE]** Group results by workspace, service, and repo: build by_workspace{}, by_service{}, by_repo{} maps with grouped context
- [ ] **[MONOREPO/MICROSERVICE]** Add workspace/service token budgets: allocate tokens per workspace to prevent single package dominating, balance context across services
- [ ] **[REFERENCE REPOS]** Include repository metadata in results: repo_type, version, upstream_url for reference repos
- [ ] **[REFERENCE REPOS]** Group results by repo type: primary_code (main codebase), libraries (your libraries), references (external frameworks), documentation (markdown docs)
- [ ] **[REFERENCE REPOS]** Add metadata section to results: repos_searched{repo_id, repo_type, chunk_count}[], reference_repos_included[], documentation_repos_included[]
- [ ] Count total tokens: sum chunk.token_count + symbols (~50 tokens each) + imports (~30 tokens each) + API contracts (~100 tokens each)
- [ ] Generate warning if >100k tokens: type 'context_size', severity 'warning', message "Context size: X tokens (exceeds 100k)", suggestion "Consider narrowing query or reducing max_snippets"
- [ ] **[MONOREPO/MICROSERVICE]** Add boundary warnings: warn if boundaries crossed unexpectedly
- [ ] **[MULTI-PROJECT]** Add API contract warnings: deprecated endpoints used, missing API implementations, cross-service contract mismatches
- [ ] **[REFERENCE REPOS]** Add reference warnings: outdated reference repos (suggest re-index), similar code in references vs main code
- [ ] Build SearchResult: query, query_type, warnings[], metadata (total_tokens, files_retrieved, chunks_retrieved, chunks_after_dedup, chunks_deduplicated, symbols_resolved, import_depth_reached, api_endpoints_found, query_time_ms, workspaces_searched?, services_searched?, repos_searched[], reference_repos_included[], documentation_repos_included[]), context (relevant_files[], code_locations[], symbols[], imports[], api_contracts[], by_workspace?, by_service?, by_repo?, by_repo_type?)
- [ ] Output: SearchResult{query, query_type, warnings, metadata, context}

### 9. Search Orchestrator

- [ ] Create `src/retrieval/search.ts` with main search function
- [ ] Implement `searchCodebase(query, options)`: coordinate all 7 stages sequentially, track query execution time, return SearchResult
- [ ] Support options: max_files (15), max_snippets (25), include_imports (true), import_depth (3), dedup_threshold (0.92), similarity_threshold (0.75)
- [ ] **[MONOREPO/MICROSERVICE]** Support new options: workspace_filter, package_filter, exclude_workspaces, service_filter, service_type_filter, exclude_services, repo_filter, exclude_repos, cross_repo, workspace_scope{mode, max_depth}, service_scope{mode, max_depth}, workspace_depth (2), service_depth (1)
- [ ] **[MULTI-PROJECT]** Support API options: search_api_contracts (true/false), api_types[] ('rest', 'graphql', 'grpc'), include_deprecated_apis (false)
- [ ] **[REFERENCE REPOS]** Support reference repo options: include_references (default: false), include_documentation (default: false), exclude_repo_types[]
- [ ] **[REFERENCE REPOS]** Support result limiting: max_reference_results (default: 5), max_documentation_results (default: 3)

---

## Success Criteria

Phase 4 is complete when:

- [ ] **Stage 0:** Scope filters applied correctly for multi-project searches
- [ ] **Stage 0:** Repository/service/workspace filtering works as expected
- [ ] **Stage 0:** Boundary-aware mode expands from start point via dependencies
- [ ] **Stage 0:** Reference and documentation repos excluded by default
- [ ] **Stage 0:** include_references and include_documentation flags work correctly
- [ ] Query embedding generated correctly from user input
- [ ] **Stage 1:** Retrieves top 15 relevant files ranked by cosine similarity
- [ ] **Stage 1:** Similarity threshold (0.70) filters low-quality results
- [ ] **Stage 2:** Retrieves chunks from top files only with higher threshold (0.75)
- [ ] **Stage 2:** Chunks ranked by similarity with correct metadata
- [ ] **Stage 3:** Resolves symbols from chunk dependencies
- [ ] **Stage 3:** Symbol definitions fetched from code_symbols table
- [ ] **Stage 4:** Expands import chains to depth 3
- [ ] **Stage 4:** Circular imports detected and marked (no infinite loops)
- [ ] **Stage 4:** External dependencies marked as truncated (not expanded)
- [ ] **Stage 5:** API contracts matched to implementation chunks
- [ ] **Stage 5:** Cross-service API calls detected and linked
- [ ] **Stage 5:** GraphQL/gRPC operations linked to schemas
- [ ] **Stage 5:** Deprecated API warnings generated
- [ ] **Stage 6:** Deduplicates similar chunks (threshold 0.92)
- [ ] **Stage 6:** Highest-scoring duplicates kept, count tracked
- [ ] **Stage 6:** Architecture-aware dedup preserves cross-service duplicates
- [ ] **Stage 6:** Cross-repo duplicates tagged instead of removed
- [ ] **Stage 6:** Reference repo duplicates vs main code handled correctly
- [ ] **Stage 7:** Token counting accurate across all components (including API contracts)
- [ ] **Stage 7:** Warning generated when context exceeds 100k tokens
- [ ] **Stage 7:** Context assembled in structured SearchResult format
- [ ] **Stage 7:** API contract warnings included in warnings array
- [ ] **Stage 7:** Repository metadata included (repo_type, version, upstream_url)
- [ ] **Stage 7:** Results grouped by repo type (primary/libraries/references/documentation)
- [ ] **Stage 7.5:** Result prioritization by repo_type works correctly
- [ ] **Stage 7.5:** Priority multipliers applied (main: 1.0, library: 0.9, reference: 0.6, docs: 0.5)
- [ ] **Stage 7.5:** Secondary results limited (max 5 reference, max 3 documentation)
- [ ] Query time <800ms for typical query (accuracy mode)
- [ ] End-to-end search returns relevant results across all 7 stages
- [ ] Multi-project filtering works correctly (repo/service/workspace scopes)
- [ ] Reference repository prioritization works correctly (main code first)
- [ ] All unit and integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (database client, config)
- [ ] Phase 3 complete (indexed database with embeddings in all 3 tables)

---

## Output Artifacts

- `src/retrieval/scope-filter.ts` - Stage 0: Scope filtering (multi-project, reference repo exclusion)
- `src/retrieval/query-processor.ts` - Query embedding generation
- `src/retrieval/file-retrieval.ts` - Stage 1: File-level search
- `src/retrieval/chunk-retrieval.ts` - Stage 2: Chunk-level search
- `src/retrieval/symbol-resolver.ts` - Stage 3: Symbol resolution
- `src/retrieval/import-expander.ts` - Stage 4: Import chain expansion
- `src/retrieval/api-enricher.ts` - Stage 5: API contract enrichment (multi-project)
- `src/retrieval/deduplicator.ts` - Stage 6: Deduplication (architecture-aware, cross-repo duplicate handling, result prioritization)
- `src/retrieval/context-assembler.ts` - Stage 7: Context assembly with token counting and repo metadata
- `src/retrieval/search.ts` - Search orchestrator (main entry point)
- `src/retrieval/vector-search.ts` - **[REFERENCE REPOS]** Vector search with scope filtering
- `tests/unit/retrieval/` - Unit tests for each stage
- `tests/integration/` - End-to-end search tests (including multi-project scenarios, reference repo filtering)

---

## Next Phase

**Phase 5: MCP Server & Tools**
- MCP server framework setup
- 4 core tools (search_codebase, get_file_context, find_symbol_definition, index_repository)
- Context formatting for Claude (Markdown)
- Input validation and error handling

**✅ Phase 4 must be 100% complete before starting Phase 5.**
