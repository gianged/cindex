/**
 * Workspace detection and configuration types for monorepo support
 *
 * Supports: Turborepo, Nx, Lerna, pnpm workspaces, npm workspaces, Yarn workspaces
 */

/**
 * Detected workspace configuration from repository root
 */
export interface WorkspaceConfig {
  /** Workspace tool/format type */
  type: WorkspaceConfigType;
  /** Absolute path to repository root */
  root_path: string;
  /** Configuration file name (e.g., pnpm-workspace.yaml, lerna.json) */
  config_file: string;
  /** Workspace glob patterns and resolved paths */
  workspaces: WorkspacePattern[];
  /** Additional workspace configuration metadata */
  metadata?: WorkspaceConfigMetadata;
}

/**
 * Workspace configuration types
 *
 * Supported monorepo tools and their config files
 */
export type WorkspaceConfigType =
  | 'pnpm' // pnpm-workspace.yaml
  | 'npm' // package.json workspaces
  | 'yarn' // package.json workspaces + yarn.lock
  | 'lerna' // lerna.json
  | 'nx' // nx.json
  | 'turborepo' // turbo.json
  | 'rush' // rush.json
  | 'none'; // Single package (monolithic)

/**
 * Workspace pattern from config file with resolved paths
 */
export interface WorkspacePattern {
  /** Glob pattern from config (e.g., 'packages/*', 'apps/*') */
  pattern: string;
  /** Actual filesystem paths matching this pattern */
  resolved_paths: string[];
}

/**
 * Workspace configuration metadata
 */
export interface WorkspaceConfigMetadata {
  /** Config format version (if specified) */
  version?: string;
  /** Tool version (nx, turbo, etc.) */
  tool_version?: string;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Detected workspace/package information in monorepo
 */
export interface DetectedWorkspace {
  /** Generated unique identifier */
  workspace_id: string;
  /** Package name from package.json */
  package_name: string;
  /** Relative path from repository root */
  workspace_path: string;
  /** Parsed package.json contents */
  package_json: PackageJsonInfo;
  /** TypeScript configuration (if present) */
  tsconfig?: TsConfigInfo;
  /** Workspace dependencies (internal and external) */
  dependencies: WorkspaceDependencyInfo;
}

/**
 * Parsed package.json information
 */
export interface PackageJsonInfo {
  /** Absolute path to package.json file */
  path: string;
  /** Package name */
  name: string;
  /** Package version */
  version: string;
  /** Whether package is private */
  private?: boolean;
  /** Main entry point */
  main?: string;
  /** TypeScript types entry point */
  types?: string;
  /** Package exports map */
  exports?: Record<string, unknown>;
  /** npm scripts */
  scripts?: Record<string, string>;
  /** Runtime dependencies */
  dependencies?: Record<string, string>;
  /** Development dependencies */
  devDependencies?: Record<string, string>;
  /** Peer dependencies */
  peerDependencies?: Record<string, string>;
  /** Workspace patterns (for root package.json) */
  workspaces?: string[] | { packages: string[] };
}

/**
 * Parsed tsconfig.json information for TypeScript workspaces
 */
export interface TsConfigInfo {
  /** Absolute path to tsconfig.json file */
  path: string;
  /** Extended configuration file paths */
  extends?: string | string[];
  /** TypeScript compiler options */
  compilerOptions?: {
    /** Base directory for module resolution */
    baseUrl?: string;
    /** Path aliases for imports (e.g., @workspace/*) */
    paths?: Record<string, string[]>;
    /** Root directory for source files */
    rootDir?: string;
    /** Output directory for compiled files */
    outDir?: string;
    /** Additional compiler options */
    [key: string]: unknown;
  };
  /** Include patterns for compilation */
  include?: string[];
  /** Exclude patterns for compilation */
  exclude?: string[];
  /** Project references for composite projects */
  references?: { path: string }[];
}

/**
 * Workspace dependency information (internal and external)
 */
export interface WorkspaceDependencyInfo {
  /** Dependencies on other workspaces in monorepo */
  internal: InternalDependency[];
  /** Dependencies on external npm packages */
  external: ExternalDependency[];
}

/**
 * Internal workspace dependency within monorepo
 */
export interface InternalDependency {
  /** Package name (e.g., '@workspace/shared') */
  package_name: string;
  /** Resolved workspace identifier */
  workspace_id: string;
  /** Version specifier from package.json */
  version: string;
  /** Dependency type classification */
  type: 'runtime' | 'dev' | 'peer';
}

/**
 * External npm package dependency
 */
export interface ExternalDependency {
  /** Package name */
  package_name: string;
  /** Version specifier */
  version: string;
  /** Dependency type classification */
  type: 'runtime' | 'dev' | 'peer';
}

/**
 * Workspace alias resolution result (e.g., @workspace/pkg → filesystem path)
 */
export interface WorkspaceResolution {
  /** Original import alias */
  alias: string;
  /** Resolved filesystem path */
  resolved_path: string;
  /** Workspace identifier */
  workspace_id: string;
  /** Package name */
  package_name: string;
  /** Resolution strategy used */
  resolution_type: 'npm_workspace' | 'tsconfig_path' | 'custom';
}

/**
 * Workspace import statement analysis result
 */
export interface WorkspaceImport {
  /** Original import statement text */
  import_statement: string;
  /** Module specifier being imported */
  module_specifier: string;
  /** Whether this is an internal workspace import */
  is_internal: boolean;
  /** Resolved path (only for internal imports) */
  resolution: WorkspaceResolution | null;
  /** Imported symbols from module */
  symbols: string[];
}

/**
 * Workspace boundary configuration for import chain expansion
 */
export interface WorkspaceBoundary {
  /** Don't cross workspace boundaries during expansion */
  respect_boundaries: boolean;
  /** Maximum depth within same workspace */
  max_depth_within_workspace: number;
  /** Maximum depth when crossing workspace boundaries */
  max_depth_cross_workspace: number;
  /** Workspace IDs to exclude from expansion */
  excluded_workspaces?: string[];
}

/**
 * Workspace detection and indexing options
 */
export interface WorkspaceIndexingOptions {
  /** Enable workspace detection (default: true) */
  detect_workspaces: boolean;
  /** Don't cross workspace boundaries (default: false) */
  respect_workspace_boundaries: boolean;
  /** Index internal workspace dependencies (default: true) */
  index_workspace_dependencies: boolean;
  /** Resolve @workspace/* aliases (default: true) */
  resolve_workspace_aliases: boolean;
  /** Parse TypeScript path mappings (default: true) */
  parse_tsconfig_paths: boolean;
  /** Workspace IDs to exclude from indexing */
  excluded_workspaces?: string[];
  /** Only index these workspaces (if specified) */
  included_workspaces?: string[];
}

/**
 * Workspace search filters for MCP tools
 */
export interface WorkspaceSearchFilter {
  /** Filter by workspace identifiers */
  workspace_ids?: string[];
  /** Filter by package names */
  package_names?: string[];
  /** Exclude these workspaces from results */
  exclude_workspaces?: string[];
  /** Include workspace dependencies in results */
  include_workspace_deps?: boolean;
}
