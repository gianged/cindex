/**
 * Indexing Strategy Module
 *
 * Defines repository-specific indexing strategies based on repository type.
 * Each repo type (monolithic, monorepo, microservice, library, reference, documentation)
 * has optimized indexing settings for its specific use case.
 *
 * Strategy impacts:
 * - Which detection steps run (workspaces, services, APIs)
 * - What files get indexed (code, markdown, docs)
 * - How deep summaries are generated
 * - Whether dependency graphs are built
 */
import { type RepositoryType } from '@/types/database';

/**
 * Indexing strategy configuration for a repository type
 *
 * Defines which indexing operations should be performed based on the repository's
 * purpose and structure. Enables or disables specific detection and processing steps
 * to optimize for different use cases (your code vs reference frameworks).
 */
export interface RepositoryIndexingStrategy {
  /**
   * Detect monorepo workspaces (pnpm-workspace.yaml, package.json workspaces)
   * Required for: monorepo, library codebases with multiple packages
   */
  detect_workspaces: boolean;

  /**
   * Resolve workspace-scoped imports (@workspace/*, @orgname/*)
   * Enables import chain traversal across workspace packages
   */
  resolve_workspace_aliases: boolean;

  /**
   * Parse TypeScript path aliases from tsconfig.json compilerOptions.paths
   * Resolves custom import paths (@/*, ~/*) to filesystem locations
   */
  parse_tsconfig_paths: boolean;

  /**
   * Detect microservice boundaries (services/*, apps/*, docker-compose services)
   * Identifies individual services in microservice architectures
   */
  detect_services: boolean;

  /**
   * Extract API endpoints from code (Express routes, NestJS decorators, GraphQL)
   * Builds searchable index of REST/GraphQL/gRPC endpoints
   */
  detect_api_endpoints: boolean;

  /**
   * Parse API specification files (OpenAPI/Swagger, GraphQL schemas, gRPC protos)
   * Links spec definitions to implementation code
   */
  parse_api_contracts: boolean;

  /**
   * Track cross-repository dependencies (service A calls service B's API)
   * Required for multi-repo microservice architectures
   */
  detect_cross_repo_deps: boolean;

  /**
   * Build internal dependency graph (workspace A depends on workspace B)
   * Maps package-to-package dependencies within a monorepo
   */
  build_dependency_graph: boolean;

  /**
   * Include markdown files in indexing (README.md, docs/, *.md)
   * Useful for library docs and documentation repos
   */
  include_markdown: boolean;

  /**
   * Optimize for learning code patterns (reference repositories only)
   * Skips heavy workspace/service detection for faster indexing
   */
  focus_on_patterns: boolean;

  /**
   * Generate LLM-based file summaries using Ollama
   * Disable for documentation repos (markdown is already readable)
   */
  generate_file_summaries: boolean;

  /**
   * Summary generation depth
   * - 'full': Detailed LLM summaries with context
   * - 'structure': Structure-focused (functions, classes)
   * - 'minimal': Lightweight metadata only
   */
  summary_depth: 'full' | 'structure' | 'minimal';
}

/**
 * Default indexing strategy for each repository type
 */
const INDEXING_STRATEGIES: Record<RepositoryType, RepositoryIndexingStrategy> = {
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
 * @returns Indexing strategy configuration
 */
export const getIndexingStrategy = (
  repoType: RepositoryType,
  overrides?: Partial<RepositoryIndexingStrategy>
): RepositoryIndexingStrategy => {
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
 * Check if workspace detection should be performed for this repository type
 *
 * @param repoType - Repository type to check
 * @returns True if workspace detection is enabled for this type
 */
export const shouldDetectWorkspaces = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_workspaces;
};

/**
 * Check if service detection should be performed for this repository type
 *
 * @param repoType - Repository type to check
 * @returns True if service detection is enabled for this type
 */
export const shouldDetectServices = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_services;
};

/**
 * Check if API contract parsing should be performed for this repository type
 *
 * @param repoType - Repository type to check
 * @returns True if API parsing is enabled for this type
 */
export const shouldParseAPIContracts = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].parse_api_contracts;
};

/**
 * Check if cross-repository dependencies should be detected for this repository type
 *
 * @param repoType - Repository type to check
 * @returns True if cross-repo dependency tracking is enabled for this type
 */
export const shouldDetectCrossRepoDeps = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].detect_cross_repo_deps;
};

/**
 * Check if markdown files should be included in indexing for this repository type
 *
 * @param repoType - Repository type to check
 * @returns True if markdown indexing is enabled for this type
 */
export const shouldIncludeMarkdown = (repoType: RepositoryType): boolean => {
  return INDEXING_STRATEGIES[repoType].include_markdown;
};

/**
 * Get summary generation depth for a repository type
 *
 * Determines how detailed file summaries should be based on repository purpose.
 * Reference repos use 'structure', documentation repos use 'minimal', others use 'full'.
 *
 * @param repoType - Repository type to get depth for
 * @returns Summary generation depth level
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
