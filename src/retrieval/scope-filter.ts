/**
 * Scope Filtering (Stage 0 of multi-project retrieval pipeline)
 *
 * Determines which repositories, services, and workspaces to search based on scope configuration.
 * Handles reference/documentation repo exclusion by default.
 */

import { type DatabaseClient } from '@database/client';
import { logger } from '@utils/logger';

/**
 * Scope mode for multi-project search
 *
 * - global: Search across all indexed repositories (excluding references/docs by default)
 * - repository: Search within specific repository IDs
 * - service: Search within specific service IDs
 * - boundary-aware: Start from a repository and expand via dependency graph
 */
export type ScopeMode = 'global' | 'repository' | 'service' | 'boundary-aware';

/**
 * Scope filter configuration
 */
export interface ScopeFilterConfig {
  // Scope mode
  mode: ScopeMode;

  // Repository filtering
  repo_ids?: string[]; // Include specific repos
  exclude_repos?: string[]; // Exclude specific repos
  cross_repo?: boolean; // Allow cross-repo results

  // Service filtering
  service_ids?: string[]; // Include specific services
  service_types?: string[]; // Filter by service type (docker, serverless, mobile, library, other)
  exclude_services?: string[]; // Exclude specific services

  // Workspace filtering
  workspace_ids?: string[]; // Include specific workspaces
  package_names?: string[]; // Filter by package.json name field
  exclude_workspaces?: string[]; // Exclude specific workspaces
  exclude_repo_types?: string[]; // Exclude specific repo types

  // Boundary-aware configuration
  start_repo?: string; // Entry point repository for boundary-aware mode
  start_service?: string; // Entry point service for boundary-aware mode
  max_depth?: number; // Max dependency depth for boundary expansion
  follow_dependencies?: boolean; // Follow dependency links
}

/**
 * Scope filter result
 */
export interface ScopeFilter {
  // Filtered IDs
  repo_ids: string[];
  service_ids: string[];
  workspace_ids: string[];

  // Additional filters
  package_names?: string[]; // Package name filter (package.json name field)
  service_types?: string[]; // Service type filter (docker, serverless, mobile, etc.)

  // Configuration
  mode: ScopeMode;
  cross_repo: boolean;
  exclude_repo_types: string[];

  // Boundary configuration
  boundary_config?: {
    max_depth: number;
    follow_dependencies: boolean;
  };
}

/**
 * Database row types
 */
interface RepositoryRow {
  repo_id: string;
  repo_type: string;
}

interface ServiceRow {
  service_id: string;
  repo_id: string;
}

interface WorkspaceRow {
  workspace_id: string;
  repo_id: string;
}

interface DependencyRow {
  source_repo_id: string;
  target_repo_id: string;
}

/**
 * Get all repositories excluding reference/documentation by default
 *
 * @param db - Database client
 * @param excludeRepoTypes - Additional repo types to exclude (reference and documentation always excluded)
 * @returns Array of repository IDs
 */
const getAllRepositories = async (db: DatabaseClient, excludeRepoTypes: string[]): Promise<string[]> => {
  // Always exclude reference and documentation repos from search_codebase
  // Use search_references tool to search these
  const excludeTypes = [...excludeRepoTypes, 'reference', 'documentation'];

  // Exclude specific repo types
  const query = `
    SELECT repo_id
    FROM repositories
    WHERE repo_type != ALL($1::text[])
  `;

  const result = await db.query<RepositoryRow>(query, [excludeTypes]);
  return result.rows.map((r) => r.repo_id);
};

/**
 * Get services for specific repositories
 *
 * @param db - Database client
 * @param repoIds - Repository IDs to filter by
 * @param serviceTypes - Optional service types to filter by (docker, serverless, mobile, etc.)
 * @returns Array of service IDs
 */
const getServicesForRepos = async (
  db: DatabaseClient,
  repoIds: string[],
  serviceTypes?: string[]
): Promise<string[]> => {
  if (repoIds.length === 0) {
    return [];
  }

  let query: string;
  let params: unknown[];

  if (serviceTypes && serviceTypes.length > 0) {
    // Filter by both repo_id and service_type
    query = `
      SELECT service_id
      FROM services
      WHERE repo_id = ANY($1::text[])
        AND service_type = ANY($2::text[])
    `;
    params = [repoIds, serviceTypes];
  } else {
    // Filter by repo_id only
    query = `
      SELECT service_id
      FROM services
      WHERE repo_id = ANY($1::text[])
    `;
    params = [repoIds];
  }

  const result = await db.query<ServiceRow>(query, params);
  return result.rows.map((r) => r.service_id);
};

/**
 * Get workspaces for specific repositories
 *
 * @param db - Database client
 * @param repoIds - Repository IDs to filter by
 * @returns Array of workspace IDs
 */
const getWorkspacesForRepos = async (db: DatabaseClient, repoIds: string[]): Promise<string[]> => {
  if (repoIds.length === 0) {
    return [];
  }

  const query = `
    SELECT workspace_id
    FROM workspaces
    WHERE repo_id = ANY($1::text[])
  `;

  const result = await db.query<WorkspaceRow>(query, [repoIds]);
  return result.rows.map((r) => r.workspace_id);
};

/**
 * Expand repositories based on dependency graph (boundary-aware mode)
 *
 * @param db - Database client
 * @param startRepoId - Starting repository
 * @param maxDepth - Maximum dependency depth
 * @returns Array of repository IDs (including start repo)
 */
const expandDependencies = async (db: DatabaseClient, startRepoId: string, maxDepth: number): Promise<string[]> => {
  const repoIds = new Set<string>([startRepoId]);
  const visited = new Set<string>();

  // Recursive expansion using cross_repo_dependencies table
  const expand = async (repoId: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited.has(repoId)) {
      return;
    }

    visited.add(repoId);

    // Get dependencies for this repo
    const query = `
      SELECT target_repo_id
      FROM cross_repo_dependencies
      WHERE source_repo_id = $1
    `;

    const result = await db.query<DependencyRow>(query, [repoId]);

    for (const row of result.rows) {
      repoIds.add(row.target_repo_id);
      await expand(row.target_repo_id, depth + 1);
    }
  };

  await expand(startRepoId, 0);

  return Array.from(repoIds);
};

/**
 * Determine search scope based on configuration
 *
 * Applies filtering rules:
 * - Reference/documentation repos excluded by default
 * - Repository/service/workspace filtering
 * - Boundary-aware expansion via dependency graph
 * - Cross-repo search support
 *
 * @param config - Scope filter configuration
 * @param db - Database client
 * @returns Scope filter with resolved IDs
 */
export const determineSearchScope = async (config: ScopeFilterConfig, db: DatabaseClient): Promise<ScopeFilter> => {
  const startTime = Date.now();

  logger.debug('Determining search scope', { config });

  // Step 1: Determine repository scope
  let repoIds: string[] = [];

  switch (config.mode) {
    case 'global': {
      // Search all repositories (always excluding references/docs - use search_references for those)
      repoIds = await getAllRepositories(db, config.exclude_repo_types ?? []);
      break;
    }

    case 'repository': {
      // Search specific repositories
      if (!config.repo_ids || config.repo_ids.length === 0) {
        throw new Error('repository mode requires repo_ids parameter');
      }
      repoIds = config.repo_ids;
      break;
    }

    case 'service': {
      // Search specific services - get their repositories
      if (!config.service_ids || config.service_ids.length === 0) {
        throw new Error('service mode requires service_ids parameter');
      }

      const query = `
        SELECT DISTINCT repo_id
        FROM services
        WHERE service_id = ANY($1::text[])
      `;

      const result = await db.query<ServiceRow>(query, [config.service_ids]);
      repoIds = result.rows.map((r) => r.repo_id);
      break;
    }

    case 'boundary-aware': {
      // Start from a repository and expand via dependencies
      if (!config.start_repo) {
        throw new Error('boundary-aware mode requires start_repo parameter');
      }

      if (config.follow_dependencies) {
        repoIds = await expandDependencies(db, config.start_repo, config.max_depth ?? 2);
      } else {
        repoIds = [config.start_repo];
      }
      break;
    }
  }

  // Step 2: Apply exclusions
  if (config.exclude_repos && config.exclude_repos.length > 0) {
    const excludeRepos = config.exclude_repos;
    repoIds = repoIds.filter((id) => !excludeRepos.includes(id));
  }

  // Step 3: Get services and workspaces for filtered repos
  let serviceIds: string[] = [];
  let workspaceIds: string[] = [];

  if (config.service_ids && config.service_ids.length > 0) {
    // Use specified services
    serviceIds = config.service_ids;
  } else {
    // Get all services for filtered repos (with optional service_type filter)
    serviceIds = await getServicesForRepos(db, repoIds, config.service_types);
  }

  if (config.workspace_ids && config.workspace_ids.length > 0) {
    // Use specified workspaces
    workspaceIds = config.workspace_ids;
  } else {
    // Get all workspaces for filtered repos
    workspaceIds = await getWorkspacesForRepos(db, repoIds);
  }

  // Apply service/workspace exclusions
  if (config.exclude_services && config.exclude_services.length > 0) {
    const excludeServices = config.exclude_services;
    serviceIds = serviceIds.filter((id) => !excludeServices.includes(id));
  }

  if (config.exclude_workspaces && config.exclude_workspaces.length > 0) {
    const excludeWorkspaces = config.exclude_workspaces;
    workspaceIds = workspaceIds.filter((id) => !excludeWorkspaces.includes(id));
  }

  const scopeTime = Date.now() - startTime;

  const scopeFilter: ScopeFilter = {
    repo_ids: repoIds,
    service_ids: serviceIds,
    workspace_ids: workspaceIds,
    package_names: config.package_names,
    service_types: config.service_types,
    mode: config.mode,
    cross_repo: config.cross_repo ?? false,
    exclude_repo_types: config.exclude_repo_types ?? [],
    boundary_config:
      config.mode === 'boundary-aware'
        ? {
            max_depth: config.max_depth ?? 2,
            follow_dependencies: config.follow_dependencies ?? true,
          }
        : undefined,
  };

  logger.info('Search scope determined', {
    mode: config.mode,
    repos: repoIds.length,
    services: serviceIds.length,
    workspaces: workspaceIds.length,
    scopeTime,
  });

  return scopeFilter;
};
