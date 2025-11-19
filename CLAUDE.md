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

### Multi-Project Support

**cindex supports three deployment patterns:**

1. **Single Repository** - Traditional RAG for one codebase (base implementation)
2. **Multi-Project** - Index multiple independent repositories, search globally or per-repo
3. **Monorepo/Microservices** - Support workspace packages, service boundaries, and API contracts

**See `docs/overview.md` Section 1.5 for complete multi-project architecture documentation.**

### Multi-Stage Retrieval Pipeline

**Base Pipeline (Single Repository):** 4-stage retrieval approach:

1. **File-Level Retrieval:** Find relevant files using summary embeddings
2. **Chunk-Level Retrieval:** Locate specific code chunks (functions/classes) within files
3. **Symbol Resolution:** Resolve imported symbols and their definitions
4. **Import Chain Expansion:** Build dependency graph with depth limits (max 3 levels)

**Enhanced Pipeline (Multi-Project):** 7-stage retrieval with additional stages:

0. **Scope Filtering:** Filter by repository/service based on search scope (global, repo, service,
   boundary-aware)
1. **File-Level Retrieval** (with repo_id filtering)
2. **Chunk-Level Retrieval** (with repo_id/service_id filtering)
3. **Symbol Resolution** (cross-repository aware)
4. **Import Chain Expansion** (cross-repository dependencies)
5. **API Contract Enrichment:** Include REST/GraphQL/gRPC API definitions
6. **Deduplication** (cross-repository aware)
7. **Context Assembly** (grouped by repository with dependency relationships)

### Indexing Pipeline

1. **File Discovery:** Walk directory tree respecting .gitignore
2. **Parsing:** Tree-sitter for syntax-aware chunking (regex fallback for unsupported languages)
3. **Chunking:** Extract functions, classes, and logical blocks (50-500 lines each)
4. **Summary Generation:** LLM-based file summaries using qwen2.5-coder
5. **Embedding:** Generate vectors via Ollama mxbai-embed-large
6. **Storage:** PostgreSQL with pgvector extension

### MCP Tools

**Base Tools (4 Core):**

- `search_codebase` - Semantic search with multi-stage retrieval
- `get_file_context` - Full context for specific file with dependencies
- `find_symbol_definition` - Locate function/class/variable definitions
- `index_repository` - Index or re-index codebase (incremental by default)

**Multi-Project Tools (Additional 2):**

- `search_api_contracts` - Search REST/GraphQL/gRPC API definitions across services
- `list_indexed_repos` - List all indexed repositories and their services

**Multi-Project Parameters:**

- `search_codebase` gains: `scope`, `repo_id`, `service_id`, `include_dependencies`,
  `include_references`, `include_documentation`
- `index_repository` gains: `repo_id`, `repo_type`, `service_config`, `detect_dependencies`,
  `version`, `force_reindex`

### Reference Repository Support

**cindex supports indexing external frameworks and libraries for learning and reference:**

**Repository Types:**

1. **`monolithic`** - Standard single-application repository (your code)
2. **`microservice`** - Individual microservice repository (your code)
3. **`monorepo`** - Multi-package repository with workspaces (your code)
4. **`library`** - Shared library repository (your own libraries)
5. **`reference`** - External framework/library cloned for learning (e.g., NestJS, React)
6. **`documentation`** - Markdown documentation files (e.g., /docs/libraries/)

**Reference Repository Behavior (`repo_type = 'reference'`):**

- **Lightweight indexing:** Skips workspace detection, service detection, API parsing
- **Excluded from default search:** Won't appear unless explicitly included
- **Lower priority:** Results prioritized below your own code (priority: 0.6 vs 1.0)
- **No cross-linking:** Never auto-linked to your main code dependencies
- **Version tracking:** Supports versioned re-indexing for framework updates

**Documentation Repository Behavior (`repo_type = 'documentation'`):**

- **Markdown-only:** Indexes markdown files, extracts code blocks
- **Fast indexing:** No LLM summaries, very lightweight (1000 files/min)
- **Lowest priority:** Results prioritized below all code (priority: 0.5)
- **Sectioned chunking:** Preserves markdown structure (headings, code blocks)

**Search Behavior:**

- **Default search:** Excludes `reference` and `documentation` repos automatically
- **Include references:** Use `include_references: true` to search framework code
- **Include documentation:** Use `include_documentation: true` to search markdown docs
- **Result grouping:** Results grouped by type (primary code, libraries, references, documentation)
- **Context limits:** Max 5 reference results, max 3 documentation results

**Version Tracking and Re-indexing:**

- Store version in metadata:
  `{ version: 'v10.3.0', upstream_url: 'https://github.com/nestjs/nest' }`
- Automatic re-index decision when version changes
- Use `force_reindex: true` to override version check
- Track last_indexed timestamp for outdated detection

## Current Implementation Status

**What's Complete:** ✅

- **Database Schema** - All tables created with multi-project support (Phase 1: 100%)
- **Type System** - Complete TypeScript type definitions (Phase 1: 100%)
- **Base Indexing** - File discovery, parsing, chunking (Phase 2: 100%)
  - File walker with .gitignore support ✅
  - Tree-sitter parsing for supported languages ✅
  - Semantic chunking (functions, classes, blocks) ✅
  - Metadata extraction (imports, exports, complexity) ✅
  - Workspace detection for monorepos ✅
  - Service detection for microservices ✅
  - Alias resolution (tsconfig paths, npm workspaces) ✅
  - Indexing strategies by repo type ✅
  - Markdown documentation indexing ✅
- **Version Tracking** - Reference repository versioning (Phase 2: 100%)
  - `getRepositoryVersion()`, `updateRepositoryVersion()` ✅
  - `shouldReindex()` with version comparison ✅
  - `clearRepositoryData()` for full re-index ✅
  - `deleteRepository()` with statistics ✅
  - `upsertRepository()`, `getIndexingStats()` ✅
  - `listIndexedRepositories()`, `listReferenceRepositories()` ✅
  - `isRepositoryOutdated()` ✅
- **MCP Tools** - Repository deletion (Phase 5: ~8%)
  - `delete_repository` tool implemented ✅
  - Input validation with fail-fast ✅
  - Deletion statistics per repository ✅

**What's In Progress:** ⚠️

- **Embeddings & Summaries** (Phase 3: ~83%)
  - LLM summary generation via Ollama ✅
  - Embedding generation (mxbai-embed-large) ✅
  - Symbol extraction and indexing ✅
  - Database persistence with batch optimization ✅
  - Progress tracking with ETA calculation ✅
  - Pipeline orchestrator ✅
  - API contract parsing (REST/GraphQL/gRPC) ⚠️ Deferred to Phase 3.1

**What's Planned:** ⚠️
- **Multi-Stage Retrieval** (Phase 4: not started)
  - 7-stage retrieval pipeline
  - Scope filtering (multi-project)
  - Query processing
  - File-level retrieval
  - Chunk-level retrieval
  - Symbol resolution
  - Import chain expansion
  - API contract enrichment
  - Context assembly
- **Remaining MCP Tools** (Phase 5: pending)
  - 12 of 13 tools remaining (search_codebase, get_file_context, find_symbol, index_repository, list_indexed_repos, list_workspaces, list_services, get_workspace_context, get_service_context, find_cross_workspace_usages, find_cross_service_calls, search_api_contracts)
  - Context formatting and error handling
  - Input validation framework
- **Optimization** (Phase 6: not started)
  - Incremental indexing (hash comparison logic)
  - HNSW index optimization
  - Query caching (embeddings + results)
  - Edge case handling
  - Performance monitoring
  - Scale testing

**Overall Completion: ~48%**

- Phase 1: ✅ 100% Complete
- Phase 2: ✅ 100% Complete
- Phase 3: ⚠️ ~83% Complete (Core pipeline done, API parsing deferred)
- Phase 4: ❌ 0% Complete
- Phase 5: ⚠️ ~8% Complete
- Phase 6: ❌ 0% Complete

See `docs/tasks/phase-*.md` for detailed task breakdowns and checklists.

## Project Structure

```
src/
├── index.ts              # MCP server entry point
├── indexing/             # Code indexing pipeline
│   ├── file-walker.ts    # Directory traversal with .gitignore support
│   ├── chunker.ts        # Semantic code chunking (tree-sitter)
│   ├── parser.ts         # Tree-sitter code parsing
│   ├── metadata.ts       # File metadata extraction
│   ├── workspace-detector.ts  # Monorepo workspace detection
│   ├── service-detector.ts    # Microservice detection
│   ├── alias-resolver.ts      # Import alias resolution
│   ├── indexing-strategy.ts   # Repository type indexing strategies
│   ├── markdown-indexer.ts    # Markdown documentation indexing
│   ├── version-tracker.ts     # Version tracking and re-indexing
│   ├── summary.ts        # LLM-based file summary generation
│   ├── embeddings.ts     # Embedding generation with enhanced text
│   ├── symbols.ts        # Symbol extraction and embedding
│   └── orchestrator.ts   # Pipeline coordination (Phases 1-3)
├── retrieval/            # Search and retrieval
│   ├── vector-search.ts  # pgvector similarity search with scope filtering
│   └── deduplicator.ts   # Result prioritization and deduplication
├── database/             # PostgreSQL client
│   ├── client.ts         # Connection pool management
│   └── writer.ts         # Database persistence with batch optimization
├── mcp/                  # MCP tool implementations (future)
│   ├── search-codebase.ts
│   ├── get-file-context.ts
│   ├── find-symbol.ts
│   └── index-repository.ts
├── types/                # TypeScript type definitions
│   ├── database.ts       # Database schema types
│   ├── config.ts         # Configuration types
│   ├── workspace.ts      # Workspace detection types
│   ├── service.ts        # Service detection types
│   ├── indexing.ts       # Indexing pipeline types
│   └── mcp-tools.ts      # MCP tool types
├── utils/                # Shared utilities
│   ├── ollama.ts         # Ollama API client
│   ├── logger.ts         # Logging utilities
│   ├── errors.ts         # Error handling
│   └── progress.ts       # Progress tracking with ETA
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

### Base Tables (Single Repository)

Three main tables with vector indexes:

- **`code_chunks`:** Core embeddings for code chunks (functions, classes, blocks)
- **`code_files`:** File-level metadata with summaries and SHA256 hashes
- **`code_symbols`:** Symbol registry for function/class/variable lookups

### Multi-Project Tables (Extension)

Additional tables for multi-project/monorepo/microservice support:

- **`repositories`:** Multi-repository registry (repo_id, repo_type, workspace_config)
- **`services`:** Service registry with API contracts (service_id, service_type, api_endpoints
  JSONB)
- **`workspaces`:** Monorepo package/workspace tracking (workspace_id, package_name, tsconfig_paths)
- **`workspace_aliases`:** Import alias resolution (@workspace/pkg → filesystem path)
- **`cross_repo_dependencies`:** Cross-service dependency tracking (source→target, api_contracts)
- **`workspace_dependencies`:** Internal monorepo dependencies

**Column Extensions:** All base tables (`code_chunks`, `code_files`, `code_symbols`) have additional
columns:

- `repo_id` - Repository identifier for filtering
- `workspace_id` - Workspace identifier (monorepos)
- `package_name` - Package name from package.json
- `service_id` - Service identifier (microservices)

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

### Import Conventions

**IMPORTANT: Always use path aliases, never relative imports.**

**See [docs/syntax.md](docs/syntax.md) for MCP SDK, pgvector, and tree-sitter syntax references.**

#### Path Aliases (configured in tsconfig.json)

- `@/*` - Root src directory (use for types: `@/types/indexing`)
- `@config/*` - Config directory
- `@database/*` - Database directory
- `@indexing/*` - Indexing directory
- `@retrieval/*` - Retrieval directory
- `@mcp/*` - MCP tools directory
- `@types/*` - Types directory (alternative to `@/types/*`)
- `@utils/*` - Utils directory

#### Import Grouping Standard

**Always group imports in this order:**

1. External packages (npm dependencies)
2. Blank line
3. Internal imports (path aliases: @config, @database, @indexing, etc.)
4. Blank line (optional)
5. Type-only imports (if separated)

**Example from [src/index.ts](src/index.ts):**

```typescript
// 1. External packages (with .js extension for ESM modules like MCP SDK)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 2. Blank line

// 3. Internal imports (path aliases, NO extensions)
import { loadConfig, validateConfig } from '@config/env';
import { createDatabaseClient } from '@database/client';
import { CindexError } from '@utils/errors';
import { initLogger, logger } from '@utils/logger';
import { createOllamaClient } from '@utils/ollama';
```

#### MCP SDK Import Patterns

**For MCP SDK packages, include `.js` extension (ESM requirement):**

```typescript
// ✅ Correct - MCP SDK imports WITH .js extension
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ❌ Wrong - Missing .js extension
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
```

**See [docs/syntax.md](docs/syntax.md) for complete MCP SDK patterns including:**
- Tool registration
- Resource registration
- Prompt registration
- Transport setup
- Client usage

#### Type Import Style (ESLint: `consistent-type-imports` with `inline-type-imports`)

**IMPORTANT: Always use inline `type` keyword and combine duplicate imports from the same module.**

```typescript
// ✅ Correct - Inline type keyword for all types
import { type WorkspaceConfig } from '@indexing/workspace-detector';
import { type CindexConfig } from '@/types/config';

// ✅ Correct - Mixed imports: use inline 'type' keyword
import { createDatabaseClient, type DatabaseConfig } from '@database/client';
import { ChunkType, NodeType, type ParseResult } from '@/types/indexing';

// ✅ Correct - Combine duplicate imports from same module
import { type DiscoveredFile, type ParseResult, type ParsedNode, type NodeType, type ExtractedSymbol } from '@/types/indexing';

// ❌ Wrong - Separate import type statements from same module
import type { DiscoveredFile, ParseResult } from '@/types/indexing';
import type { ExtractedSymbol } from '@/types/indexing';

// ✅ No file extensions (.ts, .js) for internal imports
import { logger } from '@utils/logger'; // ✅ Correct
import { logger } from '@utils/logger.js'; // ❌ Wrong

// ❌ Never use relative imports
import { logger } from '../utils/logger'; // ❌ Wrong
import { type EmbeddingGenerator } from './embeddings'; // ❌ Wrong
import { type EmbeddingGenerator } from '@indexing/embeddings'; // ✅ Correct
```

#### Node.js Built-in Imports: Always use `node:` protocol prefix

```typescript
// ❌ Wrong - Missing node: prefix
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ✅ Correct - With node: prefix
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
```

#### Example: Complete Import Block

From [src/indexing/symbols.ts](src/indexing/symbols.ts):

```typescript
// Node.js built-ins
import { randomUUID } from 'node:crypto';

// Blank line

// Internal imports with inline type keywords (combined from same module)
import { type DiscoveredFile, type ParseResult, type ParsedNode, type NodeType, type ExtractedSymbol } from '@/types/indexing';
import { type EmbeddingGenerator } from '@indexing/embeddings';
import { logger } from '@utils/logger';
```

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

## Reference Repository Usage Examples

### Example 1: Index NestJS as Reference

```typescript
// Index NestJS framework for learning patterns
await index_repository({
  repo_path: '/home/user/references/nestjs',
  repo_id: 'nestjs-v10',
  repo_type: 'reference',
  metadata: {
    upstream_url: 'https://github.com/nestjs/nest',
    version: 'v10.3.0',
    indexed_for: 'learning',
  },
});

// Result: Fast indexing (~500 files/min)
// - Skips workspace/service detection
// - Includes markdown docs
// - Structure-focused summaries
```

### Example 2: Index Markdown Documentation

```typescript
// Index library documentation markdown files
await index_repository({
  repo_path: '/home/user/my-project/docs/libraries',
  repo_id: 'library-docs',
  repo_type: 'documentation',
});

// Result: Very fast indexing (~1000 files/min)
// - Markdown-only
// - Preserves section structure
// - Extracts code blocks
```

### Example 3: Search Your Code (Default)

```typescript
// Default search: excludes references and documentation
await search_codebase({
  query: 'authentication implementation',
  scope: 'repository',
  repo_id: 'my-app',
});

// Returns: Only results from your main codebase
// - Priority 1.0 for your code
// - No reference or documentation results
```

### Example 4: Search Including References

```typescript
// Search your code + reference frameworks
await search_codebase({
  query: 'how to implement guards in NestJS',
  scope: 'global',
  include_references: true,
});

// Returns: Your code first, then reference examples
// - Your code: priority 1.0
// - NestJS reference: priority 0.6
// - Max 5 reference results
// - Grouped by repo type
```

### Example 5: Re-index on Version Update

```typescript
// Pull latest NestJS version
// git pull (in nestjs directory)

// Re-index with new version
await index_repository({
  repo_path: '/home/user/references/nestjs',
  repo_id: 'nestjs-v10',
  repo_type: 'reference',
  version: 'v11.0.0', // Version changed
  force_reindex: true, // Clear old data first
});

// Result: Automatic version comparison
// - Detects version change (v10.3.0 → v11.0.0)
// - Clears old index data
// - Re-indexes with new version
```

### Example 6: Mixed Workflow

```typescript
// Setup: Index your project + references + docs
await index_repository({
  repo_path: '/workspace/my-erp',
  repo_id: 'my-erp',
  repo_type: 'monolithic',
});

await index_repository({
  repo_path: '/references/nestjs',
  repo_id: 'nestjs-ref',
  repo_type: 'reference',
  metadata: { upstream_url: 'https://github.com/nestjs/nest', version: 'v10.3.0' },
});

await index_repository({
  repo_path: '/workspace/my-erp/docs/libraries',
  repo_id: 'lib-docs',
  repo_type: 'documentation',
});

// Search 1: Only your code (default)
await search_codebase({
  query: 'user authentication',
  scope: 'repository',
  repo_id: 'my-erp',
});
// → Returns: my-erp code only

// Search 2: Your code + references when learning
await search_codebase({
  query: 'how to implement guards',
  scope: 'global',
  include_references: true,
});
// → Returns: my-erp code (priority 1.0) + nestjs-ref (priority 0.6)

// Search 3: Include documentation
await search_codebase({
  query: 'API usage examples',
  scope: 'global',
  include_documentation: true,
});
// → Returns: my-erp code + lib-docs markdown
```

### Example 7: List Indexed Repositories

```typescript
// Get all indexed repositories with version info
await list_indexed_repos();

// Returns:
// [
//   {
//     repo_id: "my-erp",
//     repo_type: "monolithic",
//     file_count: 450,
//     last_indexed: "2025-01-15T10:30:00Z"
//   },
//   {
//     repo_id: "nestjs-ref",
//     repo_type: "reference",
//     file_count: 850,
//     version: "v10.3.0",
//     upstream_url: "https://github.com/nestjs/nest",
//     last_indexed: "2025-01-10T14:20:00Z"
//   },
//   {
//     repo_id: "lib-docs",
//     repo_type: "documentation",
//     file_count: 25,
//     last_indexed: "2025-01-14T09:15:00Z"
//   }
// ]
```

## Common Pitfalls to Avoid

1. **Vector Dimension Mismatch:** Always ensure `EMBEDDING_DIMENSIONS` matches the model output
2. **Memory Issues:** Batch large operations (don't load entire codebase into memory)
3. **HNSW Build Time:** Show progress for index builds >1M vectors (15-45 min)
4. **Circular Imports:** Always track visited files to prevent infinite loops
5. **Token Overflow:** Warn users early if context exceeds 100k tokens
6. **Large Files:** Don't try to embed 10k+ line files - use structure-only indexing

## Multi-Project Development Guidance

When implementing features for multi-project/monorepo/microservice support:

### 1. Repository ID Management

**Always require `repo_id` for multi-project operations:**

```typescript
// Good: Explicit repo_id parameter
await indexRepository({
  repo_path: '/workspace/auth-service',
  repo_id: 'auth-service', // REQUIRED for multi-project
  repo_type: 'microservice',
});

// Bad: Assumes single repository
await indexRepository({
  repo_path: '/workspace/auth-service',
  // Missing repo_id
});
```

### 2. Search Scope Implementation

**Implement scope filtering in Stage 0 of retrieval pipeline:**

```typescript
// Stage 0: Determine repo_id filter list
const repoFilter = await determineSearchScope({
  scope: "boundary-aware",
  start_repo: "payment-service",
  dependency_depth: 2
});
// Returns: ['payment-service', 'auth-service', 'notification-service']

// Stage 1: Apply filter to file retrieval
SELECT * FROM code_files
WHERE repo_id = ANY($1)  -- Use the repo filter
  AND 1 - (summary_embedding <=> $2) > 0.70;
```

### 3. API Contract Parsing

**When adding API contract parsing:**

1. **Detect API spec files during indexing:**
   - OpenAPI/Swagger: `openapi.yaml`, `swagger.json`
   - GraphQL: `schema.graphql`, `*.graphql`
   - gRPC: `*.proto`

2. **Parse and store in JSONB:**

   ```typescript
   const apiSpec = parseOpenAPI('./openapi.yaml');
   await db.query(
     `
     UPDATE services
     SET api_endpoints = $1
     WHERE service_id = $2
   `,
     [JSON.stringify(apiSpec), serviceId]
   );
   ```

3. **Link API definitions to implementation:**
   ```typescript
   // Store implementation reference in api_endpoints
   {
     "endpoint": "/api/auth/login",
     "method": "POST",
     "implementation_file": "src/controllers/auth.ts",
     "implementation_lines": "45-67"
   }
   ```

### 4. Cross-Service Dependency Detection

**Detect service calls in code during indexing:**

```typescript
// Pattern detection examples
const patterns = {
  http: /fetch\(['"]https?:\/\/([^\/]+)(\/[^'"]*)['"]/g,
  grpc: /new\s+(\w+)Client\(['"]([^:]+):(\d+)['"]/g,
  graphql: /query:\s*gql`\s*(?:query|mutation)\s+(\w+)/g,
};

// When detected, populate cross_repo_dependencies
await db.query(
  `
  INSERT INTO cross_repo_dependencies (
    source_repo_id, target_repo_id, dependency_type, api_contracts
  ) VALUES ($1, $2, 'api', $3)
`,
  [sourceRepo, targetRepo, JSON.stringify({ endpoint, method })]
);
```

### 5. Workspace Alias Resolution (Monorepos)

**When implementing monorepo support:**

```typescript
// Parse workspace config (package.json, pnpm-workspace.yaml, nx.json)
const workspaces = parseWorkspaceConfig('./package.json');
// Example: ["packages/*", "apps/*"]

// Resolve aliases during import chain expansion
const resolveImport = async (importPath: string, currentRepo: string) => {
  if (importPath.startsWith('@workspace/')) {
    // Query workspace_aliases table
    const alias = await db.query(
      `
      SELECT resolved_path FROM workspace_aliases
      WHERE repo_id = $1 AND alias_pattern = $2
    `,
      [currentRepo, importPath]
    );
    return alias.resolved_path;
  }
  // Handle tsconfig paths, custom aliases, etc.
};
```

### 6. Deduplication Across Repositories

**Be careful with cross-repo deduplication:**

```typescript
// Same utility in different repos may be INTENTIONAL
// Tag duplicates instead of removing
if (similarity > DEDUP_THRESHOLD) {
  if (chunk1.repo_id === chunk2.repo_id) {
    // Same repo: likely duplicate, remove lower-scoring
    removeChunk(lowerScoringChunk);
  } else {
    // Different repos: may be intentional, TAG instead
    tagChunk(chunk2, {
      similar_to: chunk1.id,
      similar_repo: chunk1.repo_id,
      note: 'Similar utility exists in another repository',
    });
  }
}
```

### 7. Query Context Assembly

**Group results by repository with metadata:**

```typescript
const assembleContext = (chunks: Chunk[]) => {
  const groupedByRepo = groupBy(chunks, 'repo_id');

  return {
    primary_service: {
      repo: startRepo,
      chunks: groupedByRepo[startRepo],
    },
    dependencies: otherRepos.map((repo) => ({
      repo,
      depth: calculateDepth(repo, startRepo),
      relationship: describeRelationship(repo, startRepo),
      api_contracts: getAPIContracts(repo),
      chunks: groupedByRepo[repo],
    })),
  };
};
```

### 8. Testing Multi-Project Features

**Create test fixtures for multi-project scenarios:**

```typescript
// tests/fixtures/multi-project/
// ├── auth-service/
// │   ├── src/
// │   └── openapi.yaml
// ├── payment-service/
// │   ├── src/
// │   └── schema.graphql
// └── shared-lib/
//     └── src/

// Test cross-repo search
test('boundary-aware search includes dependencies', async () => {
  await indexRepository({ repo_id: 'auth-service', ... });
  await indexRepository({
    repo_id: 'payment-service',
    detect_dependencies: true,
    dependency_repos: ['auth-service']
  });

  const results = await searchCodebase({
    query: 'payment processing',
    scope: 'boundary-aware',
    start_repo: 'payment-service',
    include_dependencies: true
  });

  expect(results.dependencies).toContainEqual(
    expect.objectContaining({ repo: 'auth-service' })
  );
});
```

### 9. Database Queries Best Practices

**Always use parameterized queries with repo filters:**

```typescript
// Good: Parameterized with repo filter
const chunks = await db.query(
  `
  SELECT * FROM code_chunks
  WHERE repo_id = ANY($1)
    AND 1 - (embedding <=> $2) > $3
  ORDER BY embedding <=> $2
  LIMIT $4
`,
  [repoIds, queryEmbedding, threshold, limit]
);

// Bad: String concatenation, no repo filter
const chunks = await db.query(`
  SELECT * FROM code_chunks
  WHERE 1 - (embedding <=> ${queryEmbedding}) > ${threshold}
  LIMIT ${limit}
`);
```

### 10. Implementation Priority for Multi-Project

When implementing multi-project features, follow this order:

1. **Phase 1:** Basic multi-repo indexing (repo_id column population)
2. **Phase 2:** Repository-scoped search (scope=repository parameter)
3. **Phase 3:** Cross-repo dependency detection (parse imports/service calls)
4. **Phase 4:** Boundary-aware search (dependency graph traversal)
5. **Phase 5:** API contract parsing and indexing
6. **Phase 6:** Service-scoped search and API contract search
7. **Phase 7:** Monorepo support (workspaces, aliases)

**Key Principle:** Build incrementally. Each phase should work independently and add value.

### 11. Multi-Language Monorepo Development

**Key Architecture Principle:** Different languages in a monorepo are tracked as separate workspaces with API-based communication, not code imports.

#### Workspace Language Detection

Each workspace must identify its primary language for correct parser selection:

```typescript
// Implement in workspace-detector.ts
const detectWorkspaceLanguage = (workspacePath: string): string => {
  const indicators = {
    typescript: ['package.json', 'tsconfig.json'],
    python: ['requirements.txt', 'pyproject.toml', 'setup.py'],
    go: ['go.mod'],
    java: ['pom.xml', 'build.gradle'],
    rust: ['Cargo.toml'],
    ruby: ['Gemfile'],
    php: ['composer.json']
  };

  for (const [lang, files] of Object.entries(indicators)) {
    for (const file of files) {
      if (existsSync(join(workspacePath, file))) {
        return lang;
      }
    }
  }

  return 'unknown';
};

// Store in workspaces table
await db.query(`
  INSERT INTO workspaces (workspace_id, package_name, workspace_path, primary_language)
  VALUES ($1, $2, $3, $4)
`, [workspaceId, packageName, workspacePath, primaryLanguage]);
```

#### Cross-Language Communication Detection

**Critical Rule:** Never attempt to resolve imports across different languages. Treat cross-language communication as API calls.

```typescript
// Detect API calls instead of imports
const detectCrossLanguageAPICalls = async (chunk: CodeChunk): Promise<void> => {
  // Parse HTTP client usage in code
  const apiCalls = parseAPIEndpoints(chunk.code);

  for (const call of apiCalls) {
    // Resolve which workspace owns this endpoint
    const targetWorkspace = await resolveAPIEndpoint(call.endpoint);

    if (targetWorkspace && targetWorkspace.primary_language !== chunk.workspace_language) {
      // Store as cross-service dependency (API type, not import type)
      await db.query(`
        INSERT INTO cross_repo_dependencies (
          source_repo_id, source_workspace_id,
          target_repo_id, target_workspace_id,
          dependency_type, api_contracts
        ) VALUES ($1, $2, $3, $4, 'api', $5)
      `, [
        chunk.repo_id, chunk.workspace_id,
        targetWorkspace.repo_id, targetWorkspace.workspace_id,
        JSON.stringify({ endpoint: call.endpoint, method: call.method })
      ]);
    }
  }
};

// Example patterns to detect:
const apiPatterns = {
  // JavaScript/TypeScript
  fetch: /fetch\(['"]([^'"]+)['"]/g,
  axios: /axios\.(get|post|put|delete)\(['"]([^'"]+)['"]/g,
  // Python
  requests: /requests\.(get|post|put|delete)\(['"]([^'"]+)['"]/g,
  httpx: /httpx\.(get|post|put|delete)\(['"]([^'"]+)['"]/g,
  // Go
  httpGet: /http\.Get\("([^"]+)"\)/g,
  httpPost: /http\.Post\("([^"]+)"/g
};
```

#### Import Chain Expansion Rules

**Rule:** Stop import chain expansion at language boundaries.

```typescript
const shouldExpandImport = (currentFile: FileMetadata, importedFile: FileMetadata): boolean => {
  // Check if files belong to same-language workspace
  if (currentFile.workspace_language === importedFile.workspace_language) {
    return true;  // ✅ Same language - expand normally
  }

  // Different languages = impossible to import
  logger.info('Import chain stopped at language boundary', {
    from: `${currentFile.file_path} (${currentFile.workspace_language})`,
    to: `${importedFile.file_path} (${importedFile.workspace_language})`,
    reason: 'Cross-language imports not possible'
  });

  return false;  // ❌ Different language - don't expand
};

// Example import chain
// frontend/src/UserList.tsx (TypeScript)
//   → import './services/user.service' ✅ Expand (TypeScript → TypeScript)
//     → import './api-client' ✅ Expand (TypeScript → TypeScript)
//       → fetch('/api/users') ❌ STOP (TypeScript → Python API)
//                                Treat as API call, not import
```

#### Example Implementation: Python Backend + TypeScript Frontend

```typescript
// Monorepo structure
my-fullstack-app/
├── apps/
│   ├── backend/     # Python (FastAPI)
│   │   ├── requirements.txt
│   │   ├── main.py
│   │   └── openapi.yaml
│   └── frontend/    # TypeScript (React)
│       ├── package.json
│       └── src/
│           └── api/
│               └── client.ts

// 1. Workspace Detection Result
{
  workspaces: [
    {
      workspace_id: 'backend',
      primary_language: 'python',
      package_manager: 'pip',
      root_path: 'apps/backend'
    },
    {
      workspace_id: 'frontend',
      primary_language: 'typescript',
      package_manager: 'npm',
      root_path: 'apps/frontend'
    }
  ]
}

// 2. Indexing Process
// Backend (Python) - Use Python parser
parseFile('apps/backend/main.py', {
  language: 'python',
  workspace_id: 'backend',
  workspace_language: 'python'
});

// Frontend (TypeScript) - Use TypeScript parser
parseFile('apps/frontend/src/api/client.ts', {
  language: 'typescript',
  workspace_id: 'frontend',
  workspace_language: 'typescript'
});

// 3. Cross-Language API Call Detection
// File: apps/frontend/src/api/client.ts
const code = `
export const fetchUsers = async () => {
  return fetch('/api/users');  // ← Detected as API call
};
`;

// Detected API call stored as:
{
  source_workspace_id: 'frontend',
  target_workspace_id: 'backend',  // Resolved from endpoint
  dependency_type: 'api',
  api_contracts: {
    endpoint: '/api/users',
    method: 'GET'
  }
}

// 4. Search Behavior
await search_codebase({
  query: 'user fetching',
  scope: 'repository',
  repo_id: 'my-fullstack-app'
});

// Returns (grouped by workspace):
{
  results: [
    {
      workspace: 'frontend',
      language: 'typescript',
      chunks: [
        {file: 'src/api/client.ts', function: 'fetchUsers'}
      ]
    },
    {
      workspace: 'backend',
      language: 'python',
      chunks: [
        {file: 'main.py', function: 'get_users'}
      ],
      api_contract: {endpoint: '/api/users', method: 'GET'}
    }
  ]
}
```

#### Testing Multi-Language Monorepos

**Test 1: Language Detection**
```typescript
test('detects Python workspace correctly', async () => {
  const workspace = await detectWorkspace('/monorepo/apps/backend');
  expect(workspace.primary_language).toBe('python');
  expect(workspace.package_manager).toBe('pip');
});

test('detects TypeScript workspace correctly', async () => {
  const workspace = await detectWorkspace('/monorepo/apps/frontend');
  expect(workspace.primary_language).toBe('typescript');
  expect(workspace.package_manager).toBe('npm');
});
```

**Test 2: Cross-Language API Call Detection**
```typescript
test('detects API call from TypeScript to Python', async () => {
  await indexRepository({
    repo_path: '/monorepo',
    repo_type: 'monorepo'
  });

  const deps = await db.query(`
    SELECT * FROM cross_repo_dependencies
    WHERE source_workspace_id = 'frontend'
      AND target_workspace_id = 'backend'
      AND dependency_type = 'api'
  `);

  expect(deps.rows).toHaveLength(1);
  expect(deps.rows[0]?.api_contracts).toMatchObject({
    endpoint: '/api/users',
    method: 'GET'
  });
});
```

**Test 3: Import Expansion Stops at Language Boundaries**
```typescript
test('does not expand imports across languages', async () => {
  const results = await searchCodebase({
    query: 'user authentication',
    scope: 'repository',
    repo_id: 'my-fullstack-app'
  });

  // Frontend results should NOT include Python backend files
  const frontendResults = results.chunks.filter(c => c.workspace_id === 'frontend');
  const hasBackendImports = frontendResults.some(c =>
    c.imports?.some(imp => imp.workspace_id === 'backend')
  );

  expect(hasBackendImports).toBe(false);

  // But should have API contract links
  expect(frontendResults[0]?.api_calls).toContainEqual(
    expect.objectContaining({endpoint: '/api/users'})
  );
});
```

**Test 4: Workspace-Scoped Search Respects Language**
```typescript
test('workspace search returns only matching language', async () => {
  const results = await searchCodebase({
    query: 'user service',
    scope: 'workspace',
    workspace_id: 'backend'
  });

  // Should only return Python files
  results.chunks.forEach(chunk => {
    expect(chunk.language).toBe('python');
    expect(chunk.workspace_id).toBe('backend');
  });
});
```

#### Error Handling

**Don't fail on mixed-language workspaces:**
```typescript
const detectWorkspaceLanguage = (workspacePath: string): string => {
  const languages = [];

  if (existsSync(join(workspacePath, 'package.json'))) languages.push('typescript');
  if (existsSync(join(workspacePath, 'requirements.txt'))) languages.push('python');

  if (languages.length > 1) {
    logger.warn('Mixed-language workspace detected', {
      workspace: workspacePath,
      languages,
      action: 'Using first detected language'
    });
  }

  return languages[0] ?? 'unknown';
};
```

**Log cross-language import attempts (for debugging):**
```typescript
if (currentFile.workspace_language !== importedFile.workspace_language) {
  logger.debug('Cross-language reference detected', {
    from: currentFile.file_path,
    from_language: currentFile.workspace_language,
    to: importedFile.file_path,
    to_language: importedFile.workspace_language,
    note: 'This should be an API call, not a code import'
  });
}
```

**Critical Reminder:** Never attempt to resolve imports across different languages. Cross-language communication MUST be tracked as API calls, not import dependencies.

## Additional Resources

- **Implementation Plan:** See `docs/overview.md` for complete technical specification
- **README:** User-facing documentation and quick start guide
- **CONTRIBUTING:** Guidelines for contributing to the project
- **Database Schema:** `database.sql` with detailed comments
