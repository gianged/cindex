/**
 * MCP Tool: index_repository
 * Index or re-index a codebase with progress notifications
 */
import path from 'node:path';

import { type IndexingOrchestrator } from '@indexing/orchestrator';
import { formatIndexingStats, type IndexingStats } from '@mcp/formatter';
import {
  validateArray,
  validateBoolean,
  validateLanguages,
  validateMaxFileSize,
  validateObject,
  validateRepoId,
  validateRepoPath,
  validateRepoType,
  validateString,
  validateSummaryMethod,
} from '@mcp/validator';
import { clearAllCaches } from '@utils/cache';
import { logger } from '@utils/logger';
import { type RepositoryType } from '@/types/database';
import { type IndexingOptions } from '@/types/indexing';

/**
 * Input schema for index_repository tool
 */
export interface IndexRepositoryInput {
  // Core parameters
  repo_path: string; // Absolute path to repository root
  incremental?: boolean; // Default: true - Skip unchanged files
  languages?: string[]; // Filter by languages (empty = all)
  include_markdown?: boolean; // Default: false - Index markdown files
  respect_gitignore?: boolean; // Default: true - Respect .gitignore
  max_file_size?: number; // Default: 5000 lines - Max file size in lines
  protect_secrets?: boolean; // Default: true - Detect and exclude secret files (.env, credentials, keys)
  secret_patterns?: string[]; // Custom patterns for secret detection (glob-style)
  summary_method?: 'llm' | 'rule-based'; // Default: llm - Summary generation method

  // Repository configuration
  repo_id?: string; // Unique repository ID (auto-generated if not provided)
  repo_name?: string; // Human-readable name
  repo_type?: RepositoryType; // Repository type (monolithic, microservice, monorepo, library, reference, documentation)

  // Multi-project options
  detect_workspaces?: boolean; // Default: true - Detect workspace packages
  workspace_config?: {
    detect_pnpm?: boolean;
    detect_npm?: boolean;
    detect_yarn?: boolean;
    detect_lerna?: boolean;
    detect_nx?: boolean;
    detect_turborepo?: boolean;
    custom_patterns?: string[];
    parse_tsconfig_paths?: boolean;
    excluded_workspaces?: string[];
    included_workspaces?: string[];
  };
  resolve_workspace_aliases?: boolean; // Default: true - Resolve tsconfig paths

  // Service detection
  detect_services?: boolean; // Default: true - Detect services
  service_config?: {
    detect_from_directories?: boolean;
    detect_from_docker_compose?: boolean;
    detect_from_package_json?: boolean;
    detect_from_api_routes?: boolean;
    custom_patterns?: string[];
    excluded_services?: string[];
    included_services?: string[];
  };
  detect_api_endpoints?: boolean; // Default: true - Detect API endpoints

  // Multi-repo linking
  link_to_repos?: string[]; // Link to other indexed repos
  update_cross_repo_deps?: boolean; // Update cross-repo dependencies

  // Reference repository options
  version?: string; // Version for reference repos (e.g., "v10.3.0")
  force_reindex?: boolean; // Default: false - Force reindex even if version matches
  metadata?: {
    upstream_url?: string; // Upstream URL for reference repos
    indexed_for?: string; // Purpose of indexing
    documentation_type?: string; // Type of documentation (if repo_type=documentation)
    exclude_from_default_search?: boolean; // Exclude from default search
  };
}

/**
 * Output schema for index_repository tool
 */
export interface IndexRepositoryOutput {
  formatted_result: string; // Markdown-formatted statistics
  stats: IndexingStats; // Raw statistics
}

/**
 * Progress callback for MCP notifications
 *
 * Implementation Status: COMPLETE
 *
 * Uses MCP SDK's `sendLoggingMessage()` method to send structured progress
 * updates to the MCP client during long-running indexing operations (10-30+ minutes).
 *
 * Implementation Details:
 * - Method: McpServer.sendLoggingMessage() with level="info"
 * - Format: Structured JSON data with type="progress"
 * - Fields: stage, current, total, percentage, message, eta_seconds, timestamp
 * - Logger: "cindex.indexing" for easy filtering in MCP logs
 * - Error Handling: Progress notification failures don't interrupt indexing
 *
 * User Experience:
 * - Progress messages appear in MCP server logs (Claude Code settings > MCP Servers > cindex > Logs)
 * - Real-time visibility into 9-stage indexing pipeline:
 *   1. File Discovery, 2. Code Parsing, 3. Summary Generation, 4. Embedding Generation,
 *   5. Symbol Extraction, 6. Database Writing, 7. Workspace Detection,
 *   8. Service Detection, 9. API Contract Parsing
 * - Includes: Current/total counts, percentage complete, ETA in seconds
 *
 * Technical Notes:
 * - MCP protocol supports `notifications/message` (LoggingMessageNotification)
 * - Custom progress notifications are not well-supported by most MCP clients
 * - This approach uses standard logging infrastructure for maximum compatibility
 * - Future: If Claude Code adds UI for logging messages, progress will auto-display
 *
 * References:
 * - MCP SDK: @modelcontextprotocol/sdk v1.22.0+
 * - Implementation: src/index.ts (index_repository tool registration)
 */
type ProgressCallback = (progress: {
  stage: string;
  current: number;
  total: number;
  message: string;
  eta_seconds?: number;
}) => void;

/**
 * Index repository MCP tool implementation
 *
 * @param orchestrator - Indexing orchestrator
 * @param input - Index repository parameters
 * @param onProgress - Progress callback for MCP notifications (optional)
 * @returns Formatted indexing statistics
 */
export const indexRepositoryTool = async (
  orchestrator: IndexingOrchestrator,
  input: IndexRepositoryInput,
  onProgress?: ProgressCallback
): Promise<IndexRepositoryOutput> => {
  logger.info('index_repository tool invoked', { repo_path: input.repo_path });

  // Validate required parameters
  const repoPath = validateRepoPath(input.repo_path, true);
  if (!repoPath) throw new Error('repo_path validation failed');

  // Validate optional core parameters
  const incremental = validateBoolean('incremental', input.incremental, false) ?? true;
  const languages = validateLanguages(input.languages, false);
  const includeMarkdown = validateBoolean('include_markdown', input.include_markdown, false) ?? false;
  const respectGitignore = validateBoolean('respect_gitignore', input.respect_gitignore, false) ?? true;
  const maxFileSize = validateMaxFileSize(input.max_file_size, false) ?? 5000;
  const protectSecrets = validateBoolean('protect_secrets', input.protect_secrets, false) ?? true;
  const secretPatterns = validateArray('secret_patterns', input.secret_patterns, false) as string[] | undefined;
  const summaryMethod = validateSummaryMethod(input.summary_method, false) ?? 'llm';

  // Validate repository configuration
  // Auto-generate repo_id from folder name if not provided
  const validatedRepoId = validateRepoId(input.repo_id, false);
  const repoId = validatedRepoId ?? path.basename(repoPath);
  const repoName = validateString('repo_name', input.repo_name, false);
  const repoType = validateRepoType(input.repo_type, false);

  // Validate multi-project options
  const detectWorkspaces = validateBoolean('detect_workspaces', input.detect_workspaces, false) ?? true;
  const workspaceConfig = validateObject('workspace_config', input.workspace_config, false);
  const resolveWorkspaceAliases =
    validateBoolean('resolve_workspace_aliases', input.resolve_workspace_aliases, false) ?? true;

  const detectServices = validateBoolean('detect_services', input.detect_services, false) ?? true;
  const serviceConfig = validateObject('service_config', input.service_config, false);
  const detectApiEndpoints = validateBoolean('detect_api_endpoints', input.detect_api_endpoints, false) ?? true;

  const linkToRepos = validateArray('link_to_repos', input.link_to_repos, false) as string[] | undefined;
  const updateCrossRepoDeps = validateBoolean('update_cross_repo_deps', input.update_cross_repo_deps, false) ?? false;

  // Validate reference repository options
  const version = validateString('version', input.version, false);
  const forceReindex = validateBoolean('force_reindex', input.force_reindex, false) ?? false;
  const metadata = validateObject('metadata', input.metadata, false) as
    | {
        upstream_url?: string;
        indexed_for?: string;
        documentation_type?: string;
        exclude_from_default_search?: boolean;
      }
    | undefined;

  logger.debug('Building indexing options', {
    repoPath,
    incremental,
    repoType,
    detectWorkspaces,
    detectServices,
  });

  // Build IndexingOptions
  const options: IndexingOptions = {
    // Core options
    incremental,
    languages: languages ?? [],
    includeMarkdown,
    respectGitignore,
    maxFileSize,
    protectSecrets,
    secretPatterns: secretPatterns ?? [],
    summaryMethod,

    // Repository configuration
    repoId,
    repoName,
    repoType,

    // Multi-project options
    detectWorkspaces,
    workspaceConfig: workspaceConfig as unknown,
    resolveWorkspaceAliases,

    detectServices,
    serviceConfig: serviceConfig as unknown,
    detectApiEndpoints,

    linkToRepos,
    updateCrossRepoDeps,

    // Reference repository options
    version,
    forceReindex,
    metadata,

    // Progress callback
    onProgress: onProgress
      ? (stage: string, current: number, total: number, message: string, etaSeconds?: number) => {
          onProgress({
            stage,
            current,
            total,
            message,
            eta_seconds: etaSeconds,
          });

          // Also log to stderr for MCP server logging
          logger.info('Indexing progress', {
            stage,
            current,
            total,
            percentage: total > 0 ? ((current / total) * 100).toFixed(1) : 0,
            message,
            eta_seconds: etaSeconds,
          });
        }
      : undefined,
  };

  logger.info('Starting repository indexing', {
    repo_path: repoPath,
    repo_type: repoType,
    incremental,
  });

  // Execute indexing
  const stats = await orchestrator.indexRepository(repoPath, options);

  logger.info('index_repository completed', {
    repo_path: repoPath,
    files_indexed: stats.files_indexed,
    chunks_created: stats.chunks_created,
    symbols_extracted: stats.symbols_extracted,
    indexing_time_ms: stats.indexing_time_ms,
  });

  // Clear all caches after successful indexing
  // This ensures search results, query embeddings, and API endpoints are refreshed
  clearAllCaches();
  logger.info('Caches cleared after successful indexing');

  // Transform stats for output
  const transformedStats: IndexingStats = {
    repo_id: repoId,
    repo_type: (repoType ?? 'monolithic') as RepositoryType,
    files_indexed: stats.files_indexed,
    chunks_created: stats.chunks_created,
    symbols_extracted: stats.symbols_extracted,
    workspaces_detected: stats.workspaces_detected,
    services_detected: stats.services_detected,
    api_endpoints_found: stats.api_endpoints_found,
    indexing_time_ms: stats.indexing_time_ms,
    errors: stats.errors.length > 0 ? stats.errors.map((e) => e.error) : undefined,
  };

  // Format result
  const formattedResult = formatIndexingStats(transformedStats);

  return {
    formatted_result: formattedResult,
    stats: transformedStats,
  };
};
