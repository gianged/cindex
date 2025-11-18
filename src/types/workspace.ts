/**
 * Workspace detection and configuration types
 * Supports: Turborepo, Nx, Lerna, pnpm workspaces, npm workspaces, Yarn workspaces
 */

/**
 * Detected workspace configuration from repository root
 */
export interface WorkspaceConfig {
  type: WorkspaceConfigType;
  root_path: string;
  config_file: string;
  workspaces: WorkspacePattern[];
  metadata?: WorkspaceConfigMetadata;
}

/**
 * Workspace configuration types
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
 * Workspace pattern (from config file)
 */
export interface WorkspacePattern {
  pattern: string; // Glob pattern (e.g., 'packages/*', 'apps/*')
  resolved_paths: string[]; // Actual filesystem paths matching pattern
}

/**
 * Workspace configuration metadata
 */
export interface WorkspaceConfigMetadata {
  version?: string; // Config format version
  tool_version?: string; // Tool version (nx, turbo, etc.)
  [key: string]: unknown;
}

/**
 * Detected workspace/package information
 */
export interface DetectedWorkspace {
  workspace_id: string; // Generated unique ID
  package_name: string; // From package.json name field
  workspace_path: string; // Relative path from repo root
  package_json: PackageJsonInfo;
  tsconfig?: TsConfigInfo; // If TypeScript workspace
  dependencies: WorkspaceDependencyInfo;
}

/**
 * package.json information
 */
export interface PackageJsonInfo {
  path: string; // Absolute path to package.json
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

/**
 * tsconfig.json information (for TypeScript workspaces)
 */
export interface TsConfigInfo {
  path: string;
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
    rootDir?: string;
    outDir?: string;
    [key: string]: unknown;
  };
  include?: string[];
  exclude?: string[];
  references?: { path: string }[];
}

/**
 * Workspace dependency information
 */
export interface WorkspaceDependencyInfo {
  internal: InternalDependency[]; // Dependencies on other workspaces
  external: ExternalDependency[]; // Dependencies on external packages
}

/**
 * Internal workspace dependency (within monorepo)
 */
export interface InternalDependency {
  package_name: string; // e.g., '@workspace/shared'
  workspace_id: string; // Resolved workspace ID
  version: string; // Version specifier from package.json
  type: 'runtime' | 'dev' | 'peer';
}

/**
 * External package dependency (npm, etc.)
 */
export interface ExternalDependency {
  package_name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer';
}

/**
 * Workspace resolution result (resolve @workspace/pkg → filesystem path)
 */
export interface WorkspaceResolution {
  alias: string; // Original alias (e.g., '@workspace/shared')
  resolved_path: string; // Filesystem path
  workspace_id: string;
  package_name: string;
  resolution_type: 'npm_workspace' | 'tsconfig_path' | 'custom';
}

/**
 * Workspace import statement analysis
 */
export interface WorkspaceImport {
  import_statement: string; // Original import string
  module_specifier: string; // The imported module
  is_internal: boolean; // Whether it's an internal workspace import
  resolution: WorkspaceResolution | null; // Resolved path (if internal)
  symbols: string[]; // Imported symbols
}

/**
 * Workspace boundary configuration (for import chain expansion)
 */
export interface WorkspaceBoundary {
  respect_boundaries: boolean; // Don't cross workspace boundaries
  max_depth_within_workspace: number; // Default: 2
  max_depth_cross_workspace: number; // Default: 1
  excluded_workspaces?: string[]; // Don't expand into these workspaces
}

/**
 * Workspace indexing options
 */
export interface WorkspaceIndexingOptions {
  detect_workspaces: boolean; // Enable workspace detection (default: true)
  respect_workspace_boundaries: boolean; // Don't cross boundaries (default: false)
  index_workspace_dependencies: boolean; // Index internal deps (default: true)
  resolve_workspace_aliases: boolean; // Resolve @workspace/* (default: true)
  parse_tsconfig_paths: boolean; // Parse TypeScript paths (default: true)
  excluded_workspaces?: string[]; // Workspace IDs to exclude
  included_workspaces?: string[]; // Only index these workspaces (if specified)
}

/**
 * Workspace search filters (for MCP tools)
 */
export interface WorkspaceSearchFilter {
  workspace_ids?: string[]; // Filter by workspace IDs
  package_names?: string[]; // Filter by package names
  exclude_workspaces?: string[]; // Exclude these workspaces
  include_workspace_deps?: boolean; // Include dependencies in results
}
