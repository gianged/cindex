/**
 * MCP Tool Output Formatting
 * Provides Markdown formatters for all MCP tool outputs
 */
import { type ServiceContext, type WorkspaceContext } from '@database/queries';
import { type RepositoryType } from '@/types/database';
import {
  type APIEndpointMatch,
  type CrossServiceCall,
  type ImportChain,
  type RelevantChunk,
  type RelevantFile,
  type ResolvedSymbol,
  type SearchMetadata,
  type SearchResult,
  type SearchWarning,
} from '@/types/retrieval';

/**
 * Get repository type badge for formatted output
 *
 * Returns a human-readable badge string indicating the repository type,
 * used in formatted output to distinguish between main code, libraries,
 * references, and documentation.
 *
 * @param repoType - Repository type identifier
 * @returns Badge string (e.g., '[Main Code]', '[Reference]')
 */
export const getRepoTypeBadge = (repoType: RepositoryType): string => {
  const badges: Record<RepositoryType, string> = {
    monolithic: '[Main Code]',
    microservice: '[Microservice]',
    monorepo: '[Monorepo]',
    library: '[Library]',
    reference: '[Reference]',
    documentation: '[Documentation]',
  };
  return badges[repoType] || '[Unknown]';
};

/**
 * Get severity badge for warning messages
 *
 * Returns a text badge representing the severity level of a warning,
 * used for visual indication in formatted warning output.
 *
 * @param severity - Warning severity level ('info', 'warning', or 'error')
 * @returns Severity badge string ([INFO] for info, [WARNING] for warning, [ERROR] for error)
 */
const getSeverityBadge = (severity: 'info' | 'warning' | 'error'): string => {
  const badges: Record<string, string> = {
    info: '[INFO]',
    warning: '[WARNING]',
    error: '[ERROR]',
  };
  return badges[severity] || '[INFO]';
};

/**
 * Format file path as inline code with bold styling
 *
 * Wraps the file path in Markdown bold and inline code formatting
 * for consistent display in MCP tool outputs.
 *
 * @param filePath - Absolute or relative file path
 * @returns Markdown-formatted file path string (**`path/to/file`**)
 */
export const formatFilePath = (filePath: string): string => {
  return `**\`${filePath}\`**`;
};

/**
 * Format code block with language syntax highlighting
 *
 * Creates a Markdown code fence with syntax highlighting for the specified
 * language. Sanitizes triple backticks in the code to prevent breaking the fence.
 *
 * @param code - Raw code content to format
 * @param language - Programming language identifier (e.g., 'typescript', 'python')
 * @returns Markdown code fence with syntax highlighting
 */
export const formatCodeBlock = (code: string, language: string): string => {
  // Ensure code doesn't contain triple backticks that would break the block
  const sanitizedCode = code.replace(/```/g, '\\`\\`\\`');
  return `\`\`\`${language}\n${sanitizedCode}\n\`\`\``;
};

/**
 * Format individual warning message with emoji and suggestion
 *
 * Converts a search warning object into formatted Markdown with severity
 * emoji, warning type, message, and optional suggestion.
 *
 * @param warning - Search warning object with type, severity, message, and optional suggestion
 * @returns Formatted warning message string
 */
export const formatWarning = (warning: SearchWarning): string => {
  const lines: string[] = [];
  const badge = getSeverityBadge(warning.severity);

  lines.push(`${badge} **${warning.type.toUpperCase()}**: ${warning.message}`);

  if (warning.suggestion) {
    lines.push(`  _Suggestion:_ ${warning.suggestion}`);
  }

  return lines.join('\n');
};

/**
 * Format all search warnings into a warnings section
 *
 * Creates a formatted warnings section with heading and all warning messages.
 * Returns empty string if no warnings exist.
 *
 * @param warnings - Array of search warnings to format
 * @returns Formatted warnings section string (empty if no warnings)
 */
export const formatWarnings = (warnings: SearchWarning[]): string => {
  if (warnings.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Warnings\n');

  for (const warning of warnings) {
    lines.push(formatWarning(warning));
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Format token count with size warning thresholds
 *
 * Formats the token count with warnings if the context size is large
 * (>50k tokens) or very large (>100k tokens), helping users understand
 * when to narrow their search scope.
 *
 * @param tokens - Total token count in search context
 * @returns Formatted token count with warning emoji if applicable
 */
export const formatTokenCount = (tokens: number): string => {
  const formattedCount = tokens.toLocaleString();

  if (tokens > 100000) {
    return `[WARNING] **${formattedCount} tokens** (Context is very large! Consider narrowing your search)`;
  } else if (tokens > 50000) {
    return `[WARNING] **${formattedCount} tokens** (Large context size)`;
  }

  return `**${formattedCount} tokens**`;
};

/**
 * Format search metadata statistics section
 *
 * Creates a comprehensive statistics section with token count, files/chunks
 * retrieved, deduplication stats, symbol resolution, import depth, query time,
 * and multi-project metadata (workspaces, services, APIs, repositories).
 *
 * @param metadata - Search metadata object with all statistics
 * @returns Formatted search statistics section in Markdown
 */
export const formatSearchMetadata = (metadata: SearchMetadata): string => {
  const lines: string[] = [];

  lines.push('## Search Statistics\n');
  lines.push(`**Total Context:** ${formatTokenCount(metadata.total_tokens)}`);
  lines.push(`**Files Retrieved:** ${String(metadata.files_retrieved)}`);
  lines.push(
    `**Chunks Retrieved:** ${String(metadata.chunks_retrieved)} (${String(metadata.chunks_after_dedup)} after deduplication)`
  );

  if (metadata.chunks_deduplicated > 0) {
    lines.push(`**Duplicates Removed:** ${String(metadata.chunks_deduplicated)}`);
  }

  lines.push(`**Symbols Resolved:** ${String(metadata.symbols_resolved)}`);
  lines.push(`**Import Depth:** ${String(metadata.import_depth_reached)}`);
  lines.push(`**Query Time:** ${String(metadata.query_time_ms)}ms`);

  // Multi-project metadata
  if (metadata.workspaces_searched !== undefined && metadata.workspaces_searched > 0) {
    lines.push(`**Workspaces Searched:** ${String(metadata.workspaces_searched)}`);
  }

  if (metadata.services_searched !== undefined && metadata.services_searched > 0) {
    lines.push(`**Services Searched:** ${String(metadata.services_searched)}`);
  }

  if (metadata.api_endpoints_found !== undefined && metadata.api_endpoints_found > 0) {
    lines.push(`**API Endpoints Found:** ${String(metadata.api_endpoints_found)}`);
  }

  // Repository metadata (grouped by type)
  if (metadata.repos_searched && metadata.repos_searched.length > 0) {
    lines.push('\n**Repositories:**');

    for (const repo of metadata.repos_searched) {
      const badge = getRepoTypeBadge(repo.repo_type);
      const version = repo.version ? ` (${repo.version})` : '';
      lines.push(
        `- ${badge} \`${repo.repo_id}\`${version}: ${String(repo.file_count)} files, ${String(repo.chunk_count)} chunks`
      );
    }
  }

  // Reference repositories included
  if (metadata.reference_repos_included && metadata.reference_repos_included.length > 0) {
    lines.push(`\n**Reference Repositories Included:** ${metadata.reference_repos_included.join(', ')}`);
  }

  // Documentation repositories included
  if (metadata.documentation_repos_included && metadata.documentation_repos_included.length > 0) {
    lines.push(`**Documentation Repositories Included:** ${metadata.documentation_repos_included.join(', ')}`);
  }

  return lines.join('\n');
};

/**
 * Format relevant file with metadata and context
 *
 * Formats a file result from Stage 1 retrieval with file path, similarity score,
 * language, line count, multi-project context, summary, exports, and imports.
 *
 * @param file - Relevant file object from search results
 * @param includeContext - Whether to include summary, exports, and imports (default: true)
 * @returns Formatted file section in Markdown
 */
export const formatRelevantFile = (file: RelevantFile, includeContext = true): string => {
  const lines: string[] = [];

  // File path with similarity score
  lines.push(`### ${formatFilePath(file.file_path)}`);
  lines.push(
    `**Similarity:** ${(file.similarity * 100).toFixed(1)}% | **Language:** ${file.language} | **Lines:** ${String(file.line_count)}`
  );

  // Multi-project context
  const contextParts: string[] = [];
  if (file.repo_id) contextParts.push(`Repo: \`${file.repo_id}\``);
  if (file.workspace_id) contextParts.push(`Workspace: \`${file.workspace_id}\``);
  if (file.package_name) contextParts.push(`Package: \`${file.package_name}\``);
  if (file.service_id) contextParts.push(`Service: \`${file.service_id}\``);

  if (contextParts.length > 0) {
    lines.push(`**Context:** ${contextParts.join(' | ')}`);
  }

  if (includeContext) {
    lines.push(`\n**Summary:** ${file.file_summary}`);

    if (file.exports.length > 0) {
      lines.push(`\n**Exports:** ${file.exports.join(', ')}`);
    }

    if (file.imports.length > 0 && file.imports.length <= 10) {
      lines.push(`**Imports:** ${file.imports.join(', ')}`);
    } else if (file.imports.length > 10) {
      lines.push(`**Imports:** ${String(file.imports.length)} modules`);
    }
  }

  return lines.join('\n');
};

/**
 * Format relevant code chunk (code snippet)
 *
 * Formats a code chunk result from Stage 2 retrieval with file path, line range,
 * chunk type, similarity score, token count, multi-project context, and code content
 * with syntax highlighting.
 *
 * @param chunk - Relevant chunk object from search results
 * @returns Formatted code snippet section in Markdown
 */
export const formatRelevantChunk = (chunk: RelevantChunk): string => {
  const lines: string[] = [];

  // Chunk header
  lines.push(`#### ${formatFilePath(chunk.file_path)}:${String(chunk.start_line)}-${String(chunk.end_line)}`);
  lines.push(
    `**Type:** ${chunk.chunk_type} | **Similarity:** ${(chunk.similarity * 100).toFixed(1)}% | **Tokens:** ${String(chunk.token_count)}`
  );

  // Multi-project context
  const contextParts: string[] = [];
  if (chunk.repo_id) contextParts.push(`Repo: \`${chunk.repo_id}\``);
  if (chunk.workspace_id) contextParts.push(`Workspace: \`${chunk.workspace_id}\``);
  if (chunk.service_id) contextParts.push(`Service: \`${chunk.service_id}\``);

  if (contextParts.length > 0) {
    lines.push(`**Context:** ${contextParts.join(' | ')}`);
  }

  // Detect language from file extension
  const language = chunk.file_path.split('.').pop() ?? 'text';
  lines.push(`\n${formatCodeBlock(chunk.chunk_content, language)}`);

  return lines.join('\n');
};

/**
 * Format resolved symbol definition
 *
 * Formats a symbol result from Stage 3 retrieval with symbol name, type,
 * file location, line number, scope, multi-project context, and the symbol's
 * definition code with syntax highlighting.
 *
 * @param symbol - Resolved symbol object from search results
 * @returns Formatted symbol definition section in Markdown
 */
export const formatResolvedSymbol = (symbol: ResolvedSymbol): string => {
  const lines: string[] = [];

  lines.push(`#### \`${symbol.symbol_name}\` (${symbol.symbol_type})`);
  lines.push(`**Location:** ${formatFilePath(symbol.file_path)}:${String(symbol.line_number)}`);
  lines.push(`**Scope:** ${symbol.scope}`);

  // Multi-project context
  const contextParts: string[] = [];
  if (symbol.workspace_id) contextParts.push(`Workspace: \`${symbol.workspace_id}\``);
  if (symbol.service_id) contextParts.push(`Service: \`${symbol.service_id}\``);
  if (symbol.is_internal) contextParts.push('Internal');

  if (contextParts.length > 0) {
    lines.push(`**Context:** ${contextParts.join(' | ')}`);
  }

  // Detect language from file extension
  const language = symbol.file_path.split('.').pop() ?? 'text';
  lines.push(`\n${formatCodeBlock(symbol.definition, language)}`);

  return lines.join('\n');
};

/**
 * Format import dependency chain
 *
 * Formats import chains from Stage 4 retrieval grouped by depth level,
 * showing the dependency tree with indentation, circular imports ([CIRCULAR]),
 * truncated chains ([TRUNCATED]), and cross-boundary markers.
 *
 * @param imports - Array of import chain entries from search results
 * @returns Formatted import dependencies section in Markdown (empty if no imports)
 */
export const formatImportChain = (imports: ImportChain[]): string => {
  if (imports.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Import Dependencies\n');

  // Group by depth
  const byDepth = new Map<number, ImportChain[]>();
  for (const imp of imports) {
    const existing = byDepth.get(imp.depth);
    if (existing) {
      existing.push(imp);
    } else {
      byDepth.set(imp.depth, [imp]);
    }
  }

  const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const depthNum of sortedDepths) {
    const depthImports = byDepth.get(depthNum);
    if (!depthImports) continue;

    lines.push(`### Depth ${String(depthNum)}\n`);

    for (const imp of depthImports) {
      const indent = '  '.repeat(depthNum);
      const arrow = depthNum > 0 ? '→ ' : '';
      const circularMark = imp.circular ? ' [CIRCULAR]' : '';
      const truncatedMark = imp.truncated ? ` [TRUNCATED: ${imp.truncation_reason ?? 'unknown'}]` : '';
      const crossBoundary = imp.cross_workspace ? ' [cross-workspace]' : imp.cross_service ? ' [cross-service]' : '';

      lines.push(`${indent}${arrow}${formatFilePath(imp.file_path)}${circularMark}${truncatedMark}${crossBoundary}`);

      if (imp.imported_from) {
        lines.push(`${indent}  _from:_ \`${imp.imported_from}\``);
      }

      if (imp.exports && imp.exports.length > 0) {
        lines.push(`${indent}  _exports:_ ${imp.exports.join(', ')}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Format API endpoint definition
 *
 * Formats an API endpoint from Stage 5 retrieval with method, path, service info,
 * API type, description, similarity score, implementation link, deprecation warning,
 * and collapsible request/response schemas.
 *
 * @param endpoint - API endpoint match object from search results
 * @returns Formatted API endpoint section in Markdown
 */
export const formatAPIEndpoint = (endpoint: APIEndpointMatch): string => {
  const lines: string[] = [];

  const deprecatedMark = endpoint.deprecated ? ' 🚫 DEPRECATED' : '';
  lines.push(`#### ${endpoint.method.toUpperCase()} ${endpoint.endpoint_path}${deprecatedMark}`);

  lines.push(`**Service:** \`${endpoint.service_name}\` (\`${endpoint.service_id}\`)`);
  lines.push(`**Type:** ${endpoint.api_type}`);

  if (endpoint.description) {
    lines.push(`**Description:** ${endpoint.description}`);
  }

  if (endpoint.similarity !== undefined) {
    lines.push(`**Similarity:** ${(endpoint.similarity * 100).toFixed(1)}%`);
  }

  // Implementation link
  if (endpoint.implementation_file) {
    const location = endpoint.implementation_lines
      ? `${endpoint.implementation_file}:${endpoint.implementation_lines}`
      : endpoint.implementation_file;
    lines.push(`**Implementation:** ${formatFilePath(location)}`);
  }

  // Deprecation warning
  if (endpoint.deprecated && endpoint.deprecation_message) {
    lines.push(`\n[WARNING] **Deprecation Warning:** ${endpoint.deprecation_message}`);
  }

  // Request/Response schemas (collapsed by default)
  if (endpoint.request_schema) {
    lines.push(`\n<details><summary>Request Schema</summary>\n`);
    lines.push(formatCodeBlock(JSON.stringify(endpoint.request_schema, null, 2), 'json'));
    lines.push(`</details>`);
  }

  if (endpoint.response_schema) {
    lines.push(`\n<details><summary>Response Schema</summary>\n`);
    lines.push(formatCodeBlock(JSON.stringify(endpoint.response_schema, null, 2), 'json'));
    lines.push(`</details>`);
  }

  return lines.join('\n');
};

/**
 * Format cross-service API call detection
 *
 * Formats a detected cross-service call from Stage 5 retrieval showing the
 * source service, target service, endpoint, call type, line number, and
 * whether the endpoint was found in the API registry ([FOUND]/[NOT FOUND]).
 *
 * @param call - Cross-service call object from search results
 * @returns Formatted cross-service call section in Markdown
 */
export const formatCrossServiceCall = (call: CrossServiceCall): string => {
  const lines: string[] = [];

  const foundMark = call.endpoint_found ? '[FOUND]' : '[NOT FOUND]';
  lines.push(`${foundMark} **${call.method.toUpperCase()} ${call.endpoint_path}**`);

  lines.push(`**From:** Service \`${call.source_service_id}\` in ${formatFilePath(call.source_file)}`);

  if (call.target_service_id) {
    lines.push(`**To:** Service \`${call.target_service_id}\``);
  }

  lines.push(`**Type:** ${call.call_type}`);

  if (call.line_number) {
    lines.push(`**Line:** ${String(call.line_number)}`);
  }

  if (!call.endpoint_found) {
    lines.push(`\n[WARNING] Endpoint not found in API registry`);
  }

  return lines.join('\n');
};

/**
 * Format Quick Summary section for search results
 *
 * Creates a concise summary at the top of search results showing:
 * - Top 5 files with paths and similarity scores
 * - Top 5 chunks with file:line-range, similarity, and code preview
 *
 * This provides immediate visibility of what was found without scrolling
 * through verbose detailed sections.
 *
 * @param files - Relevant files from Stage 1 retrieval
 * @param chunks - Relevant chunks from Stage 2 retrieval
 * @returns Formatted Quick Summary section in Markdown (empty if no results)
 */
export const formatQuickSummary = (files: RelevantFile[], chunks: RelevantChunk[]): string => {
  if (files.length === 0 && chunks.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Quick Summary\n');

  // Top 5 files with similarity and summary preview
  if (files.length > 0) {
    lines.push('**Top Files:**');
    for (const file of files.slice(0, 5)) {
      const similarity = (file.similarity * 100).toFixed(1);
      // Truncate summary to 60 chars for compact display
      const summaryPreview =
        file.file_summary.length > 60 ? file.file_summary.substring(0, 57) + '...' : file.file_summary;
      lines.push(`${String(files.indexOf(file) + 1)}. \`${file.file_path}\` (${similarity}%) - ${summaryPreview}`);
    }
    if (files.length > 5) {
      lines.push(`   _... and ${String(files.length - 5)} more files_`);
    }
    lines.push('');
  }

  // Top 5 chunks with file:lines, similarity, and code preview
  if (chunks.length > 0) {
    lines.push('**Top Chunks:**');
    for (const chunk of chunks.slice(0, 5)) {
      const similarity = (chunk.similarity * 100).toFixed(1);
      const location = `${chunk.file_path}:${String(chunk.start_line)}-${String(chunk.end_line)}`;
      // Extract first line of code, truncate to 80 chars for compact display
      const firstLine = chunk.chunk_content.split('\n')[0]?.trim() ?? '';
      const codePreview = firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
      lines.push(`${String(chunks.indexOf(chunk) + 1)}. \`${location}\` (${similarity}%) - \`${codePreview}\``);
    }
    if (chunks.length > 5) {
      lines.push(`   _... and ${String(chunks.length - 5)} more chunks_`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Format complete search result output
 *
 * Formats the full search result from the 7-stage retrieval pipeline, including
 * query info, warnings, metadata, relevant files, code locations, symbols,
 * import chains, API endpoints, cross-service calls, and grouped context
 * by workspace/service/repository.
 *
 * @param result - Complete search result object from search_codebase
 * @returns Formatted search result document in Markdown
 */
export const formatSearchResult = (result: SearchResult): string => {
  const lines: string[] = [];

  lines.push(`# Search Results: "${result.query}"\n`);
  lines.push(`**Query Type:** ${result.query_type}\n`);

  // Quick Summary - immediate visibility of what was found
  const quickSummary = formatQuickSummary(result.context.relevant_files, result.context.code_locations);
  if (quickSummary) {
    lines.push(quickSummary);
  }

  // Warnings (if any)
  if (result.warnings.length > 0) {
    lines.push(formatWarnings(result.warnings));
  }

  // Metadata
  lines.push(formatSearchMetadata(result.metadata));
  lines.push('');

  // Context: Files (skip top 5, already shown in Quick Summary)
  const remainingFiles = result.context.relevant_files.slice(5);
  if (remainingFiles.length > 0) {
    lines.push('## Additional Files\n');
    for (const file of remainingFiles) {
      lines.push(formatRelevantFile(file, true));
      lines.push('');
    }
  }

  // Context: Code Locations (skip top 5, already shown in Quick Summary)
  const remainingChunks = result.context.code_locations.slice(5);
  if (remainingChunks.length > 0) {
    lines.push('## Additional Code Locations\n');
    for (const chunk of remainingChunks) {
      lines.push(formatRelevantChunk(chunk));
      lines.push('');
    }
  }

  // Context: Symbols
  if (result.context.symbols.length > 0) {
    lines.push('## Resolved Symbols\n');
    for (const symbol of result.context.symbols) {
      lines.push(formatResolvedSymbol(symbol));
      lines.push('');
    }
  }

  // Context: Imports
  if (result.context.imports.length > 0) {
    lines.push(formatImportChain(result.context.imports));
  }

  // Context: API Endpoints
  if (result.context.api_context && result.context.api_context.endpoints.length > 0) {
    lines.push('## API Endpoints\n');
    for (const endpoint of result.context.api_context.endpoints) {
      lines.push(formatAPIEndpoint(endpoint));
      lines.push('');
    }
  }

  // Context: Cross-Service Calls
  if (result.context.api_context && result.context.api_context.cross_service_calls.length > 0) {
    lines.push('## Cross-Service API Calls\n');
    for (const call of result.context.api_context.cross_service_calls) {
      lines.push(formatCrossServiceCall(call));
      lines.push('');
    }
  }

  // Grouped context (by workspace/service/repo)
  if (result.context.by_workspace) {
    lines.push('## Results by Workspace\n');
    for (const [workspaceId, group] of Object.entries(result.context.by_workspace)) {
      lines.push(`### Workspace: ${group.name} (\`${workspaceId}\`)\n`);
      lines.push(
        `**Files:** ${String(group.files.length)} | **Chunks:** ${String(group.chunks.length)} | **Symbols:** ${String(group.symbols.length)}\n`
      );
    }
  }

  if (result.context.by_service) {
    lines.push('## Results by Service\n');
    for (const [serviceId, group] of Object.entries(result.context.by_service)) {
      lines.push(`### Service: ${group.name} (\`${serviceId}\`)\n`);
      lines.push(
        `**Files:** ${String(group.files.length)} | **Chunks:** ${String(group.chunks.length)} | **Symbols:** ${String(group.symbols.length)}\n`
      );
    }
  }

  if (result.context.by_repo) {
    lines.push('## Results by Repository\n');
    for (const [repoId, group] of Object.entries(result.context.by_repo)) {
      lines.push(`### Repository: ${group.name} (\`${repoId}\`)\n`);
      lines.push(
        `**Files:** ${String(group.files.length)} | **Chunks:** ${String(group.chunks.length)} | **Symbols:** ${String(group.symbols.length)}\n`
      );
    }
  }

  return lines.join('\n');
};

/**
 * Format indexing statistics
 */
export interface IndexingStats {
  repo_id?: string;
  repo_type?: RepositoryType;
  files_indexed: number;
  chunks_created: number;
  symbols_extracted: number;
  workspaces_detected?: number;
  services_detected?: number;
  api_endpoints_found?: number;
  indexing_time_ms: number;
  errors?: string[];
}

/**
 * Format repository indexing statistics
 *
 * Formats indexing completion statistics showing repository type, files indexed,
 * chunks created, symbols extracted, workspaces/services detected, API endpoints found,
 * indexing time, and any errors encountered.
 *
 * @param stats - Indexing statistics object from index_repository
 * @returns Formatted indexing statistics document in Markdown
 */
export const formatIndexingStats = (stats: IndexingStats): string => {
  const lines: string[] = [];

  lines.push(`# Indexing Complete: \`${stats.repo_id ?? 'unknown'}\`\n`);
  lines.push(`**Repository Type:** ${getRepoTypeBadge(stats.repo_type ?? 'monolithic')}\n`);

  lines.push('## Statistics\n');
  lines.push(`**Files Indexed:** ${String(stats.files_indexed)}`);
  lines.push(`**Chunks Created:** ${String(stats.chunks_created)}`);
  lines.push(`**Symbols Extracted:** ${String(stats.symbols_extracted)}`);

  if (stats.workspaces_detected !== undefined && stats.workspaces_detected > 0) {
    lines.push(`**Workspaces Detected:** ${String(stats.workspaces_detected)}`);
  }

  if (stats.services_detected !== undefined && stats.services_detected > 0) {
    lines.push(`**Services Detected:** ${String(stats.services_detected)}`);
  }

  if (stats.api_endpoints_found !== undefined && stats.api_endpoints_found > 0) {
    lines.push(`**API Endpoints Found:** ${String(stats.api_endpoints_found)}`);
  }

  lines.push(
    `**Indexing Time:** ${String(stats.indexing_time_ms)}ms (${(stats.indexing_time_ms / 1000 / 60).toFixed(1)} minutes)`
  );

  if (stats.errors && stats.errors.length > 0) {
    lines.push('\n## Errors\n');
    for (const error of stats.errors) {
      lines.push(`- [ERROR] ${error}`);
    }
  }

  return lines.join('\n');
};

/**
 * Workspace information for list formatting
 */
export interface WorkspaceInfo {
  workspace_id: string;
  package_name: string;
  workspace_path: string;
  dependencies?: string[];
  dependents?: string[];
}

/**
 * Format workspace list for monorepo display
 *
 * Formats a list of workspaces showing package name, ID, path, dependencies,
 * and dependents. Optionally scoped to a specific repository.
 *
 * @param workspaces - Array of workspace information objects
 * @param repoId - Optional repository ID to scope the display
 * @returns Formatted workspace list document in Markdown
 */
export const formatWorkspaceList = (workspaces: WorkspaceInfo[], repoId?: string): string => {
  const lines: string[] = [];

  const title = repoId ? `# Workspaces in \`${repoId}\`\n` : '# Indexed Workspaces\n';
  lines.push(title);
  lines.push(`**Total:** ${String(workspaces.length)}\n`);

  for (const ws of workspaces) {
    lines.push(`## \`${ws.package_name}\``);
    lines.push(`**ID:** \`${ws.workspace_id}\``);
    lines.push(`**Path:** ${formatFilePath(ws.workspace_path)}`);

    if (ws.dependencies && ws.dependencies.length > 0) {
      lines.push(`**Dependencies:** ${ws.dependencies.join(', ')}`);
    }

    if (ws.dependents && ws.dependents.length > 0) {
      lines.push(`**Dependents:** ${ws.dependents.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Service information for list formatting
 */
export interface ServiceInfo {
  service_id: string;
  service_name: string;
  service_type: string;
  repo_id: string;
  api_endpoints?: APIEndpointMatch[];
}

/**
 * Format service list for microservices display
 *
 * Formats a list of services showing service name, ID, type, repository,
 * and API endpoint count with a preview of up to 5 endpoints.
 *
 * @param services - Array of service information objects
 * @returns Formatted service list document in Markdown
 */
export const formatServiceList = (services: ServiceInfo[]): string => {
  const lines: string[] = [];

  lines.push(`# Indexed Services\n`);
  lines.push(`**Total:** ${String(services.length)}\n`);

  for (const svc of services) {
    lines.push(`## \`${svc.service_name}\``);
    lines.push(`**ID:** \`${svc.service_id}\``);
    lines.push(`**Type:** ${svc.service_type}`);
    lines.push(`**Repository:** \`${svc.repo_id}\``);

    if (svc.api_endpoints && svc.api_endpoints.length > 0) {
      lines.push(`**API Endpoints:** ${String(svc.api_endpoints.length)}`);
      lines.push('');
      for (const endpoint of svc.api_endpoints.slice(0, 5)) {
        lines.push(`- ${endpoint.method.toUpperCase()} ${endpoint.endpoint_path}`);
      }
      if (svc.api_endpoints.length > 5) {
        lines.push(`- _... and ${String(svc.api_endpoints.length - 5)} more_`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Repository information for list formatting
 */
export interface RepositoryInfo {
  repo_id: string;
  repo_name: string | null;
  repo_type: RepositoryType;
  file_count: number;
  workspace_count?: number;
  service_count?: number;
  indexed_at: string;
  version?: string;
  upstream_url?: string;
}

/**
 * Format repository list grouped by type
 *
 * Formats all indexed repositories grouped by type (main code, microservices,
 * monorepos, libraries, references, documentation) showing repo ID, name, version,
 * file count, workspace count, service count, and last indexed timestamp.
 *
 * @param repos - Array of repository information objects
 * @returns Formatted repository list document in Markdown
 */
export const formatRepositoryList = (repos: RepositoryInfo[]): string => {
  const lines: string[] = [];

  lines.push(`# Indexed Repositories\n`);
  lines.push(`**Total:** ${String(repos.length)}\n`);

  // Group by repository type
  const byType: Record<RepositoryType, RepositoryInfo[]> = {
    monolithic: [],
    microservice: [],
    monorepo: [],
    library: [],
    reference: [],
    documentation: [],
  };

  for (const repo of repos) {
    byType[repo.repo_type].push(repo);
  }

  // Format each group
  const groups: { type: RepositoryType; label: string }[] = [
    { type: 'monolithic', label: 'Main Code Repositories' },
    { type: 'microservice', label: 'Microservice Repositories' },
    { type: 'monorepo', label: 'Monorepo Repositories' },
    { type: 'library', label: 'Library Repositories' },
    { type: 'reference', label: 'Reference Repositories (External Frameworks)' },
    { type: 'documentation', label: 'Documentation Repositories' },
  ];

  for (const group of groups) {
    const groupRepos = byType[group.type];
    if (groupRepos.length === 0) continue;

    lines.push(`## ${group.label}\n`);

    for (const repo of groupRepos) {
      const badge = getRepoTypeBadge(repo.repo_type);
      const name = repo.repo_name ? ` (${repo.repo_name})` : '';
      const version = repo.version ? ` - ${repo.version}` : '';
      const upstream = repo.upstream_url ? ` [${repo.upstream_url}]` : '';

      lines.push(`### ${badge} \`${repo.repo_id}\`${name}${version}${upstream}`);
      lines.push(`**Files:** ${String(repo.file_count)} | **Indexed:** ${repo.indexed_at}`);

      if (repo.workspace_count !== undefined && repo.workspace_count > 0) {
        lines.push(`**Workspaces:** ${String(repo.workspace_count)}`);
      }

      if (repo.service_count !== undefined && repo.service_count > 0) {
        lines.push(`**Services:** ${String(repo.service_count)}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
};

/**
 * Format workspace context with dependencies and files
 *
 * Formats full workspace context showing workspace metadata, package name,
 * path, dependencies, dependents, and files (up to 20 listed).
 *
 * @param context - Workspace context object from get_workspace_context
 * @returns Formatted workspace context document in Markdown
 */
export const formatWorkspaceContext = (context: WorkspaceContext): string => {
  const lines: string[] = [];

  lines.push(`# Workspace Context: \`${context.workspace.package_name}\`\n`);
  lines.push(`**Workspace ID:** \`${String(context.workspace.id)}\``);
  lines.push(`**Package Name:** \`${context.workspace.package_name}\``);
  lines.push(`**Path:** \`${context.workspace.workspace_path}\``);
  if (context.workspace.repo_id) {
    lines.push(`**Repository:** \`${context.workspace.repo_id}\``);
  }
  lines.push('');

  if (context.dependencies.length > 0) {
    lines.push(`## Dependencies (${String(context.dependencies.length)})\n`);
    for (const dep of context.dependencies) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  if (context.dependents.length > 0) {
    lines.push(`## Dependents (${String(context.dependents.length)})\n`);
    for (const dep of context.dependents) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  if (context.files.length > 0) {
    lines.push(`## Files (${String(context.files.length)})\n`);
    for (const file of context.files.slice(0, 20)) {
      lines.push(`- ${formatFilePath(file.file_path)} (${String(file.total_lines)} lines)`);
    }
    if (context.files.length > 20) {
      lines.push(`- _... and ${String(context.files.length - 20)} more files_`);
    }
  }

  return lines.join('\n');
};

/**
 * Format service context with API contracts and dependencies
 *
 * Formats full service context showing service metadata, type, dependencies,
 * dependents, API endpoints (up to 20 listed), and files (up to 20 listed).
 *
 * @param context - Service context object from get_service_context
 * @returns Formatted service context document in Markdown
 */
export const formatServiceContext = (context: ServiceContext): string => {
  const lines: string[] = [];

  lines.push(`# Service Context: \`${context.service.service_name}\`\n`);
  lines.push(`**Service ID:** \`${String(context.service.id)}\``);
  lines.push(`**Service Name:** \`${context.service.service_name}\``);
  lines.push(`**Service Type:** \`${context.service.service_type}\``);
  if (context.service.repo_id) {
    lines.push(`**Repository:** \`${context.service.repo_id}\``);
  }
  lines.push('');

  if (context.dependencies.length > 0) {
    lines.push(`## Dependencies (${String(context.dependencies.length)})\n`);
    for (const dep of context.dependencies) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  if (context.dependents.length > 0) {
    lines.push(`## Dependents (${String(context.dependents.length)})\n`);
    for (const dep of context.dependents) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  if (context.api_endpoints.length > 0) {
    lines.push(`## API Endpoints (${String(context.api_endpoints.length)})\n`);
    for (const endpoint of context.api_endpoints.slice(0, 20)) {
      lines.push(formatAPIEndpoint(endpoint));
      lines.push('');
    }
    if (context.api_endpoints.length > 20) {
      lines.push(`_... and ${String(context.api_endpoints.length - 20)} more endpoints_\n`);
    }
  }

  if (context.files.length > 0) {
    lines.push(`## Files (${String(context.files.length)})\n`);
    for (const file of context.files.slice(0, 20)) {
      lines.push(`- ${formatFilePath(file.file_path)} (${String(file.total_lines)} lines)`);
    }
    if (context.files.length > 20) {
      lines.push(`- _... and ${String(context.files.length - 20)} more files_`);
    }
  }

  return lines.join('\n');
};

/**
 * Format cross-workspace usage analysis
 *
 * Formats all usages of a target package across workspaces, grouped by
 * source workspace, showing file locations, symbol names, and import depth
 * (up to 10 usages per workspace).
 *
 * @param usages - Array of usage objects with workspace, symbol, file, and depth info
 * @param targetPackage - Name of the package being analyzed for usages
 * @returns Formatted cross-workspace usages document in Markdown
 */
export const formatCrossWorkspaceUsages = (
  usages: {
    source_workspace_id: string;
    source_package_name: string;
    symbol_name?: string;
    file_path: string;
    line_number: number;
    depth: number;
  }[],
  targetPackage: string
): string => {
  const lines: string[] = [];

  lines.push(`# Cross-Workspace Usages: \`${targetPackage}\`\n`);
  lines.push(`**Total Usages:** ${String(usages.length)}\n`);

  // Group by source workspace
  const byWorkspace = new Map<string, typeof usages>();
  for (const usage of usages) {
    const key = usage.source_package_name;
    if (!byWorkspace.has(key)) {
      byWorkspace.set(key, []);
    }
    const workspaceGroup = byWorkspace.get(key);
    if (workspaceGroup) {
      workspaceGroup.push(usage);
    }
  }

  for (const [packageName, workspaceUsages] of byWorkspace) {
    lines.push(`## ${packageName} (${String(workspaceUsages.length)} usages)\n`);

    for (const usage of workspaceUsages.slice(0, 10)) {
      lines.push(`- ${formatFilePath(usage.file_path)}:${String(usage.line_number)}`);
      if (usage.symbol_name) {
        lines.push(`  Symbol: \`${usage.symbol_name}\``);
      }
      if (usage.depth > 0) {
        lines.push(`  Depth: ${String(usage.depth)} (indirect)`);
      }
      lines.push('');
    }

    if (workspaceUsages.length > 10) {
      lines.push(`_... and ${String(workspaceUsages.length - 10)} more usages_\n`);
    }
  }

  return lines.join('\n');
};

/**
 * Format cross-service API call analysis
 *
 * Formats detected cross-service API calls grouped by source service,
 * showing target service, endpoint path, and call count.
 *
 * @param calls - Array of cross-service call objects with source, target, endpoint, and count
 * @returns Formatted cross-service calls document in Markdown
 */
export const formatCrossServiceCalls = (
  calls: {
    source_service_id: string;
    target_service_id: string;
    endpoint_path: string;
    call_count: number;
  }[]
): string => {
  const lines: string[] = [];

  lines.push('# Cross-Service API Calls\n');
  lines.push(`**Total Calls:** ${String(calls.length)}\n`);

  // Group by source service
  const bySource = new Map<string, typeof calls>();
  for (const call of calls) {
    const key = call.source_service_id;
    if (!bySource.has(key)) {
      bySource.set(key, []);
    }
    const sourceGroup = bySource.get(key);
    if (sourceGroup) {
      sourceGroup.push(call);
    }
  }

  for (const [serviceId, serviceCalls] of bySource) {
    lines.push(`## ${serviceId} (${String(serviceCalls.length)} calls)\n`);

    for (const call of serviceCalls) {
      lines.push(`### → ${call.target_service_id}\n`);
      lines.push(`**Endpoint:** \`${call.endpoint_path}\``);
      lines.push(`**Call Count:** ${String(call.call_count)}\n`);
    }
  }

  return lines.join('\n');
};

/**
 * Format API contract search results
 *
 * Formats semantic search results for API endpoints grouped by service,
 * showing endpoint path, HTTP method, API type, implementation file,
 * and similarity score.
 *
 * @param query - Original search query string
 * @param endpoints - Array of endpoint search results with service and similarity info
 * @returns Formatted API contract search results document in Markdown
 */
export const formatAPIContractResults = (
  query: string,
  endpoints: {
    service_id: string;
    service_name: string;
    endpoint_path: string;
    http_method?: string;
    api_type: 'rest' | 'graphql' | 'grpc';
    implementation_file?: string;
    similarity: number;
  }[]
): string => {
  const lines: string[] = [];

  lines.push('# API Contract Search\n');
  lines.push(`**Query:** \`${query}\``);
  lines.push(`**Results:** ${String(endpoints.length)}\n`);

  // Group by service
  const byService = new Map<string, typeof endpoints>();
  for (const endpoint of endpoints) {
    const key = endpoint.service_name;
    if (!byService.has(key)) {
      byService.set(key, []);
    }
    const serviceGroup = byService.get(key);
    if (serviceGroup) {
      serviceGroup.push(endpoint);
    }
  }

  for (const [serviceName, serviceEndpoints] of byService) {
    lines.push(`## ${serviceName} (${String(serviceEndpoints.length)} endpoints)\n`);

    for (const endpoint of serviceEndpoints) {
      const apiTypeBadge = endpoint.api_type.toUpperCase();
      const methodBadge = endpoint.http_method ? `[${endpoint.http_method}]` : '';

      lines.push(`### ${methodBadge} ${endpoint.endpoint_path}\n`);
      lines.push(`**Type:** \`${apiTypeBadge}\``);
      lines.push(`**Similarity:** ${(endpoint.similarity * 100).toFixed(1)}%`);

      if (endpoint.implementation_file) {
        lines.push(`**Implementation:** ${formatFilePath(endpoint.implementation_file)}`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
};
