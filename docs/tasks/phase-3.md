# Phase 3: Embedding & Summary Generation

**Estimated Duration:** 3-4 days **Priority:** Critical - Enables semantic search

---

## Overview

Transform chunked code into vector embeddings and generate intelligent file summaries. This delivers
the embedding pipeline via Ollama, LLM-based summary generation, and database persistence.

---

## Checklist

### 1. File Summary Generation

- [ ] Create `src/indexing/summary.ts` with LLM-based summary generator
- [ ] Design prompt template: include file path/language, use first 100 lines, request
      single-sentence starting with "This file...", format 50-200 chars
- [ ] Implement Ollama API call using configured SUMMARY_MODEL (qwen2.5-coder:1.5b or 3b), timeout
      10s per summary
- [ ] Implement batch processing: 10 files at a time, max 3 concurrent requests, retry logic (max 2
      retries)
- [ ] Implement rule-based fallback (when Ollama unavailable/model not
      found/timeout/SUMMARY_MODEL=""): extract JSDoc/docstring, extract exports, format "This file
      exports {symbols}" or "This file contains {N} functions and {M} classes"
- [ ] Validate: summary length 50-200 chars, starts with "This file", test both LLM and fallback
      methods
- [ ] Output: FileSummary{file_path, summary_text, summary_method (llm|rule-based), model_used,
      generation_time_ms}

### 2. Embedding Generation

- [ ] Create `src/indexing/embeddings.ts` with enhanced text construction
- [ ] Build enhanced text per chunk: prepend "FILE: {path} | TYPE: {type} | LANG: {language}",
      include code content, append "SYMBOLS: {comma_separated}"
- [ ] Implement Ollama embeddings API call using configured EMBEDDING_MODEL (mxbai-embed-large),
      return 1024-dimension vector
- [ ] Validate dimensions: verify length matches EMBEDDING_DIMENSIONS, throw error on mismatch, halt
      indexing
- [ ] Implement batch processing: 50 chunks at a time, max 5 concurrent requests, rate limit 100
      req/s, progress tracking
- [ ] Implement retry logic: 3 attempts on network errors, exponential backoff (1s, 2s, 4s), skip
      chunk after 3 failures, continue with remaining
- [ ] Test: embedding generation, dimension validation, batch processing, retry logic, consistency
      (same input = same output)
- [ ] Output: ChunkEmbedding{chunk_id, embedding (1024 dims), embedding_model, dimension,
      generation_time_ms, enhanced_text}

### 3. Database Persistence

- [ ] Create `src/database/writer.ts` with insert operations
- [ ] Implement `insertFile()`: INSERT into code_files with UPSERT (ON CONFLICT DO UPDATE), update
      updated_at on conflict
- [ ] Implement `insertChunks()`: batch INSERT into code_chunks (ON CONFLICT DO NOTHING to prevent
      duplicates)
- [ ] Implement `insertSymbols()`: batch INSERT into code_symbols (ON CONFLICT DO NOTHING)
- [ ] Optimize batch inserts: collect 100 chunks before inserting, use PostgreSQL COPY for bulk
      inserts, transaction per batch (commit every 100 chunks), rollback batch on error
- [ ] Handle errors: catch unique constraints, vector dimension mismatches, foreign key violations,
      log with context, continue processing
- [ ] Test: file insertion, chunk batch insertion, symbol insertion, upsert on duplicate file,
      transaction rollback

### 4. Symbol Extraction & Indexing

- [ ] Create `src/indexing/symbols.ts` for symbol processing
- [ ] Extract from parsed nodes: functions (name, parameters, return type, line), classes (name,
      methods, properties, line), variables (name, type, line), types/interfaces (TypeScript)
- [ ] Classify symbol types: function, class, variable, interface, type, constant, method
- [ ] Detect scope: exported (in exports array) vs internal (not exported)
- [ ] Build symbol definition text: functions (`function name(params): returnType`), classes
      (`class Name { methods }`), variables (`const NAME: type`)
- [ ] Generate embedding for symbol definition using same enhanced text format
- [ ] Generate unique symbol ID (UUID)
- [ ] Test: function/class symbol extraction, scope detection, symbol embedding generation
- [ ] Output: ExtractedSymbol{symbol_id (UUID), symbol_name, symbol_type, file_path, line_number,
      definition, embedding (1024 dims), scope}

### 5. Progress Tracking

- [ ] Create `src/utils/progress.ts` with progress reporter
- [ ] Track stages: file discovery, parsing, summary generation, embedding generation, database
      insertion
- [ ] Calculate percentage complete and ETA, display format: `[Stage] X/Y (Z%) - ETA: Nm Ss`
- [ ] Collect statistics: files processed/failed, chunks generated/embedded, symbols extracted, LLM
      vs fallback summaries, average times, errors
- [ ] Display final report: files/min, chunks/min, LLM summaries (count + %), fallback summaries
      (count + %), avg embedding time, database write rate, total time
- [ ] Output: IndexingStats{files_total, files_processed, files_failed, chunks_total,
      chunks_embedded, symbols_extracted, total_time_ms, avg_file_time_ms, summaries_llm,
      summaries_fallback, errors[]}

---

## Success Criteria

Phase 3 is complete when:

- [ ] LLM summary generation produces valid summaries for all languages
- [ ] Summaries are 1-2 sentences starting with "This file..."
- [ ] Rule-based fallback works when LLM unavailable
- [ ] Embedding generation produces exactly 1024 dimensions
- [ ] Enhanced text includes file path, type, language, and symbols
- [ ] Batch processing handles 50 chunks efficiently
- [ ] Dimension validation catches and reports mismatches
- [ ] Retry logic handles temporary Ollama failures
- [ ] Progress tracking shows real-time percentage and ETA
- [ ] All 3 database tables (code_files, code_chunks, code_symbols) populated correctly
- [ ] Batch inserts optimize database writes with transactions
- [ ] Duplicate files handled with upsert
- [ ] Symbol extraction works for functions, classes, variables
- [ ] Symbol scope (exported/internal) detected correctly
- [ ] Indexing statistics logged on completion
- [ ] Errors logged but don't halt entire process
- [ ] End-to-end indexing works on test repository
- [ ] All unit and integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (config, database client, Ollama client, logger)
- [ ] Phase 2 complete (file discovery, parsing, chunking, metadata extraction)
- [ ] Ollama running with models available (mxbai-embed-large, qwen2.5-coder:1.5b)

---

## Output Artifacts

- `src/indexing/summary.ts` - LLM-based + rule-based summary generation
- `src/indexing/embeddings.ts` - Embedding generation with enhanced text
- `src/database/writer.ts` - Database persistence with batch optimization
- `src/indexing/symbols.ts` - Symbol extraction and embedding
- `src/utils/progress.ts` - Progress tracking and statistics
- `src/indexing/orchestrator.ts` - Pipeline coordinator (combines all stages)
- `tests/unit/indexing/` - Unit tests
- `tests/integration/` - Integration tests (end-to-end indexing)

---

## Next Phase

**Phase 4: Multi-Stage Retrieval System**

- Vector similarity search (5-stage pipeline)
- Query embedding generation
- File-level → chunk-level → symbol → import chain → deduplication
- Context assembly with token counting

**✅ Phase 3 must be 100% complete before starting Phase 4.**
