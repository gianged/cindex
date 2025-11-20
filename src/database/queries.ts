/**
 * Database query functions for MCP tools
 *
 * Provides read-only query functions for retrieving code context, symbols,
 * workspaces, services, and API contracts from the database.
 */
import { type Pool } from 'pg';

import { DatabaseQueryError } from '@utils/errors';
import { type CodeChunk, type CodeFile, getImportPaths, type Service, type Workspace } from '@/types/database';
import { type APIEndpointMatch, type ResolvedSymbol } from '@/types/retrieval';

// Re-export database types for MCP tool usage
export type { Workspace, Service };

/**
 * File context result with all related data including dependency relationships
 */
export interface FileContext {
  file: CodeFile;
  chunks: CodeChunk[];
  callers: string[]; // File paths that import this file (reverse dependency)
  callees: string[]; // Files imported by this file (forward dependency)
}

/**
 * Workspace context result with dependencies and code chunks
 */
export interface WorkspaceContext {
  workspace: Workspace;
  dependencies: string[]; // Package names this workspace depends on (forward)
  dependents: string[]; // Package names that depend on this workspace (reverse)
  files: CodeFile[];
  chunks: CodeChunk[];
}

/**
 * Service context result with API contracts and dependencies
 */
export interface ServiceContext {
  service: Service;
  dependencies: string[]; // Service IDs this service depends on (forward)
  dependents: string[]; // Service IDs that depend on this service (reverse)
  api_endpoints: APIEndpointMatch[];
  files: CodeFile[];
  chunks: CodeChunk[];
}

/**
 * Get file context with chunks, callers, and callees for complete file understanding
 * @param db - Database connection pool
 * @param filePath - Absolute file path to retrieve context for
 * @param includeCallers - Include files that import this file (reverse dependencies)
 * @param includeCallees - Include files imported by this file (forward dependencies)
 * @returns File context with all related data, or null if file not found
 * @throws {DatabaseQueryError} If query execution fails
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

    // Get callers (reverse dependencies - files that import this file)
    let callers: string[] = [];
    if (includeCallers) {
      // Search for this file path in other files' imports arrays
      const callersResult = await db.query<{ file_path: string }>(
        `SELECT DISTINCT file_path
         FROM code_files
         WHERE $1 = ANY(imports)
         ORDER BY file_path`,
        [filePath]
      );
      callers = callersResult.rows.map((row) => row.file_path);
    }

    // Get callees (forward dependencies - files imported by this file)
    const callees = includeCallees ? getImportPaths(file.imports) : [];

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
 * Search symbols by name with optional scope and project filters
 * @param db - Database connection pool
 * @param symbolName - Symbol name (supports partial ILIKE match with %)
 * @param options - Search options including scope, workspace, service, and repo filters
 * @returns Array of resolved symbols sorted by scope (exported first) and name
 * @throws {DatabaseQueryError} If query execution fails
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

    // Scope filter (exported symbols are public API, internal are private)
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
 * List all workspaces in a repository for monorepo support
 * @param db - Database connection pool
 * @param repoId - Repository ID (optional, returns all workspaces if not specified)
 * @param _options - Optional includes for dependencies and metadata (not yet implemented)
 * @returns Array of workspaces sorted by package name
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get workspace dependencies (forward dependencies - packages this workspace depends on)
 * @param db - Database connection pool
 * @param workspaceId - Workspace ID to retrieve dependencies for
 * @returns Array of dependency package names sorted alphabetically
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get workspace dependents (reverse dependencies - workspaces that depend on this package)
 * @param db - Database connection pool
 * @param packageName - Package name of the workspace to find dependents for
 * @returns Array of workspace IDs that depend on this package
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get full workspace context including dependencies, dependents, files, and chunks
 * @param db - Database connection pool
 * @param options - Query options (must provide either workspaceId or packageName+repoId)
 * @param options.workspaceId - Workspace ID (preferred identifier)
 * @param options.packageName - Package name (alternative identifier)
 * @param options.repoId - Repository ID (required if using package name)
 * @param options.includeDependencies - Include dependency information (not yet implemented)
 * @param options.includeDependents - Include dependent information (not yet implemented)
 * @param options.dependencyDepth - Depth of dependency traversal (not yet implemented)
 * @returns Workspace context with all related data, or null if not found
 * @throws {DatabaseQueryError} If query execution fails
 * @throws {Error} If neither workspaceId nor (packageName + repoId) provided
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
    // Lookup workspace by ID or by package name + repo ID
    let workspace: Workspace | undefined;

    if (options.workspaceId) {
      const result = await db.query<Workspace>(`SELECT * FROM workspaces WHERE workspace_id = $1`, [
        options.workspaceId,
      ]);
      workspace = result.rows[0];
    } else if (options.packageName && options.repoId) {
      // Alternative lookup using package name within a specific repository
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

    // Fetch all related data in parallel for performance
    const [dependencies, dependents, files, chunks] = await Promise.all([
      getWorkspaceDependencies(db, workspace.workspace_id), // Forward dependencies
      getWorkspaceDependents(db, workspace.package_name), // Reverse dependencies
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
 * List all services in repositories with optional filtering
 * @param db - Database connection pool
 * @param repoId - Repository ID (optional, returns all services if not specified)
 * @param options - Optional filters and includes
 * @param options.serviceType - Filter by service type (e.g., ['rest', 'graphql'])
 * @param options.includeDependencies - Include dependency information (not yet implemented)
 * @param options.includeApiEndpoints - Include API endpoint information (not yet implemented)
 * @returns Array of services sorted by repository and service name
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get service API endpoints with implementation details
 * Enriches endpoints with file path and line numbers from code chunks
 * @param db - Database connection pool
 * @param serviceId - Service ID to retrieve endpoints for
 * @returns Array of API endpoints with implementation locations
 * @throws {DatabaseQueryError} If query execution fails
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

    // Enrich endpoints with implementation file and line numbers
    for (const endpoint of result.rows) {
      if (endpoint.implementation_chunk_id) {
        // Fetch chunk details to get file location and line range
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
 * Get service dependencies (forward dependencies - services this service calls)
 * @param db - Database connection pool
 * @param serviceId - Service ID to retrieve dependencies for
 * @returns Array of service IDs this service depends on
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get service dependents (reverse dependencies - services that call this service)
 * @param db - Database connection pool
 * @param serviceId - Service ID to find dependents for
 * @returns Array of service IDs that depend on this service
 * @throws {DatabaseQueryError} If query execution fails
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
 * Get full service context including API contracts, dependencies, and code
 * @param db - Database connection pool
 * @param options - Query options (must provide either serviceId or serviceName+repoId)
 * @param options.serviceId - Service ID (preferred identifier)
 * @param options.serviceName - Service name (alternative identifier)
 * @param options.repoId - Repository ID (required if using service name)
 * @param options.includeDependencies - Include dependency information (not yet implemented)
 * @param options.includeDependents - Include dependent information (not yet implemented)
 * @param options.includeApiContracts - Include API contract information (not yet implemented)
 * @param options.dependencyDepth - Depth of dependency traversal (not yet implemented)
 * @returns Service context with all related data, or null if not found
 * @throws {DatabaseQueryError} If query execution fails
 * @throws {Error} If neither serviceId nor (serviceName + repoId) provided
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
    // Lookup service by ID or by service name + repo ID
    let service: Service | undefined;

    if (options.serviceId) {
      const result = await db.query<Service>(`SELECT * FROM services WHERE service_id = $1`, [options.serviceId]);
      service = result.rows[0];
    } else if (options.serviceName && options.repoId) {
      // Alternative lookup using service name within a specific repository
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

    // Fetch all related data in parallel for performance
    const [dependencies, dependents, apiEndpoints, files, chunks] = await Promise.all([
      getServiceDependencies(db, service.service_id), // Forward dependencies
      getServiceDependents(db, service.service_id), // Reverse dependencies
      getServiceAPIEndpoints(db, service.service_id), // API contracts
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
 * Search API contracts (endpoints) with semantic vector search
 * Uses cosine similarity for relevance ranking
 * @param db - Database connection pool
 * @param queryEmbedding - Query embedding vector (1024 dimensions)
 * @param options - Search options for filtering and configuration
 * @param options.apiTypes - Filter by API type (rest, graphql, grpc)
 * @param options.serviceFilter - Filter by service IDs
 * @param options.repoFilter - Filter by repository IDs
 * @param options.includeDeprecated - Include deprecated endpoints (default: false)
 * @param options.maxResults - Maximum results to return (default: 20)
 * @param options.similarityThreshold - Minimum similarity score (default: 0.75)
 * @returns Array of API endpoints ranked by similarity with implementation details
 * @throws {DatabaseQueryError} If query execution fails
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

    // Apply similarity threshold for relevance filtering
    const similarityThreshold = options.similarityThreshold ?? 0.75;

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
    const limit = options.maxResults ?? 20;

    // Use cosine distance operator (<=> ) from pgvector for similarity
    // Formula: 1 - cosine_distance = cosine_similarity (0 to 1 scale)
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
/**
 * File-level import information for cross-workspace tracking with line numbers
 */
export interface CrossWorkspaceFileImport {
  file_path: string;
  line_number: number;
  symbols: string[]; // Imported symbols (e.g., ['Button', 'Input'])
  import_type: string; // Import style (e.g., 'named', 'default', 'namespace')
}

/**
 * Cross-workspace usage detail with file-level and line-level granularity
 */
export interface CrossWorkspaceUsageDetail {
  workspace_id: string;
  package_name: string;
  file_imports: CrossWorkspaceFileImport[]; // All files that import the target package
  file_count: number; // Total number of files
  total_imports: number; // Total number of import statements
}

/**
 * Find cross-workspace usages with file-level and line-level detail for dependency tracking
 * Uses JSONB operators to search structured import data
 * @param db - Database connection pool
 * @param options - Query options
 * @param options.packageName - Target package name to find usages of
 * @param options.workspaceId - Workspace ID to exclude from results (optional)
 * @param options.symbolName - Filter by specific symbol name (not yet implemented)
 * @param options.includeIndirect - Include indirect dependencies (not yet implemented)
 * @param options.maxDepth - Maximum depth for transitive dependencies (reserved for future)
 * @returns Array of workspace usages with file/line details, sorted by usage count
 * @throws {DatabaseQueryError} If query execution fails
 * @throws {Error} If neither packageName nor workspaceId provided
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
): Promise<CrossWorkspaceUsageDetail[]> => {
  try {
    const packageName = options.packageName;
    const workspaceId = options.workspaceId;

    // Note: maxDepth parameter reserved for future transitive dependency tracking
    // Currently only direct imports are supported
    void options.maxDepth;

    if (!packageName && !workspaceId) {
      throw new Error('Either packageName or workspaceId is required');
    }

    // Search for workspaces that import the specified package
    if (packageName) {
      const excludeClause = workspaceId ? `AND workspace_id != $2` : '';
      const params = workspaceId ? [packageName, workspaceId] : [packageName];

      // Query to find all files that import the target package
      // Uses JSONB containment operator (@>) to search within structured imports array
      // This allows querying nested JSONB structures efficiently
      const sql = `
        SELECT
          workspace_id,
          package_name,
          file_path,
          imports
        FROM code_files
        WHERE imports IS NOT NULL
          AND imports @> jsonb_build_object('imports', jsonb_build_array(jsonb_build_object('path', $1)))
          ${excludeClause}
        ORDER BY workspace_id, package_name, file_path
      `;

      const result = await db.query<{
        workspace_id: string;
        package_name: string;
        file_path: string;
        imports: { imports: { path: string; line: number; symbols: string[]; type: string }[] };
      }>(sql, params);

      // Group results by workspace to aggregate file-level imports
      const workspaceMap = new Map<string, CrossWorkspaceUsageDetail>();

      for (const row of result.rows) {
        const key = `${row.workspace_id}:${row.package_name}`;

        // Initialize workspace entry if not exists
        if (!workspaceMap.has(key)) {
          workspaceMap.set(key, {
            workspace_id: row.workspace_id,
            package_name: row.package_name,
            file_imports: [],
            file_count: 0,
            total_imports: 0,
          });
        }

        const usage = workspaceMap.get(key);
        if (!usage) continue; // Should never happen, but TypeScript safety check

        // Extract imports matching the target package from JSONB structure
        const matchingImports = row.imports.imports.filter((imp) => imp.path === packageName);

        // Add each import statement with file location and imported symbols
        for (const imp of matchingImports) {
          usage.file_imports.push({
            file_path: row.file_path,
            line_number: imp.line,
            symbols: imp.symbols,
            import_type: imp.type,
          });
          usage.total_imports++;
        }

        usage.file_count++;
      }

      // Sort by usage frequency (most used packages first)
      return Array.from(workspaceMap.values()).sort((a, b) => b.total_imports - a.total_imports);
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
 * Find cross-service API calls for microservice dependency analysis
 * @param db - Database connection pool
 * @param options - Query options for filtering
 * @param options.sourceServiceId - Source service ID (caller)
 * @param options.targetServiceId - Target service ID (callee)
 * @param options.endpointPattern - Endpoint regex pattern for filtering
 * @returns Array of cross-service API calls with call counts
 * @throws {DatabaseQueryError} If query execution fails
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
 * Repository information with optional counts and metadata
 */
export interface RepositoryInfo {
  repo_id: string;
  repo_name: string | null;
  repo_type: string; // 'monolithic', 'microservice', 'monorepo', 'library', 'reference', 'documentation'
  repo_path?: string;
  last_indexed: Date;
  indexed_at: string; // ISO 8601 string representation of last_indexed
  file_count: number;
  metadata?: Record<string, unknown>;
  workspace_count?: number; // Number of workspaces (monorepos only)
  service_count?: number; // Number of services (microservices only)
  version?: string; // Version tag for reference repositories
  upstream_url?: string; // Git remote URL
}

/**
 * List all indexed repositories with optional metadata and counts
 * Uses LEFT JOINs to include repositories even if they have no files/workspaces/services
 * @param db - Database connection pool
 * @param options - Optional parameters for additional data
 * @param options.includeMetadata - Include repository metadata JSONB field
 * @param options.includeWorkspaceCount - Include count of workspaces (monorepos)
 * @param options.includeServiceCount - Include count of services (microservices)
 * @returns Array of repository information sorted by last indexed date (newest first)
 * @throws {DatabaseQueryError} If query execution fails
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

    // Build dynamic SELECT clause based on options
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

    // Build dynamic JOIN clause based on options (LEFT JOIN to include repos with 0 counts)
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

    // Transform query results with proper type conversion
    return result.rows.map((row) => ({
      repo_id: row.repo_id,
      repo_name: row.repo_name,
      repo_type: row.repo_type,
      repo_path: row.repo_path,
      last_indexed: row.indexed_at,
      indexed_at: row.indexed_at.toISOString(), // Convert to ISO 8601 string
      version: row.version,
      upstream_url: row.upstream_url,
      file_count: parseInt(row.file_count, 10), // PostgreSQL COUNT returns string
      metadata: includeMetadata ? row.metadata : undefined,
      workspace_count: includeWorkspaceCount ? parseInt(row.workspace_count ?? '0', 10) : undefined,
      service_count: includeServiceCount ? parseInt(row.service_count ?? '0', 10) : undefined,
    }));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DatabaseQueryError('listIndexedRepositories', [JSON.stringify(options)], err);
  }
};
