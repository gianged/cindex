# Phase 6: Optimization & Production Readiness

**Estimated Duration:** 5-7 days **Priority:** High - Production-grade performance and reliability
**Status:** ❌ Not Started (0%)

---

## Overview

Optimize the system for production use with large codebases (1M+ LoC). This delivers incremental
indexing, HNSW index optimization, query caching, edge case handling, and comprehensive testing for
production deployment.

---

## Checklist

### 1. Incremental Indexing

- [ ] Create `src/indexing/incremental.ts` with hash-based change detection
- [ ] Implement change detection: walk directory + compute SHA256 per file, query database for
      existing hashes, classify files (new: not in DB, modified: hash different, unchanged: hash
      matches, deleted: in DB not on disk)
- [ ] Process changes: process only new + modified files, delete old chunks/symbols for modified
      files, re-parse and re-embed modified files, remove deleted files from database (DELETE FROM
      code_files cascades to chunks/symbols), update timestamps
- [ ] Log stats: unchanged (skipped), modified (re-indexing), new (indexing), deleted (removing)
- [ ] Target: re-index 100 changed files in <15s

### 2. HNSW Index Optimization

- [ ] Create `src/database/hnsw.ts` for index upgrade
- [ ] Drop IVFFlat indexes: code_files_summary_embedding_idx, code_chunks_embedding_idx,
      code_symbols_embedding_idx
- [ ] Create HNSW indexes with accuracy settings: m=16, ef_construction=200, use CONCURRENTLY for
      non-blocking builds
- [ ] Set runtime parameter: `SET hnsw.ef_search = 300` (accuracy mode)
- [ ] Show estimated time: ~30 min per 1M vectors
- [ ] Verify indexes created: check pg_indexes, test query performance with EXPLAIN ANALYZE
- [ ] Target: query time <800ms with >92% accuracy

### 3. Query Caching

- [ ] Create `src/utils/cache.ts` with LRU cache implementation
- [ ] Implement query embedding cache: key = query text, value = embedding + timestamp, TTL 1 hour,
      max 1000 entries, LRU eviction
- [ ] Implement search result cache: key = query + options (JSON), value = SearchResult + timestamp,
      TTL 5 minutes, LRU eviction
- [ ] **[MONOREPO/MICROSERVICE]** Implement workspace metadata cache: workspace dependency graphs,
      package.json data, TTL 30 minutes
- [ ] **[MONOREPO/MICROSERVICE]** Implement service metadata cache: API endpoint lists, service
      dependencies, TTL 30 minutes
- [ ] **[MONOREPO]** Implement alias resolution cache: @workspace/* mappings, tsconfig paths, TTL 1
      hour
- [ ] Invalidate caches on re-index (clear all)
- [ ] **[MONOREPO/MICROSERVICE]** Workspace-specific invalidation: invalidate only affected workspace
      when single package re-indexed
- [ ] **[MICROSERVICE]** Service-specific invalidation: invalidate only affected service when service
      re-indexed
- [ ] Track statistics: hit rate, cache size, total hits
- [ ] Target: cached query <100ms (vs 800ms uncached)

### 4. Large File Handling

- [ ] Detect generated/minified files: file name patterns (.min., .bundle., .d.ts), content patterns
      ("AUTO-GENERATED", "DO NOT EDIT"), avg line length >500 (minified)
- [ ] Structure-only indexing: files >5000 lines, generated files → index only summary + exports +
      top-level symbols, mark large_file=true and index_type='structure_only', log warning
- [ ] Binary file detection: check for null bytes, validate UTF-8 encoding, skip if binary

### 5. Edge Case Handling

- [ ] Circular imports: track visited files in Set, skip if already visited, mark as circular in
      metadata, prevent infinite loops
- [ ] Malformed code: wrap tree-sitter in try-catch, fall back to regex on error, last resort: treat
      file as single chunk, log failures
- [ ] Encoding issues: try UTF-8 first, fall back to ASCII, skip if unsupported, log errors
- [ ] Symlinks: check if points outside repo, skip external symlinks, detect circular symlinks,
      follow internal only
- [ ] Permissions: catch EACCES errors, log warnings, continue with next file, skip inaccessible
      directories
- [ ] Empty files: skip zero length, skip whitespace-only, skip comment-only, log skipped

### 6. Performance Monitoring

- [ ] Create `src/utils/performance.ts` with metrics collection
- [ ] Collect metrics: indexing (files/min, chunks/min, avg times), retrieval (query time, cache hit
      rate), database (query time, pool usage), memory (heap usage, trend analysis)
- [ ] Profile queries: track execution time, track memory delta, log slow queries (>1s)
- [ ] Monitor connection pool: total/idle/waiting connections
- [ ] Detect memory leaks: track heap over time, calculate trend, warn if consistently growing

### 7. Comprehensive Testing

- [ ] Scale tests: small (1k LoC, <30s index, <500ms query), medium (10k LoC, <5min index, <800ms
      query), large (100k LoC, <30min index, <1s query), very large (1M LoC, <1 hour index, <1.5s
      query)
- [ ] **[MONOREPO]** Monorepo scale tests: small monorepo (5 workspaces, 10k LoC, <7min index),
      medium (20 workspaces, 50k LoC, <20min index), large (50+ workspaces, 200k LoC, <1 hour index)
- [ ] **[MICROSERVICE]** Multi-repo tests: 5 service repos (10k LoC each, <40min total index with
      linking), 20 service repos (5k LoC each, <1 hour total index)
- [ ] **[MONOREPO]** Workspace detection tests: Turborepo, Nx, pnpm workspaces, npm workspaces, Lerna
      (100% detection accuracy), tsconfig path alias resolution (>95% accuracy), @workspace/* import
      resolution (>98% accuracy), cross-workspace dependency graph (100% circular detection)
- [ ] **[MICROSERVICE]** Service boundary tests: services/* directory detection (>95% accuracy),
      docker-compose.yml parsing (100% service extraction), API endpoint detection (>85% accuracy for
      Express/NestJS), service dependency graph (100% accuracy)
- [ ] **[MULTI-LANGUAGE MONOREPO]** Mixed-language tests: TypeScript + Python monorepo, TypeScript +
      Go microservices, verify language-specific workspace handling
- [ ] Stress tests: 10 concurrent queries (<5s total), 100 rapid re-index iterations (no leaks,
      stable performance)
- [ ] Accuracy tests: 100 test queries (top 1: >85%, top 5: >92%, top 10: >95%), deduplication (>95%
      caught, <5% false positives), import chain (100% circular detected, 100% depth respected, 100%
      external marked)
- [ ] **[MONOREPO/MICROSERVICE]** Architecture-aware accuracy: workspace-scoped search (>90% relevant
      within workspace), service-scoped search (>90% relevant within service), cross-workspace
      deduplication (>95% shared utilities deduplicated), cross-service deduplication (0% false
      deduplication - keep legitimate duplicates)
- [ ] Regression tests: re-run full test suite after each optimization, verify no functionality
      broken, verify performance improved

### 8. Production Deployment Checklist

- [ ] Create `docs/production-checklist.md` with deployment requirements
- [ ] Infrastructure: PostgreSQL 16+ with pgvector, Ollama with models, database backups,
      monitoring/alerting
- [ ] Configuration: env vars set, HNSW parameters tuned, connection pool sized, cache sizes
      configured
- [ ] Performance: HNSW indexes built, database vacuumed/analyzed, query <800ms, memory stable <3GB
- [ ] Testing: all tests passing, scale tests passing, accuracy >92%
- [ ] Security: no secrets in code, password secured, input validation verified, SQL injection
      prevented
- [ ] Monitoring: query latency, error rate, memory usage, cache hit rate, connection pool

---

## Success Criteria

Phase 6 is complete when:

- [ ] Incremental indexing detects changes via SHA256 comparison
- [ ] Only modified/new/deleted files processed (unchanged skipped)
- [ ] Re-index 100 changed files completes in <15s
- [ ] HNSW indexes created for all vector columns with accuracy settings (ef_search=300,
      ef_construction=200)
- [ ] Query embeddings cached (1 hour TTL) and search results cached (5 min TTL)
- [ ] Cache invalidation works on re-index
- [ ] Large files (>5000 lines) indexed structure-only
- [ ] Generated and binary files detected and handled appropriately
- [ ] All edge cases handled: circular imports, malformed code, encoding errors, symlinks,
      permissions, empty files
- [ ] Performance metrics collected and monitored
- [ ] Connection pool optimized and monitored
- [ ] Memory leaks eliminated (stable heap over time)
- [ ] All scale tests passing (1k to 1M LoC)
- [ ] All stress tests passing (concurrent queries, rapid re-indexing)
- [ ] Accuracy targets met: >92% relevance in top 10, >95% dedup effectiveness
- [ ] Query latency <800ms in accuracy mode, <100ms cached
- [ ] Production deployment checklist complete
- [ ] All unit, integration, scale, stress, and accuracy tests passing

---

## Performance Targets (Final)

**Indexing (Accuracy Mode):**

- Small (1k LoC): <30s | Medium (10k LoC): <5 min | Large (100k LoC): <30 min | Very Large (1M LoC):
  <1 hour
- Incremental (100 changed files): <15s

**Query (Accuracy Mode):**

- Typical query: <800ms | Cached query: <100ms | Complex query (>10 files): <1.5s
- Concurrent (10 simultaneous): <5s total

**Accuracy:**

- Top 10 relevance: >92% | Deduplication: >95% duplicates caught | Context noise: <2%

**Resource Usage:**

- Memory (idle): <100MB | Memory (indexing): <3GB | Memory (queries): <500MB
- Database connections: 2-10 (pooled)

---

## Dependencies

- [ ] All prior phases complete (Phases 1-5)

---

## Output Artifacts

- `src/indexing/incremental.ts` - Incremental indexing with hash comparison
- `src/database/hnsw.ts` - HNSW index creation and optimization
- `src/utils/cache.ts` - Query/result caching with LRU eviction
- `src/utils/edge-cases.ts` - Edge case handlers (all scenarios)
- `src/utils/performance.ts` - Performance monitoring and profiling
- `tests/scale/` - Scale tests (1k to 1M LoC)
- `tests/stress/` - Stress tests (concurrency, rapid re-indexing)
- `tests/accuracy/` - Accuracy validation tests
- `docs/production-checklist.md` - Complete deployment checklist
- `docs/performance-report.md` - Benchmark results and targets

---

## Completion

**System is production-ready when:**

✅ All checklists in Phases 1-6 complete ✅ All performance targets met or exceeded ✅ Zero crashes
in 24-hour stress test ✅ >92% relevance in blind testing with real queries ✅ Handles 1M+ LoC
codebases efficiently ✅ MCP integration seamless in Claude Code ✅ Code coverage >80%, fully
documented ✅ Production deployment checklist verified

**🎉 The cindex RAG MCP server is production-ready for 1M+ LoC codebases with accuracy-first
design!**
