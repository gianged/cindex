# Phase 5: MCP Server & Tools

**Estimated Duration:** 4-5 days **Priority:** Critical - User-facing interface

---

## Overview

Wrap the retrieval system in a Model Context Protocol (MCP) server that integrates with Claude Code.
This delivers 4 core MCP tools, context formatting, error handling, and a production-ready server.

---

## Checklist

### 1. MCP Server Framework

- [ ] Create `src/index.ts` as MCP server entry point: import @modelcontextprotocol/sdk, initialize
      Server (name: 'cindex', version: '1.0.0', capabilities: tools), set up StdioServerTransport,
      connect server
- [ ] Handle lifecycle: start (initialize database, validate config), runtime (handle tool
      requests), shutdown (close connections, cleanup)

### 2. Tool Implementations

- [ ] Create `src/mcp/search-codebase.ts`: input schema (query required, max_files 15, max_snippets
      25, include_imports true, import_depth 3, dedup_threshold 0.92, similarity_threshold 0.75),
      call searchCodebase(), format as Markdown, return MCP response
- [ ] Create `src/mcp/get-file-context.ts`: input schema (file_path required, include_callers true,
      include_callees true, import_depth 2), fetch file metadata + chunks + callers + callees,
      expand imports, format as Markdown
- [ ] Create `src/mcp/find-symbol.ts`: input schema (symbol_name required, include_usages false,
      scope_filter all|exported|internal), search code_symbols by name, filter by scope, rank
      exported first, optionally find usages, format as Markdown
- [ ] Create `src/mcp/index-repository.ts`: input schema (repo_path required, incremental true,
      languages[], include_markdown false, respect_gitignore true, max_file_size 5000,
      summary_method llm|rule-based), call indexRepository(), stream progress via MCP notifications,
      format statistics as Markdown
- [ ] Register all 4 tools with MCP server

### 3. Context Formatting

- [ ] Create `src/mcp/formatter.ts` with Markdown formatters for all tool outputs
- [ ] Formatting rules: file paths (backticks + bold), code blocks (specify language for syntax
      highlighting), warnings (⚠️ **Warning**), sections (##/###/####), metadata (compact,
      readable), include token counts, display warnings prominently
- [ ] Implement formatters: search results, file context, symbol definitions, indexing statistics

### 4. Input Validation & Error Handling

- [ ] Create `src/mcp/validator.ts`: validate required parameters, validate types, validate ranges
      (max_files 1-50, max_snippets 1-100, import_depth 1-3, thresholds 0.0-1.0), return clear error
      messages
- [ ] Create `src/mcp/errors.ts`: define error types (ValidationError, DatabaseError, OllamaError,
      FileNotFoundError), add user-friendly messages, include resolution suggestions, log for
      debugging

### 5. Testing & Integration

- [ ] Unit tests: input validation for all tools, context formatting, error handling, Markdown
      generation
- [ ] Integration tests: MCP server lifecycle (start/tool call/shutdown), all 4 tools end-to-end,
      error scenarios
- [ ] Create `docs/mcp-config-examples.json`: user scope (~/.claude.json), project scope (.mcp.json)
      with examples
- [ ] Test with Claude Code: configure MCP server, verify tools appear, execute test queries, verify
      formatted output

---

## Success Criteria

Phase 5 is complete when:

- [ ] MCP server starts and connects via stdio without errors
- [ ] All 4 tools registered and listed in Claude Code
- [ ] `search_codebase` returns formatted context with files, chunks, symbols, imports
- [ ] `get_file_context` returns complete file context with callers/callees
- [ ] `find_symbol_definition` locates symbols and optionally shows usages
- [ ] `index_repository` indexes codebase with real-time progress updates
- [ ] Input validation catches all invalid parameters with clear messages
- [ ] Error messages are user-friendly with actionable suggestions
- [ ] All outputs formatted in Markdown with syntax highlighting
- [ ] Warnings displayed prominently for large contexts (>100k tokens)
- [ ] Token counts visible in all search outputs
- [ ] Progress updates stream during indexing via MCP notifications
- [ ] Server logs to stderr for debugging
- [ ] Graceful shutdown closes all connections
- [ ] Integration with Claude Code works end-to-end
- [ ] All unit and integration tests passing

---

## Dependencies

- [ ] Phase 1 complete (config, database, logger)
- [ ] Phase 4 complete (search orchestrator: searchCodebase function)
- [ ] Phase 3 complete (indexing orchestrator: indexRepository function)
- [ ] @modelcontextprotocol/sdk installed

---

## Output Artifacts

- `src/index.ts` - MCP server entry point with lifecycle management
- `src/mcp/search-codebase.ts` - Search tool implementation
- `src/mcp/get-file-context.ts` - File context tool implementation
- `src/mcp/find-symbol.ts` - Symbol lookup tool implementation
- `src/mcp/index-repository.ts` - Indexing tool implementation
- `src/mcp/formatter.ts` - Markdown formatting for all outputs
- `src/mcp/validator.ts` - Input validation logic
- `src/mcp/errors.ts` - Error types and messages
- `tests/unit/mcp/` - Unit tests
- `tests/integration/` - Integration tests
- `docs/mcp-config-examples.json` - MCP configuration examples
- README.md - MCP setup instructions

---

## Next Phase

**Phase 6: Optimization & Production Readiness**

- Incremental indexing with hash comparison
- HNSW index optimization (upgrade from IVFFlat)
- Query caching (embeddings + results)
- Edge case handling (circular imports, encoding, permissions)
- Comprehensive testing (scale, stress, accuracy)

**✅ Phase 5 must be 100% complete before starting Phase 6.**
