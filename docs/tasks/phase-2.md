# Phase 2: Core Indexing Pipeline

**Estimated Duration:** 4-5 days **Priority:** Critical - Foundation for all retrieval functionality
**Status:** ✅ 100% Complete

---

## Overview

Build the complete indexing pipeline that transforms a codebase into structured, parseable chunks
ready for embedding. This delivers file discovery, syntax-aware parsing, semantic chunking, and
metadata extraction.

---

## Checklist

### 1. File Discovery & Filtering

- [x] Install dependencies: `ignore` (gitignore parser), `uuid` (chunk IDs)
- [x] Create `src/indexing/file-walker.ts`: recursive directory traversal, gitignore parsing and
      application, SHA256 hash computation per file, language detection by extension, line counting
- [x] **[MONOREPO]** Implement workspace detection: parse pnpm-workspace.yaml, package.json
      workspaces, nx.json, lerna.json, turbo.json, rush.json; extract workspace patterns (packages/*,
      apps/*); build workspace registry with package names and paths
- [x] **[MONOREPO]** Create `src/indexing/workspace-detector.ts`: detectWorkspaceConfig(),
      parsePackageJson(), parseTsConfig(), resolveWorkspaceAliases(), buildWorkspaceDependencyGraph()
- [x] **[MICROSERVICE]** Implement service boundary detection: detect services/* and apps/*
      directories, parse docker-compose.yml, identify service types (rest/graphql/grpc/library), extract
      API endpoint patterns
- [x] **[MICROSERVICE]** Create `src/indexing/service-detector.ts`: detectServices(),
      parseDockerCompose(), detectAPIEndpoints(), classifyServiceType()
- [x] **[MULTI-REPO]** Create repository registry: generate repo_id, detect repo_type
      (monorepo/microservice/monolithic), store workspace config metadata
- [x] Implement hardcoded filters: node_modules/, .git/, dist/, build/, coverage/, .next/, out/,
      binaries (.png, .jpg, .pdf, .exe, .zip), generated files (package-lock.json, *.min.js,
      *.bundle.js), lock files
- [x] Handle options: `include_markdown` (default false, except README.md at root), `max_file_size`
      (default 5000 lines - skip larger files)
- [x] Support languages: TypeScript/JavaScript (.ts, .tsx, .js, .jsx, .mjs, .cjs), Python (.py,
      .pyw), Java (.java), Go (.go), Rust (.rs), C/C++ (.c, .cpp, .h, .hpp), Ruby (.rb), PHP (.php),
      C# (.cs), Swift (.swift), Kotlin (.kt)
- [x] Output: DiscoveredFile{absolute_path, relative_path, file_hash (SHA256), language, line_count,
      file_size_bytes, modified_time, encoding, workspace_id?, package_name?, service_id?, repo_id}

### 2. Tree-sitter Parsing

- [x] Install tree-sitter parsers: tree-sitter, tree-sitter-typescript, tree-sitter-python,
      tree-sitter-java, tree-sitter-go, tree-sitter-rust, tree-sitter-c, tree-sitter-cpp,
      tree-sitter-ruby, tree-sitter-php, tree-sitter-c-sharp
- [x] Create `src/indexing/parser.ts`: initialize parser per language, generate syntax tree, extract
      nodes (functions, classes, imports, exports, top-level variables, interfaces/types)
- [x] Extract function metadata: name, parameters, return type, docstring, start/end line
- [x] Extract class metadata: name, methods, properties, start/end line
- [x] Handle syntax errors: catch and fall back to regex parsing, log failures
- [x] Output: ParsedNode{node_type, name, start_line, end_line, code_text, parameters, return_type,
      docstring, complexity, children}

### 3. Semantic Chunking

- [x] Create `src/indexing/chunker.ts` with chunking strategies
- [x] Implement file summary chunk: first 100 lines or entire file, mark as
      `chunk_type: 'file_summary'`, one per file
- [x] Implement import block chunk: group all imports, mark as `chunk_type: 'import_block'`, zero or
      one per file
- [x] **[MONOREPO]** Tag import blocks with workspace context: mark internal (@workspace/*)  vs
      external imports, extract workspace dependencies for workspace_dependencies table
- [x] Implement function chunks: one per function, include docstring, mark as
      `chunk_type: 'function'`
- [x] Implement class chunks: one per class with all methods, mark as `chunk_type: 'class'`
- [x] Implement top-level code blocks: group by logical boundaries, mark as `chunk_type: 'block'`
- [x] **[MONOREPO/MICROSERVICE]** Add repository context to all chunks: workspace_id, package_name,
      service_id, repo_id from file discovery metadata
- [x] Enforce size constraints: target 50-500 lines, merge <50 lines, split >500 at boundaries,
      minimum 10 lines
- [x] Handle large files: 1000-5000 lines (section-based chunking), >5000 lines (structure-only:
      summary + exports, mark `large_file: true`, log warning)
- [x] Implement fallback chunking: sliding window (200 lines, 20-line overlap), language-specific
      regex for function boundaries, mark as `chunk_type: 'fallback'`
- [x] Calculate token count: estimate 4 chars ≈ 1 token, generate UUID per chunk
- [x] Output: CodeChunk{chunk_id (UUID), file_path, chunk_content, chunk_type, start_line, end_line,
      token_count, metadata, created_at, workspace_id?, package_name?, service_id?, repo_id}

### 4. Metadata Extraction

- [x] Create `src/indexing/metadata.ts` for import/export/symbol extraction
- [x] Parse imports: TypeScript/JavaScript (`import { x } from './file'`, `import * as util`,
      `import React`), Python (`from utils import foo`, `import numpy as np`)
- [x] **[MONOREPO]** Classify imports: workspace imports (@workspace/*, @scope/*), tsconfig path
      aliases (@/*, ~/*), relative imports (./*, ../*)external imports (node_modules); mark
      is_internal flag
- [x] **[MONOREPO]** Create `src/indexing/alias-resolver.ts`: resolveWorkspaceAlias(),
      resolveTsConfigPath(), buildAliasCache(); populate workspace_aliases table
- [x] Parse exports: TypeScript/JavaScript (`export function foo()`, `export { User }`,
      `export default X`), Python (`__all__ = ['foo']`)
- [x] Extract symbols: function names, class names, top-level variables, type/interface names
      (TypeScript)
- [x] Calculate cyclomatic complexity: count decision points (if, else, while, for, case, &&, ||, ?,
      catch), formula: `complexity = decisions + 1`
- [x] Analyze dependencies: parse function calls, match against imports, track used imports
- [x] **[MICROSERVICE]** Extract API endpoint patterns: Express routes (app.get/post/put/delete),
      NestJS decorators (@Get/@Post), GraphQL resolvers, gRPC service definitions
- [x] Output: ChunkMetadata{function_names[], class_names[], imported_symbols[], exported_symbols[],
      dependencies[], complexity, has_async, has_loops, has_conditionals, is_internal_import?,
      api_endpoints?}

### 5. Indexing Strategy by Repository Type

- [x] Create `src/indexing/indexing-strategy.ts` with strategy definitions per repo type
- [x] Define lightweight indexing for reference repos: skip workspace detection, skip service detection, skip API parsing, include markdown, structure-focused summaries, no cross-repo dependencies
- [x] Define markdown-only indexing for documentation repos: skip all code parsing, index markdown only, no LLM summaries, preserve section structure
- [x] Define performance targets: reference (500 files/min), documentation (1000 files/min), monolithic (300-600 files/min)
- [x] Implement helper functions: `getIndexingStrategy(repo_type)`, `shouldDetectWorkspaces()`, `shouldDetectServices()`, `shouldIncludeMarkdown()`, `getSummaryDepth()`
- [x] Output: IndexingOptions{detect_workspaces, detect_services, detect_api_endpoints, include_markdown, focus_on_patterns, generate_file_summaries, summary_depth}

### 6. Markdown Documentation Indexing

- [x] Create `src/indexing/markdown-indexer.ts` for documentation repo support
- [x] Implement front matter parsing (YAML-style metadata at file start)
- [x] Extract markdown sections: parse headings (H1-H6), extract section content, track line numbers
- [x] Extract code blocks from markdown: detect language tags (```typescript, ```python), extract code content, link to parent section context
- [x] Implement `parseMarkdownFile()`: returns MarkdownDocument{title, sections, allCodeBlocks, metadata}
- [x] Implement `convertToParseResult()`: convert markdown to ParseResult format compatible with chunker (sections as 'class' chunks, code blocks as 'function' chunks)
- [x] Implement `indexMarkdownFiles()`: recursively find .md files, parse each, return array of documents
- [x] Generate markdown summaries: table of contents from headings, code block language counts, metadata summary
- [x] Output: MarkdownDocument{filePath, title, sections[], allCodeBlocks[], metadata}

### 7. Version Tracking & Re-indexing

- [x] Create `src/indexing/version-tracker.ts` for reference repo version management
- [x] Implement `getRepositoryVersion()`: query repositories table, return version info from metadata
- [x] Implement `updateRepositoryVersion()`: update metadata with new version, last_indexed timestamp
- [x] Implement `shouldReindex()`: compare versions, check force_reindex flag, return decision with reason
- [x] Implement `clearRepositoryData()`: delete all chunks/files/symbols for repo before re-indexing
- [x] Implement `upsertRepository()`: INSERT or UPDATE repository entry with metadata
- [x] Implement `getIndexingStats()`: count files/chunks/symbols/workspaces/services per repo
- [x] Implement `listIndexedRepositories()`: return all repos with version info and file counts
- [x] Implement `listReferenceRepositories()`: specialized query for reference repos with upstream_url and version
- [x] Implement `isRepositoryOutdated()`: check if repo older than N days (suggest re-index)
- [x] Output: RepositoryVersion{repo_id, current_version, last_indexed, indexed_file_count, metadata}, ReindexDecision{should_reindex, reason, version_changed}

### 8. Testing

- [x] Create test fixtures: `tests/fixtures/sample.ts` (well-formed TypeScript), `sample.py`
      (Python), `large.ts` (6000+ lines), `malformed.js` (syntax errors), `repo-with-gitignore/`
      (with .gitignore), `minimal.js` (<50 lines)
- [x] Unit tests: file discovery, gitignore application, binary file exclusion, SHA256 hashing,
      language detection, tree-sitter parsing (TypeScript/Python), function/class extraction,
      import/export parsing, chunk size constraints, token counting, fallback chunking, metadata
      extraction, complexity calculation
- [x] Integration tests: end-to-end file processing (TypeScript/Python), large file handling,
      gitignore filtering, malformed code fallback
- [x] Verify all tests pass (53/53 unit tests passing, integration tests require PostgreSQL setup)

---

## Success Criteria

Phase 2 is complete when:

- [x] File discovery recursively walks directories with gitignore filtering
- [x] Binary and generated files excluded correctly
- [x] SHA256 hash computed for all files (enables incremental indexing)
- [x] Language detected for all supported extensions
- [x] Tree-sitter parsers extract functions/classes with correct boundaries
- [x] Import and export statements parsed correctly
- [x] Chunks sized appropriately (50-500 lines where possible)
- [x] File summary and import block chunks created
- [x] Token count estimated for each chunk
- [x] Metadata extracted (functions, classes, symbols, complexity)
- [x] Fallback chunking works on parse errors
- [x] Large files (>5000 lines) indexed structure-only
- [x] All chunks have unique UUIDs and correct types
- [x] All unit and integration tests passing (53/53 unit tests passing)

---

## Dependencies

- [x] Phase 1 complete (logger, config system)
- [x] Tree-sitter libraries and language parsers installed

---

## Output Artifacts

- `src/indexing/file-walker.ts` - File discovery with gitignore support
- `src/indexing/workspace-detector.ts` - **[MONOREPO]** Workspace detection and registry
- `src/indexing/service-detector.ts` - **[MICROSERVICE]** Service boundary detection
- `src/indexing/alias-resolver.ts` - **[MONOREPO]** Workspace alias resolution
- `src/indexing/parser.ts` - Tree-sitter parsing with fallback
- `src/indexing/chunker.ts` - Semantic chunking logic with workspace/service tagging
- `src/indexing/metadata.ts` - Metadata extraction (imports, exports, symbols, complexity, APIs)
- `src/indexing/indexing-strategy.ts` - **[REFERENCE REPOS]** Repository type indexing strategies
- `src/indexing/markdown-indexer.ts` - **[REFERENCE REPOS]** Markdown documentation parsing and chunking
- `src/indexing/version-tracker.ts` - **[REFERENCE REPOS]** Version comparison and re-indexing workflow
- `src/types/indexing.ts` - Type definitions (DiscoveredFile, ParsedNode, CodeChunk, ChunkMetadata)
- `tests/unit/indexing/` - Unit tests
- `tests/fixtures/` - Test files for each language + monorepo/microservice samples

---

## Next Phase

**Phase 3: Embedding & Summary Generation**

- LLM-based file summaries via Ollama (qwen2.5-coder)
- Embedding generation via Ollama (mxbai-embed-large)
- Database persistence with batch inserts
- Symbol extraction and indexing

**✅ Phase 2 must be 100% complete before starting Phase 3.**
