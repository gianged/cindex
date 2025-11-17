# Phase 4: Multi-Stage Retrieval System

**Estimated Duration:** 4-5 days **Priority:** Critical - Core RAG functionality

---

## Overview

Implement the 5-stage retrieval pipeline that progressively narrows from broad file-level search to
precise code locations with dependency context. This delivers vector similarity search, symbol
resolution, import chain expansion, deduplication, and context assembly.

---

## Checklist

### 1. Query Embedding Generation

- [ ] Create `src/retrieval/query-processor.ts`
- [ ] Detect query type (natural language vs code snippet)
- [ ] Preprocess query:
  - [ ] Trim whitespace
  - [ ] Normalize text
  - [ ] Remove special characters (except in code)
- [ ] Generate query embedding via Ollama
- [ ] Return 1024-dimension vector
- [ ] Cache query embeddings (same query = reuse)

### 2. Stage 1: File-Level Retrieval

- [ ] Create `src/retrieval/file-retrieval.ts`
- [ ] Implement SQL query:
  - [ ] SELECT from `code_files`
  - [ ] Calculate cosine similarity: `1 - (summary_embedding <=> query_embedding)`
  - [ ] WHERE similarity > `SIMILARITY_THRESHOLD` (0.70)
  - [ ] ORDER BY similarity DESC
  - [ ] LIMIT `max_files` (default: 15)
- [ ] Return relevant files with metadata:
  - [ ] file_path
  - [ ] file_summary
  - [ ] language
  - [ ] line_count
  - [ ] imports
  - [ ] exports
  - [ ] similarity score
- [ ] Rank files by relevance (descending)

### 3. Stage 2: Chunk-Level Retrieval

- [ ] Create `src/retrieval/chunk-retrieval.ts`
- [ ] Implement SQL query:
  - [ ] SELECT from `code_chunks`
  - [ ] WHERE file_path IN (top files from Stage 1)
  - [ ] AND similarity > `SIMILARITY_THRESHOLD` (0.75, higher than Stage 1)
  - [ ] AND chunk_type != 'file_summary'
  - [ ] ORDER BY similarity DESC
  - [ ] LIMIT 100 (before deduplication)
- [ ] Return relevant chunks with metadata:
  - [ ] chunk_id
  - [ ] file_path
  - [ ] chunk_content
  - [ ] chunk_type
  - [ ] start_line, end_line
  - [ ] token_count
  - [ ] metadata
  - [ ] similarity score
- [ ] Rank chunks by relevance

### 4. Stage 3: Symbol Resolution

- [ ] Create `src/retrieval/symbol-resolver.ts`
- [ ] Extract symbols from chunk metadata:
  - [ ] Dependencies (imported/used symbols)
  - [ ] Function names
  - [ ] Class names
- [ ] Implement SQL query:
  - [ ] SELECT from `code_symbols`
  - [ ] WHERE symbol_name IN (extracted symbols)
  - [ ] AND scope = 'exported'
  - [ ] ORDER BY symbol_name
- [ ] Return resolved symbols:
  - [ ] symbol_name
  - [ ] symbol_type
  - [ ] file_path
  - [ ] line_number
  - [ ] definition
  - [ ] scope

### 5. Stage 4: Import Chain Expansion

- [ ] Create `src/retrieval/import-expander.ts`
- [ ] Select top N files (N=5-10) from Stage 1
- [ ] For each file:
  - [ ] Extract imports from `code_files.imports`
  - [ ] Filter to internal imports (in indexed repo)
  - [ ] Fetch file summary for each import
  - [ ] Track visited files (prevent circular imports)
- [ ] Traverse imports recursively:
  - [ ] Depth 1: Direct imports
  - [ ] Depth 2: Second-order imports
  - [ ] Depth 3: Third-order imports (stop here)
- [ ] Detect circular imports:
  - [ ] Use Set to track visited files
  - [ ] Skip if already visited
  - [ ] Mark as circular in metadata
- [ ] Mark truncated chains:
  - [ ] Depth limit reached (>3)
  - [ ] External dependency (not in repo)
- [ ] Return import chains:
  - [ ] file_path
  - [ ] imported_from (parent file)
  - [ ] depth (0-3)
  - [ ] file_summary
  - [ ] exports
  - [ ] circular flag
  - [ ] truncated flag

### 6. Stage 5: Deduplication

- [ ] Create `src/retrieval/deduplicator.ts`
- [ ] Sort chunks by similarity score (descending)
- [ ] For each chunk (highest to lowest):
  - [ ] Compare embedding to all higher-ranked chunks
  - [ ] Calculate cosine similarity
  - [ ] If similarity > `DEDUP_THRESHOLD` (0.92): mark as duplicate
  - [ ] Track reference to kept chunk
- [ ] Filter out duplicates
- [ ] Return deduplicated chunks (typically 25-35)
- [ ] Track duplicate count

### 7. Context Assembly

- [ ] Create `src/retrieval/context-assembler.ts`
- [ ] Aggregate results from all 5 stages:
  - [ ] Relevant files (Stage 1)
  - [ ] Relevant chunks (Stage 2, after dedup)
  - [ ] Resolved symbols (Stage 3)
  - [ ] Import chains (Stage 4)
- [ ] Count total tokens:
  - [ ] Sum chunk.token_count
  - [ ] Add symbols (~50 tokens each)
  - [ ] Add imports (~30 tokens each)
- [ ] Generate warning if > 100k tokens:
  - [ ] type: 'context_size'
  - [ ] severity: 'warning'
  - [ ] message: "Context size: X tokens (exceeds 100k)"
  - [ ] suggestion: "Consider narrowing query"
- [ ] Build SearchResult structure:
  - [ ] query
  - [ ] query_type
  - [ ] warnings[]
  - [ ] metadata (token count, file count, dedup count, query time)
  - [ ] context (files, chunks, symbols, imports)

### 8. Search Orchestrator

- [ ] Create `src/retrieval/search.ts`
- [ ] Implement `searchCodebase(query, options)` function
- [ ] Coordinate all 5 stages:
  1. [ ] Generate query embedding
  2. [ ] Retrieve relevant files (Stage 1)
  3. [ ] Retrieve relevant chunks (Stage 2)
  4. [ ] Resolve symbols (Stage 3)
  5. [ ] Expand imports (Stage 4)
  6. [ ] Deduplicate chunks (Stage 5)
  7. [ ] Assemble context
- [ ] Track query execution time
- [ ] Return SearchResult

---

## Success Criteria

**Phase 4 is complete when ALL items below are checked:**

- [ ] Query embedding generated from user input
- [ ] Stage 1 retrieves top 15 relevant files
- [ ] Files ranked by cosine similarity (descending)
- [ ] Similarity threshold filters low-quality results
- [ ] Stage 2 retrieves chunks from top files only
- [ ] Higher threshold in Stage 2 (0.75 vs 0.70)
- [ ] Chunks ranked by similarity
- [ ] Stage 3 resolves symbols from chunk metadata
- [ ] Symbol definitions fetched from code_symbols
- [ ] Stage 4 expands import chains to depth 3
- [ ] Circular imports detected and marked
- [ ] External dependencies marked (not expanded)
- [ ] Stage 5 deduplicates similar chunks (threshold 0.92)
- [ ] Highest-scoring duplicates kept
- [ ] Duplicate count tracked in metadata
- [ ] Token counting accurate across all components
- [ ] Warning generated when tokens >100k
- [ ] Context assembled in structured format
- [ ] Query time <800ms for typical query
- [ ] End-to-end search returns relevant results
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (database client, config)
- [ ] Phase 3 complete (indexed database with embeddings)

---

## Output Artifacts

- [ ] `src/retrieval/query-processor.ts` - Query processing
- [ ] `src/retrieval/file-retrieval.ts` - File-level search
- [ ] `src/retrieval/chunk-retrieval.ts` - Chunk-level search
- [ ] `src/retrieval/symbol-resolver.ts` - Symbol resolution
- [ ] `src/retrieval/import-expander.ts` - Import expansion
- [ ] `src/retrieval/deduplicator.ts` - Deduplication
- [ ] `src/retrieval/context-assembler.ts` - Context assembly
- [ ] `src/retrieval/search.ts` - Search orchestrator
- [ ] `tests/unit/retrieval/` - Unit tests
- [ ] `tests/integration/` - Integration tests

---

## Next Phase

**Phase 5 wraps retrieval in MCP server:**

- MCP tool implementations
- Claude Code integration
- Context formatting for Claude

**✅ Phase 4 must be 100% complete before starting Phase 5.**
