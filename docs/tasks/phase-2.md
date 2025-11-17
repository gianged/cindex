# Phase 2: Core Indexing Pipeline

**Estimated Duration:** 4-5 days **Priority:** Critical - Foundation for all retrieval functionality

---

## Overview

Build the complete indexing pipeline that transforms a codebase into structured, parseable chunks
ready for embedding. This delivers file discovery, syntax-aware parsing, semantic chunking, and
metadata extraction.

---

## Checklist

### 1. File Discovery & Filtering

- [ ] Install dependencies: `ignore` (gitignore parser), `uuid` (chunk IDs)
- [ ] Create `src/indexing/file-walker.ts`: recursive directory traversal, gitignore parsing and
      application, SHA256 hash computation per file, language detection by extension, line counting
- [ ] Implement hardcoded filters: node_modules/, .git/, dist/, build/, coverage/, .next/, out/,
      binaries (.png, .jpg, .pdf, .exe, .zip), generated files (package-lock.json, _.min.js,
      _.bundle.js), lock files
- [ ] Handle options: `include_markdown` (default false, except README.md at root), `max_file_size`
      (default 5000 lines - skip larger files)
- [ ] Support languages: TypeScript/JavaScript (.ts, .tsx, .js, .jsx, .mjs, .cjs), Python (.py,
      .pyw), Java (.java), Go (.go), Rust (.rs), C/C++ (.c, .cpp, .h, .hpp), Ruby (.rb), PHP (.php),
      C# (.cs), Swift (.swift), Kotlin (.kt)
- [ ] Output: DiscoveredFile{absolute_path, relative_path, file_hash (SHA256), language, line_count,
      file_size_bytes, modified_time, encoding}

### 2. Tree-sitter Parsing

- [ ] Install tree-sitter parsers: tree-sitter, tree-sitter-typescript, tree-sitter-python,
      tree-sitter-java, tree-sitter-go, tree-sitter-rust, tree-sitter-c, tree-sitter-cpp,
      tree-sitter-ruby, tree-sitter-php, tree-sitter-c-sharp
- [ ] Create `src/indexing/parser.ts`: initialize parser per language, generate syntax tree, extract
      nodes (functions, classes, imports, exports, top-level variables, interfaces/types)
- [ ] Extract function metadata: name, parameters, return type, docstring, start/end line
- [ ] Extract class metadata: name, methods, properties, start/end line
- [ ] Handle syntax errors: catch and fall back to regex parsing, log failures
- [ ] Output: ParsedNode{node_type, name, start_line, end_line, code_text, parameters, return_type,
      docstring, complexity, children}

### 3. Semantic Chunking

- [ ] Create `src/indexing/chunker.ts` with chunking strategies
- [ ] Implement file summary chunk: first 100 lines or entire file, mark as
      `chunk_type: 'file_summary'`, one per file
- [ ] Implement import block chunk: group all imports, mark as `chunk_type: 'import_block'`, zero or
      one per file
- [ ] Implement function chunks: one per function, include docstring, mark as
      `chunk_type: 'function'`
- [ ] Implement class chunks: one per class with all methods, mark as `chunk_type: 'class'`
- [ ] Implement top-level code blocks: group by logical boundaries, mark as `chunk_type: 'block'`
- [ ] Enforce size constraints: target 50-500 lines, merge <50 lines, split >500 at boundaries,
      minimum 10 lines
- [ ] Handle large files: 1000-5000 lines (section-based chunking), >5000 lines (structure-only:
      summary + exports, mark `large_file: true`, log warning)
- [ ] Implement fallback chunking: sliding window (200 lines, 20-line overlap), language-specific
      regex for function boundaries, mark as `chunk_type: 'fallback'`
- [ ] Calculate token count: estimate 4 chars ≈ 1 token, generate UUID per chunk
- [ ] Output: CodeChunk{chunk_id (UUID), file_path, chunk_content, chunk_type, start_line, end_line,
      token_count, metadata, created_at}

### 4. Metadata Extraction

- [ ] Create `src/indexing/metadata.ts` for import/export/symbol extraction
- [ ] Parse imports: TypeScript/JavaScript (`import { x } from './file'`, `import * as util`,
      `import React`), Python (`from utils import foo`, `import numpy as np`)
- [ ] Parse exports: TypeScript/JavaScript (`export function foo()`, `export { User }`,
      `export default X`), Python (`__all__ = ['foo']`)
- [ ] Extract symbols: function names, class names, top-level variables, type/interface names
      (TypeScript)
- [ ] Calculate cyclomatic complexity: count decision points (if, else, while, for, case, &&, ||, ?,
      catch), formula: `complexity = decisions + 1`
- [ ] Analyze dependencies: parse function calls, match against imports, track used imports
- [ ] Output: ChunkMetadata{function_names[], class_names[], imported_symbols[], exported_symbols[],
      dependencies[], complexity, has_async, has_loops, has_conditionals}

### 5. Testing

- [ ] Create test fixtures: `tests/fixtures/sample.ts` (well-formed TypeScript), `sample.py`
      (Python), `large.ts` (6000+ lines), `malformed.js` (syntax errors), `repo-with-gitignore/`
      (with .gitignore), `minimal.js` (<50 lines)
- [ ] Unit tests: file discovery, gitignore application, binary file exclusion, SHA256 hashing,
      language detection, tree-sitter parsing (TypeScript/Python), function/class extraction,
      import/export parsing, chunk size constraints, token counting, fallback chunking, metadata
      extraction, complexity calculation
- [ ] Integration tests: end-to-end file processing (TypeScript/Python), large file handling,
      gitignore filtering, malformed code fallback
- [ ] Verify all tests pass

---

## Success Criteria

Phase 2 is complete when:

- [ ] File discovery recursively walks directories with gitignore filtering
- [ ] Binary and generated files excluded correctly
- [ ] SHA256 hash computed for all files (enables incremental indexing)
- [ ] Language detected for all supported extensions
- [ ] Tree-sitter parsers extract functions/classes with correct boundaries
- [ ] Import and export statements parsed correctly
- [ ] Chunks sized appropriately (50-500 lines where possible)
- [ ] File summary and import block chunks created
- [ ] Token count estimated for each chunk
- [ ] Metadata extracted (functions, classes, symbols, complexity)
- [ ] Fallback chunking works on parse errors
- [ ] Large files (>5000 lines) indexed structure-only
- [ ] All chunks have unique UUIDs and correct types
- [ ] All unit and integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (logger, config system)
- [ ] Tree-sitter libraries and language parsers installed

---

## Output Artifacts

- `src/indexing/file-walker.ts` - File discovery with gitignore support
- `src/indexing/parser.ts` - Tree-sitter parsing with fallback
- `src/indexing/chunker.ts` - Semantic chunking logic
- `src/indexing/metadata.ts` - Metadata extraction (imports, exports, symbols, complexity)
- `src/types/indexing.ts` - Type definitions (DiscoveredFile, ParsedNode, CodeChunk, ChunkMetadata)
- `tests/unit/indexing/` - Unit tests
- `tests/fixtures/` - Test files for each language

---

## Next Phase

**Phase 3: Embedding & Summary Generation**

- LLM-based file summaries via Ollama (qwen2.5-coder)
- Embedding generation via Ollama (mxbai-embed-large)
- Database persistence with batch inserts
- Symbol extraction and indexing

**✅ Phase 2 must be 100% complete before starting Phase 3.**
