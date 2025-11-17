# Phase 4: Multi-Stage Retrieval System

**Estimated Duration:** 4-5 days
**Priority:** Critical - Core RAG functionality

---

## Overview

Implement the 5-stage retrieval pipeline that progressively narrows from broad file-level search to precise code locations with dependency context. This delivers semantic search, symbol resolution, import chain expansion, deduplication, and context assembly.

---

## Checklist

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
- [ ] Return relevant files: file_path, file_summary, language, line_count, imports[], exports[], similarity score
- [ ] Rank files by relevance (descending)
- [ ] Output: RelevantFile{file_path, file_summary, language, line_count, imports, exports, similarity}

### 3. Stage 2: Chunk-Level Retrieval

- [ ] Create `src/retrieval/chunk-retrieval.ts` for precise chunk search
- [ ] Implement SQL query: SELECT from code_chunks, WHERE file_path IN (top files from Stage 1), AND similarity > 0.75 (higher than Stage 1), AND chunk_type != 'file_summary', ORDER BY similarity DESC, LIMIT 100 (before deduplication)
- [ ] Return relevant chunks: chunk_id, file_path, chunk_content, chunk_type, start_line, end_line, token_count, metadata, similarity score
- [ ] Rank chunks by relevance
- [ ] Output: RelevantChunk{chunk_id, file_path, chunk_content, chunk_type, start_line, end_line, token_count, metadata, similarity}

### 4. Stage 3: Symbol Resolution

- [ ] Create `src/retrieval/symbol-resolver.ts` for dependency resolution
- [ ] Extract symbols from chunk metadata: dependencies (imported/used symbols), function names, class names
- [ ] Implement SQL query: SELECT from code_symbols, WHERE symbol_name IN (extracted symbols), AND scope = 'exported', ORDER BY symbol_name
- [ ] Return resolved symbols: symbol_name, symbol_type, file_path, line_number, definition, scope
- [ ] Output: ResolvedSymbol{symbol_name, symbol_type, file_path, line_number, definition, scope}

### 5. Stage 4: Import Chain Expansion

- [ ] Create `src/retrieval/import-expander.ts` for dependency graph building
- [ ] Select top N files (N=5-10) from Stage 1 for import expansion
- [ ] Traverse imports recursively: depth 1 (direct imports), depth 2 (second-order), depth 3 (third-order, stop here)
- [ ] For each file: extract imports from code_files.imports, filter to internal imports (in indexed repo), fetch file summary, track visited files
- [ ] Detect circular imports: use Set for visited files, skip if already visited, mark as circular in metadata
- [ ] Mark truncated chains: depth limit reached (>3), external dependency (not in repo)
- [ ] Output: ImportChain{file_path, imported_from (parent), depth (0-3), file_summary, exports[], circular flag, truncated flag}

### 6. Stage 5: Deduplication

- [ ] Create `src/retrieval/deduplicator.ts` for similarity-based dedup
- [ ] Sort chunks by similarity score (descending)
- [ ] For each chunk: compare embedding to all higher-ranked chunks, calculate cosine similarity, if similarity > DEDUP_THRESHOLD (0.92): mark as duplicate, track reference to kept chunk
- [ ] Filter out duplicates, return deduplicated chunks (typically 25-35 from 100)
- [ ] Track duplicate count and mapping
- [ ] Output: DeduplicationResult{unique_chunks[], duplicates_removed count, duplicate_map (duplicate_id -> kept_id)}

### 7. Context Assembly

- [ ] Create `src/retrieval/context-assembler.ts` for result aggregation
- [ ] Aggregate all 5 stages: relevant files (Stage 1), relevant chunks (Stage 2, after dedup), resolved symbols (Stage 3), import chains (Stage 4)
- [ ] Count total tokens: sum chunk.token_count + symbols (~50 tokens each) + imports (~30 tokens each)
- [ ] Generate warning if >100k tokens: type 'context_size', severity 'warning', message "Context size: X tokens (exceeds 100k)", suggestion "Consider narrowing query or reducing max_snippets"
- [ ] Build SearchResult: query, query_type, warnings[], metadata (total_tokens, files_retrieved, chunks_retrieved, chunks_after_dedup, chunks_deduplicated, symbols_resolved, import_depth_reached, query_time_ms), context (relevant_files[], code_locations[], symbols[], imports[])
- [ ] Output: SearchResult{query, query_type, warnings, metadata, context}

### 8. Search Orchestrator

- [ ] Create `src/retrieval/search.ts` with main search function
- [ ] Implement `searchCodebase(query, options)`: coordinate all 5 stages sequentially, track query execution time, return SearchResult
- [ ] Support options: max_files (15), max_snippets (25), include_imports (true), import_depth (3), dedup_threshold (0.92), similarity_threshold (0.75)

---

## Success Criteria

Phase 4 is complete when:

- [ ] Query embedding generated correctly from user input
- [ ] Stage 1 retrieves top 15 relevant files ranked by cosine similarity
- [ ] Similarity threshold (0.70) filters low-quality results
- [ ] Stage 2 retrieves chunks from top files only with higher threshold (0.75)
- [ ] Chunks ranked by similarity with correct metadata
- [ ] Stage 3 resolves symbols from chunk dependencies
- [ ] Symbol definitions fetched from code_symbols table
- [ ] Stage 4 expands import chains to depth 3
- [ ] Circular imports detected and marked (no infinite loops)
- [ ] External dependencies marked as truncated (not expanded)
- [ ] Stage 5 deduplicates similar chunks (threshold 0.92)
- [ ] Highest-scoring duplicates kept, count tracked
- [ ] Token counting accurate across all components
- [ ] Warning generated when context exceeds 100k tokens
- [ ] Context assembled in structured SearchResult format
- [ ] Query time <800ms for typical query (accuracy mode)
- [ ] End-to-end search returns relevant results
- [ ] All unit and integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (database client, config)
- [ ] Phase 3 complete (indexed database with embeddings in all 3 tables)

---

## Output Artifacts

- `src/retrieval/query-processor.ts` - Query embedding generation
- `src/retrieval/file-retrieval.ts` - Stage 1: File-level search
- `src/retrieval/chunk-retrieval.ts` - Stage 2: Chunk-level search
- `src/retrieval/symbol-resolver.ts` - Stage 3: Symbol resolution
- `src/retrieval/import-expander.ts` - Stage 4: Import chain expansion
- `src/retrieval/deduplicator.ts` - Stage 5: Deduplication
- `src/retrieval/context-assembler.ts` - Context assembly with token counting
- `src/retrieval/search.ts` - Search orchestrator (main entry point)
- `tests/unit/retrieval/` - Unit tests for each stage
- `tests/integration/` - End-to-end search tests

---

## Next Phase

**Phase 5: MCP Server & Tools**
- MCP server framework setup
- 4 core tools (search_codebase, get_file_context, find_symbol_definition, index_repository)
- Context formatting for Claude (Markdown)
- Input validation and error handling

**✅ Phase 4 must be 100% complete before starting Phase 5.**
