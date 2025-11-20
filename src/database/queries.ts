/**
 * Database query functions for MCP tools
 *
 * Provides read-only query functions for retrieving code context, symbols,
 * workspaces, services, and API contracts from the database.
 */
import { type Pool } from 'pg';

import { DatabaseQueryError } from '@utils/errors';
import { type CodeChunk, type CodeFile, type Service, type Workspace } from '@/types/database';
import { type APIEndpointMatch, type ResolvedSymbol } from '@/types/retrieval';

// Re-export database types for MCP tool usage
export type { Workspace, Service };

/**
 * File context result with all related data
 */
export interface FileContext {
  file: CodeFile;
  chunks: CodeChunk[];
  callers: string[]; // File paths that import this file
  callees: string[]; // Files imported by this file
}

/**
 * Workspace context result with dependencies
 */
export interface WorkspaceContext {
  workspace: Workspace;
  dependencies: string[]; // Package names this workspace depends on
  dependents: string[]; // Package names that depend on this workspace
  files: CodeFile[];
  chunks: CodeChunk[];
}

/**
 * Service context result with API contracts
 */
export interface ServiceContext {
  service: Service;
  dependencies: string[]; // Service IDs this service depends on
  dependents: string[]; // Service IDs that depend on this service
  api_endpoints: APIEndpointMatch[];
  files: CodeFile[];
  chunks: CodeChunk[];
}

/**
 * Get file context with chunks, callers, and callees
 *
 * @param db - Database connection pool
 * @param filePath - Absolute file path
 * @param includeCallers - Include files that import this file
 * @param includeCallees - Include files imported by this file
 * @returns File context with all related data
 */
export const getFileContext = async (
  db: Pool,
  filePath: string,
  includeCallers = true,
  includeCallees = true
): Promise<FileContext | null> => {
  try {
    // Get file metadata
    const fileResult = await db.query<CodeFile>(`SELECT * FROM code_files WHERE file_path = $1`, [filePath]);

    if (fileResult.rows.length === 0) {
      return null;
    }

    const file = fileResult.rows[0];

    // Get all chunks for this file
    const chunksResult = await db.query<CodeChunk>(
      `SELECT * FROM code_chunks WHERE file_path = $1 ORDER BY start_line ASC`,
      [filePath]
    );

    const chunks = chunksResult.rows;

    // Get callers (files that import this file)
    let callers: string[] = [];
    if (includeCallers) {
      const callersResult = await db.query<{ file_path: string }>(
        `SELECT DISTINCT file_path
         FROM code_files
         WHERE $1 = ANY(imports)
         ORDER BY file_path`,
        [filePath]
      );
      callers = callersResult.rows.map((row) => row.file_path);
    }

    // Get callees (files imported by this file)
    const callees = includeCallees ? (file.imports ?? []) : [];

    return {
      file,
      chunks,
      callers,
      callees,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getFileContext', [filePath], err);
  }
};

/**
 * Search symbols by name with optional filters
 *
 * @param db - Database connection pool
 * @param symbolName - Symbol name (supports partial match with %)
 * @param options - Search options
 * @returns Array of resolved symbols
 */
export const searchSymbols = async (
  db: Pool,
  symbolName: string,
  options: {
    scope?: 'all' | 'exported' | 'internal';
    workspaceId?: string;
    serviceId?: string;
    repoId?: string;
    limit?: number;
  } = {}
): Promise<ResolvedSymbol[]> => {
  try {
    const conditions: string[] = ['symbol_name ILIKE $1'];
    const params: unknown[] = [`%${symbolName}%`];
    let paramIndex = 2;

    // Scope filter
    if (options.scope === 'exported') {
      conditions.push(`scope = 'exported'`);
    } else if (options.scope === 'internal') {
      conditions.push(`scope = 'internal'`);
    }

    // Multi-project filters
    if (options.workspaceId) {
      conditions.push(`workspace_id = $${String(paramIndex++)}`);
      params.push(options.workspaceId);
    }

    if (options.serviceId) {
      conditions.push(`service_id = $${String(paramIndex++)}`);
      params.push(options.serviceId);
    }

    if (options.repoId) {
      conditions.push(`repo_id = $${String(paramIndex++)}`);
      params.push(options.repoId);
    }

    const limit = options.limit ?? 50;

    const sql = `
      SELECT
        symbol_name,
        symbol_type,
        file_path,
        line_number,
        definition,
        scope,
        workspace_id,
        service_id
      FROM code_symbols
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE WHEN scope = 'exported' THEN 0 ELSE 1 END,
        symbol_name
      LIMIT $${String(paramIndex)}
    `;

    params.push(limit);

    const result = await db.query<ResolvedSymbol>(sql, params);

    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('searchSymbols', [symbolName], err);
  }
};

/**
 * List all workspaces in a repository
 *
 * @param db - Database connection pool
 * @param repoId - Repository ID (optional, returns all if not specified)
 * @param options - Optional includes for dependencies and metadata
 * @returns Array of workspaces with metadata
 */
export const listWorkspaces = async (
  db: Pool,
  repoId?: string,
  _options?: {
    includeDependencies?: boolean;
    includeMetadata?: boolean;
  }
): Promise<Workspace[]> => {
  try {
    const sql = repoId
      ? `SELECT * FROM workspaces WHERE repo_id = $1 ORDER BY package_name`
      : `SELECT * FROM workspaces ORDER BY repo_id, package_name`;

    const params = repoId ? [repoId] : [];
    const result = await db.query<Workspace>(sql, params);

    // Note: _options (includeDependencies and includeMetadata) are not yet implemented in the query
    // These would require additional joins or queries to fetch related data
    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('listWorkspaces', repoId ? [repoId] : [], err);
  }
};

/**
 * Get workspace dependencies
 *
 * @param db - Database connection pool
 * @param workspaceId - Workspace ID
 * @returns Array of dependency package names
 */
export const getWorkspaceDependencies = async (db: Pool, workspaceId: string): Promise<string[]> => {
  try {
    const sql = `
      SELECT dependency_package
      FROM workspace_dependencies
      WHERE workspace_id = $1
      ORDER BY dependency_package
    `;

    const result = await db.query<{ dependency_package: string }>(sql, [workspaceId]);

    return result.rows.map((row) => row.dependency_package);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getWorkspaceDependencies', [workspaceId], err);
  }
};

/**
 * Get workspace dependents (who depends on this workspace)
 *
 * @param db - Database connection pool
 * @param packageName - Package name of the workspace
 * @returns Array of workspace IDs that depend on this package
 */
export const getWorkspaceDependents = async (db: Pool, packageName: string): Promise<string[]> => {
  try {
    const sql = `
      SELECT workspace_id
      FROM workspace_dependencies
      WHERE dependency_package = $1
      ORDER BY workspace_id
    `;

    const result = await db.query<{ workspace_id: string }>(sql, [packageName]);

    return result.rows.map((row) => row.workspace_id);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getWorkspaceDependents', [packageName], err);
  }
};

/**
 * Get full workspace context
 *
 * @param db - Database connection pool
 * @param workspaceId - Workspace ID
 * @param packageName - Package name (alternative to workspace ID)
 * @param repoId - Repository ID (required if using package name)
 * @returns Workspace context with dependencies and files
 */
export const getWorkspaceContext = async (
  db: Pool,
  options: {
    workspaceId?: string;
    packageName?: string;
    repoId?: string;
    includeDependencies?: boolean;
    includeDependents?: boolean;
    dependencyDepth?: number;
  }
): Promise<WorkspaceContext | null> => {
  try {
    // Get workspace
    let workspace: Workspace | undefined;

    if (options.workspaceId) {
      const result = await db.query<Workspace>(`SELECT * FROM workspaces WHERE workspace_id = $1`, [
        options.workspaceId,
      ]);
      workspace = result.rows[0];
    } else if (options.packageName && options.repoId) {
      const result = await db.query<Workspace>(`SELECT * FROM workspaces WHERE package_name = $1 AND repo_id = $2`, [
        options.packageName,
        options.repoId,
      ]);
      workspace = result.rows[0];
    } else {
      throw new Error('Either workspaceId or (packageName + repoId) must be provided');
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!workspace) {
      return null;
    }

    // Get dependencies and dependents
    const [dependencies, dependents, files, chunks] = await Promise.all([
      getWorkspaceDependencies(db, workspace.workspace_id),
      getWorkspaceDependents(db, workspace.package_name),
      db.query<CodeFile>(`SELECT * FROM code_files WHERE workspace_id = $1 ORDER BY file_path`, [
        workspace.workspace_id,
      ]),
      db.query<CodeChunk>(`SELECT * FROM code_chunks WHERE workspace_id = $1 ORDER BY file_path, start_line`, [
        workspace.workspace_id,
      ]),
    ]);

    return {
      workspace,
      dependencies,
      dependents,
      files: files.rows,
      chunks: chunks.rows,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getWorkspaceContext', [JSON.stringify(options)], err);
  }
};

/**
 * List all services in repositories
 *
 * @param db - Database connection pool
 * @param repoId - Repository ID (optional, returns all if not specified)
 * @param options - Optional filters and includes
 * @returns Array of services with metadata
 */
export const listServices = async (
  db: Pool,
  repoId?: string,
  options?: {
    serviceType?: string[];
    includeDependencies?: boolean;
    includeApiEndpoints?: boolean;
  }
): Promise<Service[]> => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (repoId) {
      conditions.push(`repo_id = $${String(paramIndex++)}`);
      params.push(repoId);
    }

    if (options?.serviceType && options.serviceType.length > 0) {
      conditions.push(`service_type = ANY($${String(paramIndex++)})`);
      params.push(options.serviceType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `SELECT * FROM services ${whereClause} ORDER BY repo_id, service_name`;

    const result = await db.query<Service>(sql, params);

    // Note: includeDependencies and includeApiEndpoints are not yet implemented in the query
    // These would require additional joins or queries to fetch related data
    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('listServices', [repoId ?? 'all', options?.serviceType?.join(',') ?? 'all'], err);
  }
};

/**
 * Get service API endpoints
 *
 * @param db - Database connection pool
 * @param serviceId - Service ID
 * @returns Array of API endpoints
 */
export const getServiceAPIEndpoints = async (db: Pool, serviceId: string): Promise<APIEndpointMatch[]> => {
  try {
    const sql = `
      SELECT
        endpoint_path,
        method,
        service_id,
        (SELECT service_name FROM services WHERE service_id = $1) as service_name,
        api_type,
        description,
        request_schema,
        response_schema,
        chunk_id as implementation_chunk_id,
        deprecated,
        deprecation_message,
        metadata
      FROM api_endpoints
      WHERE service_id = $1
      ORDER BY endpoint_path, method
    `;

    const result = await db.query<APIEndpointMatch>(sql, [serviceId]);

    // Get implementation file and lines from chunk_id
    for (const endpoint of result.rows) {
      if (endpoint.implementation_chunk_id) {
        const chunkResult = await db.query<{ file_path: string; start_line: number; end_line: number }>(
          `SELECT file_path, start_line, end_line FROM code_chunks WHERE chunk_id = $1`,
          [endpoint.implementation_chunk_id]
        );

        if (chunkResult.rows.length > 0) {
          const chunk = chunkResult.rows[0];
          endpoint.implementation_file = chunk.file_path;
          endpoint.implementation_lines = `${String(chunk.start_line)}-${String(chunk.end_line)}`;
        }
      }
    }

    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getServiceAPIEndpoints', [serviceId], err);
  }
};

/**
 * Get service dependencies
 *
 * @param db - Database connection pool
 * @param serviceId - Service ID
 * @returns Array of service IDs this service depends on
 */
export const getServiceDependencies = async (db: Pool, serviceId: string): Promise<string[]> => {
  try {
    const sql = `
      SELECT DISTINCT target_service_id
      FROM cross_repo_dependencies
      WHERE source_service_id = $1
      ORDER BY target_service_id
    `;

    const result = await db.query<{ target_service_id: string }>(sql, [serviceId]);

    return result.rows.map((row) => row.target_service_id);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getServiceDependencies', [serviceId], err);
  }
};

/**
 * Get service dependents (who depends on this service)
 *
 * @param db - Database connection pool
 * @param serviceId - Service ID
 * @returns Array of service IDs that depend on this service
 */
export const getServiceDependents = async (db: Pool, serviceId: string): Promise<string[]> => {
  try {
    const sql = `
      SELECT DISTINCT source_service_id
      FROM cross_repo_dependencies
      WHERE target_service_id = $1
      ORDER BY source_service_id
    `;

    const result = await db.query<{ source_service_id: string }>(sql, [serviceId]);

    return result.rows.map((row) => row.source_service_id);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getServiceDependents', [serviceId], err);
  }
};

/**
 * Get full service context
 *
 * @param db - Database connection pool
 * @param serviceId - Service ID
 * @param serviceName - Service name (alternative to service ID)
 * @param repoId - Repository ID (required if using service name)
 * @returns Service context with API contracts and dependencies
 */
export const getServiceContext = async (
  db: Pool,
  options: {
    serviceId?: string;
    serviceName?: string;
    repoId?: string;
    includeDependencies?: boolean;
    includeDependents?: boolean;
    includeApiContracts?: boolean;
    dependencyDepth?: number;
  }
): Promise<ServiceContext | null> => {
  try {
    // Get service
    let service: Service | undefined;

    if (options.serviceId) {
      const result = await db.query<Service>(`SELECT * FROM services WHERE service_id = $1`, [options.serviceId]);
      service = result.rows[0];
    } else if (options.serviceName && options.repoId) {
      const result = await db.query<Service>(`SELECT * FROM services WHERE service_name = $1 AND repo_id = $2`, [
        options.serviceName,
        options.repoId,
      ]);
      service = result.rows[0];
    } else {
      throw new Error('Either serviceId or (serviceName + repoId) must be provided');
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!service) {
      return null;
    }

    // Get dependencies, dependents, API endpoints, files, and chunks
    const [dependencies, dependents, apiEndpoints, files, chunks] = await Promise.all([
      getServiceDependencies(db, service.service_id),
      getServiceDependents(db, service.service_id),
      getServiceAPIEndpoints(db, service.service_id),
      db.query<CodeFile>(`SELECT * FROM code_files WHERE service_id = $1 ORDER BY file_path`, [service.service_id]),
      db.query<CodeChunk>(`SELECT * FROM code_chunks WHERE service_id = $1 ORDER BY file_path, start_line`, [
        service.service_id,
      ]),
    ]);

    return {
      service,
      dependencies,
      dependents,
      api_endpoints: apiEndpoints,
      files: files.rows,
      chunks: chunks.rows,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('getServiceContext', [JSON.stringify(options)], err);
  }
};

/**
 * Search API contracts (endpoints) with semantic search
 *
 * @param db - Database connection pool
 * @param queryEmbedding - Query embedding vector
 * @param options - Search options
 * @returns Array of API endpoints ranked by similarity
 */
export const searchAPIContracts = async (
  db: Pool,
  queryEmbedding: number[],
  options: {
    apiTypes?: ('rest' | 'graphql' | 'grpc')[];
    serviceFilter?: string[];
    repoFilter?: string[];
    includeDeprecated?: boolean;
    maxResults?: number;
    similarityThreshold?: number;
  } = {}
): Promise<APIEndpointMatch[]> => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [`[${queryEmbedding.join(',')}]`];
    let paramIndex = 2;

    // API type filter
    if (options.apiTypes && options.apiTypes.length > 0) {
      conditions.push(`api_type = ANY($${String(paramIndex++)})`);
      params.push(options.apiTypes);
    }

    // Service filter
    if (options.serviceFilter && options.serviceFilter.length > 0) {
      conditions.push(`service_id = ANY($${String(paramIndex++)})`);
      params.push(options.serviceFilter);
    }

    // Repository filter
    if (options.repoFilter && options.repoFilter.length > 0) {
      conditions.push(`service_id IN (SELECT service_id FROM services WHERE repo_id = ANY($${String(paramIndex++)}))`);
      params.push(options.repoFilter);
    }

    // Deprecated filter
    if (!options.includeDeprecated) {
      conditions.push(`(deprecated IS NULL OR deprecated = false)`);
    }

    // Similarity threshold
    const similarityThreshold = options.similarityThreshold ?? 0.75;

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    const limit = options.maxResults ?? 20;

    const sql = `
      SELECT
        endpoint_path,
        method,
        service_id,
        (SELECT service_name FROM services WHERE services.service_id = api_endpoints.service_id) as service_name,
        api_type,
        description,
        request_schema,
        response_schema,
        chunk_id as implementation_chunk_id,
        deprecated,
        deprecation_message,
        1 - (endpoint_embedding <=> $1::vector) as similarity
      FROM api_endpoints
      WHERE endpoint_embedding IS NOT NULL
        AND 1 - (endpoint_embedding <=> $1::vector) >= ${String(similarityThreshold)}
        ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${String(limit)}
    `;

    const result = await db.query<APIEndpointMatch>(sql, params);

    // Get implementation file and lines
    for (const endpoint of result.rows) {
      if (endpoint.implementation_chunk_id) {
        const chunkResult = await db.query<{ file_path: string; start_line: number; end_line: number }>(
          `SELECT file_path, start_line, end_line FROM code_chunks WHERE chunk_id = $1`,
          [endpoint.implementation_chunk_id]
        );

        if (chunkResult.rows.length > 0) {
          const chunk = chunkResult.rows[0];
          endpoint.implementation_file = chunk.file_path;
          endpoint.implementation_lines = `${String(chunk.start_line)}-${String(chunk.end_line)}`;
        }
      }
    }

    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('searchAPIContracts', ['embedding search'], err);
  }
};

/**
 * Find cross-workspace usages of a package
 *
 * @param db - Database connection pool
 * @param options - Search options (packageName or workspaceId, plus filters)
 * @returns Array of workspace IDs that use this package
 */
export const findCrossWorkspaceUsages = async (
  db: Pool,
  options: {
    packageName?: string;
    workspaceId?: string;
    symbolName?: string;
    includeIndirect?: boolean;
    maxDepth?: number;
  }
): Promise<{ workspace_id: string; package_name: string; file_count: number }[]> => {
  try {
    // Note: symbolName, includeIndirect, and maxDepth are not yet implemented
    // This is a simplified implementation that only does basic workspace filtering
    const packageName = options.packageName;
    const workspaceId = options.workspaceId;

    if (!packageName && !workspaceId) {
      throw new Error('Either packageName or workspaceId is required');
    }

    // If we have packageName, search for workspaces that import it
    if (packageName) {
      const excludeClause = workspaceId ? `AND workspace_id != $2` : '';
      const params = workspaceId ? [packageName, workspaceId] : [packageName];

      const sql = `
        SELECT
          workspace_id,
          package_name,
          COUNT(DISTINCT file_path) as file_count
        FROM code_files
        WHERE $1 = ANY(imports)
          ${excludeClause}
        GROUP BY workspace_id, package_name
        ORDER BY file_count DESC, package_name
      `;

      const result = await db.query<{ workspace_id: string; package_name: string; file_count: number }>(sql, params);
      return result.rows;
    }

    // If only workspaceId, return empty (not yet implemented)
    return [];
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError(
      'findCrossWorkspaceUsages',
      [options.packageName ?? options.workspaceId ?? 'unknown'],
      err
    );
  }
};

/**
 * Find cross-service API calls
 *
 * @param db - Database connection pool
 * @param sourceServiceId - Source service ID (optional)
 * @param targetServiceId - Target service ID (optional)
 * @param endpointPattern - Endpoint regex pattern (optional)
 * @returns Array of cross-service API calls
 */
export const findCrossServiceCalls = async (
  db: Pool,
  options: {
    sourceServiceId?: string;
    targetServiceId?: string;
    endpointPattern?: string;
  } = {}
): Promise<
  {
    source_service_id: string;
    target_service_id: string;
    endpoint_path: string;
    call_count: number;
  }[]
> => {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.sourceServiceId) {
      conditions.push(`source_service_id = $${String(paramIndex++)}`);
      params.push(options.sourceServiceId);
    }

    if (options.targetServiceId) {
      conditions.push(`target_service_id = $${String(paramIndex++)}`);
      params.push(options.targetServiceId);
    }

    if (options.endpointPattern) {
      conditions.push(`api_contracts::text ~ $${String(paramIndex++)}`);
      params.push(options.endpointPattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        source_service_id,
        target_service_id,
        (api_contracts->>0)::text as endpoint_path,
        COUNT(*) as call_count
      FROM cross_repo_dependencies
      ${whereClause}
      GROUP BY source_service_id, target_service_id, endpoint_path
      ORDER BY call_count DESC
    `;

    const result = await db.query<{
      source_service_id: string;
      target_service_id: string;
      endpoint_path: string;
      call_count: number;
    }>(sql, params);

    return result.rows;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('findCrossServiceCalls', [JSON.stringify(options)], err);
  }
};

/**
 * Repository information with optional counts
 */
export interface RepositoryInfo {
  repo_id: string;
  repo_name: string | null;
  repo_type: string;
  repo_path?: string;
  last_indexed: Date;
  indexed_at: string; // ISO string representation of last_indexed
  file_count: number;
  metadata?: Record<string, unknown>;
  workspace_count?: number;
  service_count?: number;
  version?: string;
  upstream_url?: string;
}

/**
 * List all indexed repositories
 *
 * @param db - Database connection pool
 * @param options - Optional parameters for additional data
 * @returns Array of repository information
 */
export const listIndexedRepositories = async (
  db: Pool,
  options: {
    includeMetadata?: boolean;
    includeWorkspaceCount?: boolean;
    includeServiceCount?: boolean;
  } = {}
): Promise<RepositoryInfo[]> => {
  try {
    const { includeMetadata = false, includeWorkspaceCount = false, includeServiceCount = false } = options;

    // Build SELECT clause
    const selectFields = [
      'r.repo_id',
      'r.repo_name',
      'r.repo_type',
      'r.repo_path',
      'r.indexed_at',
      'r.version',
      'r.upstream_url',
      'COUNT(DISTINCT f.id) as file_count',
    ];

    if (includeMetadata) {
      selectFields.push('r.metadata');
    }

    if (includeWorkspaceCount) {
      selectFields.push('COUNT(DISTINCT w.id) as workspace_count');
    }

    if (includeServiceCount) {
      selectFields.push('COUNT(DISTINCT s.id) as service_count');
    }

    // Build JOIN clause
    const joins = ['LEFT JOIN code_files f ON r.repo_id = f.repo_id'];

    if (includeWorkspaceCount) {
      joins.push('LEFT JOIN workspaces w ON r.repo_id = w.repo_id');
    }

    if (includeServiceCount) {
      joins.push('LEFT JOIN services s ON r.repo_id = s.repo_id');
    }

    // Build GROUP BY clause
    const groupByFields = [
      'r.repo_id',
      'r.repo_name',
      'r.repo_type',
      'r.repo_path',
      'r.indexed_at',
      'r.version',
      'r.upstream_url',
    ];
    if (includeMetadata) {
      groupByFields.push('r.metadata');
    }

    const sql = `
      SELECT ${selectFields.join(', ')}
      FROM repositories r
      ${joins.join('\n      ')}
      GROUP BY ${groupByFields.join(', ')}
      ORDER BY r.indexed_at DESC
    `;

    const result = await db.query<{
      repo_id: string;
      repo_name: string | null;
      repo_type: string;
      repo_path?: string;
      indexed_at: Date;
      version?: string;
      upstream_url?: string;
      file_count: string;
      metadata?: Record<string, unknown>;
      workspace_count?: string;
      service_count?: string;
    }>(sql);

    return result.rows.map((row) => ({
      repo_id: row.repo_id,
      repo_name: row.repo_name,
      repo_type: row.repo_type,
      repo_path: row.repo_path,
      last_indexed: row.indexed_at,
      indexed_at: row.indexed_at.toISOString(),
      version: row.version,
      upstream_url: row.upstream_url,
      file_count: parseInt(row.file_count, 10),
      metadata: includeMetadata ? row.metadata : undefined,
      workspace_count: includeWorkspaceCount ? parseInt(row.workspace_count ?? '0', 10) : undefined,
      service_count: includeServiceCount ? parseInt(row.service_count ?? '0', 10) : undefined,
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('listIndexedRepositories', [JSON.stringify(options)], err);
  }
};
