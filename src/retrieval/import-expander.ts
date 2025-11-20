/**
 * Import Chain Expansion (Stage 4 of retrieval pipeline)
 *
 * Builds dependency graph by recursively traversing import chains.
 * Detects circular imports, enforces depth limits, and marks truncated chains.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { type DatabaseClient } from '@database/client';
import { AliasResolver } from '@indexing/alias-resolver';
import { type WorkspaceConfig } from '@indexing/workspace-detector';
import { logger } from '@utils/logger';
import { type CindexConfig } from '@/types/config';
import { type ImportChain, type RelevantFile } from '@/types/retrieval';

/**
 * Database row type for file import query
 */
interface FileImportRow {
  file_path: string;
  imports: string[];
  exports: string[];
  file_summary: string;
  repo_id: string | null;
  workspace_config: Record<string, unknown> | null;
}

/**
 * Check if an import is internal (within the indexed repository)
 *
 * External imports include:
 * - Node.js built-ins (node:*, fs, path, etc.)
 * - npm packages (no ./ or ../ prefix, no file extension)
 * - URLs (http://, https://)
 *
 * Internal imports:
 * - Relative paths (./foo, ../bar)
 * - Absolute paths within project (/src/utils/foo)
 * - Workspace aliases (@workspace/*, tsconfig paths)
 *
 * Note: This is a heuristic approach. Scoped npm packages like @types/* may be incorrectly
 * classified as internal, but will fail normalization and be marked as external_dependency.
 *
 * @param importPath - Import path from code
 * @returns true if internal import, false if external
 */
export const isInternalImport = (importPath: string): boolean => {
  // External: Node.js built-ins with node: prefix
  if (importPath.startsWith('node:')) {
    return false;
  }

  // External: URLs
  if (importPath.startsWith('http://') || importPath.startsWith('https://')) {
    return false;
  }

  // Internal: Relative paths
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return true;
  }

  // Internal: Absolute paths (starts with /)
  if (importPath.startsWith('/')) {
    return true;
  }

  // Internal: Workspace aliases (starts with @)
  // Note: This includes scoped npm packages like @types/*, which may be external
  // For now, treat all @ imports as internal (will be refined in multi-project mode)
  if (importPath.startsWith('@')) {
    return true;
  }

  // External: No path separators = likely npm package
  if (!importPath.includes('/')) {
    return false;
  }

  // Default: treat as external
  return false;
};

/**
 * Normalize import path to match file_path in database
 *
 * Resolves various import patterns to absolute filesystem paths:
 * - Workspace aliases: @workspace/package → packages/package/src/index.ts
 * - TypeScript paths: @/utils/logger → src/utils/logger.ts
 * - Relative imports: ./helper → src/utils/helper.ts
 * - External imports: lodash → lodash (unchanged)
 *
 * Also infers file extensions (.ts, .tsx, .js, .jsx) by checking filesystem.
 *
 * @param importPath - Import path from code
 * @param currentFile - Current file absolute path (for relative resolution)
 * @param workspaceConfig - Workspace configuration (null for non-monorepo)
 * @returns Normalized absolute file path, or original if external
 */
export const normalizeImportPath = async (
  importPath: string,
  currentFile: string,
  workspaceConfig: WorkspaceConfig | null
): Promise<string> => {
  // Handle external imports (no transformation needed)
  if (!isInternalImport(importPath)) {
    return importPath;
  }

  // If no workspace config, handle relative and absolute paths
  if (!workspaceConfig) {
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Relative path - resolve relative to current file
      const currentDir = path.dirname(currentFile);
      const resolved = path.resolve(currentDir, importPath);
      return addFileExtension(resolved);
    } else if (importPath.startsWith('/')) {
      // Absolute path - just add extension
      return addFileExtension(importPath);
    }
    // No workspace config and starts with @ (but not a workspace package) = treat as external
    return importPath;
  }

  // Use AliasResolver to resolve import path
  const resolver = new AliasResolver(workspaceConfig, currentFile);
  const resolution = resolver.resolveAlias(importPath);

  // If external, return as-is
  if (!resolution.isInternal) {
    return importPath;
  }

  // Add file extension if missing
  return addFileExtension(resolution.resolved);
};

/**
 * Add file extension to path if missing
 *
 * Tries common TypeScript/JavaScript extensions in order:
 * 1. .ts (TypeScript)
 * 2. .tsx (TypeScript JSX)
 * 3. .js (JavaScript)
 * 4. .jsx (JavaScript JSX)
 * 5. /index.ts (directory with index)
 * 6. /index.js
 *
 * If none exist, returns the original resolved path (likely an external import or missing file).
 *
 * @param resolvedPath - Absolute path without extension
 * @returns Path with extension, or original if no match found
 */
export const addFileExtension = async (resolvedPath: string): Promise<string> => {
  // If already has extension, return as-is
  if (path.extname(resolvedPath)) {
    return resolvedPath;
  }

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];

  for (const ext of extensions) {
    const pathWithExt = resolvedPath + ext;
    try {
      await fs.access(pathWithExt);
      return pathWithExt;
    } catch {
      // File doesn't exist, try next extension
    }
  }

  // Try index files in directory
  const indexExtensions = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  for (const indexExt of indexExtensions) {
    const pathWithIndex = resolvedPath + indexExt;
    try {
      await fs.access(pathWithIndex);
      return pathWithIndex;
    } catch {
      // File doesn't exist, try next
    }
  }

  // No matching file found - return original path
  // This might be an external import or a missing file
  logger.debug('Could not infer file extension', {
    resolvedPath,
    tried: [...extensions, ...indexExtensions],
  });

  return resolvedPath;
};

/**
 * Recursively expand import chains
 *
 * Traverses import dependencies up to maxDepth levels.
 * Detects circular imports and marks truncated chains.
 *
 * @param filePath - Current file to expand
 * @param depth - Current depth in import chain (0 = root)
 * @param maxDepth - Maximum depth to traverse (default: 3)
 * @param visited - Set of visited files (for circular detection)
 * @param db - Database client
 * @param parentPath - Parent file that imported this (undefined for root)
 * @returns Array of import chain entries
 */
const expandImportsRecursive = async (
  filePath: string,
  depth: number,
  maxDepth: number,
  visited: Set<string>,
  db: DatabaseClient,
  parentPath?: string
): Promise<ImportChain[]> => {
  const chains: ImportChain[] = [];

  // Circular import detection
  if (visited.has(filePath)) {
    logger.debug('Circular import detected', {
      file: filePath,
      parent: parentPath,
      depth,
    });

    chains.push({
      file_path: filePath,
      imported_from: parentPath,
      depth,
      circular: true,
      truncated: true,
      truncation_reason: 'depth_limit', // Circular treated as depth limit
    });

    return chains;
  }

  // Depth limit check
  if (depth > maxDepth) {
    logger.debug('Import depth limit reached', {
      file: filePath,
      depth,
      maxDepth,
    });

    chains.push({
      file_path: filePath,
      imported_from: parentPath,
      depth,
      truncated: true,
      truncation_reason: 'depth_limit',
    });

    return chains;
  }

  // Mark as visited
  visited.add(filePath);

  // Query database for file imports and workspace configuration
  const query = `
    SELECT
      cf.file_path,
      COALESCE(cf.imports, '{}') AS imports,
      COALESCE(cf.exports, '{}') AS exports,
      cf.file_summary,
      cf.repo_id,
      r.workspace_config
    FROM code_files cf
    LEFT JOIN repositories r ON cf.repo_id = r.repo_id
    WHERE cf.file_path = $1
  `;

  try {
    const result = await db.query<FileImportRow>(query, [filePath]);

    if (result.rows.length === 0) {
      // File not found in database
      logger.debug('File not found in database', { file: filePath, depth });

      chains.push({
        file_path: filePath,
        imported_from: parentPath,
        depth,
        truncated: true,
        truncation_reason: 'external_dependency',
      });

      return chains;
    }

    const fileData = result.rows[0];

    // Parse workspace configuration if available
    const workspaceConfig = fileData.workspace_config
      ? (fileData.workspace_config as unknown as WorkspaceConfig)
      : null;

    // Add current file to chain
    chains.push({
      file_path: filePath,
      imported_from: parentPath,
      depth,
      file_summary: fileData.file_summary,
      exports: fileData.exports,
      circular: false,
      truncated: false,
    });

    // Recursively expand imports
    for (const importPath of fileData.imports) {
      // Skip external imports
      if (!isInternalImport(importPath)) {
        logger.debug('Skipping external import', {
          import: importPath,
          file: filePath,
          depth,
        });

        chains.push({
          file_path: importPath,
          imported_from: filePath,
          depth: depth + 1,
          truncated: true,
          truncation_reason: 'external_dependency',
        });

        continue;
      }

      // Normalize import path with alias resolution
      const normalizedPath = await normalizeImportPath(importPath, filePath, workspaceConfig);

      // Recursively expand
      const subChains = await expandImportsRecursive(normalizedPath, depth + 1, maxDepth, visited, db, filePath);

      chains.push(...subChains);
    }
  } catch (error) {
    logger.warn('Failed to expand imports for file', {
      file: filePath,
      depth,
      error: error instanceof Error ? error.message : String(error),
    });

    chains.push({
      file_path: filePath,
      imported_from: parentPath,
      depth,
      truncated: true,
      truncation_reason: 'external_dependency',
    });
  }

  return chains;
};

/**
 * Expand import chains for top files
 *
 * Selects top N files from Stage 1 and builds their dependency graphs.
 * Returns all import chain entries up to maxDepth levels.
 *
 * @param relevantFiles - Top files from Stage 1
 * @param config - cindex configuration
 * @param db - Database client
 * @param topFilesLimit - Number of top files to expand (default: 10)
 * @param maxDepth - Maximum import depth (default: 3)
 * @returns Array of import chain entries
 */
export const expandImports = async (
  relevantFiles: RelevantFile[],
  config: CindexConfig,
  db: DatabaseClient,
  topFilesLimit = 10,
  maxDepth?: number
): Promise<ImportChain[]> => {
  const startTime = Date.now();

  // Use config import_depth if not provided
  const depth = maxDepth ?? config.performance.import_depth;

  if (relevantFiles.length === 0) {
    logger.debug('No files provided for import expansion');
    return [];
  }

  // Select top N files for expansion
  const topFiles = relevantFiles.slice(0, topFilesLimit);

  logger.debug('Starting import chain expansion', {
    topFilesCount: topFiles.length,
    maxDepth: depth,
  });

  // Track visited files globally across all expansions
  const visited = new Set<string>();
  const allChains: ImportChain[] = [];

  // Expand each top file
  for (const file of topFiles) {
    const fileChains = await expandImportsRecursive(file.file_path, 0, depth, visited, db);

    allChains.push(...fileChains);
  }

  const expansionTime = Date.now() - startTime;

  // Calculate statistics
  const depthCounts = allChains.reduce<Record<number, number>>((acc, chain) => {
    acc[chain.depth] = (acc[chain.depth] || 0) + 1;
    return acc;
  }, {});

  const circularCount = allChains.filter((c) => c.circular).length;
  const truncatedCount = allChains.filter((c) => c.truncated).length;
  const maxDepthReached = Math.max(...allChains.map((c) => c.depth));

  // Count truncation reasons
  const truncationReasons = allChains
    .filter((c) => c.truncated && c.truncation_reason)
    .reduce<Record<string, number>>((acc, chain) => {
      if (chain.truncation_reason) {
        acc[chain.truncation_reason] = (acc[chain.truncation_reason] || 0) + 1;
      }
      return acc;
    }, {});

  logger.info('Import chain expansion complete', {
    topFilesExpanded: topFiles.length,
    totalChainEntries: allChains.length,
    uniqueFiles: visited.size,
    maxDepth: depth,
    maxDepthReached,
    circularImports: circularCount,
    truncatedChains: truncatedCount,
    truncationReasons,
    depthDistribution: depthCounts,
    expansionTime,
  });

  return allChains;
};

/**
 * Expand imports with workspace/service boundary awareness (multi-project support)
 *
 * Enhanced version that respects workspace and service boundaries during import traversal.
 * Applies different depth limits based on whether imports cross boundaries.
 *
 * Boundary detection:
 * - Workspace boundary: Import crosses from one workspace_id to another
 * - Service boundary: Import crosses from one service_id to another
 *
 * Depth limits:
 * - workspace_depth: Max depth within same workspace (default: 3)
 * - service_depth: Max depth within same service (default: 2)
 * - cross_workspace: Reduced depth after crossing workspace boundary (default: 1)
 * - cross_service: Minimal depth after crossing service boundary (default: 0, stops)
 *
 * @param relevantFiles - Top files from Stage 1
 * @param config - cindex configuration
 * @param db - Database client
 * @param options - Expansion options with boundary awareness
 * @returns Array of import chain entries with boundary markers
 */
export const expandImportsBoundaryAware = async (
  relevantFiles: RelevantFile[],
  config: CindexConfig,
  db: DatabaseClient,
  options: {
    top_files_limit?: number;
    max_depth?: number;
    workspace_depth?: number; // Max depth within workspace
    service_depth?: number; // Max depth within service
    respect_workspace_boundaries?: boolean;
    respect_service_boundaries?: boolean;
  }
): Promise<ImportChain[]> => {
  const startTime = Date.now();

  const topFilesLimit = options.top_files_limit ?? 10;
  const maxDepth = options.max_depth ?? config.performance.import_depth;
  const workspaceDepth = options.workspace_depth ?? 3;
  const serviceDepth = options.service_depth ?? 2;
  const respectWorkspaceBoundaries = options.respect_workspace_boundaries ?? true;
  const respectServiceBoundaries = options.respect_service_boundaries ?? true;

  if (relevantFiles.length === 0) {
    logger.debug('No files provided for boundary-aware import expansion');
    return [];
  }

  // Select top N files for expansion
  const topFiles = relevantFiles.slice(0, topFilesLimit);

  logger.debug('Starting boundary-aware import chain expansion', {
    topFilesCount: topFiles.length,
    maxDepth,
    workspaceDepth,
    serviceDepth,
    respectWorkspaceBoundaries,
    respectServiceBoundaries,
  });

  // Track visited files globally
  const visited = new Set<string>();
  const allChains: ImportChain[] = [];

  // Boundary tracking state
  interface BoundaryState {
    startWorkspaceId?: string;
    startServiceId?: string;
    currentWorkspaceId?: string;
    currentServiceId?: string;
    crossedWorkspace: boolean;
    crossedService: boolean;
    depthInWorkspace: number;
    depthInService: number;
  }

  /**
   * Recursive expansion with boundary awareness
   */
  const expandWithBoundaries = async (
    filePath: string,
    depth: number,
    boundaryState: BoundaryState,
    parentPath?: string
  ): Promise<ImportChain[]> => {
    const chains: ImportChain[] = [];

    // Circular import detection
    if (visited.has(filePath)) {
      chains.push({
        file_path: filePath,
        imported_from: parentPath,
        depth,
        circular: true,
        truncated: true,
        truncation_reason: 'depth_limit',
        cross_workspace: boundaryState.crossedWorkspace,
        cross_service: boundaryState.crossedService,
      });
      return chains;
    }

    // Depth limit check (respects boundaries)
    let depthLimit = maxDepth;

    if (respectServiceBoundaries && boundaryState.crossedService) {
      // Stop immediately after crossing service boundary
      depthLimit = Math.min(depthLimit, boundaryState.depthInService);
    } else if (respectWorkspaceBoundaries && boundaryState.crossedWorkspace) {
      // Reduced depth after crossing workspace boundary
      depthLimit = Math.min(depthLimit, workspaceDepth);
    }

    if (depth > depthLimit) {
      chains.push({
        file_path: filePath,
        imported_from: parentPath,
        depth,
        truncated: true,
        truncation_reason:
          boundaryState.crossedService || boundaryState.crossedWorkspace ? 'boundary_crossed' : 'depth_limit',
        cross_workspace: boundaryState.crossedWorkspace,
        cross_service: boundaryState.crossedService,
      });
      return chains;
    }

    // Mark as visited
    visited.add(filePath);

    // Query file data
    const query = `
      SELECT
        cf.file_path,
        COALESCE(cf.imports, '{}') AS imports,
        COALESCE(cf.exports, '{}') AS exports,
        cf.file_summary,
        cf.repo_id,
        cf.workspace_id,
        cf.service_id,
        r.workspace_config
      FROM code_files cf
      LEFT JOIN repositories r ON cf.repo_id = r.repo_id
      WHERE cf.file_path = $1
    `;

    try {
      const result = await db.query<FileImportRow & { workspace_id: string | null; service_id: string | null }>(query, [
        filePath,
      ]);

      if (result.rows.length === 0) {
        chains.push({
          file_path: filePath,
          imported_from: parentPath,
          depth,
          truncated: true,
          truncation_reason: 'external_dependency',
          cross_workspace: boundaryState.crossedWorkspace,
          cross_service: boundaryState.crossedService,
        });
        return chains;
      }

      const fileData = result.rows[0];
      const workspaceConfig = fileData.workspace_config
        ? (fileData.workspace_config as unknown as WorkspaceConfig)
        : null;

      // Detect boundary crossings
      const fileWorkspaceId = fileData.workspace_id ?? undefined;
      const fileServiceId = fileData.service_id ?? undefined;

      const newBoundaryState = { ...boundaryState };

      // Initialize start boundaries on first file
      if (depth === 0) {
        newBoundaryState.startWorkspaceId = fileWorkspaceId;
        newBoundaryState.startServiceId = fileServiceId;
        newBoundaryState.currentWorkspaceId = fileWorkspaceId;
        newBoundaryState.currentServiceId = fileServiceId;
      } else {
        // Check for boundary crossings
        if (fileWorkspaceId && fileWorkspaceId !== boundaryState.currentWorkspaceId) {
          newBoundaryState.crossedWorkspace = true;
          newBoundaryState.depthInWorkspace = 0;
        } else {
          newBoundaryState.depthInWorkspace = boundaryState.depthInWorkspace + 1;
        }

        if (fileServiceId && fileServiceId !== boundaryState.currentServiceId) {
          newBoundaryState.crossedService = true;
          newBoundaryState.depthInService = 0;
        } else {
          newBoundaryState.depthInService = boundaryState.depthInService + 1;
        }

        newBoundaryState.currentWorkspaceId = fileWorkspaceId;
        newBoundaryState.currentServiceId = fileServiceId;
      }

      // Add current file to chain
      chains.push({
        file_path: filePath,
        imported_from: parentPath,
        depth,
        file_summary: fileData.file_summary,
        exports: fileData.exports,
        circular: false,
        truncated: false,
        cross_workspace: newBoundaryState.crossedWorkspace,
        cross_service: newBoundaryState.crossedService,
        workspace_id: fileWorkspaceId,
        service_id: fileServiceId,
      });

      // Recursively expand imports
      for (const importPath of fileData.imports) {
        if (!isInternalImport(importPath)) {
          chains.push({
            file_path: importPath,
            imported_from: filePath,
            depth: depth + 1,
            truncated: true,
            truncation_reason: 'external_dependency',
            cross_workspace: newBoundaryState.crossedWorkspace,
            cross_service: newBoundaryState.crossedService,
          });
          continue;
        }

        const normalizedPath = await normalizeImportPath(importPath, filePath, workspaceConfig);
        const subChains = await expandWithBoundaries(normalizedPath, depth + 1, newBoundaryState, filePath);
        chains.push(...subChains);
      }
    } catch (error) {
      logger.warn('Failed to expand imports for file', {
        file: filePath,
        depth,
        error: error instanceof Error ? error.message : String(error),
      });

      chains.push({
        file_path: filePath,
        imported_from: parentPath,
        depth,
        truncated: true,
        truncation_reason: 'external_dependency',
        cross_workspace: boundaryState.crossedWorkspace,
        cross_service: boundaryState.crossedService,
      });
    }

    return chains;
  };

  // Expand each top file
  for (const file of topFiles) {
    const initialState: BoundaryState = {
      startWorkspaceId: file.workspace_id,
      startServiceId: file.service_id,
      currentWorkspaceId: file.workspace_id,
      currentServiceId: file.service_id,
      crossedWorkspace: false,
      crossedService: false,
      depthInWorkspace: 0,
      depthInService: 0,
    };

    const fileChains = await expandWithBoundaries(file.file_path, 0, initialState);
    allChains.push(...fileChains);
  }

  const expansionTime = Date.now() - startTime;

  // Calculate statistics
  const workspaceCrossings = allChains.filter((c) => c.cross_workspace).length;
  const serviceCrossings = allChains.filter((c) => c.cross_service).length;
  const maxDepthReached = Math.max(...allChains.map((c) => c.depth), 0);

  logger.info('Boundary-aware import chain expansion complete', {
    topFilesExpanded: topFiles.length,
    totalChainEntries: allChains.length,
    uniqueFiles: visited.size,
    maxDepthReached,
    workspaceBoundaryCrossings: workspaceCrossings,
    serviceBoundaryCrossings: serviceCrossings,
    expansionTime,
  });

  return allChains;
};
