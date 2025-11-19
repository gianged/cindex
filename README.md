# cindex

**Semantic code search and context retrieval for large codebases**

A Model Context Protocol (MCP) server that provides intelligent code search and context retrieval for Claude Code. Handles 1M+ lines of code with accuracy-first design.

## Features

- 🔍 **Semantic Search** - Vector embeddings for intelligent code discovery
- 🎯 **Multi-Stage Retrieval** - Files → chunks → symbols → imports
- ⚡ **Incremental Indexing** - Only re-index changed files
- 🔧 **Configurable Models** - Swap embedding/LLM models via env vars
- 🌳 **Import Chain Analysis** - Automatic dependency resolution
- 🎨 **Deduplication** - Remove duplicate utility functions
- 📊 **Large Codebase Support** - Efficiently handles 1M+ LoC
- 🤖 **Claude Code Integration** - Native MCP server
- 🎓 **Accuracy-First** - Default settings optimized for relevance
- 🗄️ **Flexible Database** - PostgreSQL with configurable connection

## Supported Languages

TypeScript, JavaScript, Python, Java, Go, Rust, C, C++, and more via tree-sitter parsers.

## Quick Start

### Prerequisites

```bash
# PostgreSQL with pgvector
sudo apt install postgresql-16 postgresql-16-pgvector

# Ollama
curl https://ollama.ai/install.sh | sh
ollama pull mxbai-embed-large
ollama pull qwen2.5-coder:1.5b
```

### Installation

```bash
npm install -g @gianged/cindex
```

Or use with npx (no installation):

```bash
npx @gianged/cindex
```

### Database Setup

```bash
createdb cindex_rag_codebase
psql cindex_rag_codebase < node_modules/@gianged/cindex/database.sql
```

### Configure MCP

Add to `~/.claude.json` (user scope - all projects):

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

**Configuration Scopes:**
- **User scope** (shown above): `~/.claude.json` - Available across all your projects
- **Project scope**: `.mcp.json` in project root - Team-shared via git, allows environment variable expansion

> **Note:** MCP servers are only recognized in `~/.claude.json` (user scope) or `.mcp.json` (project scope). Other config files are ignored for MCP.

### Start Using

1. Open Claude Code
2. Use the `index_repository` tool to index your codebase
3. Use `search_codebase` to find relevant code

## Configuration

All settings are configurable via environment variables in MCP config:

### Model Settings

```json
"env": {
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "EMBEDDING_DIMENSIONS": "1024",
  "SUMMARY_MODEL": "qwen2.5-coder:3b",
  "OLLAMA_HOST": "http://localhost:11434"
}
```

### Database Settings

```json
"env": {
  "POSTGRES_HOST": "localhost",
  "POSTGRES_PORT": "5432",
  "POSTGRES_DB": "cindex_rag_codebase",
  "POSTGRES_USER": "postgres",
  "POSTGRES_PASSWORD": "your_password"
}
```

### Accuracy/Performance Tuning

```json
"env": {
  "HNSW_EF_SEARCH": "300",              // Higher = more accurate, slower
  "HNSW_EF_CONSTRUCTION": "200",        // Higher quality index
  "SIMILARITY_THRESHOLD": "0.75",       // Higher = stricter matching
  "DEDUP_THRESHOLD": "0.92"             // Lower = more deduplication
}
```

## MCP Tools

**13 Tools Available:**
- **4 Core Tools:** search_codebase, get_file_context, find_symbol_definition, index_repository
- **9 Specialized Tools:** list_indexed_repos, list_workspaces, list_services, get_workspace_context, get_service_context, find_cross_workspace_usages, find_cross_service_calls, search_api_contracts, delete_repository

See [docs/overview.md Section 1.5](./docs/overview.md) for complete tool documentation including multi-project/monorepo/microservice support.

---

### `search_codebase`

Semantic search with multi-stage retrieval

- Natural language queries
- Code snippet search
- Returns files, locations, imports, and code snippets

### `get_file_context`

Get full context for a specific file

- Include callers/callees
- Dependency analysis
- Import chain traversal

### `find_symbol_definition`

Locate definitions and usages

- Function/class/variable lookup
- Usage tracking across codebase

### `index_repository`

Index or re-index a codebase

- Incremental updates (default)
- Language filtering
- Progress tracking

**Repository Types:**
- `monolithic` - Single application codebase
- `monorepo` - Multi-package workspace (Turborepo, Nx, pnpm)
- `microservice` - Individual service repository
- `library` - Shared library (your own packages)
- `reference` - External framework for learning (NestJS, React, Vue)
- `documentation` - Markdown documentation repository

**Reference Repository Indexing:**

When indexing external frameworks or libraries for learning:

```json
{
  "repo_type": "reference",
  "version": "v10.3.0",
  "force_reindex": false,
  "metadata": {
    "upstream_url": "https://github.com/nestjs/nest",
    "indexed_for": "learning"
  }
}
```

**Search with References:**

```json
{
  "query": "how to implement guards",
  "scope": "global",
  "include_references": true,
  "include_documentation": true,
  "max_reference_results": 5,
  "max_documentation_results": 3
}
```

- `include_references` - Include reference repos in search (default: false)
- `include_documentation` - Include documentation repos (default: false)
- Reference results have lower priority (0.6 vs 1.0 for your code)
- Documentation results have lowest priority (0.5)

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

## Performance

### Accuracy-First Mode (Default)

- **Indexing**: 300-600 files/min
- **Query Time**: <800ms
- **Relevance**: >92% in top 10 results
- **Context Noise**: <2%

### Speed-First Mode

Set these environment variables:

```json
"env": {
  "SUMMARY_MODEL": "qwen2.5-coder:1.5b",
  "HNSW_EF_SEARCH": "100",
  "SIMILARITY_THRESHOLD": "0.70",
  "DEDUP_THRESHOLD": "0.95"
}
```

- **Indexing**: 500-1000 files/min
- **Query Time**: <500ms
- **Relevance**: >85% in top 10 results

## Requirements

- **Node.js** 22+ (for MCP server)
- **PostgreSQL** 16+ with pgvector extension
- **Ollama** (for embeddings and LLM)
- **Disk Space**: ~1GB per 100k LoC indexed

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

## License

MIT

## Author

**gianged** - Full-stack developer and IT infrastructure specialist

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## Troubleshooting

### "Vector dimension mismatch"

Update `EMBEDDING_DIMENSIONS` in MCP config to match your model, then update `database.sql` vector dimensions.

### "Connection refused" to PostgreSQL

Check `POSTGRES_HOST` and `POSTGRES_PORT` in MCP config. Default is `localhost:5432`.

### "Model not found" in Ollama

Pull the required models:

```bash
ollama pull mxbai-embed-large
ollama pull qwen2.5-coder:1.5b
```

### Slow indexing

- Use smaller summary model: `qwen2.5-coder:1.5b` instead of `3b`
- Reduce `HNSW_EF_CONSTRUCTION` to `64`
- Enable incremental indexing (default)

### Low accuracy results

- Increase `HNSW_EF_SEARCH` to `300-400`
- Raise `SIMILARITY_THRESHOLD` to `0.75-0.80`
- Use better summary model: `qwen2.5-coder:3b` or `7b`
- Lower `DEDUP_THRESHOLD` to `0.90-0.92`

## Acknowledgments

Built with:

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [pgvector](https://github.com/pgvector/pgvector) for vector search
- [Ollama](https://ollama.ai/) for local LLM inference
- [tree-sitter](https://tree-sitter.github.io/) for code parsing
