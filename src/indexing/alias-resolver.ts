/**
 * Alias Resolver: Import Alias Resolution for Monorepos
 *
 * Resolves various import alias patterns:
 * - Workspace imports: @workspace/package-name
 * - Scoped packages: @myorg/package-name
 * - TypeScript path aliases: @/*, ~/*, etc.
 * - Relative imports: ./*, ../*, (resolved to absolute paths)
 *
 * Builds alias cache for fast lookups during import chain traversal.
 */

import * as path from 'node:path';

import type { WorkspaceConfig } from '@indexing/workspace-detector';
import { logger } from '@utils/logger';

/**
 * Alias resolution result
 */
export interface AliasResolution {
  /** Original import path */
  original: string;

  /** Resolved absolute filesystem path */
  resolved: string;

  /** Whether this is a workspace-internal import */
  isInternal: boolean;

  /** Alias type */
  type: 'workspace' | 'tsconfig' | 'relative' | 'external';

  /** Workspace package name (if workspace import) */
  packageName?: string;
}

/**
 * Alias resolver for monorepo import resolution
 */
export class AliasResolver {
  private aliasCache = new Map<string, string>();
  private packageNameToPath = new Map<string, string>();
  private tsconfigAliases = new Map<string, string[]>();

  constructor(
    private readonly workspaceConfig: WorkspaceConfig,
    private readonly currentFilePath: string
  ) {
    this.buildAliasCache();
  }

  /**
   * Resolve import path to absolute filesystem path
   *
   * @param importPath - Import specifier (e.g., '@workspace/pkg', './utils', '@/components')
   * @returns Alias resolution result
   */
  public resolveAlias = (importPath: string): AliasResolution => {
    // 1. Check if it's a workspace package import
    const workspaceResolution = this.resolveWorkspaceAlias(importPath);
    if (workspaceResolution) {
      return workspaceResolution;
    }

    // 2. Check if it's a TypeScript path alias
    const tsconfigResolution = this.resolveTsConfigPath(importPath);
    if (tsconfigResolution) {
      return tsconfigResolution;
    }

    // 3. Check if it's a relative import
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      return this.resolveRelativePath(importPath);
    }

    // 4. External import (node_modules)
    return {
      original: importPath,
      resolved: importPath, // Keep as-is for external imports
      isInternal: false,
      type: 'external',
    };
  };

  /**
   * Resolve workspace package alias (@workspace/pkg-name, @scope/pkg-name)
   */
  public resolveWorkspaceAlias = (importPath: string): AliasResolution | null => {
    // Extract package name (handle scoped packages)
    let packageName: string;

    if (importPath.startsWith('@')) {
      // Scoped package: @workspace/package-name/module → @workspace/package-name
      const parts = importPath.split('/');
      packageName = `${parts[0]}/${parts[1]}`;
    } else {
      // Unscoped package: package-name/module → package-name
      packageName = importPath.split('/')[0];
    }

    // Check if this package exists in workspace
    const packagePath = this.packageNameToPath.get(packageName);
    if (!packagePath) {
      return null;
    }

    // Build resolved path
    const modulePath = importPath.substring(packageName.length + 1); // Remove package name
    const resolved = modulePath ? path.join(packagePath, modulePath) : packagePath;

    logger.debug('Resolved workspace alias', {
      original: importPath,
      resolved,
      package: packageName,
    });

    return {
      original: importPath,
      resolved,
      isInternal: true,
      type: 'workspace',
      packageName,
    };
  };

  /**
   * Resolve TypeScript path alias from tsconfig.json paths
   *
   * Example: @/components/Button → /workspace/root/src/components/Button
   */
  public resolveTsConfigPath = (importPath: string): AliasResolution | null => {
    for (const [alias, targetPaths] of this.tsconfigAliases.entries()) {
      // Check if import matches alias pattern
      // Handle wildcards: @/* matches @/anything
      const aliasPattern = alias.replace('*', '(.*)');
      const regex = new RegExp(`^${aliasPattern}$`);
      const match = importPath.match(regex);

      if (match) {
        // Use first target path (most common pattern)
        let targetPath = targetPaths[0];

        // Replace wildcard with matched value
        if (alias.includes('*') && match[1]) {
          targetPath = targetPath.replace('*', match[1]);
        }

        // Resolve to absolute path
        const resolved = path.join(this.workspaceConfig.rootPath, targetPath);

        logger.debug('Resolved tsconfig path alias', {
          original: importPath,
          alias,
          resolved,
        });

        return {
          original: importPath,
          resolved,
          isInternal: true,
          type: 'tsconfig',
        };
      }
    }

    return null;
  };

  /**
   * Resolve relative import path (./file, ../folder/file)
   */
  private resolveRelativePath = (importPath: string): AliasResolution => {
    const currentDir = path.dirname(this.currentFilePath);
    const resolved = path.resolve(currentDir, importPath);

    logger.debug('Resolved relative import', {
      original: importPath,
      resolved,
      from: this.currentFilePath,
    });

    return {
      original: importPath,
      resolved,
      isInternal: true,
      type: 'relative',
    };
  };

  /**
   * Build alias cache from workspace configuration
   */
  public buildAliasCache = (): void => {
    // Build package name → path map
    for (const pkg of this.workspaceConfig.packages) {
      this.packageNameToPath.set(pkg.name, pkg.path);
      this.aliasCache.set(pkg.name, pkg.path);
    }

    // Build tsconfig path aliases map
    if (this.workspaceConfig.tsconfigPaths) {
      for (const [alias, paths] of Object.entries(this.workspaceConfig.tsconfigPaths)) {
        this.tsconfigAliases.set(alias, paths);

        // Cache first path for quick lookup
        const resolvedPath = paths[0].replace('/*', '').replace('*', '');
        const fullPath = path.join(this.workspaceConfig.rootPath, resolvedPath);
        this.aliasCache.set(alias, fullPath);
      }
    }

    logger.info('Built alias cache', {
      workspacePackages: this.packageNameToPath.size,
      tsconfigAliases: this.tsconfigAliases.size,
    });
  };

  /**
   * Get all workspace package names
   */
  public getWorkspacePackages = (): string[] => {
    return Array.from(this.packageNameToPath.keys());
  };

  /**
   * Check if import is internal to workspace
   */
  public isInternalImport = (importPath: string): boolean => {
    const resolution = this.resolveAlias(importPath);
    return resolution.isInternal;
  };

  /**
   * Get resolved path from cache (fast lookup)
   *
   * Returns null if not in cache (requires full resolution)
   */
  public getCachedPath = (importPath: string): string | null => {
    return this.aliasCache.get(importPath) ?? null;
  };
}

/**
 * Create alias resolver for a file (convenience function)
 *
 * @param workspaceConfig - Workspace configuration
 * @param currentFilePath - Absolute path to current file (for relative imports)
 * @returns Alias resolver instance
 */
export const createAliasResolver = (workspaceConfig: WorkspaceConfig, currentFilePath: string): AliasResolver => {
  return new AliasResolver(workspaceConfig, currentFilePath);
};

/**
 * Resolve single import path (convenience function)
 *
 * @param importPath - Import specifier to resolve
 * @param workspaceConfig - Workspace configuration
 * @param currentFilePath - Current file path (for relative imports)
 * @returns Alias resolution result
 */
export const resolveImportPath = (
  importPath: string,
  workspaceConfig: WorkspaceConfig,
  currentFilePath: string
): AliasResolution => {
  const resolver = new AliasResolver(workspaceConfig, currentFilePath);
  return resolver.resolveAlias(importPath);
};

/**
 * Batch resolve import paths (convenience function)
 *
 * @param importPaths - Array of import specifiers
 * @param workspaceConfig - Workspace configuration
 * @param currentFilePath - Current file path
 * @returns Array of alias resolutions
 */
export const resolveImportPaths = (
  importPaths: string[],
  workspaceConfig: WorkspaceConfig,
  currentFilePath: string
): AliasResolution[] => {
  const resolver = new AliasResolver(workspaceConfig, currentFilePath);
  return importPaths.map((importPath) => resolver.resolveAlias(importPath));
};

/**
 * Extract workspace dependencies from import resolutions
 *
 * Returns list of workspace packages that are imported
 */
export const extractWorkspaceDependencies = (resolutions: AliasResolution[]): string[] => {
  const dependencies = new Set<string>();

  for (const resolution of resolutions) {
    if (resolution.type === 'workspace' && resolution.packageName) {
      dependencies.add(resolution.packageName);
    }
  }

  return Array.from(dependencies);
};
