# Phase 3: Embedding & Summary Generation

**Estimated Duration:** 3-4 days **Priority:** Critical - Enables semantic search

---

## Overview

Transform chunked code into vector embeddings and generate intelligent file summaries. This phase
delivers the embedding pipeline (via Ollama), LLM-based file summary generation, and database
persistence.

---

## Checklist

### 1. File Summary Generation

#### LLM-Based Summary

- [ ] Create `src/indexing/summary.ts`
- [ ] Design prompt template for code summary
  - [ ] Include file path and language
  - [ ] Use first 100 lines of code
  - [ ] Request single-sentence summary
  - [ ] Format: "This file..."
- [ ] Implement Ollama API call for summary
- [ ] Use configured `SUMMARY_MODEL` (qwen2.5-coder:1.5b or 3b)
- [ ] Validate summary length (50-200 chars)
- [ ] Validate summary starts with "This file"
- [ ] Implement batch processing (10 files at a time)
- [ ] Add parallel requests (max 3 concurrent)
- [ ] Implement retry logic (max 2 retries)
- [ ] Add timeout (10 seconds per summary)

#### Rule-Based Fallback

- [ ] Extract first JSDoc/docstring comment
- [ ] Extract export statements
- [ ] Generate: "This file exports {symbols}"
- [ ] If no exports: "This file contains {N} functions and {M} classes"
- [ ] Trigger fallback when:
  - [ ] Ollama unavailable
  - [ ] Model not found
  - [ ] LLM timeout
  - [ ] User sets `SUMMARY_MODEL=""`

#### Validation

- [ ] Test LLM summary generation
- [ ] Test rule-based fallback
- [ ] Test batch processing
- [ ] Test timeout handling
- [ ] Verify summary quality

### 2. Embedding Generation

#### Enhanced Text Construction

- [ ] Create `src/indexing/embeddings.ts`
- [ ] Build enhanced text for each chunk:
  - [ ] Prepend: `FILE: {path} | TYPE: {type} | LANG: {language}`
  - [ ] Include: actual code content
  - [ ] Append: `SYMBOLS: {comma_separated}`
- [ ] Implement Ollama embeddings API call
- [ ] Use configured `EMBEDDING_MODEL` (mxbai-embed-large)
- [ ] Return embedding vector (1024 dimensions)

#### Dimension Validation

- [ ] Validate embedding length matches `EMBEDDING_DIMENSIONS`
- [ ] Throw error on mismatch: "Model outputs {X} dims, config expects {Y}"
- [ ] Halt indexing on dimension mismatch

#### Batch Processing

- [ ] Process chunks in batches of 50
- [ ] Implement parallel requests (max 5 concurrent)
- [ ] Add rate limiting (max 100 requests/second)
- [ ] Track progress: "Generating embeddings: {current}/{total} ({percent}%)"

#### Retry Logic

- [ ] Retry on network errors (max 3 attempts)
- [ ] Exponential backoff: 1s, 2s, 4s
- [ ] Skip chunk after 3 failures
- [ ] Log failed chunks
- [ ] Continue with remaining chunks

#### Validation

- [ ] Test embedding generation
- [ ] Test dimension validation
- [ ] Test batch processing
- [ ] Test retry logic
- [ ] Verify embedding consistency (same input = same output)

### 3. Database Persistence

#### Insert Operations

- [ ] Create `src/database/writer.ts`
- [ ] Implement `insertFile()` - insert into `code_files`
  - [ ] Use UPSERT (ON CONFLICT DO UPDATE)
  - [ ] Update `updated_at` on conflict
- [ ] Implement `insertChunks()` - batch insert into `code_chunks`
  - [ ] Use ON CONFLICT DO NOTHING (prevent duplicates)
- [ ] Implement `insertSymbols()` - batch insert into `code_symbols`
  - [ ] Use ON CONFLICT DO NOTHING

#### Batch Optimization

- [ ] Collect 100 chunks before inserting
- [ ] Use PostgreSQL COPY for bulk inserts (faster than INSERT)
- [ ] Implement transaction per batch (commit every 100 chunks)
- [ ] Rollback batch on error
- [ ] Log failed batches

#### Error Handling

- [ ] Catch unique constraint violations
- [ ] Catch vector dimension mismatches
- [ ] Catch foreign key violations
- [ ] Log errors with context (file path, chunk ID)
- [ ] Continue processing on errors

#### Validation

- [ ] Test file insertion
- [ ] Test chunk batch insertion
- [ ] Test symbol insertion
- [ ] Test upsert on duplicate file
- [ ] Test transaction rollback on error

### 4. Symbol Extraction & Indexing

#### Symbol Processing

- [ ] Create `src/indexing/symbols.ts`
- [ ] Extract from parsed nodes:
  - [ ] Functions (name, parameters, return type, line)
  - [ ] Classes (name, methods, properties, line)
  - [ ] Variables (name, type, line)
  - [ ] Types/Interfaces (TypeScript)
- [ ] Classify symbol types: function, class, variable, interface, type
- [ ] Detect scope: exported vs internal
- [ ] Build symbol definition text
  - [ ] Function: `function name(params): returnType`
  - [ ] Class: `class Name { methods }`
  - [ ] Variable: `const NAME: type = value`
- [ ] Generate embedding for symbol definition
- [ ] Generate unique symbol ID (UUID)

#### Validation

- [ ] Test function symbol extraction
- [ ] Test class symbol extraction
- [ ] Test scope detection (exported/internal)
- [ ] Test symbol embedding generation

### 5. Progress Tracking

#### Progress Reporter

- [ ] Create `src/utils/progress.ts`
- [ ] Track indexing stages:
  - [ ] File discovery
  - [ ] Parsing
  - [ ] Summary generation
  - [ ] Embedding generation
  - [ ] Database insertion
- [ ] Calculate percentage complete
- [ ] Estimate time remaining (ETA)
- [ ] Display: `[Stage] X/Y (Z%) - ETA: Nm Ss`

#### Statistics Collection

- [ ] Count files processed
- [ ] Count files failed
- [ ] Count chunks generated
- [ ] Count chunks embedded
- [ ] Count symbols extracted
- [ ] Track LLM summaries vs fallback
- [ ] Calculate average times
- [ ] Log errors

#### Performance Report

- [ ] Display final statistics:
  - [ ] Files processed (files/min)
  - [ ] Chunks generated (chunks/min)
  - [ ] LLM summaries (count and %)
  - [ ] Fallback summaries (count and %)
  - [ ] Average embedding time
  - [ ] Database write rate
  - [ ] Total time

---

## Success Criteria

**Phase 3 is complete when ALL items below are checked:**

- [ ] LLM summary generation works for all languages
- [ ] Summaries are 1-2 sentences, start with "This file..."
- [ ] Rule-based fallback works when LLM unavailable
- [ ] Embedding generation produces 1024 dimensions
- [ ] Enhanced text includes path, type, language, symbols
- [ ] Batch embedding processes 50 chunks at a time
- [ ] Dimension validation catches mismatches
- [ ] Retry logic handles temporary failures
- [ ] Progress tracking shows real-time percentage
- [ ] `code_files` table populated with metadata
- [ ] `code_chunks` table populated with embeddings
- [ ] `code_symbols` table populated with symbol registry
- [ ] Batch inserts optimize database writes
- [ ] Transactions rollback on errors
- [ ] Duplicate files handled with upsert
- [ ] Symbol extraction works for functions, classes
- [ ] Symbol scope (exported/internal) detected
- [ ] Indexing statistics logged at completion
- [ ] Errors logged but don't halt entire process
- [ ] End-to-end indexing works on test repository
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (config, database, Ollama client)
- [ ] Phase 2 complete (file discovery, chunking)
- [ ] Ollama running with models available

---

## Output Artifacts

- [ ] `src/indexing/summary.ts` - Summary generation
- [ ] `src/indexing/embeddings.ts` - Embedding generation
- [ ] `src/database/writer.ts` - Database persistence
- [ ] `src/indexing/symbols.ts` - Symbol extraction
- [ ] `src/utils/progress.ts` - Progress tracking
- [ ] `src/indexing/orchestrator.ts` - Pipeline coordinator
- [ ] `tests/unit/indexing/` - Unit tests
- [ ] `tests/integration/` - Integration tests

---

## Next Phase

**Phase 4 builds on indexed data:**

- Vector search queries against `code_chunks` table
- Multi-stage retrieval (files → chunks → symbols → imports)
- Deduplication of results

**✅ Phase 3 must be 100% complete before starting Phase 4.**
