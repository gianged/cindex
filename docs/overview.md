# cindex - RAG MCP for Code Context

**Semantic code search and context retrieval for large codebases (1M+ LoC)**

**NPM Package:** `@gianged/cindex` **Author:** gianged **Project Type:** MCP Server for Claude Code
integration

---

## System Overview

Build a multi-stage retrieval system that progressively narrows from files → precise locations →
contextual code, optimized for Claude Code integration.

### Key Features

- **Semantic Code Search** - Vector embeddings for intelligent code discovery
- **Multi-Stage Retrieval** - Files → chunks → symbols → imports (4-stage pipeline)
- **Incremental Indexing** - Hash-based change detection, re-index only modified files
- **Configurable Models** - Swap embedding/LLM models via environment variables
- **Import Chain Analysis** - Automatic dependency resolution with depth limits
- **Deduplication** - Remove duplicate utility functions from results
- **Large Codebase Support** - Handles 1M+ lines of code efficiently
- **Claude Code Integration** - Native MCP server, plug-and-play with Claude
- **Accuracy-First Design** - Default settings optimized for relevance over speed
- **Flexible Database** - PostgreSQL with configurable connection parameters

### Supported Languages

TypeScript, JavaScript, Python, Java, Go, Rust, C, C++, and more via tree-sitter parsers.

**Tree-sitter Version:** 0.21.1 (Node.js bindings) **Language Parsers:** 0.21.x - 0.22.x (all
verified compatible) **API Reference:** See [docs/syntax.md](./syntax.md) for complete tree-sitter
API documentation

---

## 1. Data Model & Schema

**Database Schema:** See `database.sql` for complete schema definition.

**Note:** When using non-default `EMBEDDING_DIMENSIONS`, update the vector dimension in
`database.sql`:

```sql
-- Change all vector(1024) to match your EMBEDDING_DIMENSIONS
embedding vector(1024)  -- Change 1024 to your dimension
```

### Tables Overview

j **`code_chunks`** - Core embeddings table

- Stores embeddings for code chunks (functions, classes, blocks)
- Includes token counts for context budget management
- Chunk types: `file_summary`, `function`, `class`, `import_block`, `fallback`
- JSONB metadata: function names, complexity, dependencies

**`code_files`** - File-level metadata

- File summaries and embeddings for quick filtering
- SHA256 hash for incremental update detection
- Arrays for imports/exports tracking
- Language and line count metadata

**`code_symbols`** - Symbol registry

- Fast lookup for functions/classes/variables
- Links symbols to file locations
- Embeddings for semantic symbol search

### Key Schema Features

- **Vector dimensions:** 1024 (mxbai-embed-large)
- **Indexes:** HNSW for production (15-45 min build time on 1M vectors with high accuracy settings)
- **Performance tuning:** `hnsw.ef_search = 300` (accuracy priority)
- **Index construction:** `hnsw.ef_construction = 200` (higher quality index, longer build)

---

## Installation

### Via NPM (Recommended)

```bash
npm install -g @gianged/cindex
```

Or use with npx (no installation required):

```bash
npx @gianged/cindex
```

### From Source

```bash
git clone https://github.com/gianged/cindex.git
cd cindex
npm install
npm run build
```

### Quick Start

1. **Install prerequisites:**

   ```bash
   # PostgreSQL with pgvector
   sudo apt install postgresql-16 postgresql-16-pgvector

   # Ollama
   curl https://ollama.ai/install.sh | sh
   ollama pull mxbai-embed-large
   ollama pull qwen2.5-coder:1.5b
   ```

2. **Set up database:**

   ```bash
   createdb cindex_rag_codebase
   psql cindex_rag_codebase < database.sql
   ```

3. **Configure MCP:** Add to `~/.claude.json` (user scope) or `.mcp.json` (project scope)

4. **Start indexing:** Use the `index_repository` tool from Claude Code

---

## 2. MCP Configuration

### Environment Variables

The MCP server is configured via environment variables in the MCP `.json` configuration file. All
settings have sensible defaults but can be overridden.

**MCP Configuration File Locations:**

- **User scope (all projects):** `~/.claude.json` in home directory
- **Project scope (team-shared):** `.mcp.json` in project root

**Configuration Example:**

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "EMBEDDING_MODEL": "mxbai-embed-large",
        "EMBEDDING_DIMENSIONS": "1024",
        "SUMMARY_MODEL": "qwen2.5-coder:3b",
        "OLLAMA_HOST": "http://localhost:11434",
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "cindex_rag_codebase",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "your_password",
        "HNSW_EF_SEARCH": "300",
        "HNSW_EF_CONSTRUCTION": "200",
        "SIMILARITY_THRESHOLD": "0.75",
        "DEDUP_THRESHOLD": "0.92"
      }
    }
  }
}
```

### Environment Variable Reference

#### Model Configuration

- **`EMBEDDING_MODEL`** (default: `mxbai-embed-large`)
  - Ollama embedding model to use
  - Alternatives: `nomic-embed-text`, `mxbai-embed-large`, custom models
  - Must match `EMBEDDING_DIMENSIONS`

- **`EMBEDDING_DIMENSIONS`** (default: `1024`)
  - Vector dimensions for embeddings
  - Must match the model's output dimensions
  - `mxbai-embed-large`: 1024
  - `nomic-embed-text`: 768

- **`SUMMARY_MODEL`** (default: `qwen2.5-coder:1.5b`)
  - Ollama model for generating file summaries
  - Options: `qwen2.5-coder:1.5b` (fast), `qwen2.5-coder:3b` (accurate), `qwen2.5-coder:7b` (best)
  - Set to empty string to disable LLM summaries (use rule-based)

- **`OLLAMA_HOST`** (default: `http://localhost:11434`)
  - Ollama API endpoint
  - Change if running Ollama on different host/port

#### PostgreSQL Configuration

- **`POSTGRES_HOST`** (default: `localhost`)
  - PostgreSQL server hostname or IP

- **`POSTGRES_PORT`** (default: `5432`)
  - PostgreSQL server port
  - Common alternative: `5433` for secondary instances

- **`POSTGRES_DB`** (default: `cindex_rag_codebase`)
  - Database name

- **`POSTGRES_USER`** (default: `postgres`)
  - Database username

- **`POSTGRES_PASSWORD`** (required)
  - Database password
  - No default for security

#### Accuracy/Performance Tuning

- **`HNSW_EF_SEARCH`** (default: `300`)
  - HNSW search quality parameter (40-400)
  - Higher = more accurate, slower queries
  - Accuracy priority: 300
  - Speed priority: 100

- **`HNSW_EF_CONSTRUCTION`** (default: `200`)
  - HNSW index build quality (64-400)
  - Higher = better index quality, longer build time
  - Accuracy priority: 200
  - Speed priority: 64

- **`SIMILARITY_THRESHOLD`** (default: `0.75`)
  - Minimum similarity score for chunk retrieval (0.0-1.0)
  - Higher = fewer but more relevant results
  - Accuracy priority: 0.75
  - Speed priority: 0.70

- **`DEDUP_THRESHOLD`** (default: `0.92`)
  - Similarity threshold for deduplication (0.0-1.0)
  - Lower = more aggressive deduplication
  - Accuracy priority: 0.92
  - Speed priority: 0.95

### Configuration Presets

**Accuracy-First (Default):**

```json
"env": {
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "EMBEDDING_DIMENSIONS": "1024",
  "SUMMARY_MODEL": "qwen2.5-coder:3b",
  "HNSW_EF_SEARCH": "300",
  "HNSW_EF_CONSTRUCTION": "200",
  "SIMILARITY_THRESHOLD": "0.75",
  "DEDUP_THRESHOLD": "0.92"
}
```

**Speed-First (Alternative):**

```json
"env": {
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "EMBEDDING_DIMENSIONS": "1024",
  "SUMMARY_MODEL": "qwen2.5-coder:1.5b",
  "HNSW_EF_SEARCH": "100",
  "HNSW_EF_CONSTRUCTION": "64",
  "SIMILARITY_THRESHOLD": "0.70",
  "DEDUP_THRESHOLD": "0.95"
}
```

**Custom PostgreSQL Port Example:**

```json
"env": {
  "POSTGRES_HOST": "192.168.1.100",
  "POSTGRES_PORT": "5433",
  "POSTGRES_DB": "my_cindex_db",
  "POSTGRES_USER": "rag_user",
  "POSTGRES_PASSWORD": "secure_password"
}
```

**Remote Ollama Setup:**

```json
"env": {
  "OLLAMA_HOST": "http://192.168.1.50:11434",
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "SUMMARY_MODEL": "qwen2.5-coder:7b"
}
```

### Configuration Notes

1. **Model Dimensions Must Match:**
   - If changing `EMBEDDING_MODEL`, update `EMBEDDING_DIMENSIONS`
   - Mismatch will cause vector dimension errors in PostgreSQL

2. **Re-indexing After Model Changes:**
   - Changing `EMBEDDING_MODEL` requires full re-index
   - Changing `SUMMARY_MODEL` only affects new/updated files

3. **HNSW Parameters:**
   - Changes to `HNSW_EF_SEARCH` take effect immediately (runtime parameter)
   - Changes to `HNSW_EF_CONSTRUCTION` require index rebuild

4. **PostgreSQL Connection:**
   - Use connection pooling for production
   - Ensure `POSTGRES_PASSWORD` is kept secure
   - Consider using PostgreSQL environment variables or `.pgpass` file

---

## 3. Indexing Pipeline

### Stage 1: File Discovery & Parsing

```
Input: Codebase path

File Filtering Rules:
- Respect .gitignore patterns (use gitignore parser)
- Always ignore: node_modules, .git, dist, build, coverage, .next, out
- Skip binary files: .png, .jpg, .pdf, .exe, .zip, .so, .dylib
- Skip generated files: package-lock.json, yarn.lock, .min.js, .bundle.js
- Skip documentation: .md, .txt (configurable - see note below)
- Skip large files: >5000 lines (index structure only)
- Include: .ts, .js, .tsx, .jsx, .py, .java, .go, .rs, .c, .cpp, .h, etc.

Process:
1. Walk directory tree with filters applied
2. Compute SHA256 hash for each file (for incremental updates)
3. Detect language per file (by extension + shebang)
4. Parse with tree-sitter for syntax-aware chunking (fallback if unavailable)
5. Extract metadata: imports, exports, symbols

Note on .md files:
- Skip by default (docs don't help code understanding)
- Exception: README.md at repo root (contains high-level architecture)
- Exception: API docs if they contain code examples
- Make configurable via indexing options
```

### Stage 2: Chunking Strategy

```
For each file:
├── File Summary (1 chunk)
│   └── Generate: "This file implements X, exports Y, handles Z"
│   └── Methods (Accuracy Priority):
│       ├── LLM-based: qwen2.5-coder:1.5b or 3b on first 100 lines (preferred, high quality)
│       └── Rule-based fallback: Extract top comment + exports (only if LLM unavailable)
│
├── Import Block (1 chunk if exists)
│   └── All import/require statements grouped
│
├── Semantic Chunks (N chunks)
│   ├── Tree-sitter parsing (preferred):
│   │   ├── Functions: Full function definition + docstring
│   │   ├── Classes: Class definition + public methods
│   │   ├── Top-level code: Logical blocks (not arbitrary splits)
│   │   └── Each chunk: 50-500 lines (aim for complete logical units)
│   │
│   └── Fallback (if tree-sitter fails/unsupported):
│       ├── Sliding window: 200 lines per chunk with 20-line overlap
│       ├── Regex detect function boundaries (language-specific)
│       ├── Break at natural boundaries (blank lines, comments)
│       └── Mark as chunk_type: 'fallback' for quality tracking
│
├── Large File Handling (>1000 lines)
│   ├── Detect major sections (classes, modules, comment headers)
│   ├── Treat each section as logical sub-file
│   ├── Chunk within sections normally
│   └── Files >5000 lines: Index only top-level structure + exports
│
└── Metadata Extraction
    ├── Cyclomatic complexity (functions)
    ├── Dependencies (what this code calls)
    ├── Token count (for context budget: ~4 chars = 1 token estimate)
    └── Line ranges
```

### Stage 3: Embedding Generation

```
For each chunk:
1. Construct enhanced text for embedding:
   - Prepend: file path, language, chunk type
   - Include: actual code + surrounding context (2 lines before/after)
   - Append: extracted symbols/function names

Example input to embedding model:
"FILE: src/auth/login.ts | TYPE: function | LANG: typescript
function authenticateUser(username: string, password: string): Promise<User> {
  // Validates credentials against database
  // Returns User object or throws AuthError
  ...
}
SYMBOLS: authenticateUser, User, AuthError"

2. Generate embedding via Ollama (mxbai-embed-large)
3. Store in appropriate table
```

---

## 4. Retrieval Pipeline (Multi-Stage)

**Query Input:** User's natural language question or code snippet

### Stage 1: File-Level Retrieval (Broad)

```sql
-- Find top 30 most relevant files (more candidates for accuracy)
SELECT
    file_path,
    file_summary,
    1 - (summary_embedding <=> query_embedding) as similarity
FROM code_files
WHERE 1 - (summary_embedding <=> query_embedding) > 0.70  -- Minimum threshold
ORDER BY summary_embedding <=> query_embedding
LIMIT 30; -- Increased from 20 for better coverage
```

### Stage 2: Chunk-Level Retrieval (Precise)

```sql
-- Within top files, find specific code chunks
-- Retrieve more candidates for better filtering (100 instead of 50)
SELECT
    c.file_path,
    c.chunk_content,
    c.start_line,
    c.end_line,
    c.chunk_type,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
FROM code_chunks c
WHERE c.file_path = ANY(top_files_from_stage1)
  AND 1 - (c.embedding <=> query_embedding) > 0.75  -- Higher threshold for accuracy (0.75 vs 0.7)
ORDER BY c.embedding <=> query_embedding
LIMIT 100; -- Retrieve more candidates, filter after deduplication
```

### Stage 3: Symbol Resolution (Dependencies)

```sql
-- For each retrieved chunk, resolve imported symbols
SELECT DISTINCT
    s.symbol_name,
    s.file_path,
    s.line_number,
    s.definition
FROM code_symbols s
WHERE s.symbol_name = ANY(extracted_symbols_from_chunks)
ORDER BY s.symbol_name;
```

### Stage 4: Import Chain Expansion

```
For top N files (N=5-10):
1. Extract all imports from code_files.imports
2. If imported file in indexed repo:
   - Fetch its file summary
   - Fetch specific exported symbol definitions
3. Build import dependency graph
4. Limit traversal depth (default: 3 levels)
   - Level 1: Files directly retrieved
   - Level 2: Their immediate imports
   - Level 3: Second-order imports
   - Stop after depth 3 to prevent runaway expansion
5. Track visited files to avoid circular imports (A→B→A)
6. Mark truncated chains with metadata flag
```

### Stage 5: Deduplication

```
Problem: Utility functions/patterns repeated across files pollute results

Strategy (Post-Ranking):
1. After retrieval, compare chunks pairwise
2. Calculate similarity between chunk embeddings
3. If cosine similarity >0.92: consider duplicates (stricter for accuracy)
4. Keep highest-scoring chunk, discard others
5. Mark discarded chunks with "similar_to" reference
6. Result: Cleaner, non-redundant context for Claude

Alternative: Signature-based dedup
- Hash function signatures (name + parameters)
- Deduplicate exact signature matches during indexing
- Faster but less flexible than embedding-based

Note: Lower threshold (0.92 vs 0.95) catches more near-duplicates
- Better accuracy at cost of potentially missing legitimate variations
- Recommended for accuracy-focused use case
```

---

## 5. Context Assembly for Claude Code

### Context Window Management

```
Token Budget Strategy:
1. Estimate tokens for all retrieved chunks (4 chars ≈ 1 token)
2. Sum total token count from chunk.token_count field
3. Warn if total exceeds 100k tokens (no hard limit - user decides)
4. Priority ranking by relevance score
5. For oversized chunks:
   - Include first 50 lines + last 50 lines
   - Add "...truncated N lines..." marker
   - Preserve function signatures and key logic

Warning Format:
⚠️ Context size: 120,547 tokens (exceeds 100k - may impact performance)
Showing top 30 most relevant locations. Consider narrowing query.
```

### Output Structure

```json
{
  "query": "user's question",
  "warnings": [
    {
      "type": "context_size",
      "severity": "warning",
      "message": "Context size: 127,843 tokens (exceeds 100k)",
      "suggestion": "Consider narrowing query or reducing max_snippets parameter"
    }
  ],
  "metadata": {
    "total_tokens": 127843,
    "files_retrieved": 12,
    "chunks_retrieved": 35,
    "chunks_deduplicated": 8,
    "import_depth_reached": 3,
    "query_time_ms": 420
  },
  "context": {
    "relevant_files": [
      {
        "path": "src/auth/login.ts",
        "summary": "Handles user authentication logic",
        "relevance_score": 0.92,
        "total_lines": 245,
        "language": "typescript",
        "file_hash": "a3f2c8..."
      }
    ],
    "code_locations": [
      {
        "file": "src/auth/login.ts",
        "lines": "45-67",
        "relevance_score": 0.89,
        "chunk_type": "function",
        "context": "function authenticateUser(...)",
        "token_count": 287
      }
    ],
    "imports": {
      "src/auth/login.ts": [
        {
          "symbol": "hashPassword",
          "from": "src/utils/crypto.ts",
          "line": 12,
          "definition": "export function hashPassword(plain: string): string",
          "depth": 1
        }
      ]
    },
    "code_snippets": [
      {
        "file": "src/auth/login.ts",
        "lines": "45-67",
        "code": "function authenticateUser(username: string, password: string): Promise<User> {\n  const hashedInput = hashPassword(password);\n  ...\n}",
        "symbols": ["authenticateUser", "hashPassword", "User"],
        "token_count": 287,
        "truncated": false
      }
    ]
  }
}
```

### Context Formatting for Claude

````markdown
⚠️ **Context Size Warning** Total tokens: 127,843 (exceeds 100k recommended limit) Files: 12 | Code
locations: 35 | Deduplicated: 8 chunks Query time: 420ms

---

# Relevant Code Context

## Files (ranked by relevance)

1. `src/auth/login.ts` (score: 0.92) - Handles user authentication logic [245 lines]
2. `src/utils/crypto.ts` (score: 0.85) - Password hashing utilities [189 lines]

## Key Code Locations

### src/auth/login.ts:45-67 (function: authenticateUser) [287 tokens]

```typescript
function authenticateUser(username: string, password: string): Promise<User> {
  const hashedInput = hashPassword(password);
  const user = await db.users.findOne({ username });
  if (!user || user.password !== hashedInput) {
    throw new AuthError('Invalid credentials');
  }
  return user;
}
```

## Dependencies & Imports (depth: 3)

- `hashPassword` from `src/utils/crypto.ts:12` [depth 1]
  ```typescript
  export function hashPassword(plain: string): string;
  ```
- `bcrypt` from `node_modules/bcrypt` [depth 2] External dependency - not expanded
````

---

## 6. MCP Tools Design

### Tool 1: `search_codebase`

```typescript
{
  name: "search_codebase",
  description: "Semantic search across codebase with multi-stage retrieval",
  inputSchema: {
    query: string,              // Natural language or code snippet
    max_files: number,          // Default: 15 (more candidates for accuracy)
    max_snippets: number,       // Default: 25 (more context for accuracy)
    include_imports: boolean,   // Default: true
    import_depth: number,       // Default: 3 (max levels to traverse)
    dedup_threshold: number,    // Default: 0.92 (stricter for accuracy)
    similarity_threshold: number // Default: 0.75 (higher for quality)
  },
  returns: "Structured context with files, locations, imports, code snippets. Includes token count warning if >100k."
}
```

### Tool 2: `get_file_context`

```typescript
{
  name: "get_file_context",
  description: "Get full context for a specific file including dependencies",
  inputSchema: {
    file_path: string,
    include_callers: boolean,   // Find what calls this file's exports
    include_callees: boolean,   // Find what this file imports
    import_depth: number        // Default: 3 (max traversal depth)
  }
}
```

### Tool 3: `find_symbol_definition`

```typescript
{
  name: "find_symbol_definition",
  description: "Locate definition and usages of a function/class/variable",
  inputSchema: {
    symbol_name: string,
    include_usages: boolean
  }
}
```

### Tool 4: `index_repository`

```typescript
{
  name: "index_repository",
  description: "Index or re-index a codebase",
  inputSchema: {
    repo_path: string,
    incremental: boolean,       // Default: true - only update changed files
    languages: string[],        // Filter by language (empty = all)
    include_markdown: boolean,  // Default: false - skip .md files
    respect_gitignore: boolean, // Default: true
    max_file_size: number,      // Default: 5000 lines (skip larger files)
    summary_method: string      // 'llm' | 'rule-based' (default: 'llm' for accuracy)
  },
  returns: "Indexing progress and statistics. Shows HNSW build progress for large indexes."
}
```

---

## 7. Implementation Priorities

### Phase 1: Core RAG (Week 1)

- PostgreSQL schema setup with file_hash and token_count
- File discovery with gitignore respect and filtering
- Basic indexing: file walking, SHA256 hashing
- Tree-sitter parsing with regex fallback
- LLM-based file summary generation (qwen2.5-coder:1.5b, primary method)
- Embedding generation pipeline (Ollama integration)
- Stage 1+2 retrieval (files + chunks) with accuracy settings (ef_search=300)
- Incremental update logic (hash comparison)

### Phase 2: Symbol Resolution (Week 2)

- Symbol extraction and indexing
- Import chain analysis with depth limits (max: 3)
- Stage 3+4 retrieval (symbols + imports)
- Large file handling (>5000 lines)
- Deduplication strategy (post-ranking, threshold: 0.95)

### Phase 3: MCP Integration (Week 3)

- MCP server with 4 core tools
- Context formatter for Claude Code
- Token counting and 100k warning system
- Testing with real queries
- HNSW index progress tracking

### Phase 4: Optimization (Week 4)

- Query caching
- Incremental indexing with file watching
- Performance tuning (HNSW parameters fine-tuning)
- Rule-based summary fallback (when LLM unavailable)
- Handle edge cases (minified code, generated files)
- Deleted file cleanup automation
- Batch processing optimizations for LLM summaries

---

## 8. Key Technical Decisions

### Embedding Model

**mxbai-embed-large via Ollama**

- 1024 dimensions
- Good code understanding
- Local, no API costs

### File Summary Generation

**LLM-based (primary) + Rule-based fallback**

- LLM: qwen2.5-coder:1.5b or 3b on first 100 lines (preferred, high quality)
- Rule-based fallback: Extract top comment + exports (only if LLM unavailable)
- Single sentence format: "This file does X"
- Accuracy priority: Always use LLM when available

### Chunking

**Tree-sitter based (syntax-aware) with fallback**

- Primary: Tree-sitter respects function/class boundaries
- Fallback: Sliding window (200 lines, 20-line overlap) for unsupported languages
- Includes surrounding context
- Metadata-rich (token counts, line ranges)
- Special handling for files >1000 lines

### Vector Search

**pgvector with HNSW (Accuracy-optimized)**

- Single database (simpler ops than Qdrant)
- `hnsw.ef_search = 300` for maximum accuracy
- `hnsw.ef_construction = 200` for higher quality index
- Cosine distance metric
- Build time: 15-45 minutes for 1M vectors (show progress)
- Trade longer build/query time for better results

### Incremental Updates

**Hash-based change detection**

- SHA256 per file for change detection
- Re-index only changed files
- Automatic deleted file cleanup
- Sub-second re-index for small changes

### Import Depth

**Maximum 3 levels (default)**

- Prevents runaway import chains
- Circular import detection
- Truncation markers for UI feedback

### Deduplication

**Post-ranking, similarity threshold 0.92**

- Compare chunk embeddings after retrieval
- Lower threshold (0.92) catches more near-duplicates for better accuracy
- Keep highest-scoring duplicate
- Prevents utility function pollution
- May filter some legitimate variations (acceptable for accuracy priority)

### Retrieval Settings

**Accuracy-optimized defaults**

- Similarity threshold: 0.75 (higher quality results)
- Max files: 15 (more candidates)
- Max snippets: 25 (richer context)
- Retrieve 100 candidates before dedup/filtering
- Prioritize precision over recall

### Context Window

**Soft limit with warnings**

- Warn at 100k tokens (no hard limit)
- Token estimation: ~4 chars = 1 token
- Priority ranking by relevance
- Smart truncation for oversized chunks

### File Filtering

**Respect gitignore + common patterns**

- Parse and apply .gitignore rules
- Skip: node_modules, dist, build, .min.js, package-lock.json
- Skip: .md files by default (configurable)
- Skip: files >5000 lines (index structure only)
- Skip: binary files

---

## Expected Output Flow

```
User Query: "How does authentication work?"
    ↓
Stage 1: Find relevant files (hash-based cache check)
    → src/auth/login.ts (0.92)
    → src/auth/session.ts (0.87)
    → src/middleware/auth.ts (0.84)
    ↓
Stage 2: Find specific code chunks (with token counting)
    → login.ts:45-67 - authenticateUser() (0.89, 287 tokens)
    → login.ts:120-145 - validateToken() (0.85, 312 tokens)
    → session.ts:30-55 - createSession() (0.83, 265 tokens)
    ↓
Stage 3: Resolve symbols
    → hashPassword from utils/crypto.ts:12
    → User from types/models.ts:8
    → AuthError from errors/auth.ts:15
    ↓
Stage 4: Expand imports (depth 3, circular detection)
    → crypto.ts imports bcrypt (depth 2, external - stop)
    → models.ts defines User interface (depth 2)
    → auth.ts defines error hierarchy (depth 2)
    ↓
Stage 5: Deduplication (threshold 0.95)
    → Found 3 identical `formatDate()` implementations
    → Kept highest-scoring version from utils/date.ts
    → Discarded 2 duplicates, saved ~400 tokens
    ↓
Token Count & Warning:
    → Total: 127,843 tokens
    → ⚠️ Exceeds 100k threshold - warn user
    ↓
Output: Formatted context with all components
    → Warnings displayed prominently
    → Metadata included (files, chunks, dedup count, query time)
    → Ready for Claude Code
```

---

## Edge Cases & Improvements

### Incremental Indexing Flow

```
User triggers re-index:
1. Walk directory, compute file hashes
2. Compare with stored hashes in DB
3. Unchanged files: Skip
4. Changed files: Delete old chunks → Re-parse → Re-embed → Insert
5. Deleted files: Remove from all tables
6. New files: Full indexing pipeline
7. Rebuild HNSW index only if >10% data changed
Result: 10k file repo re-indexes in seconds instead of minutes
```

### Large File Strategy

```
File size categories:
- <1000 lines: Normal chunking
- 1000-5000 lines: Section-based chunking
  → Detect major boundaries (classes, modules)
  → Chunk within sections
- >5000 lines: Structure-only indexing
  → Index file summary + exports
  → Skip detailed chunks (too noisy)
  → Flag as "large file - partial index"
```

### Tree-sitter Fallback Triggers

```
Use regex-based chunking when:
- Language not supported by tree-sitter
- Syntax errors prevent parsing
- File is badly formatted/minified
- Fallback strategy:
  → 200-line sliding window, 20-line overlap
  → Regex detect function starts (language-specific)
  → Break at blank lines/comments when possible
  → Mark chunk_type: 'fallback'
```

### Deduplication Examples

```
Scenario: 10 files each have identical `formatDate()` utility

Without dedup:
- All 10 versions appear in results
- Wastes context window space
- Confuses Claude with redundancy

With dedup (threshold 0.92, accuracy-focused):
- Keep highest-scoring version (most relevant file)
- Discard other 9 (stricter threshold catches more)
- Add metadata: "similar_to: [file1, file2, ...]"
- Result: Clean, focused context
- Trade-off: May occasionally filter legitimate variations
  (acceptable for accuracy-first approach)
```

### Context Window Warning System

```
Token calculation:
1. Sum chunk.token_count for all retrieved chunks
2. Add overhead: file paths, metadata (~5% of total)
3. Total = data_tokens + overhead

Warning levels:
- <50k tokens: ✓ Optimal (no warning)
- 50k-100k: ℹ️ Large context (acceptable)
- >100k: ⚠️ Very large context - may impact performance
- No hard limit - user decides whether to proceed

Output:
⚠️ Context size: 127,843 tokens (exceeds 100k)
Consider narrowing query or reducing max_snippets parameter.
```

### File Filtering Decision Tree

```
Should we index .md files?

Skip .md (default):
✓ Code-focused RAG (most use cases)
✓ Faster indexing
✓ Less noise in results

Include .md (optional):
✓ When docs contain code examples
✓ When README.md has architecture diagrams
✓ API documentation with usage patterns

Recommendation:
- Skip by default
- Whitelist: README.md at repo root only
- Make configurable: include_markdown parameter
```

### Circular Import Handling

```
Scenario: A imports B, B imports C, C imports A

Detection:
1. Track visited files in Set during import expansion
2. Before fetching imports, check if already visited
3. If visited: Skip, mark as circular

Result:
imports: {
  "A.ts": ["B.ts"],
  "B.ts": ["C.ts"],
  "C.ts": ["A.ts (circular - not expanded)"]
}
```

### HNSW Build Progress

```
Problem: Building HNSW on 1M vectors takes 15-25 minutes
User sees: Nothing (looks frozen)

Solution: Progress tracking
1. Use IVFFlat index initially (fast build, slightly slower queries)
2. Show progress: "Building vector index: 45% (450k/1M vectors)"
3. After data insert complete, rebuild as HNSW in background
4. Allow queries during rebuild (use IVFFlat until HNSW ready)
5. Atomic swap: IVFFlat → HNSW when complete

Alternative: Batch progress updates every 10k vectors
```

---

## Performance Targets

### Indexing Performance (Accuracy Priority)

- **Initial indexing**: 300-600 files/minute (slower due to LLM summaries)
- **Incremental re-index**: <15 seconds for 100 changed files
- **HNSW build**: 15-45 minutes for 1M vectors (with high-quality settings + progress tracking)
- **Memory usage**: <3GB RAM for indexing (LLM + embeddings), <500MB for queries

### Query Performance (Accuracy Priority)

- **Typical query latency**: <800ms (slower but more accurate)
  - File-level retrieval: <150ms
  - Chunk-level retrieval: <350ms (more candidates, higher ef_search)
  - Symbol resolution: <150ms
  - Import expansion: <150ms (depth 3)
- **Cold start (first query)**: <3s (includes model warmup + higher computation)

### Accuracy Targets

- **Relevance**: >92% of top 10 results are highly relevant (vs 85% baseline)
- **Deduplication**: >97% of duplicate utilities caught (vs 95%)
- **File summary quality**:
  - LLM-based: 92-95% accurate (default)
  - Rule-based fallback: 70% accurate

### Scale Targets

- **Codebase size**: Handle 1M+ LoC efficiently
- **File count**: 50k+ files indexed
- **Concurrent queries**: 5-8 simultaneous searches (reduced for accuracy)
- **Context quality**: <2% noise in final assembled context (vs 5% baseline)

---

## Next Steps

### Development Environment Setup

1. **MCP Configuration**
   - Create/edit MCP `.json` file (see Section 2 for full reference)
   - Set environment variables for models and database
   - Choose accuracy-first or speed-first preset
2. **PostgreSQL + pgvector**
   - Install PostgreSQL 16+
   - Enable pgvector extension: `CREATE EXTENSION vector;`
   - Create database: `cindex_rag_codebase` (or name specified in config)

3. **Ollama Setup**
   - Install Ollama
   - Pull embedding model: `ollama pull mxbai-embed-large` (or configured model)
   - Pull LLM (required for accuracy): `ollama pull qwen2.5-coder:1.5b` or `qwen2.5-coder:3b`
   - Note: 3b model has better accuracy, 1.5b is faster

4. **TypeScript Environment** (for development)
   - Clone: `git clone https://github.com/gianged/cindex.git`
   - Initialize: `npm install`
   - Core dependencies:
     - `@modelcontextprotocol/sdk` - MCP server framework
     - `pg`, `pgvector` - PostgreSQL client and vector support
     - `tree-sitter` - Syntax-aware code parsing
     - `tree-sitter-typescript`, `tree-sitter-python` - Language parsers
   - Build: `npm run build`

### Initial Implementation Order

1. **Configuration setup** (Day 1)
   - Set up MCP `.json` file with environment variables
   - Configure embedding model, summary model, PostgreSQL connection
   - Test Ollama connectivity and model availability
   - Verify PostgreSQL connection

2. **Schema creation** (Day 1)
   - Run all CREATE TABLE statements
   - Set up indexes (defer HNSW for testing - use IVFFlat first)
   - Test with sample data

3. **File discovery** (Day 2)
   - Implement directory walker with gitignore support
   - File filtering logic (extensions, size limits)
   - SHA256 hashing for each file

4. **Chunking pipeline** (Day 3-4)
   - Tree-sitter integration for TypeScript/JavaScript
   - Regex fallback for unsupported languages
   - LLM-based file summary generation (using configured SUMMARY_MODEL)
   - Token counting for chunks

5. **Embedding generation** (Day 5)
   - Ollama API integration (using configured EMBEDDING_MODEL)
   - Batch processing (handle 100+ files)
   - Progress tracking

6. **Basic retrieval** (Day 6-7)
   - Stage 1: File-level search
   - Stage 2: Chunk-level search
   - Apply configured similarity thresholds
   - Test with small codebase (1k-5k LoC)

7. **Incremental updates** (Week 2 Day 1-2)
   - Hash comparison logic
   - Differential re-indexing
   - Deleted file cleanup

8. **Symbol resolution** (Week 2 Day 3-4)
   - Extract symbols during chunking
   - Build symbol index
   - Import chain traversal with depth limits

9. **MCP server** (Week 3)
   - Implement 4 core tools
   - Context formatting for Claude Code
   - Token warning system
   - Read configuration from environment variables

10. **Optimization** (Week 4)

- HNSW index rebuild (replace IVFFlat)
- Deduplication implementation (using configured threshold)
- Query caching
- Performance tuning

### Testing Strategy

- **Unit tests**: Each stage independently (chunking, embedding, retrieval)
- **Integration tests**: End-to-end query flow
- **Scale tests**:
  - Small: 1k LoC codebase
  - Medium: 50k LoC codebase
  - Large: 200k-1M LoC codebase (your ERP/blog)
- **Edge cases**: Circular imports, large files, minified code

### Success Criteria

- ✅ Index 200k LoC codebase in <45 minutes (slower due to LLM summaries)
- ✅ Re-index 100 changed files in <15 seconds
- ✅ Query returns highly relevant results in <800ms (accuracy over speed)
- ✅ >92% relevance in top 10 results (vs 85% baseline)
- ✅ Context stays under 150k tokens for typical queries
- ✅ Deduplication catches >97% of duplicate utilities (stricter threshold)
- ✅ <2% noise in final context (vs 5% baseline)
- ✅ Works with Claude Code seamlessly

---

## Summary of Key Improvements

### Project Information

- **Package Name:** `@gianged/cindex`
- **Author:** gianged
- **License:** MIT
- **Repository:** https://github.com/gianged/cindex
- **NPM:** https://www.npmjs.com/package/@gianged/cindex

### Critical Features Added

1. **Configurable Models** - Embedding and summary models via environment variables in MCP `.json`
2. **Flexible Database Connection** - PostgreSQL host/port/credentials fully configurable
3. **Incremental Indexing** - Hash-based change detection prevents full re-indexing
4. **File Filtering** - Respects gitignore, skips .md by default, handles large files
5. **Tree-sitter Fallback** - Regex-based chunking when tree-sitter fails
6. **Import Depth Limits** - Max 3 levels to prevent runaway expansion
7. **Deduplication** - Post-ranking similarity check (threshold 0.92)
8. **Context Window Management** - Token counting with 100k warning (no hard limit)
9. **File Summary Generation** - LLM-based (configurable model) with rule-based fallback
10. **Progress Tracking** - HNSW build progress visible to user
11. **Tunable Accuracy/Speed** - All thresholds configurable via environment

### Schema Enhancements

- Added `file_hash` for change detection
- Added `token_count` for context budget management
- Added indexes for performance optimization

### Configuration Options

**All settings configurable via environment variables (see Section 2 for details)**

**Accuracy-Optimized Defaults:**

- `EMBEDDING_MODEL` (default: 'mxbai-embed-large')
- `EMBEDDING_DIMENSIONS` (default: 1024)
- `SUMMARY_MODEL` (default: 'qwen2.5-coder:1.5b')
- `OLLAMA_HOST` (default: 'http://localhost:11434')
- `POSTGRES_HOST` (default: 'localhost')
- `POSTGRES_PORT` (default: 5432)
- `POSTGRES_DB` (default: 'cindex_rag_codebase')
- `HNSW_EF_SEARCH` (default: 300)
- `HNSW_EF_CONSTRUCTION` (default: 200)
- `SIMILARITY_THRESHOLD` (default: 0.75)
- `DEDUP_THRESHOLD` (default: 0.92)
- `import_depth` (default: 3)
- `include_markdown` (default: false)
- `respect_gitignore` (default: true)
- `max_file_size` (default: 5000 lines)

**Performance Trade-offs:**

- Slower indexing (LLM summaries + higher quality HNSW)
- Slower queries (~800ms vs 500ms)
- Higher accuracy (>92% vs >85% relevance)
- Lower noise (<2% vs <5%)

### Output Improvements

- Token count warnings when >100k
- Metadata: query time, dedup count, depth reached
- Structured warnings array
- Truncation markers for large chunks
- Import depth labels

This plan now comprehensively addresses all edge cases for production use with 1M+ LoC codebases.

**Accuracy-First Configuration:**

- All defaults optimized for maximum accuracy over speed
- LLM-based summaries (qwen2.5-coder:1.5b/3b)
- Higher HNSW quality settings (ef_search=300, ef_construction=200)
- Stricter similarity thresholds (0.75 retrieval, 0.92 dedup)
- More retrieval candidates (15 files, 25 snippets, 100 chunks)
- Expected: 60% slower but >92% accuracy vs baseline 85%

**Package Files Included:**

- `README.md` - User-facing documentation and quick start
- `package.json` - NPM package configuration
- `tsconfig.json` - TypeScript compiler configuration
- `.gitignore` - Git ignore patterns
- `.npmignore` - NPM publish ignore patterns
- `LICENSE` - MIT license
- `database.sql` - PostgreSQL schema
- `docs/overview.md` - This document - complete technical documentation
- `docs/syntax.md` - Syntax reference for MCP SDK, pgvector, and tree-sitter
- `CLAUDE.md` - Claude Code internal instructions (not for end users)
- `CONTRIBUTING.md` - Contribution guidelines
- `src/` - TypeScript source code (to be implemented)
- `dist/` - Compiled JavaScript (generated on build)

**Publishing to NPM:**

```bash
npm login
npm publish --access public
```
