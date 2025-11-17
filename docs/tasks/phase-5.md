# Phase 5: MCP Server & Tools

**Estimated Duration:** 4-5 days **Priority:** Critical - User-facing interface

---

## Overview

Wrap the retrieval system in a Model Context Protocol (MCP) server that integrates with Claude Code.
This delivers 4 core MCP tools, context formatting, error handling, and a production-ready server.

---

## Checklist

### 1. MCP Server Framework

- [ ] Create `src/index.ts` as MCP server entry point
- [ ] Import `@modelcontextprotocol/sdk`
- [ ] Initialize MCP Server:
  - [ ] name: 'cindex'
  - [ ] version: '1.0.0'
  - [ ] capabilities: tools
- [ ] Set up StdioServerTransport
- [ ] Connect server to transport
- [ ] Handle server lifecycle:
  - [ ] Start: Initialize database, validate config
  - [ ] Runtime: Handle tool requests
  - [ ] Shutdown: Close connections, cleanup

### 2. Tool 1: `search_codebase`

- [ ] Create `src/mcp/search-codebase.ts`
- [ ] Define input schema:
  - [ ] query (string, required)
  - [ ] max_files (number, default: 15)
  - [ ] max_snippets (number, default: 25)
  - [ ] include_imports (boolean, default: true)
  - [ ] import_depth (number, default: 3, max: 3)
  - [ ] dedup_threshold (number, default: 0.92)
  - [ ] similarity_threshold (number, default: 0.75)
- [ ] Implement tool handler:
  - [ ] Call `searchCodebase(query, options)`
  - [ ] Format result as Markdown
  - [ ] Return as MCP response
- [ ] Register tool with MCP server

### 3. Tool 2: `get_file_context`

- [ ] Create `src/mcp/get-file-context.ts`
- [ ] Define input schema:
  - [ ] file_path (string, required)
  - [ ] include_callers (boolean, default: true)
  - [ ] include_callees (boolean, default: true)
  - [ ] import_depth (number, default: 2, max: 3)
- [ ] Implement tool handler:
  - [ ] Fetch file metadata
  - [ ] Fetch all chunks for file
  - [ ] Find callers (files importing this file)
  - [ ] Find callees (files this file imports)
  - [ ] Expand imports to specified depth
  - [ ] Format result as Markdown
- [ ] Register tool with MCP server

### 4. Tool 3: `find_symbol_definition`

- [ ] Create `src/mcp/find-symbol.ts`
- [ ] Define input schema:
  - [ ] symbol_name (string, required)
  - [ ] include_usages (boolean, default: false)
  - [ ] scope_filter (enum: all/exported/internal, default: all)
- [ ] Implement tool handler:
  - [ ] Search code_symbols table by name
  - [ ] Filter by scope if specified
  - [ ] Rank by exported first
  - [ ] Optionally find usages
  - [ ] Format result as Markdown
- [ ] Register tool with MCP server

### 5. Tool 4: `index_repository`

- [ ] Create `src/mcp/index-repository.ts`
- [ ] Define input schema:
  - [ ] repo_path (string, required)
  - [ ] incremental (boolean, default: true)
  - [ ] languages (array, default: [])
  - [ ] include_markdown (boolean, default: false)
  - [ ] respect_gitignore (boolean, default: true)
  - [ ] max_file_size (number, default: 5000)
  - [ ] summary_method (enum: llm/rule-based, default: llm)
- [ ] Implement tool handler:
  - [ ] Call `indexRepository(repo_path, options)`
  - [ ] Stream progress notifications via MCP
  - [ ] Format statistics as Markdown
  - [ ] Return summary on completion
- [ ] Register tool with MCP server

### 6. Context Formatting

- [ ] Create `src/mcp/formatter.ts`
- [ ] Implement Markdown formatters:
  - [ ] Format search results
  - [ ] Format file context
  - [ ] Format symbol definitions
  - [ ] Format indexing statistics
- [ ] Formatting guidelines:
  - [ ] File paths: backticks + bold (\`**path**\`)
  - [ ] Code blocks: specify language
  - [ ] Warnings: emoji + bold (⚠️ **Warning**)
  - [ ] Sections: clear hierarchy (##, ###, ####)
  - [ ] Metadata: compact, readable
- [ ] Add syntax highlighting to code blocks
- [ ] Include token counts
- [ ] Display warnings prominently

### 7. Input Validation

- [ ] Create `src/mcp/validator.ts`
- [ ] Validate required parameters
- [ ] Validate parameter types
- [ ] Validate parameter ranges:
  - [ ] max_files: 1-50
  - [ ] max_snippets: 1-100
  - [ ] import_depth: 1-3
  - [ ] thresholds: 0.0-1.0
- [ ] Return clear error messages

### 8. Error Handling

- [ ] Create `src/mcp/errors.ts`
- [ ] Define error types:
  - [ ] ValidationError
  - [ ] DatabaseError
  - [ ] OllamaError
  - [ ] FileNotFoundError
- [ ] Add user-friendly error messages
- [ ] Include suggestions for resolution
- [ ] Log errors for debugging

### 9. Testing & Integration

#### Unit Tests

- [ ] Test input validation for all tools
- [ ] Test context formatting
- [ ] Test error handling
- [ ] Test Markdown generation

#### Integration Tests

- [ ] Test MCP server lifecycle (start, tool call, shutdown)
- [ ] Test all 4 tools end-to-end
- [ ] Test error scenarios

#### Claude Code Integration

- [ ] Create MCP config example: `docs/mcp-config-examples.json`
- [ ] Document user scope config (~/.claude.json)
- [ ] Document project scope config (.mcp.json)
- [ ] Test with Claude Code:
  - [ ] Configure MCP server
  - [ ] Verify tools appear in Claude
  - [ ] Execute test queries
  - [ ] Verify formatted output

---

## Success Criteria

**Phase 5 is complete when ALL items below are checked:**

- [ ] MCP server starts and connects via stdio
- [ ] All 4 tools registered and listed
- [ ] `search_codebase` returns formatted context
- [ ] `get_file_context` returns complete file context
- [ ] `find_symbol_definition` locates symbols correctly
- [ ] `index_repository` indexes codebase with progress
- [ ] Input validation catches invalid parameters
- [ ] Error messages are user-friendly
- [ ] Context formatted in Markdown for Claude
- [ ] Code blocks have syntax highlighting
- [ ] Warnings displayed for large contexts
- [ ] Token counts visible in outputs
- [ ] Progress updates stream during indexing
- [ ] Server logs to stderr for debugging
- [ ] Graceful shutdown closes connections
- [ ] Integration with Claude Code works end-to-end
- [ ] All unit tests passing
- [ ] All integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (config, database, logger)
- [ ] Phase 4 complete (search orchestrator)
- [ ] Phase 3 complete (indexing orchestrator)
- [ ] `@modelcontextprotocol/sdk` installed

---

## Output Artifacts

- [ ] `src/index.ts` - MCP server entry point
- [ ] `src/mcp/search-codebase.ts` - Search tool
- [ ] `src/mcp/get-file-context.ts` - File context tool
- [ ] `src/mcp/find-symbol.ts` - Symbol lookup tool
- [ ] `src/mcp/index-repository.ts` - Indexing tool
- [ ] `src/mcp/formatter.ts` - Markdown formatter
- [ ] `src/mcp/validator.ts` - Input validator
- [ ] `src/mcp/errors.ts` - Error types
- [ ] `tests/unit/mcp/` - Unit tests
- [ ] `tests/integration/` - Integration tests
- [ ] `docs/mcp-config-examples.json` - MCP config examples
- [ ] README.md updated with MCP setup instructions

---

## Next Phase

**Phase 6 optimizes for production:**

- Incremental indexing
- HNSW index optimization
- Query caching
- Edge case handling

**✅ Phase 5 must be 100% complete before starting Phase 6.**
