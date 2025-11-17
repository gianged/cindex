# Phase 2: Core Indexing Pipeline

**Estimated Duration:** 4-5 days **Priority:** Critical - Foundation for all retrieval functionality

---

## Overview

Build the complete indexing pipeline that transforms a codebase into structured, parseable chunks
ready for embedding. This phase delivers file discovery, syntax-aware parsing, semantic chunking,
and metadata extraction.

---

## Checklist

### 1. File Discovery & Filtering

#### Setup

- [ ] Install `ignore` package (gitignore parser)
- [ ] Install `uuid` package (chunk IDs)

#### File Walker Implementation

- [ ] Create `src/indexing/file-walker.ts`
- [ ] Implement recursive directory traversal
- [ ] Parse `.gitignore` file
- [ ] Apply gitignore patterns during traversal
- [ ] Filter out hardcoded patterns:
  - [ ] `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.next/`, `out/`
  - [ ] Binary files: `.png`, `.jpg`, `.pdf`, `.exe`, `.zip`, `.so`, `.dylib`
  - [ ] Generated files: `package-lock.json`, `*.min.js`, `*.bundle.js`
  - [ ] Lock files: `Gemfile.lock`, `Pipfile.lock`, `poetry.lock`
- [ ] Compute SHA256 hash for each file
- [ ] Detect language by file extension
- [ ] Count lines per file
- [ ] Extract file modification time
- [ ] Handle `include_markdown` option (default: false, except README.md)
- [ ] Handle `max_file_size` option (default: 5000 lines)

#### Language Support

- [ ] Detect TypeScript (`.ts`, `.tsx`)
- [ ] Detect JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)
- [ ] Detect Python (`.py`, `.pyw`)
- [ ] Detect Java (`.java`)
- [ ] Detect Go (`.go`)
- [ ] Detect Rust (`.rs`)
- [ ] Detect C/C++ (`.c`, `.cpp`, `.h`, `.hpp`)
- [ ] Detect Ruby (`.rb`)
- [ ] Detect PHP (`.php`)
- [ ] Detect C# (`.cs`)
- [ ] Detect Swift (`.swift`)
- [ ] Detect Kotlin (`.kt`)

### 2. Tree-sitter Parsing

#### Dependencies

- [ ] Install `tree-sitter`
- [ ] Install `tree-sitter-typescript`
- [ ] Install `tree-sitter-python`
- [ ] Install `tree-sitter-java`
- [ ] Install `tree-sitter-go`
- [ ] Install `tree-sitter-rust`
- [ ] Install `tree-sitter-c`
- [ ] Install `tree-sitter-cpp`
- [ ] Install `tree-sitter-ruby`
- [ ] Install `tree-sitter-php`
- [ ] Install `tree-sitter-c-sharp`

#### Parser Implementation

- [ ] Create `src/indexing/parser.ts`
- [ ] Initialize tree-sitter parser for each language
- [ ] Generate syntax tree from source code
- [ ] Extract function definitions
  - [ ] Function name
  - [ ] Parameters
  - [ ] Return type
  - [ ] Docstring/comments
  - [ ] Start/end line
- [ ] Extract class definitions
  - [ ] Class name
  - [ ] Methods
  - [ ] Properties
  - [ ] Start/end line
- [ ] Extract import statements
- [ ] Extract export statements
- [ ] Extract top-level variables
- [ ] Extract interface/type definitions (TypeScript)
- [ ] Handle syntax errors gracefully
- [ ] Fall back to regex parsing on error
- [ ] Log parsing failures

### 3. Semantic Chunking

#### Chunker Implementation

- [ ] Create `src/indexing/chunker.ts`
- [ ] Implement file summary chunk (1 per file)
  - [ ] Use first 100 lines or entire file
  - [ ] Mark as `chunk_type: 'file_summary'`
- [ ] Implement import block chunk (0-1 per file)
  - [ ] Group all imports together
  - [ ] Mark as `chunk_type: 'import_block'`
- [ ] Implement function chunking
  - [ ] One chunk per function
  - [ ] Include docstring
  - [ ] Mark as `chunk_type: 'function'`
- [ ] Implement class chunking
  - [ ] One chunk per class
  - [ ] Include all methods
  - [ ] Mark as `chunk_type: 'class'`
- [ ] Implement top-level code blocks
  - [ ] Group by logical boundaries
  - [ ] Mark as `chunk_type: 'block'`
- [ ] Enforce chunk size constraints:
  - [ ] Target: 50-500 lines
  - [ ] Merge small chunks (<50 lines)
  - [ ] Split large chunks (>500 lines) at boundaries
  - [ ] Minimum: 10 lines
- [ ] Calculate token count (estimate: 4 chars ≈ 1 token)
- [ ] Generate unique chunk ID (UUID)

#### Large File Handling

- [ ] Detect files 1000-5000 lines
  - [ ] Split into major sections
  - [ ] Chunk within sections
- [ ] Detect files >5000 lines
  - [ ] Index structure only (summary + exports)
  - [ ] Skip detailed chunking
  - [ ] Mark `large_file: true`
  - [ ] Log warning

#### Fallback Chunking

- [ ] Implement regex-based fallback
  - [ ] Sliding window: 200 lines per chunk
  - [ ] Overlap: 20 lines
  - [ ] Detect function boundaries with regex
  - [ ] Mark as `chunk_type: 'fallback'`
- [ ] Language-specific regex patterns:
  - [ ] JavaScript/TypeScript function detection
  - [ ] Python function detection
  - [ ] Java method detection

### 4. Metadata Extraction

#### Import/Export Parsing

- [ ] Create `src/indexing/metadata.ts`
- [ ] Parse TypeScript/JavaScript imports
  - [ ] `import { x, y } from './file'`
  - [ ] `import * as util from 'lodash'`
  - [ ] `import React from 'react'`
- [ ] Parse Python imports
  - [ ] `from utils import foo, bar`
  - [ ] `import numpy as np`
- [ ] Parse TypeScript/JavaScript exports
  - [ ] `export function foo() {}`
  - [ ] `export { User, Session }`
  - [ ] `export default X`
- [ ] Parse Python exports
  - [ ] `__all__ = ['foo', 'bar']`

#### Symbol Extraction

- [ ] Extract function names
- [ ] Extract class names
- [ ] Extract variable names (top-level)
- [ ] Extract type/interface names (TypeScript)
- [ ] Store in chunk metadata

#### Complexity Calculation

- [ ] Count decision points:
  - [ ] `if`, `else`
  - [ ] `while`, `for`
  - [ ] `case`, `switch`
  - [ ] `&&`, `||`, `?`
  - [ ] `catch`
- [ ] Calculate: `complexity = decisions + 1`
- [ ] Store in chunk metadata

#### Dependency Analysis

- [ ] Parse function calls within chunk
- [ ] Match against imported symbols
- [ ] Track used imports
- [ ] Store in `metadata.dependencies`

### 5. Testing

#### Unit Tests

- [ ] Test file discovery on fixture directory
- [ ] Test gitignore pattern application
- [ ] Test binary file exclusion
- [ ] Test SHA256 hash calculation
- [ ] Test language detection
- [ ] Test TypeScript parsing
- [ ] Test Python parsing
- [ ] Test function extraction
- [ ] Test class extraction
- [ ] Test import parsing
- [ ] Test export parsing
- [ ] Test chunk size constraints
- [ ] Test token counting
- [ ] Test fallback chunking
- [ ] Test metadata extraction
- [ ] Test complexity calculation

#### Integration Tests

- [ ] Test end-to-end file processing (TypeScript)
- [ ] Test end-to-end file processing (Python)
- [ ] Test large file handling (>5000 lines)
- [ ] Test gitignore filtering
- [ ] Test malformed code fallback

#### Test Fixtures

- [ ] Create `tests/fixtures/sample.ts` (well-formed TypeScript)
- [ ] Create `tests/fixtures/sample.py` (well-formed Python)
- [ ] Create `tests/fixtures/large.ts` (6000+ lines)
- [ ] Create `tests/fixtures/malformed.js` (syntax errors)
- [ ] Create `tests/fixtures/repo-with-gitignore/` (with .gitignore)
- [ ] Create `tests/fixtures/minimal.js` (<50 lines)

---

## Success Criteria

**Phase 2 is complete when ALL items below are checked:**

- [ ] File discovery walks directory recursively
- [ ] .gitignore patterns applied correctly
- [ ] Binary files excluded
- [ ] Generated files excluded
- [ ] SHA256 hash computed for each file
- [ ] Language detected for all supported extensions
- [ ] Line count accurate
- [ ] Tree-sitter parsers load for all languages
- [ ] Functions extracted with correct boundaries
- [ ] Classes extracted with all methods
- [ ] Import statements parsed
- [ ] Export statements parsed
- [ ] Chunks sized 50-500 lines (where possible)
- [ ] Import block chunk created when imports exist
- [ ] File summary chunk created for every file
- [ ] Token count estimated for each chunk
- [ ] Metadata extracted (functions, classes, symbols)
- [ ] Cyclomatic complexity calculated
- [ ] Fallback chunking works on parse errors
- [ ] Large files (>5000 lines) indexed structure-only
- [ ] No chunks smaller than 10 lines (except imports)
- [ ] Chunk types assigned correctly
- [ ] All chunks have unique UUIDs
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (logger, config)
- [ ] Tree-sitter libraries installed
- [ ] Language parsers installed

---

## Output Artifacts

- [ ] `src/indexing/file-walker.ts` - File discovery
- [ ] `src/indexing/parser.ts` - Tree-sitter parsing
- [ ] `src/indexing/chunker.ts` - Semantic chunking
- [ ] `src/indexing/metadata.ts` - Metadata extraction
- [ ] `src/types/indexing.ts` - Type definitions
- [ ] `tests/unit/indexing/` - Unit tests
- [ ] `tests/fixtures/` - Test files

---

## Next Phase

**Phase 3 builds on chunked code:**

- File summary chunks → LLM summary generation
- All chunks → Embedding generation via Ollama
- Chunks + embeddings → Database insertion

**✅ Phase 2 must be 100% complete before starting Phase 3.**
