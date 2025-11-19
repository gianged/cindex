/**
 * Workspace Detector: Monorepo Support
 *
 * Detects and parses monorepo workspace configurations:
 * - pnpm-workspace.yaml
 * - package.json workspaces field
 * - nx.json (Nx monorepos)
 * - lerna.json (Lerna monorepos)
 * - turbo.json (Turborepo)
 * - rush.json (Rush)
 *
 * Builds workspace registry with package names, paths, and dependencies.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { logger } from '@utils/logger';
import { type PackageJsonInfo, type TsConfigInfo } from '@/types/workspace';

/**
 * Workspace configuration type
 */
export enum WorkspaceType {
  PNPM = 'pnpm',
  NPM = 'npm',
  Yarn = 'yarn',
  Nx = 'nx',
  Lerna = 'lerna',
  Turbo = 'turbo',
  Rush = 'rush',
  Unknown = 'unknown',
}

/**
 * Workspace package information
 */
export interface WorkspacePackage {
  /** Package name from package.json */
  name: string;

  /** Absolute path to package directory */
  path: string;

  /** Relative path from workspace root */
  relativePath: string;

  /** Package version */
  version?: string;

  /** Package dependencies */
  dependencies?: Record<string, string>;

  /** Dev dependencies */
  devDependencies?: Record<string, string>;

  /** Whether this is a private package */
  isPrivate?: boolean;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Workspace type */
  type: WorkspaceType;

  /** Root directory */
  rootPath: string;

  /** Workspace patterns (e.g., ["packages/*", "apps/*"]) */
  patterns: string[];

  /** Detected workspace packages */
  packages: WorkspacePackage[];

  /** TypeScript path aliases from tsconfig.json */
  tsconfigPaths?: Record<string, string[]>;
}

/**
 * Rush project definition from rush.json
 */
interface RushProject {
  /** Project folder path relative to rush.json */
  projectFolder: string;

  /** Package name (optional in rush.json) */
  packageName?: string;

  /** Other project properties */
  [key: string]: unknown;
}

/**
 * Type guard to check if a value is a valid PackageJson-like object
 */
const isPackageJsonLike = (value: unknown): value is Partial<PackageJsonInfo> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Safely parse package.json content
 */
const parsePackageJson = (content: string): Partial<PackageJsonInfo> => {
  const parsed: unknown = JSON.parse(content);
  if (!isPackageJsonLike(parsed)) {
    return {};
  }
  return parsed;
};

/**
 * Type guard to check if a value is a valid TsConfig-like object
 */
const isTsConfigLike = (value: unknown): value is Partial<TsConfigInfo> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Safely parse tsconfig.json content
 */
const parseTsConfig = (content: string): Partial<TsConfigInfo> => {
  const parsed: unknown = JSON.parse(content);
  if (!isTsConfigLike(parsed)) {
    return {};
  }
  return parsed;
};

/**
 * Safely parse JSON to Record<string, unknown>
 */
const parseJsonToRecord = (content: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
};

/**
 * Workspace detector for monorepo support
 */
export class WorkspaceDetector {
  constructor(private readonly rootPath: string) {}

  /**
   * Detect workspace configuration in repository
   *
   * @returns Workspace config or null if not a monorepo
   */
  public detectWorkspaceConfig = async (): Promise<WorkspaceConfig | null> => {
    logger.info('Detecting workspace configuration', { root: this.rootPath });

    // Try pnpm-workspace.yaml
    const pnpmConfig = await this.detectPnpmWorkspace();
    if (pnpmConfig) {
      return pnpmConfig;
    }

    // Try package.json workspaces (npm/yarn)
    const npmConfig = await this.detectNpmWorkspace();
    if (npmConfig) {
      return npmConfig;
    }

    // Try nx.json
    const nxConfig = await this.detectNxWorkspace();
    if (nxConfig) {
      return nxConfig;
    }

    // Try lerna.json
    const lernaConfig = await this.detectLernaWorkspace();
    if (lernaConfig) {
      return lernaConfig;
    }

    // Try turbo.json
    const turboConfig = await this.detectTurboWorkspace();
    if (turboConfig) {
      return turboConfig;
    }

    // Try rush.json
    const rushConfig = await this.detectRushWorkspace();
    if (rushConfig) {
      return rushConfig;
    }

    logger.info('No workspace configuration detected');
    return null;
  };

  /**
   * Detect pnpm workspace (pnpm-workspace.yaml)
   */
  private detectPnpmWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const workspaceFile = path.join(this.rootPath, 'pnpm-workspace.yaml');

    try {
      const content = await fs.readFile(workspaceFile, 'utf-8');

      // Simple YAML parsing for packages array
      const packagesMatch = /packages:\s*\n((?:\s+-\s+.+\n)+)/.exec(content);
      if (!packagesMatch) {
        return null;
      }

      const patterns = packagesMatch[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('-'))
        .map((line) => line.replace(/^-\s*['"]?([^'"]+)['"]?/, '$1'));

      logger.info('Detected pnpm workspace', { patterns });

      const packages = await this.resolveWorkspacePackages(patterns);

      return {
        type: WorkspaceType.PNPM,
        rootPath: this.rootPath,
        patterns,
        packages,
        tsconfigPaths: await this.parseTsConfigPaths(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Error reading pnpm-workspace.yaml', { error });
      }
      return null;
    }
  };

  /**
   * Detect npm/yarn workspace (package.json workspaces field)
   */
  private detectNpmWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const packageJsonPath = path.join(this.rootPath, 'package.json');

    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = parsePackageJson(content);

      if (!packageJson.workspaces) {
        return null;
      }

      // Workspaces can be array or object with packages array
      const workspaces = packageJson.workspaces;
      const patterns: string[] = Array.isArray(workspaces)
        ? workspaces
        : typeof workspaces === 'object' && 'packages' in workspaces
          ? workspaces.packages
          : [];

      if (patterns.length === 0) {
        return null;
      }

      logger.info('Detected npm/yarn workspace', { patterns });

      const packages = await this.resolveWorkspacePackages(patterns);

      return {
        type: WorkspaceType.NPM,
        rootPath: this.rootPath,
        patterns,
        packages,
        tsconfigPaths: await this.parseTsConfigPaths(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Error reading package.json', { error });
      }
      return null;
    }
  };

  /**
   * Detect Nx workspace (nx.json)
   */
  private detectNxWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const nxJsonPath = path.join(this.rootPath, 'nx.json');

    try {
      await fs.access(nxJsonPath);

      // Nx workspaces typically use standard patterns
      const patterns = ['packages/*', 'apps/*', 'libs/*'];

      logger.info('Detected Nx workspace');

      const packages = await this.resolveWorkspacePackages(patterns);

      return {
        type: WorkspaceType.Nx,
        rootPath: this.rootPath,
        patterns,
        packages,
        tsconfigPaths: await this.parseTsConfigPaths(),
      };
    } catch {
      return null;
    }
  };

  /**
   * Detect Lerna workspace (lerna.json)
   */
  private detectLernaWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const lernaJsonPath = path.join(this.rootPath, 'lerna.json');

    try {
      const content = await fs.readFile(lernaJsonPath, 'utf-8');
      const lernaJson = parseJsonToRecord(content);

      const packagesField = lernaJson.packages;
      const patterns: string[] = Array.isArray(packagesField) ? (packagesField as string[]) : ['packages/*'];

      logger.info('Detected Lerna workspace', { patterns });

      const packages = await this.resolveWorkspacePackages(patterns);

      return {
        type: WorkspaceType.Lerna,
        rootPath: this.rootPath,
        patterns,
        packages,
        tsconfigPaths: await this.parseTsConfigPaths(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Error reading lerna.json', { error });
      }
      return null;
    }
  };

  /**
   * Detect Turborepo (turbo.json)
   */
  private detectTurboWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const turboJsonPath = path.join(this.rootPath, 'turbo.json');

    try {
      await fs.access(turboJsonPath);

      // Turbo relies on package manager workspaces (npm/pnpm/yarn)
      // Try to detect underlying workspace config
      const npmConfig = await this.detectNpmWorkspace();
      if (npmConfig) {
        npmConfig.type = WorkspaceType.Turbo;
        logger.info('Detected Turborepo');
        return npmConfig;
      }

      return null;
    } catch {
      return null;
    }
  };

  /**
   * Detect Rush monorepo (rush.json)
   */
  private detectRushWorkspace = async (): Promise<WorkspaceConfig | null> => {
    const rushJsonPath = path.join(this.rootPath, 'rush.json');

    try {
      const content = await fs.readFile(rushJsonPath, 'utf-8');
      const rushJson = parseJsonToRecord(content) as { projects?: RushProject[] };

      // Rush defines projects array
      const patterns = rushJson.projects?.map((p) => p.projectFolder) ?? [];

      logger.info('Detected Rush monorepo', { patterns });

      const packages = await this.resolveWorkspacePackages(patterns);

      return {
        type: WorkspaceType.Rush,
        rootPath: this.rootPath,
        patterns,
        packages,
        tsconfigPaths: await this.parseTsConfigPaths(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Error reading rush.json', { error });
      }
      return null;
    }
  };

  /**
   * Resolve workspace patterns to actual package directories
   */
  private resolveWorkspacePackages = async (patterns: string[]): Promise<WorkspacePackage[]> => {
    const packages: WorkspacePackage[] = [];

    for (const pattern of patterns) {
      // Simple glob matching (supports * wildcard)
      if (pattern.includes('*')) {
        const basePath = pattern.replace('/*', '');
        const baseDir = path.join(this.rootPath, basePath);

        try {
          const entries = await fs.readdir(baseDir, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isDirectory()) {
              const packagePath = path.join(baseDir, entry.name);
              const packageInfo = await this.parsePackageJson(packagePath);

              if (packageInfo) {
                packages.push(packageInfo);
              }
            }
          }
        } catch (error) {
          logger.debug('Error reading workspace directory', { basePath, error });
        }
      } else {
        // Direct path
        const packagePath = path.join(this.rootPath, pattern);
        const packageInfo = await this.parsePackageJson(packagePath);

        if (packageInfo) {
          packages.push(packageInfo);
        }
      }
    }

    logger.info('Resolved workspace packages', { count: packages.length });

    return packages;
  };

  /**
   * Parse package.json in a package directory
   */
  public parsePackageJson = async (packagePath: string): Promise<WorkspacePackage | null> => {
    const packageJsonPath = path.join(packagePath, 'package.json');

    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = parsePackageJson(content);

      if (!packageJson.name) {
        return null;
      }

      return {
        name: packageJson.name,
        path: packagePath,
        relativePath: path.relative(this.rootPath, packagePath),
        version: packageJson.version,
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
        isPrivate: packageJson.private,
      };
    } catch {
      return null;
    }
  };

  /**
   * Parse tsconfig.json path mappings
   */
  public parseTsConfig = async (): Promise<Record<string, string[]> | null> => {
    const tsconfigPath = path.join(this.rootPath, 'tsconfig.json');

    try {
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      // Remove comments (simple approach)
      const jsonContent = content.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tsconfig = parseTsConfig(jsonContent);

      return tsconfig.compilerOptions?.paths ?? null;
    } catch {
      return null;
    }
  };

  /**
   * Parse TypeScript path aliases (convenience method)
   */
  private parseTsConfigPaths = async (): Promise<Record<string, string[]> | undefined> => {
    const paths = await this.parseTsConfig();
    return paths ?? undefined;
  };

  /**
   * Build workspace dependency graph
   *
   * Maps internal package dependencies within the monorepo
   */
  public buildWorkspaceDependencyGraph = (workspaceConfig: WorkspaceConfig): Map<string, string[]> => {
    const graph = new Map<string, string[]>();

    // Build set of workspace package names
    const workspacePackages = new Set(workspaceConfig.packages.map((p) => p.name));

    for (const pkg of workspaceConfig.packages) {
      const deps: string[] = [];

      // Check dependencies
      if (pkg.dependencies) {
        for (const depName of Object.keys(pkg.dependencies)) {
          if (workspacePackages.has(depName)) {
            deps.push(depName);
          }
        }
      }

      // Check devDependencies
      if (pkg.devDependencies) {
        for (const depName of Object.keys(pkg.devDependencies)) {
          if (workspacePackages.has(depName)) {
            deps.push(depName);
          }
        }
      }

      graph.set(pkg.name, deps);
    }

    logger.info('Built workspace dependency graph', {
      packages: graph.size,
      totalDeps: Array.from(graph.values()).flat().length,
    });

    return graph;
  };
}

/**
 * Detect workspace configuration (convenience function)
 *
 * @param rootPath - Repository root path
 * @returns Workspace config or null if not a monorepo
 */
export const detectWorkspaceConfig = async (rootPath: string): Promise<WorkspaceConfig | null> => {
  const detector = new WorkspaceDetector(rootPath);
  return detector.detectWorkspaceConfig();
};

/**
 * Resolve workspace aliases for a monorepo
 *
 * Maps import aliases (@workspace/pkg) to filesystem paths
 */
export const resolveWorkspaceAliases = (workspaceConfig: WorkspaceConfig): Map<string, string> => {
  const aliases = new Map<string, string>();

  // Map package names to their paths
  for (const pkg of workspaceConfig.packages) {
    aliases.set(pkg.name, pkg.path);
  }

  // Add tsconfig path aliases if available
  if (workspaceConfig.tsconfigPaths) {
    for (const [alias, paths] of Object.entries(workspaceConfig.tsconfigPaths)) {
      // Use first path (most common pattern)
      const resolvedPath = paths[0].replace('/*', '').replace('*', '');
      const fullPath = path.join(workspaceConfig.rootPath, resolvedPath);
      aliases.set(alias, fullPath);
    }
  }

  return aliases;
};
