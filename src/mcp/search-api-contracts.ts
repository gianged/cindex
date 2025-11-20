/**
 * MCP Tool: search_api_contracts
 * Search API endpoints across services with semantic understanding
 */
import { type Pool } from 'pg';

import { searchAPIContracts } from '@database/queries';
import { formatAPIContractResults } from '@mcp/formatter';
import { validateArray, validateBoolean, validateMaxResults, validateQuery, validateThreshold } from '@mcp/validator';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type EmbeddingConfig } from '@/types/config';

/**
 * Input schema for search_api_contracts tool
 */
export interface SearchAPIContractsInput {
  query: string; // API search query (e.g., "user authentication endpoint")
  api_types?: ('rest' | 'graphql' | 'grpc')[]; // Default: all - Filter by API type
  service_filter?: string[]; // Optional: Filter by service IDs
  repo_filter?: string[]; // Optional: Filter by repository IDs
  include_deprecated?: boolean; // Default: false - Include deprecated endpoints
  max_results?: number; // Default: 20, Range: 1-100 - Maximum results to return
  similarity_threshold?: number; // Default: 0.70, Range: 0.0-1.0 - Minimum similarity score
}

/**
 * Output schema for search_api_contracts tool
 */
export interface SearchAPIContractsOutput {
  formatted_result: string; // Markdown-formatted API contract results
  endpoints: {
    service_id: string;
    service_name: string;
    endpoint_path: string;
    http_method?: string;
    api_type: 'rest' | 'graphql' | 'grpc';
    implementation_file?: string;
    similarity: number;
  }[];
  total_results: number;
}

/**
 * Search API contracts MCP tool implementation
 *
 * Performs semantic search across API endpoint definitions (REST, GraphQL, gRPC).
 * Searches endpoint paths, operation IDs, descriptions, and parameters using
 * vector similarity. Supports filtering by API type, service, repository, and
 * deprecation status.
 *
 * @param db - Database connection pool
 * @param ollama - Ollama client for embedding generation
 * @param embeddingConfig - Embedding configuration (model, dimensions, context window)
 * @param input - Search API contracts parameters with filters
 * @returns Formatted API contract results grouped by service with implementation links
 * @throws {Error} If query validation fails or embedding generation fails
 */
export const searchAPIContractsTool = async (
  db: Pool,
  ollama: OllamaClient,
  embeddingConfig: EmbeddingConfig,
  input: SearchAPIContractsInput
): Promise<SearchAPIContractsOutput> => {
  logger.info('search_api_contracts tool invoked', { query: input.query });

  // Validate required parameters
  const query = validateQuery(input.query, true);
  if (!query) throw new Error('query validation failed');

  // Validate optional parameters
  const apiTypes = validateArray('api_types', input.api_types, false) as ('rest' | 'graphql' | 'grpc')[] | undefined;
  const serviceFilter = validateArray('service_filter', input.service_filter, false) as string[] | undefined;
  const repoFilter = validateArray('repo_filter', input.repo_filter, false) as string[] | undefined;
  const includeDeprecated = validateBoolean('include_deprecated', input.include_deprecated, false) ?? false;
  const maxResults = validateMaxResults(input.max_results, false) ?? 20;
  const similarityThreshold = validateThreshold('similarity_threshold', input.similarity_threshold, false) ?? 0.7;

  logger.debug('Searching API contracts', {
    query,
    apiTypes,
    serviceFilter,
    repoFilter,
    includeDeprecated,
    maxResults,
    similarityThreshold,
  });

  // Generate embedding for query
  const queryEmbedding = await ollama.generateEmbedding(
    embeddingConfig.model,
    query,
    embeddingConfig.dimensions,
    embeddingConfig.context_window
  );

  // Search API contracts in database
  const endpoints = await searchAPIContracts(db, queryEmbedding, {
    apiTypes,
    serviceFilter,
    repoFilter,
    includeDeprecated,
    maxResults,
    similarityThreshold,
  });

  if (endpoints.length === 0) {
    const message = `# API Contract Search\n\n**Query:** \`${query}\`\n\nNo API endpoints found matching this query.\n\n**Tip:** Try a broader search or ensure API endpoints are detected during indexing.`;

    logger.info('No API contracts found', { query });

    return {
      formatted_result: message,
      endpoints: [],
      total_results: 0,
    };
  }

  // Transform endpoints to match output schema
  // Note: WebSocket API type is normalized to 'rest' for compatibility with output schema
  const transformedEndpoints = endpoints.map((endpoint) => ({
    service_id: endpoint.service_id,
    service_name: endpoint.service_name,
    endpoint_path: endpoint.endpoint_path,
    http_method: endpoint.method,
    api_type: endpoint.api_type === 'websocket' ? 'rest' : endpoint.api_type,
    implementation_file: endpoint.implementation_file,
    similarity: endpoint.similarity ?? 0,
  }));

  // Format output
  const formattedResult = formatAPIContractResults(query, transformedEndpoints);

  logger.info('search_api_contracts completed', {
    query,
    total_results: transformedEndpoints.length,
  });

  return {
    formatted_result: formattedResult,
    endpoints: transformedEndpoints,
    total_results: transformedEndpoints.length,
  };
};
