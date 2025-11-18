/**
 * Indexing strategy based on repository type
 * Defines which indexing steps to perform for different repo types
 */
import type { RepositoryType } from '@/types/database';

/**
 * Indexing options for a repository
 */
export interface IndexingOptions {
  // Workspace detection
  detect_workspaces: boolean; // Detect monorepo workspaces
  resolve_workspace_aliases: boolean; // Resolve @workspace/* imports
  parse_tsconfig_paths: boolean; // Parse TypeScript path aliases

  // Service detection
  detect_services: boolean; // Detect microservices
  detect_api_endpoints: boolean; // Extract API endpoints from code
  parse_api_contracts: boolean; // Parse OpenAPI/GraphQL/gRPC specs

  // Dependency tracking
  detect_cross_repo_deps: boolean; // Track cross-repository dependencies
  build_dependency_graph: boolean; // Build internal dependency graph

  // File processing
  include_markdown: boolean; // Index markdown files
  focus_on_patterns: boolean; // Optimize for learning patterns (reference repos)

  // Summary generation
  generate_file_summaries: boolean; // Use LLM to generate file summaries
  summary_depth: 'full' | 'structure' | 'minimal'; // How detailed to make summaries
}

/**
 * Default indexing strategy for each repository type
 */
const INDEXING_STRATEGIES: Record<RepositoryType, IndexingOptions> = {
  // Monolithic: Standard indexing for single-application repositories
  monolithic: {
    detect_workspaces: false,
    resolve_workspace_aliases: false,
    parse_tsconfig_paths: true,
    detect_services: false,
    detect_api_endpoints: true,
    parse_api_contracts: true,
    detect_cross_repo_deps: false,
    build_dependency_graph: false,
    include_markdown: false,
    focus_on_patterns: false,
    generate_file_summaries: true,
    summary_depth: 'full',
  },

  // Monorepo: Full workspace support with internal dependencies
  monorepo: {
    detect_workspaces: true,
    resolve_workspace_aliases: true,
    parse_tsconfig_paths: true,
    detect_services: false,
    detect_api_endpoints: true,
    parse_api_contracts: true,
    detect_cross_repo_deps: false,
    build_dependency_graph: true,
    include_markdown: false,
    focus_on_patterns: false,
    generate_file_summaries: true,
    summary_depth: 'full',
  },

  // Microservice: Service boundaries and API contracts
  microservice: {
    detect_workspaces: false,
    resolve_workspace_aliases: false,
    parse_tsconfig_paths: true,
    detect_services: true,
    detect_api_endpoints: true,
    parse_api_contracts: true,
    detect_cross_repo_deps: true,
    build_dependency_graph: false,
    include_markdown: false,
    focus_on_patterns: false,
    generate_file_summaries: true,
    summary_depth: 'full',
  },

  // Library: Your own shared library repositories
  library: {
    detect_workspaces: false,
    resolve_workspace_aliases: false,
    parse_tsconfig_paths: true,
    detect_services: false,
    detect_api_endpoints: false,
    parse_api_contracts: false,
    detect_cross_repo_deps: false,
    build_dependency_graph: false,
    include_markdown: true, // Include library docs
    focus_on_patterns: false,
    generate_file_summaries: true,
    summary_depth: 'full',
  },

  // Reference: Lightweight indexing for external frameworks (e.g., NestJS)
  reference: {
    detect_workspaces: false, // Skip workspace detection
    resolve_workspace_aliases: false, // Don't resolve aliases
    parse_tsconfig_paths: false, // Don't parse tsconfig
    detect_services: false, // Skip service detection
    detect_api_endpoints: false, // Don't extract API endpoints
    parse_api_contracts: false, // Don't parse API specs
    detect_cross_repo_deps: false, // Never link to main code
    build_dependency_graph: false, // No dependency graph
    include_markdown: true, // Include README and docs
    focus_on_patterns: true, // Optimize for learning patterns
    generate_file_summaries: true, // Still generate summaries
    summary_depth: 'structure', // Structure-focused summaries
  },

  // Documentation: Index markdown files only
  documentation: {
    detect_workspaces: false,
    resolve_workspace_aliases: false,
    parse_tsconfig_paths: false,
    detect_services: false,
    detect_api_endpoints: false,
    parse_api_contracts: false,
    detect_cross_repo_deps: false,
    build_dependency_graph: false,
    include_markdown: true, // Primary purpose
    focus_on_patterns: false,
    generate_file_summaries: false, // Markdown is already readable
    summary_depth: 'minimal', // Minimal processing
  },
};

/**
 * Get indexing strategy for a repository type
 *
 * @param repoType - Repository type
 * @param overrides - Optional overrides to strategy
 * @returns Indexing options
 */
export const getIndexingStrategy = (
  repoType: RepositoryType,
  overrides?: Partial<IndexingOptions>
): IndexingOptions => {
  const baseStrategy = INDEXING_STRATEGIES[repoType];

  if (!overrides) {
    return baseStrategy;
  }

  // Merge overrides with base strategy
  return {
    ...baseStrategy,
    ...overrides,
  };
};

/**
 * Check if workspace detection should be performed
 */
export const shouldDetectWorkspaces = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_workspaces;
};

/**
 * Check if service detection should be performed
 */
export const shouldDetectServices = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_services;
};

/**
 * Check if API contract parsing should be performed
 */
export const shouldParseAPIContracts = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].parse_api_contracts;
};

/**
 * Check if cross-repository dependencies should be detected
 */
export const shouldDetectCrossRepoDeps = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_cross_repo_deps;
};

/**
 * Check if markdown files should be included
 */
export const shouldIncludeMarkdown = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].include_markdown;
};

/**
 * Get summary generation depth for a repository type
 */
export const getSummaryDepth = (repoType: RepositoryType): 'full' | 'structure' | 'minimal' => {
  return INDEXING_STRATEGIES[repoType].summary_depth;
};

/**
 * Performance estimates for different repository types
 * Helps users understand indexing time expectations
 */
export const INDEXING_PERFORMANCE = {
  monolithic: {
    filesPerMinute: 300,
    description: 'Standard indexing with full LLM summaries',
  },
  monorepo: {
    filesPerMinute: 250,
    description: 'Includes workspace detection and dependency graph',
  },
  microservice: {
    filesPerMinute: 280,
    description: 'Includes API contract parsing',
  },
  library: {
    filesPerMinute: 350,
    description: 'Lightweight indexing with docs',
  },
  reference: {
    filesPerMinute: 500,
    description: 'Fast indexing optimized for learning patterns',
  },
  documentation: {
    filesPerMinute: 1000,
    description: 'Markdown-only indexing, very fast',
  },
} as const;

/**
 * Get estimated indexing time
 *
 * @param repoType - Repository type
 * @param fileCount - Number of files to index
 * @returns Estimated time in minutes
 */
export const estimateIndexingTime = (repoType: RepositoryType, fileCount: number): number => {
  const filesPerMinute = INDEXING_PERFORMANCE[repoType].filesPerMinute;
  return Math.ceil(fileCount / filesPerMinute);
};
