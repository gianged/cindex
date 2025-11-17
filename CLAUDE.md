# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

**cindex** is a Model Context Protocol (MCP) server that provides semantic code search and context
retrieval for large codebases (1M+ LoC). It integrates with Claude Code to enable intelligent code
discovery through vector embeddings, multi-stage retrieval, and dependency analysis.

**Package:** `@gianged/cindex` **Type:** MCP Server (TypeScript) **Main Purpose:** RAG
(Retrieval-Augmented Generation) for code understanding

## Key Technologies

- **MCP SDK:** `@modelcontextprotocol/sdk` - MCP server framework
- **Database:** PostgreSQL 16+ with pgvector extension for vector similarity search
- **Embeddings:** Ollama (mxbai-embed-large, 1024 dimensions)
- **LLM Summaries:** Ollama (qwen2.5-coder:1.5b/3b)
- **Code Parsing:** tree-sitter with language-specific parsers
- **Vector Index:** HNSW (Hierarchical Navigable Small World) for production

## Development Commands

```bash
# Build the project
npm run build

# Development mode (watch for changes)
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Start the MCP server (after build)
npm start
```

## Architecture Overview

### Multi-Stage Retrieval Pipeline

The system uses a 4-stage retrieval approach:

1. **File-Level Retrieval:** Find relevant files using summary embeddings
2. **Chunk-Level Retrieval:** Locate specific code chunks (functions/classes) within files
3. **Symbol Resolution:** Resolve imported symbols and their definitions
4. **Import Chain Expansion:** Build dependency graph with depth limits (max 3 levels)

### Indexing Pipeline

1. **File Discovery:** Walk directory tree respecting .gitignore
2. **Parsing:** Tree-sitter for syntax-aware chunking (regex fallback for unsupported languages)
3. **Chunking:** Extract functions, classes, and logical blocks (50-500 lines each)
4. **Summary Generation:** LLM-based file summaries using qwen2.5-coder
5. **Embedding:** Generate vectors via Ollama mxbai-embed-large
6. **Storage:** PostgreSQL with pgvector extension

### MCP Tools (4 Core Tools)

- `search_codebase` - Semantic search with multi-stage retrieval
- `get_file_context` - Full context for specific file with dependencies
- `find_symbol_definition` - Locate function/class/variable definitions
- `index_repository` - Index or re-index codebase (incremental by default)

## Project Structure

```
src/
├── index.ts              # MCP server entry point
├── indexing/             # Code indexing pipeline
│   ├── file-walker.ts    # Directory traversal with .gitignore support
│   ├── chunker.ts        # Semantic code chunking (tree-sitter)
│   ├── embeddings.ts     # Ollama embedding generation
│   └── summary.ts        # LLM-based file summaries
├── retrieval/            # Search and retrieval
│   ├── vector-search.ts  # pgvector similarity search
│   ├── symbol-resolver.ts # Import chain analysis
│   └── deduplicator.ts   # Remove duplicate utility functions
├── database/             # PostgreSQL client
│   ├── client.ts         # Connection pool management
│   └── queries.ts        # SQL queries for retrieval
├── mcp/                  # MCP tool implementations
│   ├── search-codebase.ts
│   ├── get-file-context.ts
│   ├── find-symbol.ts
│   └── index-repository.ts
├── types/                # TypeScript type definitions
├── utils/                # Shared utilities
│   ├── tree-sitter.ts    # Code parsing helpers
│   ├── ollama.ts         # Ollama API client
│   └── logger.ts         # Logging utilities
└── config/               # Configuration
    └── env.ts            # Environment variable handling

tests/
├── unit/                 # Unit tests
├── integration/          # Integration tests
├── e2e/                  # End-to-end tests
├── fixtures/             # Test data
└── helpers/              # Test utilities
```

## Database Schema (database.sql)

Three main tables with vector indexes:

- **`code_chunks`:** Core embeddings for code chunks (functions, classes, blocks)
- **`code_files`:** File-level metadata with summaries and SHA256 hashes
- **`code_symbols`:** Symbol registry for function/class/variable lookups

**Important:** Vector dimensions (1024) must match the embedding model. If changing
`EMBEDDING_MODEL` in MCP config, update all `vector(1024)` declarations in database.sql.

## Configuration via Environment Variables

All settings are configured through environment variables in the MCP config file
(`~/.config/claude/mcp.json`):

### Model Settings

- `EMBEDDING_MODEL` (default: mxbai-embed-large)
- `EMBEDDING_DIMENSIONS` (default: 1024)
- `SUMMARY_MODEL` (default: qwen2.5-coder:1.5b)
- `OLLAMA_HOST` (default: http://localhost:11434)

### Database Settings

- `POSTGRES_HOST` (default: localhost)
- `POSTGRES_PORT` (default: 5432)
- `POSTGRES_DB` (default: cindex_rag_codebase)
- `POSTGRES_USER` (default: postgres)
- `POSTGRES_PASSWORD` (required)

### Accuracy/Performance Tuning

- `HNSW_EF_SEARCH` (default: 300) - Higher = more accurate, slower
- `HNSW_EF_CONSTRUCTION` (default: 200) - Higher = better index quality
- `SIMILARITY_THRESHOLD` (default: 0.75) - Minimum similarity for retrieval
- `DEDUP_THRESHOLD` (default: 0.92) - Similarity threshold for deduplication

## MCP Server Configuration Scopes

Claude Code supports three configuration scopes for MCP servers, allowing you to control where
servers are available:

### User Scope (~/.claude.json)

**Purpose:** Personal MCP servers available across all your projects.

**Use cases:**

- Personal utilities you use frequently (database tools, file managers)
- Development helpers specific to your workflow
- Testing new MCP servers before sharing with team

**Location:** `~/.claude.json` in your home directory

**Example configuration:**

```json
{
  "mcpServers": {
    "my-database-tool": {
      "command": "npx",
      "args": ["-y", "@user/database-mcp"],
      "env": {
        "DB_HOST": "localhost"
      }
    }
  }
}
```

### Project Scope (.mcp.json in project root)

**Purpose:** Team-shared MCP servers specific to this project, checked into version control.

**Use cases:**

- Project dependencies required by all contributors (e.g., context7 for this project)
- Project-specific tools (codebase analyzers, custom integrations)
- Ensures consistent tooling across team members

**Location:** `.mcp.json` in the project root directory

**Example configuration:**

```json
{
  "mcpServers": {
    "cindex": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "POSTGRES_HOST": "${POSTGRES_HOST:-localhost}",
        "POSTGRES_PORT": "${POSTGRES_PORT:-5432}",
        "POSTGRES_DB": "${POSTGRES_DB:-cindex_rag_codebase}",
        "POSTGRES_USER": "${POSTGRES_USER:-postgres}",
        "POSTGRES_PASSWORD": "${POSTGRES_PASSWORD}"
      }
    }
  }
}
```

**Important notes:**

- Use environment variable expansion (`${VAR_NAME:-default}`) for sensitive values
- Add `.mcp.json` to version control for team sharing
- Claude Code prompts for approval before using project-scoped servers (security measure)
- Never commit actual secrets—use environment variable placeholders

### Local Scope (temporary)

**Purpose:** Session-only servers that don't persist.

**Use cases:**

- Quick testing of MCP servers
- Temporary debugging tools
- One-off experiments

**Configuration:** Added via CLI or UI, not persisted to disk.

### Scope Priority

When multiple servers with the same name exist at different scopes:

1. **Local scope** (highest priority) - Temporary session servers
2. **Project scope** - Team-shared servers from `.mcp.json`
3. **User scope** (lowest priority) - Personal servers from `~/.claude.json`

This allows you to override team settings temporarily or test alternatives without affecting other
contributors.

### Best Practices

**User scope:**

- Personal development tools and utilities
- Experimental MCP servers you're testing
- Servers you use across multiple projects

**Project scope:**

- Core dependencies required by the project
- Team-shared integrations (databases, APIs, documentation tools)
- Ensure all team members have consistent tooling

**Security:**

- Never commit API keys or passwords directly in `.mcp.json`
- Use environment variable expansion: `"API_KEY": "${API_KEY}"`
- Add sensitive `.env` files to `.gitignore`
- Document required environment variables in README.md

## Key Implementation Details

### Incremental Indexing

- SHA256 hash per file stored in `code_files.file_hash`
- On re-index: compare hashes, skip unchanged files
- Only re-embed modified files for fast updates

### Deduplication Strategy

- Post-retrieval comparison of chunk embeddings
- If similarity >0.92: keep highest-scoring chunk, discard duplicates
- Prevents utility function pollution in results

### Context Window Management

- Token estimation: ~4 chars = 1 token
- Warn if context >100k tokens (no hard limit)
- Token counts stored in `code_chunks.token_count`

### Import Chain Traversal

- Maximum depth: 3 levels (prevent runaway expansion)
- Circular import detection via visited files tracking
- Mark truncated chains in metadata

### Large File Handling

- <1000 lines: Normal chunking
- 1000-5000 lines: Section-based chunking
- > 5000 lines: Structure-only indexing (summary + exports)

### Tree-sitter Fallback

- Use regex-based chunking if tree-sitter fails
- 200-line sliding window with 20-line overlap
- Mark chunks as `chunk_type: 'fallback'`

## Testing Strategy

When writing tests:

- **Unit tests:** Test each stage independently (chunking, embedding, retrieval)
- **Integration tests:** End-to-end query flow
- **Scale tests:** Test with small (1k LoC), medium (50k LoC), and large (1M+ LoC) codebases
- **Edge cases:** Circular imports, large files, minified code, unsupported languages

Use test fixtures in `tests/fixtures/` for consistent test data.

## Performance Targets

### Accuracy-First Mode (Default)

- **Indexing:** 300-600 files/min (slower due to LLM summaries)
- **Query time:** <800ms
- **Relevance:** >92% in top 10 results
- **Context noise:** <2%

### Speed-First Mode (Alternative)

Set `SUMMARY_MODEL=qwen2.5-coder:1.5b`, `HNSW_EF_SEARCH=100`, `SIMILARITY_THRESHOLD=0.70`

- **Indexing:** 500-1000 files/min
- **Query time:** <500ms
- **Relevance:** >85% in top 10 results

## Important Implementation Notes

### When Adding New Features

1. **Configuration:** Add environment variables to `src/config/env.ts` with sensible defaults
2. **Database Changes:** Update `database.sql` and add migration logic
3. **MCP Tools:** Follow existing tool patterns in `src/mcp/`
4. **Testing:** Add unit tests in `tests/unit/`, integration tests in `tests/integration/`
5. **Documentation:** Update README.md for user-facing changes, this file for implementation details

### Code Quality Standards

- Use TypeScript strict mode (already configured in tsconfig.json)
- Add JSDoc comments for all exported functions
- Follow existing code patterns (arrow functions, async/await)
- Run `npm run lint` and `npm run format` before committing

### Database Operations

- Always use parameterized queries to prevent SQL injection
- Use connection pooling (configured in `src/database/client.ts`)
- Handle vector dimension mismatches gracefully with clear error messages
- Monitor HNSW index build progress for large datasets (15-45 min for 1M vectors)

### Ollama Integration

- Always check model availability before generating embeddings/summaries
- Implement retry logic for temporary failures
- Batch embedding requests (e.g., 100 files at a time)
- Fall back to rule-based summaries if LLM unavailable

### Error Handling

- Provide clear error messages with context (file path, operation, model name)
- Log errors with appropriate severity levels
- Handle common errors: PostgreSQL connection failures, Ollama unavailable, vector dimension
  mismatches
- Never fail silently - always inform user of issues

## Development Workflow

### Setting Up Development Environment

1. Install PostgreSQL 16+ with pgvector:

   ```bash
   sudo apt install postgresql-16 postgresql-16-pgvector
   ```

2. Install Ollama and pull models:

   ```bash
   curl https://ollama.ai/install.sh | sh
   ollama pull mxbai-embed-large
   ollama pull qwen2.5-coder:1.5b
   ```

3. Create development database:

   ```bash
   createdb cindex_rag_codebase_dev
   psql cindex_rag_codebase_dev < database.sql
   ```

4. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

### Testing MCP Server Locally

After building, configure in `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "cindex-dev": {
      "command": "node",
      "args": ["/home/giang/my-projects/cindex/dist/index.js"],
      "env": {
        "POSTGRES_PASSWORD": "your_password",
        "POSTGRES_DB": "cindex_rag_codebase_dev"
      }
    }
  }
}
```

### Debugging

- Use `console.error()` for debugging (outputs to MCP stderr)
- Check MCP logs: Claude Code > Settings > MCP > View Logs
- Test database queries directly in psql before implementing
- Use small test codebases (1k-5k LoC) for faster iteration

## Common Pitfalls to Avoid

1. **Vector Dimension Mismatch:** Always ensure `EMBEDDING_DIMENSIONS` matches the model output
2. **Memory Issues:** Batch large operations (don't load entire codebase into memory)
3. **HNSW Build Time:** Show progress for index builds >1M vectors (15-45 min)
4. **Circular Imports:** Always track visited files to prevent infinite loops
5. **Token Overflow:** Warn users early if context exceeds 100k tokens
6. **Large Files:** Don't try to embed 10k+ line files - use structure-only indexing

## Additional Resources

- **Implementation Plan:** See `docs/overview.md` for complete technical specification
- **README:** User-facing documentation and quick start guide
- **CONTRIBUTING:** Guidelines for contributing to the project
- **Database Schema:** `database.sql` with detailed comments
