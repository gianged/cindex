/**
 * API Contract Enrichment (Stage 5 of multi-project retrieval pipeline)
 *
 * Enriches search results with API contract information:
 * - Finds API endpoints exposed by services in search scope
 * - Detects cross-service API calls in code chunks
 * - Links endpoints to implementation chunks
 * - Generates warnings for deprecated endpoints, missing implementations
 */

import { type DatabaseClient } from '@database/client';
import { apiEndpointCache, generateCacheKey } from '@utils/cache';
import { logger } from '@utils/logger';
import { type APIEndpoint } from '@/types/database';
import {
  type APIContext,
  type APIEndpointMatch,
  type ContractLink,
  type CrossServiceCall,
  type QueryEmbedding,
  type RelevantChunk,
  type RelevantFile,
  type SearchOptions,
  type SearchWarning,
} from '@/types/retrieval';

/**
 * Database row types for API queries
 */
interface ServiceAPIRow {
  service_id: string;
  service_name: string;
  service_type: string;
  api_endpoints: APIEndpoint[] | null;
}

/**
 * API endpoint database row (from api_endpoints table with vector search)
 */
interface APIEndpointRow {
  id: number;
  service_id: string;
  repo_id: string;
  api_type: string;
  endpoint_path: string;
  http_method: string | null;
  operation_id: string | null;
  summary: string | null;
  description: string | null;
  tags: string[] | null;
  request_schema: Record<string, unknown> | null;
  response_schema: Record<string, unknown> | null;
  implementation_file: string | null;
  implementation_lines: string | null;
  implementation_chunk_id: number | null;
  implementation_function: string | null;
  deprecated: boolean;
  similarity?: number; // Computed from vector search
}

/**
 * Service name lookup row
 */
interface ServiceNameRow {
  service_id: string;
  service_name: string;
}

/**
 * HTTP client patterns for detecting API calls in code
 *
 * These regex patterns match common HTTP client usage in JavaScript/TypeScript:
 * - fetch API calls (native browser/Node.js)
 * - axios method calls (axios.get, axios.post, etc.)
 * - axios config objects
 * - GraphQL query/mutation operations
 * - gRPC client instantiations
 *
 * Used in detectCrossServiceCalls() to identify cross-service dependencies.
 */
const API_CALL_PATTERNS = {
  // JavaScript/TypeScript patterns
  fetch: /fetch\(['"]([^'"]+)['"](?:,\s*\{[^}]*method:\s*['"](\w+)['"][^}]*\})?/g,
  axios: /axios\.(\w+)\(['"]([^'"]+)['"]/g,
  axiosRequest: /axios\(\{[^}]*url:\s*['"]([^'"]+)['"][^}]*method:\s*['"](\w+)['"][^}]*\}/g,

  // GraphQL patterns
  graphqlQuery: /(?:query|mutation)\s+(\w+)/g,
  graphqlClient: /graphql\(['"]([^'"]+)['"]/g,

  // gRPC patterns (simplified)
  grpcClient: /new\s+(\w+)Client\(/g,
};

/**
 * Extract service IDs from relevant files and chunks
 *
 * @param files - Relevant files from Stage 1
 * @param chunks - Relevant chunks from Stage 2
 * @returns Set of unique service IDs
 */
const extractServiceIds = (files: RelevantFile[], chunks: RelevantChunk[]): Set<string> => {
  const serviceIds = new Set<string>();

  // Extract from files
  for (const file of files) {
    if (file.service_id) {
      serviceIds.add(file.service_id);
    }
  }

  // Extract from chunks
  for (const chunk of chunks) {
    if (chunk.service_id) {
      serviceIds.add(chunk.service_id);
    }
  }

  return serviceIds;
};

/**
 * Query API endpoints table with vector similarity search
 *
 * This function performs semantic search on the api_endpoints table using
 * vector embeddings, supporting multi-project features like API type filtering
 * and implementation chunk validation.
 *
 * @param db - Database client
 * @param queryEmbedding - Query embedding for similarity search
 * @param serviceIds - Service IDs to search within
 * @param options - API enrichment options
 * @returns Array of API endpoints ranked by similarity
 */
const queryAPIEndpointsWithSimilarity = async (
  db: DatabaseClient,
  queryEmbedding: QueryEmbedding,
  serviceIds: Set<string>,
  options: SearchOptions = {}
): Promise<APIEndpointMatch[]> => {
  if (serviceIds.size === 0) {
    return [];
  }

  const apiTypes = options.api_types;
  const includeDeprecatedApis = options.include_deprecated_apis ?? false;
  const apiSimilarityThreshold = options.api_similarity_threshold ?? 0.75;
  const maxApiEndpoints = options.max_api_endpoints ?? 50;

  // Check API endpoint cache
  const cacheKey = generateCacheKey({
    serviceIds: Array.from(serviceIds).sort(),
    queryEmbedding: queryEmbedding.embedding.slice(0, 10), // Use first 10 dimensions for cache key
    apiTypes,
    includeDeprecatedApis,
    apiSimilarityThreshold,
    maxApiEndpoints,
  });

  const cachedEndpoints = apiEndpointCache.get(cacheKey) as APIEndpointMatch[] | undefined;
  if (cachedEndpoints) {
    const cacheStats = apiEndpointCache.getStats();
    logger.debug('API endpoints retrieved from cache', {
      servicesQueried: serviceIds.size,
      endpointsFound: cachedEndpoints.length,
      cacheSize: cacheStats.size,
      hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
    });
    return cachedEndpoints;
  }

  const serviceIdArray = Array.from(serviceIds);

  // Build query with optional filters
  const conditions: string[] = ['service_id = ANY($1::text[])'];
  const params: unknown[] = [serviceIdArray, queryEmbedding.embedding];
  let paramIndex = 3;

  // Filter by API type if specified
  if (apiTypes && apiTypes.length > 0) {
    conditions.push(`api_type = ANY($${String(paramIndex)}::text[])`);
    params.push(apiTypes);
    paramIndex++;
  }

  // Exclude deprecated APIs unless explicitly included
  if (!includeDeprecatedApis) {
    conditions.push('deprecated = FALSE');
  }

  // Build WHERE clause
  const whereClause = conditions.join(' AND ');

  // Query with vector similarity
  const query = `
    SELECT
      id,
      service_id,
      repo_id,
      api_type,
      endpoint_path,
      http_method,
      operation_id,
      summary,
      description,
      tags,
      request_schema,
      response_schema,
      implementation_file,
      implementation_lines,
      implementation_chunk_id,
      implementation_function,
      deprecated,
      1 - (embedding <=> $2::vector) AS similarity
    FROM api_endpoints
    WHERE ${whereClause}
      AND 1 - (embedding <=> $2::vector) > $${String(paramIndex)}
    ORDER BY embedding <=> $2::vector
    LIMIT $${String(paramIndex + 1)}
  `;

  params.push(apiSimilarityThreshold, maxApiEndpoints);

  const result = await db.query<APIEndpointRow>(query, params);

  // Fetch service names for endpoints
  const serviceNameMap = await fetchServiceNames(db, new Set(result.rows.map((r) => r.service_id)));

  // Convert to APIEndpointMatch format
  const endpoints: APIEndpointMatch[] = result.rows.map((row) => ({
    endpoint_path: row.endpoint_path,
    method: row.http_method ?? row.operation_id ?? 'QUERY',
    service_id: row.service_id,
    service_name: serviceNameMap.get(row.service_id) ?? row.service_id,
    api_type: row.api_type as 'rest' | 'graphql' | 'grpc' | 'websocket',
    description: row.description ?? row.summary ?? undefined,
    request_schema: row.request_schema ?? undefined,
    response_schema: row.response_schema ?? undefined,
    implementation_chunk_id: row.implementation_chunk_id?.toString(),
    implementation_file: row.implementation_file ?? undefined,
    implementation_lines: row.implementation_lines ?? undefined,
    similarity: row.similarity,
    deprecated: row.deprecated,
  }));

  logger.debug('Queried API endpoints with similarity', {
    servicesQueried: serviceIds.size,
    endpointsFound: endpoints.length,
    avgSimilarity:
      endpoints.length > 0
        ? (endpoints.reduce((sum, e) => sum + (e.similarity ?? 0), 0) / endpoints.length).toFixed(3)
        : 0,
    apiTypes: apiTypes ?? 'all',
    includeDeprecated: includeDeprecatedApis,
  });

  // Cache the API endpoints
  apiEndpointCache.set(cacheKey, endpoints);
  const cacheStats = apiEndpointCache.getStats();
  logger.debug('API endpoints cached', {
    cacheSize: cacheStats.size,
    hitRate: (cacheStats.hitRate * 100).toFixed(1) + '%',
  });

  return endpoints;
};

/**
 * Fetch service names for service IDs
 *
 * @param db - Database client
 * @param serviceIds - Service IDs to fetch names for
 * @returns Map of service_id → service_name
 */
const fetchServiceNames = async (db: DatabaseClient, serviceIds: Set<string>): Promise<Map<string, string>> => {
  if (serviceIds.size === 0) {
    return new Map();
  }

  const query = `
    SELECT service_id, service_name
    FROM services
    WHERE service_id = ANY($1::text[])
  `;

  const result = await db.query<ServiceNameRow>(query, [Array.from(serviceIds)]);

  const nameMap = new Map<string, string>();
  for (const row of result.rows) {
    nameMap.set(row.service_id, row.service_name);
  }

  return nameMap;
};

/**
 * Fetch API endpoints for services (legacy method using JSONB)
 *
 * This method queries the services.api_endpoints JSONB column.
 * Prefer queryAPIEndpointsWithSimilarity() for semantic search.
 *
 * @param db - Database client
 * @param serviceIds - Service IDs to query
 * @returns Array of API endpoints with service metadata
 */
const fetchServiceAPIs = async (db: DatabaseClient, serviceIds: Set<string>): Promise<APIEndpointMatch[]> => {
  if (serviceIds.size === 0) {
    return [];
  }

  const serviceIdArray = Array.from(serviceIds);

  const query = `
    SELECT
      service_id,
      service_name,
      service_type,
      api_endpoints
    FROM services
    WHERE service_id = ANY($1::text[])
      AND api_endpoints IS NOT NULL
  `;

  const result = await db.query<ServiceAPIRow>(query, [serviceIdArray]);

  // Flatten endpoints from all services
  const endpoints: APIEndpointMatch[] = [];

  for (const row of result.rows) {
    if (!row.api_endpoints) continue;

    for (const endpoint of row.api_endpoints) {
      const apiType = row.service_type as 'rest' | 'graphql' | 'grpc' | 'websocket';

      endpoints.push({
        endpoint_path: endpoint.path,
        method: endpoint.method ?? 'GET',
        service_id: row.service_id,
        service_name: row.service_name,
        api_type: apiType,
        description: endpoint.description,
        request_schema: endpoint.schema as Record<string, unknown> | undefined,
        response_schema: endpoint.schema as Record<string, unknown> | undefined,
        deprecated: (endpoint as { deprecated?: boolean }).deprecated,
        deprecation_message: (endpoint as { deprecation_message?: string }).deprecation_message,
      });
    }
  }

  logger.debug('Fetched API endpoints from services', {
    servicesQueried: serviceIds.size,
    endpointsFound: endpoints.length,
  });

  return endpoints;
};

/**
 * Detect API calls in code chunks
 *
 * Parses chunk content for HTTP client usage, GraphQL queries, gRPC calls.
 * Matches detected calls against known API endpoints to identify inter-service dependencies.
 *
 * @param chunks - Code chunks to analyze
 * @param endpoints - Known API endpoints from services (for matching)
 * @returns Array of detected cross-service calls with endpoint matches
 */
const detectCrossServiceCalls = (chunks: RelevantChunk[], endpoints: APIEndpointMatch[]): CrossServiceCall[] => {
  const calls: CrossServiceCall[] = [];

  // Build endpoint lookup map
  const endpointMap = new Map<string, APIEndpointMatch>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method}:${endpoint.endpoint_path}`;
    endpointMap.set(key, endpoint);
  }

  for (const chunk of chunks) {
    const content = chunk.chunk_content;
    const chunkServiceId = chunk.service_id ?? 'unknown';

    // Detect fetch calls
    let match;
    while ((match = API_CALL_PATTERNS.fetch.exec(content)) !== null) {
      const url = match[1];
      const method = match[2] || 'GET';

      if (url) {
        const endpointPath = extractPathFromURL(url);
        const key = `${method.toUpperCase()}:${endpointPath}`;
        const matchedEndpoint = endpointMap.get(key);

        calls.push({
          source_chunk_id: chunk.chunk_id,
          source_file: chunk.file_path,
          source_service_id: chunkServiceId,
          target_service_id: matchedEndpoint?.service_id,
          endpoint_path: endpointPath,
          method: method.toUpperCase(),
          call_type: 'http',
          endpoint_found: !!matchedEndpoint,
          matched_endpoint: matchedEndpoint,
        });
      }
    }

    // Detect axios calls
    API_CALL_PATTERNS.axios.lastIndex = 0;
    while ((match = API_CALL_PATTERNS.axios.exec(content)) !== null) {
      const method = match[1];
      const url = match[2];

      if (url && method) {
        const endpointPath = extractPathFromURL(url);
        const key = `${method.toUpperCase()}:${endpointPath}`;
        const matchedEndpoint = endpointMap.get(key);

        calls.push({
          source_chunk_id: chunk.chunk_id,
          source_file: chunk.file_path,
          source_service_id: chunkServiceId,
          target_service_id: matchedEndpoint?.service_id,
          endpoint_path: endpointPath,
          method: method.toUpperCase(),
          call_type: 'http',
          endpoint_found: !!matchedEndpoint,
          matched_endpoint: matchedEndpoint,
        });
      }
    }

    // Detect GraphQL queries/mutations
    API_CALL_PATTERNS.graphqlQuery.lastIndex = 0;
    while ((match = API_CALL_PATTERNS.graphqlQuery.exec(content)) !== null) {
      const operationName = match[1];

      if (operationName) {
        // Try to find matching GraphQL endpoint
        const graphqlEndpoints = endpoints.filter((e) => e.api_type === 'graphql');
        const matchedEndpoint = graphqlEndpoints[0]; // Simplified - first GraphQL service

        calls.push({
          source_chunk_id: chunk.chunk_id,
          source_file: chunk.file_path,
          source_service_id: chunkServiceId,
          target_service_id: matchedEndpoint.service_id,
          endpoint_path: operationName,
          method: 'QUERY',
          call_type: 'graphql',
          endpoint_found: !!matchedEndpoint,
          matched_endpoint: matchedEndpoint,
        });
      }
    }

    // Detect gRPC clients
    API_CALL_PATTERNS.grpcClient.lastIndex = 0;
    while ((match = API_CALL_PATTERNS.grpcClient.exec(content)) !== null) {
      const clientName = match[1];

      if (clientName) {
        // Try to find matching gRPC service
        const grpcEndpoints = endpoints.filter((e) => e.api_type === 'grpc');
        const matchedEndpoint = grpcEndpoints[0]; // Simplified

        calls.push({
          source_chunk_id: chunk.chunk_id,
          source_file: chunk.file_path,
          source_service_id: chunkServiceId,
          target_service_id: matchedEndpoint.service_id,
          endpoint_path: clientName,
          method: 'RPC',
          call_type: 'grpc',
          endpoint_found: !!matchedEndpoint,
          matched_endpoint: matchedEndpoint,
        });
      }
    }
  }

  logger.debug('Detected cross-service API calls', {
    chunksAnalyzed: chunks.length,
    callsDetected: calls.length,
    callsWithMatchedEndpoints: calls.filter((c) => c.endpoint_found).length,
  });

  return calls;
};

/**
 * Extract path from URL (remove protocol, domain, query params)
 *
 * Examples:
 * - "https://api.example.com/users?limit=10" → "/users"
 * - "/api/v1/posts" → "/api/v1/posts"
 * - "users" → "/users"
 *
 * @param url - Full URL or path
 * @returns Extracted path (always starts with /)
 */
const extractPathFromURL = (url: string): string => {
  // Remove protocol and domain if present
  let path = url.replace(/^https?:\/\/[^/]+/, '');

  // Remove query parameters
  path = path.split('?')[0] ?? path;

  // Ensure starts with /
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  return path;
};

/**
 * Link endpoints to implementation chunks
 *
 * Uses implementation_chunk_id from endpoint metadata (set during API contract parsing).
 * Groups multiple endpoints implemented in the same chunk.
 *
 * @param endpoints - API endpoints with implementation_chunk_id
 * @param chunks - Code chunks from retrieval
 * @returns Contract links between chunks and endpoints (high confidence: 1.0)
 */
const linkEndpointsToChunks = (endpoints: APIEndpointMatch[], chunks: RelevantChunk[]): ContractLink[] => {
  const links: ContractLink[] = [];
  const chunkMap = new Map<string, RelevantChunk>();

  // Build chunk lookup map
  for (const chunk of chunks) {
    chunkMap.set(chunk.chunk_id, chunk);
  }

  // Group endpoints by chunk
  const endpointsByChunk = new Map<string, APIEndpointMatch[]>();

  for (const endpoint of endpoints) {
    // Use implementation_chunk_id if available
    if (endpoint.implementation_chunk_id) {
      const chunkEndpoints = endpointsByChunk.get(endpoint.implementation_chunk_id) ?? [];
      chunkEndpoints.push(endpoint);
      endpointsByChunk.set(endpoint.implementation_chunk_id, chunkEndpoints);
    }
  }

  // Create contract links
  for (const [chunkId, linkedEndpoints] of endpointsByChunk.entries()) {
    if (chunkMap.has(chunkId)) {
      links.push({
        chunk_id: chunkId,
        endpoints: linkedEndpoints,
        link_type: 'implementation',
        confidence: 1.0, // High confidence when implementation_chunk_id is set
      });
    }
  }

  logger.debug('Linked endpoints to chunks', {
    totalEndpoints: endpoints.length,
    linkedEndpoints: links.reduce((sum, link) => sum + link.endpoints.length, 0),
    chunksWithLinks: links.length,
  });

  return links;
};

/**
 * Generate API-related warnings
 *
 * Warnings:
 * - Deprecated endpoints being used
 * - Missing endpoint implementations
 * - Unresolved cross-service calls
 *
 * @param endpoints - API endpoints
 * @param calls - Detected API calls
 * @param links - Contract links
 * @returns Array of warnings
 */
const generateAPIWarnings = (
  endpoints: APIEndpointMatch[],
  calls: CrossServiceCall[],
  links: ContractLink[]
): SearchWarning[] => {
  const warnings: SearchWarning[] = [];

  // Warn about deprecated endpoints
  const deprecatedEndpoints = endpoints.filter((e) => e.deprecated);
  if (deprecatedEndpoints.length > 0) {
    warnings.push({
      type: 'deprecated_api',
      severity: 'warning',
      message: `Found ${String(deprecatedEndpoints.length)} deprecated API endpoint(s) in search results`,
      suggestion: `Review deprecated endpoints: ${deprecatedEndpoints.map((e) => e.endpoint_path).join(', ')}`,
    });
  }

  // Warn about unresolved API calls
  const unresolvedCalls = calls.filter((c) => !c.endpoint_found);
  if (unresolvedCalls.length > 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'info',
      message: `Detected ${String(unresolvedCalls.length)} API call(s) to unregistered endpoints`,
      suggestion: 'Some API calls could not be matched to service definitions',
    });
  }

  // Warn about endpoints without implementations
  const linkedEndpointIds = new Set<string>();
  for (const link of links) {
    for (const endpoint of link.endpoints) {
      linkedEndpointIds.add(`${endpoint.service_id}:${endpoint.endpoint_path}`);
    }
  }

  const unlinkedEndpoints = endpoints.filter((e) => !linkedEndpointIds.has(`${e.service_id}:${e.endpoint_path}`));

  if (unlinkedEndpoints.length > 0) {
    warnings.push({
      type: 'partial_results',
      severity: 'info',
      message: `${String(unlinkedEndpoints.length)} API endpoint(s) without linked implementation chunks`,
      suggestion: 'Some endpoints may not have been indexed or implementation links are missing',
    });
  }

  return warnings;
};

/**
 * Build API context maps
 *
 * Creates mappings:
 * - service_id → exposed APIs
 * - chunk_id → related endpoints
 *
 * @param endpoints - API endpoints
 * @param links - Contract links
 * @returns API context maps
 */
const buildAPIContextMaps = (
  endpoints: APIEndpointMatch[],
  links: ContractLink[]
): {
  apis_by_service: Record<string, APIEndpointMatch[]>;
  endpoints_by_chunk: Record<string, APIEndpointMatch[]>;
} => {
  const apisByService: Record<string, APIEndpointMatch[]> = {};
  const endpointsByChunk: Record<string, APIEndpointMatch[]> = {};

  // Group endpoints by service
  for (const endpoint of endpoints) {
    (apisByService[endpoint.service_id] ??= []).push(endpoint);
  }

  // Map chunks to endpoints
  for (const link of links) {
    endpointsByChunk[link.chunk_id] = link.endpoints;
  }

  return { apis_by_service: apisByService, endpoints_by_chunk: endpointsByChunk };
};

/**
 * Enrich search results with API contract information (Enhanced version)
 *
 * Stage 5 of multi-project retrieval pipeline.
 *
 * Workflow:
 * 1. Extract service IDs from files and chunks
 * 2. Query api_endpoints table with vector similarity (semantic search)
 * 3. Filter by API type, deprecation status, implementation match
 * 4. Detect cross-service API calls in code
 * 5. Link endpoints to implementation chunks
 * 6. Generate API warnings
 * 7. Build context maps
 *
 * @param files - Relevant files from Stage 1
 * @param chunks - Relevant chunks from Stage 2 (after dedup)
 * @param db - Database client
 * @param queryEmbedding - Optional query embedding for semantic API search
 * @param options - Optional API enrichment options
 * @returns API context with endpoints, calls, links, and warnings
 */
export const enrichWithAPIContracts = async (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  db: DatabaseClient,
  queryEmbedding?: QueryEmbedding,
  options: SearchOptions = {}
): Promise<APIContext> => {
  const startTime = Date.now();

  // Check if API enrichment is enabled
  const searchApiContracts = options.search_api_contracts ?? true;
  if (!searchApiContracts) {
    logger.debug('API contract enrichment disabled by options');
    return {
      endpoints: [],
      cross_service_calls: [],
      contract_links: [],
      api_warnings: [],
      apis_by_service: {},
      endpoints_by_chunk: {},
    };
  }

  logger.debug('Starting API contract enrichment', {
    files: files.length,
    chunks: chunks.length,
    semanticSearch: !!queryEmbedding,
    options,
  });

  // Step 1: Extract service IDs
  const serviceIds = extractServiceIds(files, chunks);

  if (serviceIds.size === 0) {
    logger.debug('No services found in search results, skipping API enrichment');
    return {
      endpoints: [],
      cross_service_calls: [],
      contract_links: [],
      api_warnings: [],
      apis_by_service: {},
      endpoints_by_chunk: {},
    };
  }

  // Step 2: Fetch API endpoints for services
  let endpoints: APIEndpointMatch[];
  if (queryEmbedding) {
    // Use semantic search on api_endpoints table (preferred)
    endpoints = await queryAPIEndpointsWithSimilarity(db, queryEmbedding, serviceIds, options);
  } else {
    // Fall back to JSONB query on services table (legacy)
    endpoints = await fetchServiceAPIs(db, serviceIds);
  }

  // Step 2.5: Filter endpoints by implementation match if required
  if (options.require_implementation_match && endpoints.length > 0) {
    const retrievedChunkIds = new Set(chunks.map((c) => c.chunk_id));
    endpoints = endpoints.filter((e) => e.implementation_chunk_id && retrievedChunkIds.has(e.implementation_chunk_id));

    logger.debug('Filtered endpoints by implementation match', {
      beforeFilter: endpoints.length,
      afterFilter: endpoints.length,
    });
  }

  // Step 3: Detect cross-service API calls
  const crossServiceCalls = detectCrossServiceCalls(chunks, endpoints);

  // Step 4: Link endpoints to implementation chunks
  const contractLinks = linkEndpointsToChunks(endpoints, chunks);

  // Step 5: Generate API warnings
  const apiWarnings = generateAPIWarnings(endpoints, crossServiceCalls, contractLinks);

  // Step 6: Build context maps
  const { apis_by_service: apisByService, endpoints_by_chunk: endpointsByChunk } = buildAPIContextMaps(
    endpoints,
    contractLinks
  );

  const enrichmentTime = Date.now() - startTime;

  logger.info('API contract enrichment complete', {
    servicesAnalyzed: serviceIds.size,
    endpointsFound: endpoints.length,
    crossServiceCalls: crossServiceCalls.length,
    contractLinks: contractLinks.length,
    apiWarnings: apiWarnings.length,
    enrichmentTime,
  });

  return {
    endpoints,
    cross_service_calls: crossServiceCalls,
    contract_links: contractLinks,
    api_warnings: apiWarnings,
    apis_by_service: apisByService,
    endpoints_by_chunk: endpointsByChunk,
  };
};

/**
 * Enrich search results with API contracts (filtered by scope)
 *
 * Enhanced version for multi-project mode with scope filtering.
 * This version respects the scope filter from Stage 0.
 *
 * @param files - Relevant files from Stage 1
 * @param chunks - Relevant chunks from Stage 2
 * @param db - Database client
 * @param serviceIds - Service IDs to include (from scope filter)
 * @param queryEmbedding - Optional query embedding for semantic API search
 * @param options - Optional API enrichment options
 * @returns API context filtered by scope
 */
export const enrichWithAPIContractsFiltered = async (
  files: RelevantFile[],
  chunks: RelevantChunk[],
  db: DatabaseClient,
  serviceIds: string[],
  queryEmbedding?: QueryEmbedding,
  options: SearchOptions = {}
): Promise<APIContext> => {
  const startTime = Date.now();

  // Check if API enrichment is enabled
  const searchApiContracts = options.search_api_contracts ?? true;
  if (!searchApiContracts) {
    logger.debug('API contract enrichment disabled by options');
    return {
      endpoints: [],
      cross_service_calls: [],
      contract_links: [],
      api_warnings: [],
      apis_by_service: {},
      endpoints_by_chunk: {},
    };
  }

  logger.debug('Starting filtered API contract enrichment', {
    files: files.length,
    chunks: chunks.length,
    scopeServices: serviceIds.length,
    semanticSearch: !!queryEmbedding,
  });

  // Use provided service IDs from scope filter
  const serviceIdSet = new Set(serviceIds);

  if (serviceIdSet.size === 0) {
    logger.debug('No services in scope filter, skipping API enrichment');
    return {
      endpoints: [],
      cross_service_calls: [],
      contract_links: [],
      api_warnings: [],
      apis_by_service: {},
      endpoints_by_chunk: {},
    };
  }

  // Fetch API endpoints for scoped services
  let endpoints: APIEndpointMatch[];
  if (queryEmbedding) {
    // Use semantic search on api_endpoints table
    endpoints = await queryAPIEndpointsWithSimilarity(db, queryEmbedding, serviceIdSet, options);
  } else {
    // Fall back to JSONB query
    endpoints = await fetchServiceAPIs(db, serviceIdSet);
  }

  // Filter endpoints by implementation match if required
  if (options.require_implementation_match && endpoints.length > 0) {
    const retrievedChunkIds = new Set(chunks.map((c) => c.chunk_id));
    endpoints = endpoints.filter((e) => e.implementation_chunk_id && retrievedChunkIds.has(e.implementation_chunk_id));
  }

  // Detect cross-service API calls
  const crossServiceCalls = detectCrossServiceCalls(chunks, endpoints);

  // Link endpoints to implementation chunks
  const contractLinks = linkEndpointsToChunks(endpoints, chunks);

  // Generate API warnings
  const apiWarnings = generateAPIWarnings(endpoints, crossServiceCalls, contractLinks);

  // Build context maps
  const { apis_by_service: apisByService, endpoints_by_chunk: endpointsByChunk } = buildAPIContextMaps(
    endpoints,
    contractLinks
  );

  const enrichmentTime = Date.now() - startTime;

  logger.info('Filtered API contract enrichment complete', {
    servicesAnalyzed: serviceIdSet.size,
    endpointsFound: endpoints.length,
    crossServiceCalls: crossServiceCalls.length,
    contractLinks: contractLinks.length,
    apiWarnings: apiWarnings.length,
    enrichmentTime,
  });

  return {
    endpoints,
    cross_service_calls: crossServiceCalls,
    contract_links: contractLinks,
    api_warnings: apiWarnings,
    apis_by_service: apisByService,
    endpoints_by_chunk: endpointsByChunk,
  };
};
