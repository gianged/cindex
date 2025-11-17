# Phase 6: Optimization & Production Readiness

**Estimated Duration:** 5-7 days **Priority:** High - Production-grade performance

---

## Overview

Optimize the system for production use with large codebases (1M+ LoC). This delivers incremental
indexing, HNSW index optimization, query caching, edge case handling, and comprehensive testing.

---

## Checklist

### 1. Incremental Indexing

- [ ] Create `src/indexing/incremental.ts`
- [ ] Implement hash-based change detection:
  - [ ] Walk directory, compute SHA256 for each file
  - [ ] Query database for existing hashes
  - [ ] Classify files:
    - [ ] New: not in database
    - [ ] Modified: hash different
    - [ ] Unchanged: hash matches
    - [ ] Deleted: in database, not on disk
- [ ] Process only new + modified files
- [ ] Delete old chunks/symbols for modified files
- [ ] Re-parse and re-embed modified files
- [ ] Remove deleted files from database:
  - [ ] DELETE FROM code_files (cascades to chunks/symbols)
- [ ] Update timestamps
- [ ] Log incremental stats:
  - [ ] Unchanged (skipped)
  - [ ] Modified (re-indexing)
  - [ ] New (indexing)
  - [ ] Deleted (removing)

### 2. HNSW Index Optimization

- [ ] Create `src/database/hnsw.ts`
- [ ] Drop IVFFlat indexes:
  - [ ] DROP INDEX code_files_summary_embedding_idx
  - [ ] DROP INDEX code_chunks_embedding_idx
  - [ ] DROP INDEX code_symbols_embedding_idx
- [ ] Create HNSW indexes:
  - [ ] code_files.summary_embedding (m=16, ef_construction=200)
  - [ ] code_chunks.embedding (m=16, ef_construction=200)
  - [ ] code_symbols.embedding (m=16, ef_construction=200)
- [ ] Set runtime parameter: `SET hnsw.ef_search = 300`
- [ ] Use concurrent index builds (CONCURRENTLY)
- [ ] Show estimated time (30 min per 1M vectors)
- [ ] Verify indexes created
- [ ] Test query performance with EXPLAIN ANALYZE

### 3. Query Caching

- [ ] Create `src/utils/cache.ts`
- [ ] Implement query embedding cache:
  - [ ] Key: query text
  - [ ] Value: embedding vector + timestamp
  - [ ] TTL: 1 hour
  - [ ] LRU eviction (max 1000 entries)
- [ ] Implement search result cache:
  - [ ] Key: query + options (JSON)
  - [ ] Value: SearchResult + timestamp
  - [ ] TTL: 5 minutes
  - [ ] LRU eviction
- [ ] Invalidate caches on re-index
- [ ] Track cache statistics:
  - [ ] Hit rate
  - [ ] Cache size
  - [ ] Total hits

### 4. Large File Handling

- [ ] Detect generated/minified files:
  - [ ] File name patterns: `.min.`, `.bundle.`, `.d.ts`
  - [ ] Content patterns: "AUTO-GENERATED", "DO NOT EDIT"
  - [ ] Avg line length >500 chars (minified)
- [ ] Structure-only indexing for:
  - [ ] Files >5000 lines
  - [ ] Generated files
  - [ ] Only index: summary + exports + top-level symbols
  - [ ] Mark `large_file: true` and `index_type: 'structure_only'`
  - [ ] Log warning
- [ ] Binary file detection:
  - [ ] Check for null bytes
  - [ ] Validate UTF-8 encoding
  - [ ] Skip if binary

### 5. Edge Case Handling

#### Circular Imports

- [ ] Track visited files in Set during import expansion
- [ ] Skip if already visited
- [ ] Mark as circular in metadata
- [ ] Prevent infinite loops

#### Malformed Code

- [ ] Wrap tree-sitter parsing in try-catch
- [ ] Fall back to regex parsing on error
- [ ] Last resort: treat entire file as single chunk
- [ ] Log parsing failures

#### Encoding Issues

- [ ] Try UTF-8 first
- [ ] Fall back to ASCII
- [ ] Skip file if unsupported encoding
- [ ] Log encoding errors

#### Symlinks

- [ ] Check if symlink points outside repo
- [ ] Skip external symlinks
- [ ] Detect circular symlinks
- [ ] Follow internal symlinks only

#### Permissions

- [ ] Catch EACCES errors
- [ ] Log permission denied warnings
- [ ] Continue with next file
- [ ] Skip inaccessible directories

#### Empty Files

- [ ] Skip files with zero length
- [ ] Skip files with only whitespace
- [ ] Skip comment-only files
- [ ] Log skipped files

### 6. Performance Monitoring

- [ ] Create `src/utils/performance.ts`
- [ ] Collect metrics:
  - [ ] Indexing: files/min, chunks/min, avg times
  - [ ] Retrieval: query time, cache hit rate
  - [ ] Database: query time, connection pool usage
  - [ ] Memory: heap usage, trend analysis
- [ ] Profile queries:
  - [ ] Track execution time
  - [ ] Track memory delta
  - [ ] Log slow queries (>1s)
- [ ] Monitor connection pool:
  - [ ] Total connections
  - [ ] Idle connections
  - [ ] Waiting connections
- [ ] Detect memory leaks:
  - [ ] Track heap usage over time
  - [ ] Calculate trend
  - [ ] Warn if consistently growing

### 7. Comprehensive Testing

#### Scale Tests

- [ ] Test small codebase (1k LoC)
  - [ ] Index time: <30s
  - [ ] Query time: <500ms
  - [ ] Memory: <500MB
- [ ] Test medium codebase (10k LoC)
  - [ ] Index time: <5 min
  - [ ] Query time: <800ms
  - [ ] Memory: <1GB
- [ ] Test large codebase (100k LoC)
  - [ ] Index time: <30 min
  - [ ] Query time: <1s
  - [ ] Memory: <2GB
- [ ] Test very large codebase (1M LoC)
  - [ ] Index time: <1 hour
  - [ ] Query time: <1.5s
  - [ ] Memory: <3GB

#### Stress Tests

- [ ] Concurrent queries (10 simultaneous)
  - [ ] Complete in <5s total
  - [ ] No deadlocks
  - [ ] Memory stable
- [ ] Rapid re-indexing (100 iterations)
  - [ ] No memory leaks
  - [ ] Performance stable
  - [ ] Connections cleaned up

#### Accuracy Tests

- [ ] Relevance validation (100 test queries)
  - [ ] Top 1 relevant: >85%
  - [ ] Top 5 relevant: >92%
  - [ ] Top 10 relevant: >95%
- [ ] Deduplication effectiveness
  - [ ] > 95% duplicates caught
  - [ ] <5% false positives
- [ ] Import chain accuracy
  - [ ] Circular imports: 100% detected
  - [ ] Depth limits: 100% respected
  - [ ] External dependencies: 100% marked

#### Regression Tests

- [ ] Re-run full test suite after each optimization
- [ ] Verify no functionality broken
- [ ] Verify performance improved or stable

### 8. Production Deployment

- [ ] Create `docs/production-checklist.md`
- [ ] Infrastructure checklist:
  - [ ] PostgreSQL 16+ with pgvector
  - [ ] Ollama with models pulled
  - [ ] Database backups configured
  - [ ] Monitoring/alerting set up
- [ ] Configuration checklist:
  - [ ] Environment variables set
  - [ ] HNSW parameters tuned
  - [ ] Connection pool sized
  - [ ] Cache sizes configured
- [ ] Performance checklist:
  - [ ] HNSW indexes built
  - [ ] Database vacuumed and analyzed
  - [ ] Query performance validated (<800ms)
  - [ ] Memory usage stable (<3GB)
- [ ] Testing checklist:
  - [ ] All tests passing
  - [ ] Scale tests passing
  - [ ] Accuracy targets met (>92%)
- [ ] Security checklist:
  - [ ] No secrets in code/config
  - [ ] Password secured
  - [ ] Input validation verified
  - [ ] SQL injection prevented
- [ ] Monitoring checklist:
  - [ ] Query latency metrics
  - [ ] Error rate tracking
  - [ ] Memory usage monitoring
  - [ ] Cache hit rate tracking

---

## Success Criteria

**Phase 6 is complete when ALL items below are checked:**

- [ ] Incremental indexing detects changes via SHA256
- [ ] Only modified files re-indexed
- [ ] Deleted files removed from database
- [ ] Re-index 100 changed files in <15s
- [ ] HNSW indexes created for all vector columns
- [ ] HNSW parameters tuned (ef_search=300)
- [ ] Query embeddings cached (1 hour TTL)
- [ ] Search results cached (5 min TTL)
- [ ] Cache invalidation on re-index
- [ ] Large files (>5000 lines) indexed structure-only
- [ ] Generated files detected and skipped
- [ ] Binary files detected and skipped
- [ ] Circular imports handled without loops
- [ ] Malformed code falls back gracefully
- [ ] Encoding errors handled (non-UTF-8)
- [ ] Permission errors logged and skipped
- [ ] Performance metrics collected
- [ ] Connection pool optimized
- [ ] Memory leaks eliminated
- [ ] All scale tests passing (1k - 1M LoC)
- [ ] All stress tests passing
- [ ] Accuracy >92% in top 10 results
- [ ] Query latency <800ms (accuracy mode)
- [ ] Production deployment checklist complete
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

- [ ] All prior phases complete (1-5)

---

## Output Artifacts

- [ ] `src/indexing/incremental.ts` - Incremental indexing
- [ ] `src/database/hnsw.ts` - HNSW optimization
- [ ] `src/utils/cache.ts` - Query/result caching
- [ ] `src/utils/edge-cases.ts` - Edge case handlers
- [ ] `src/utils/performance.ts` - Performance monitoring
- [ ] `tests/scale/` - Scale tests
- [ ] `tests/stress/` - Stress tests
- [ ] `tests/accuracy/` - Accuracy validation
- [ ] `docs/production-checklist.md` - Deployment checklist
- [ ] `docs/performance-report.md` - Benchmark results

---

## Performance Targets (Final)

**Indexing (Accuracy Mode):**

- [ ] Small (1k LoC): <30s
- [ ] Medium (10k LoC): <5 min
- [ ] Large (100k LoC): <30 min
- [ ] Very Large (1M LoC): <1 hour
- [ ] Incremental (100 files): <15s

**Query (Accuracy Mode):**

- [ ] Typical query: <800ms
- [ ] Cached query: <100ms
- [ ] Complex query: <1.5s
- [ ] Concurrent (10 queries): <5s total

**Accuracy:**

- [ ] Top 10 relevance: >92%
- [ ] Deduplication: >95% caught
- [ ] Context noise: <2%

**Resource Usage:**

- [ ] Memory (idle): <100MB
- [ ] Memory (indexing): <3GB
- [ ] Memory (queries): <500MB

---

## Completion

**System is production-ready when:**

✅ All checklists in Phases 1-6 are complete ✅ All performance targets met or exceeded ✅ Zero
crashes in 24-hour stress test ✅ >92% relevance in blind testing ✅ Handles 1M+ LoC codebases ✅
MCP integration seamless in Claude Code ✅ Code coverage >80%, documented

**🎉 Congratulations! The cindex RAG MCP server is production-ready.**
