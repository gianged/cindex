# cindex

**Semantic code search and context retrieval for large codebases**

A Model Context Protocol (MCP) server that provides intelligent code search and context retrieval
for Claude Code. Handles 1M+ lines of code with accuracy-first design.

## Features

- **Semantic Search** - Vector embeddings for intelligent code discovery
- **Multi-Stage Retrieval** - Files → chunks → symbols → imports
- **Incremental Indexing** - Only re-index changed files
- **Configurable Models** - Swap embedding/LLM models via env vars
- **Import Chain Analysis** - Automatic dependency resolution
- **Deduplication** - Remove duplicate utility functions
- **Large Codebase Support** - Efficiently handles 1M+ LoC
- **Claude Code Integration** - Native MCP server
- **Accuracy-First** - Default settings optimized for relevance
- **Flexible Database** - PostgreSQL with configurable connection

## Supported Languages

**12 languages** with full tree-sitter parsing: TypeScript, JavaScript, Python, Java, Go, Rust, C,
C++, C#, PHP, Ruby, Kotlin. Swift and other languages use regex fallback parsing.

## Prerequisites

Before installing cindex, you need:

### 1. PostgreSQL with pgvector

PostgreSQL 16+ with pgvector extension for vector similarity search:

```bash
# Ubuntu/Debian
sudo apt install postgresql-16 postgresql-16-pgvector

# macOS
brew install postgresql@16 pgvector

# Start PostgreSQL
sudo systemctl start postgresql  # Linux
brew services start postgresql@16  # macOS
```

### 2. Ollama with Models

Ollama for local LLM inference with two models:

**Embedding Model** (for vector generation):

```bash
# Install Ollama
curl https://ollama.ai/install.sh | sh

# Pull embedding model (bge-m3:567m recommended)
ollama pull bge-m3:567m
```

**Coding Model** (for file summaries and analysis):

```bash
# Pull coding model (qwen2.5-coder:7b recommended)
ollama pull qwen2.5-coder:7b

# Alternative for faster indexing (lower quality):
# ollama pull qwen2.5-coder:1.5b
```

**Model Options:**

- **Embedding**: bge-m3:567m (1024 dims, 8K context) - Best accuracy
- **Summary**: qwen2.5-coder:7b (32K context) - High quality, RTX 4060+ recommended
- **Summary**: qwen2.5-coder:3b (32K context) - Balanced
- **Summary**: qwen2.5-coder:1.5b (32K context) - Fast indexing, lower quality

## Installation

### Database Setup

Create and initialize the cindex database:

```bash
# Create database
createdb cindex_rag_codebase

# Initialize schema (after installing cindex - see next section)
```

### Install MCP Server

Add cindex to Claude Code using the CLI. You can install for personal use (user scope) or share with
your team (project scope).

#### Quick Install (Personal Use)

Install for all your projects:

```bash
claude mcp add cindex --scope user --transport stdio \
  --env POSTGRES_PASSWORD="your_password" \
  -- npx -y @gianged/cindex
```

#### Team Install (Shared via Git)

Install for the current project (creates `.mcp.json` in project root):

```bash
claude mcp add cindex --scope project --transport stdio \
  --env POSTGRES_PASSWORD="your_password" \
  -- npx -y @gianged/cindex
```

**Note:** For project scope, set `POSTGRES_PASSWORD` as an environment variable on your system and
reference it in the command. Never commit actual secrets to version control.

#### Custom Configuration

Add additional environment variables using multiple `--env` flags:

```bash
claude mcp add cindex --scope user --transport stdio \
  --env POSTGRES_PASSWORD="your_password" \
  --env POSTGRES_HOST="localhost" \
  --env POSTGRES_DB="cindex_rag_codebase" \
  --env EMBEDDING_MODEL="bge-m3:567m" \
  --env SUMMARY_MODEL="qwen2.5-coder:7b" \
  -- npx -y @gianged/cindex
```

See [Environment Variables](#environment-variables) section below for all available configuration
options.

#### Manual Configuration (Alternative)

If you prefer to manually edit configuration files, you can add cindex to:

**User Scope** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "POSTGRES_PASSWORD": "your_password"
      }
    }
  }
}
```

**Project Scope** (`.mcp.json` in project root):

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
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

### Initialize Database Schema

After configuring MCP, initialize the database schema:

```bash
# Download schema file
curl -o database.sql https://raw.githubusercontent.com/gianged/cindex/main/database.sql

# Apply schema
psql cindex_rag_codebase < database.sql
```

### Start Using

1. Open Claude Code
2. Use the `index_repository` tool to index your codebase
3. Use `search_codebase` to find relevant code

## Environment Variables

All configuration is done through environment variables in your MCP config file.

### Model Configuration

| Variable                   | Default                  | Range         | Description                                      |
| -------------------------- | ------------------------ | ------------- | ------------------------------------------------ |
| `EMBEDDING_MODEL`          | `bge-m3:567m`            | -             | Ollama embedding model for vector generation     |
| `EMBEDDING_DIMENSIONS`     | `1024`                   | 1-4096        | Vector dimensions (must match model output)      |
| `EMBEDDING_CONTEXT_WINDOW` | `4096`                   | 512-131072    | Token limit for embedding model                  |
| `SUMMARY_MODEL`            | `qwen2.5-coder:7b`       | -             | Ollama model for file summaries                  |
| `SUMMARY_CONTEXT_WINDOW`   | `4096`                   | 512-131072    | Token limit for summary model                    |
| `OLLAMA_HOST`              | `http://localhost:11434` | -             | Ollama API endpoint                              |
| `OLLAMA_TIMEOUT`           | `30000`                  | 1000-300000   | Request timeout in milliseconds                  |

**Context Window Notes:**

- Default 4096 matches Ollama's default and is sufficient (cindex uses first 100 lines per file)
- Higher values = more VRAM usage + slower inference
- qwen2.5-coder:7b supports up to 32K tokens
- bge-m3:567m supports up to 8K tokens
- Increase only if you encounter issues with large files

### Database Configuration

| Variable                   | Default               | Range   | Description                     |
| -------------------------- | --------------------- | ------- | ------------------------------- |
| `POSTGRES_HOST`            | `localhost`           | -       | PostgreSQL server hostname      |
| `POSTGRES_PORT`            | `5432`                | 1-65535 | PostgreSQL server port          |
| `POSTGRES_DB`              | `cindex_rag_codebase` | -       | Database name                   |
| `POSTGRES_USER`            | `postgres`            | -       | Database user                   |
| `POSTGRES_PASSWORD`        | _required_            | -       | Database password (must be set) |
| `POSTGRES_MAX_CONNECTIONS` | `10`                  | 1-100   | Maximum connection pool size    |

### Performance Tuning

| Variable               | Default | Range     | Description                                          |
| ---------------------- | ------- | --------- | ---------------------------------------------------- |
| `HNSW_EF_SEARCH`       | `300`   | 10-1000   | HNSW search quality (higher = more accurate, slower) |
| `HNSW_EF_CONSTRUCTION` | `200`   | 10-1000   | HNSW index quality (higher = better index)           |
| `SIMILARITY_THRESHOLD` | `0.75`  | 0.0-1.0   | Minimum similarity for retrieval                     |
| `DEDUP_THRESHOLD`      | `0.92`  | 0.0-1.0   | Similarity threshold for deduplication               |
| `IMPORT_DEPTH`         | `3`     | 1-10      | Maximum import chain traversal depth                 |
| `WORKSPACE_DEPTH`      | `2`     | 1-10      | Maximum workspace dependency depth                   |
| `SERVICE_DEPTH`        | `1`     | 1-10      | Maximum service dependency depth                     |

### Indexing Configuration

| Variable           | Default | Range       | Description                        |
| ------------------ | ------- | ----------- | ---------------------------------- |
| `MAX_FILE_SIZE`    | `5000`  | 100-100000  | Maximum file size in lines         |
| `INCLUDE_MARKDOWN` | `false` | true/false  | Include markdown files in indexing |

### Feature Flags

| Variable                        | Default | Range      | Description                             |
| ------------------------------- | ------- | ---------- | --------------------------------------- |
| `ENABLE_WORKSPACE_DETECTION`    | `true`  | true/false | Detect monorepo workspaces              |
| `ENABLE_SERVICE_DETECTION`      | `true`  | true/false | Detect microservices                    |
| `ENABLE_MULTI_REPO`             | `false` | true/false | Enable multi-repository support         |
| `ENABLE_API_ENDPOINT_DETECTION` | `true`  | true/false | Parse API contracts (REST/GraphQL/gRPC) |

## Example Configurations

### Minimal Configuration

Only the required password:

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "POSTGRES_PASSWORD": "your_password"
      }
    }
  }
}
```

### Full Configuration

All available settings with defaults shown:

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "EMBEDDING_MODEL": "bge-m3:567m",
        "EMBEDDING_DIMENSIONS": "1024",
        "EMBEDDING_CONTEXT_WINDOW": "4096",
        "SUMMARY_MODEL": "qwen2.5-coder:7b",
        "SUMMARY_CONTEXT_WINDOW": "4096",
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

### Speed-First Configuration

For faster indexing with lower quality:

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "POSTGRES_PASSWORD": "your_password",
        "SUMMARY_MODEL": "qwen2.5-coder:1.5b",
        "SUMMARY_CONTEXT_WINDOW": "4096",
        "HNSW_EF_SEARCH": "100",
        "HNSW_EF_CONSTRUCTION": "64",
        "SIMILARITY_THRESHOLD": "0.70",
        "DEDUP_THRESHOLD": "0.95"
      }
    }
  }
}
```

**Performance:**

- **Indexing**: 500-1000 files/min (vs 300-600 files/min default)
- **Query Time**: <500ms (vs <800ms default)
- **Relevance**: >85% in top 10 results (vs >92% default)

## Managing Configuration

### Verify Installation

List all installed MCP servers:

```bash
claude mcp list
```

View cindex configuration:

```bash
claude mcp get cindex
```

### Update Configuration

To update environment variables, remove and re-add with new settings:

```bash
claude mcp remove cindex
claude mcp add cindex --scope user --transport stdio \
  --env POSTGRES_PASSWORD="your_password" \
  --env SUMMARY_MODEL="qwen2.5-coder:3b" \
  -- npx -y @gianged/cindex
```

### Switch to Speed-First Mode

For faster indexing with lower quality, use these settings:

```bash
claude mcp remove cindex
claude mcp add cindex --scope user --transport stdio \
  --env POSTGRES_PASSWORD="your_password" \
  --env SUMMARY_MODEL="qwen2.5-coder:1.5b" \
  --env HNSW_EF_SEARCH="100" \
  --env HNSW_EF_CONSTRUCTION="64" \
  --env SIMILARITY_THRESHOLD="0.70" \
  --env DEDUP_THRESHOLD="0.95" \
  -- npx -y @gianged/cindex
```

**Performance:**

- **Indexing**: 500-1000 files/min (vs 300-600 files/min default)
- **Query Time**: <500ms (vs <800ms default)
- **Relevance**: >85% in top 10 results (vs >92% default)

### Remove Server

```bash
claude mcp remove cindex
```

## MCP Tools

**Status: 1 of 13 tools implemented (Phase 5 in progress)**

### Core Tools (Planned)

- `search_codebase` - Semantic search with multi-stage retrieval
- `get_file_context` - Full context for specific file with dependencies
- `find_symbol_definition` - Locate function/class/variable definitions
- `index_repository` - Index or re-index codebase

### Specialized Tools (Planned)

- `list_indexed_repos` - List all indexed repositories
- `list_workspaces` - List monorepo workspaces
- `list_services` - List detected microservices
- `get_workspace_context` - Get workspace-specific context
- `get_service_context` - Get service-specific context
- `find_cross_workspace_usages` - Find cross-workspace dependencies
- `find_cross_service_calls` - Find cross-service API calls
- `search_api_contracts` - Search API definitions (REST/GraphQL/gRPC)

### Implemented Tools

- `delete_repository` - Delete indexed repository data

See [docs/overview.md](./docs/overview.md) for complete tool documentation including
multi-project/monorepo/microservice support.

## Architecture

### Multi-Stage Retrieval

1. **File-Level** - Find relevant files via summary embeddings
2. **Chunk-Level** - Locate specific code chunks (functions/classes)
3. **Symbol Resolution** - Resolve imported symbols and dependencies
4. **Import Expansion** - Build dependency graph (max 3 levels)
5. **Deduplication** - Remove redundant code from results

### Indexing Pipeline

1. File discovery (respects .gitignore)
2. Tree-sitter parsing (with regex fallback)
3. Semantic chunking (functions, classes, blocks)
4. LLM-based file summaries (configurable model)
5. Embedding generation (configurable model)
6. PostgreSQL + pgvector storage

## Performance Characteristics

### Accuracy-First Mode (Default)

- **Indexing**: 300-600 files/min
- **Query Time**: <800ms
- **Relevance**: >92% in top 10 results
- **Context Noise**: <2%

### Speed-First Mode

- **Indexing**: 500-1000 files/min
- **Query Time**: <500ms
- **Relevance**: >85% in top 10 results

## System Requirements

- **Node.js** 22+ (for MCP server)
- **PostgreSQL** 16+ with pgvector extension
- **Ollama** with models installed
- **Disk Space**: ~1GB per 100k LoC indexed
- **RAM**: 8GB minimum (16GB+ recommended for large codebases)
- **GPU**: Optional but recommended (RTX 3060+ for qwen2.5-coder:7b)

## Troubleshooting

### "Vector dimension mismatch"

Update `EMBEDDING_DIMENSIONS` in MCP config to match your model, then update vector dimensions in
`database.sql`.

### "Connection refused" to PostgreSQL

Check `POSTGRES_HOST` and `POSTGRES_PORT` in MCP config. Verify PostgreSQL is running:

```bash
sudo systemctl status postgresql  # Linux
brew services list  # macOS
```

### "Model not found" in Ollama

Pull the required models:

```bash
ollama pull bge-m3:567m
ollama pull qwen2.5-coder:7b
```

Verify models are available:

```bash
ollama list
```

### Slow indexing

- Use smaller summary model: `qwen2.5-coder:1.5b` instead of `7b`
- Reduce `HNSW_EF_CONSTRUCTION` to `64`
- Enable incremental indexing (default)

### Low accuracy results

- Increase `HNSW_EF_SEARCH` to `300-400`
- Raise `SIMILARITY_THRESHOLD` to `0.75-0.80`
- Use better summary model: `qwen2.5-coder:3b` or `7b`
- Lower `DEDUP_THRESHOLD` to `0.90-0.92`

## Documentation

See [docs/overview.md](./docs/overview.md) for detailed documentation including:

- Complete architecture details
- Database schema
- Configuration reference
- Implementation guide
- Performance tuning

## Development

```bash
git clone https://github.com/gianged/cindex.git
cd cindex
npm install
npm run build
npm test
```

## Implementation Status

- Phase 1 (100%) - Database schema & type system
- Phase 2 (100%) - File discovery, parsing, chunking, workspace/service detection
- Phase 3 (100%) - Embeddings, summaries, API parsing, 12-language support, Docker/serverless/mobile
  detection
- Phase 4 (0%) - Multi-stage retrieval pipeline (planned)
- Phase 5 (8%) - MCP tools (1 of 13 implemented)
- Phase 6 (0%) - Incremental indexing, optimization (planned)

**Overall: ~58% complete**

## License

MIT

## Author

**gianged** - Yup, it's me

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## Acknowledgments

Built with:

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [pgvector](https://github.com/pgvector/pgvector) for vector search
- [Ollama](https://ollama.ai/) for local LLM inference
- [tree-sitter](https://tree-sitter.github.io/) for code parsing
