/**
 * API endpoint embedding generation
 *
 * Generates vector embeddings for API endpoints with enriched context
 */

import { type EmbeddingGenerator } from '@indexing/embeddings';
import { logger } from '@utils/logger';
import { type APIEndpointWithEmbedding, type APISchema, type ParsedAPIEndpoint } from '@/types/api-parsing';

/**
 * API endpoint embedding generator
 */
export class APIEndpointEmbeddingGenerator {
  constructor(private readonly embeddingGenerator: EmbeddingGenerator) {}

  /**
   * Generate embedding for single API endpoint
   *
   * Creates enriched text from endpoint metadata before generating embedding.
   *
   * @param endpoint - Parsed API endpoint
   * @returns Endpoint with embedding
   */
  public generateEmbedding = async (endpoint: ParsedAPIEndpoint): Promise<APIEndpointWithEmbedding> => {
    // Create enriched text from endpoint metadata
    const embeddingText = this.createEmbeddingText(endpoint);

    // Generate embedding using existing embedding generator
    const embedding = await this.embeddingGenerator.generateTextEmbedding(
      embeddingText,
      `API endpoint ${endpoint.method} ${endpoint.path}`
    );

    logger.debug('API endpoint embedding generated', {
      method: endpoint.method,
      path: endpoint.path,
      embedding_length: embedding.length,
    });

    return {
      ...endpoint,
      embedding,
      embedding_text: embeddingText,
    };
  };

  /**
   * Generate embeddings for multiple endpoints in batch
   *
   * @param endpoints - Array of parsed API endpoints
   * @returns Array of endpoints with embeddings
   */
  public generateBatch = async (endpoints: ParsedAPIEndpoint[]): Promise<APIEndpointWithEmbedding[]> => {
    logger.info('Generating API endpoint embeddings in batch', {
      endpoint_count: endpoints.length,
    });

    const results: APIEndpointWithEmbedding[] = [];

    for (const endpoint of endpoints) {
      try {
        const endpointWithEmbedding = await this.generateEmbedding(endpoint);
        results.push(endpointWithEmbedding);
      } catch (error) {
        logger.error('Failed to generate embedding for endpoint', {
          method: endpoint.method,
          path: endpoint.path,
          error: error instanceof Error ? error.message : String(error),
        });

        // Add endpoint with empty embedding on error
        results.push({
          ...endpoint,
          embedding: [],
          embedding_text: this.createEmbeddingText(endpoint),
        });
      }
    }

    logger.info('API endpoint embeddings generated', {
      total: results.length,
      successful: results.filter((r) => r.embedding.length > 0).length,
      failed: results.filter((r) => r.embedding.length === 0).length,
    });

    return results;
  };

  /**
   * Create enriched text for embedding
   *
   * Combines endpoint metadata into a single text representation suitable for embedding.
   *
   * Format:
   * METHOD /path/to/endpoint
   * Description: ...
   * Parameters: param1 (type), param2 (type)
   * Request: { schema }
   * Response: { schema }
   * Tags: tag1, tag2
   *
   * @param endpoint - Parsed API endpoint
   * @returns Enriched text for embedding
   */
  private createEmbeddingText = (endpoint: ParsedAPIEndpoint): string => {
    const parts: string[] = [];

    // Method and path (most important)
    parts.push(`${endpoint.method} ${endpoint.path}`);

    // Description
    if (endpoint.description) {
      parts.push(`Description: ${endpoint.description}`);
    }

    // Operation ID (useful for matching)
    if (endpoint.operation_id) {
      parts.push(`Operation: ${endpoint.operation_id}`);
    }

    // Parameters
    if (endpoint.parameters && endpoint.parameters.length > 0) {
      const paramList = endpoint.parameters
        .map((p) => `${p.name} (${p.type}${p.required ? ', required' : ''})`)
        .join(', ');
      parts.push(`Parameters: ${paramList}`);
    }

    // Request body schema (simplified)
    if (endpoint.request_body) {
      const requestSchema = this.simplifySchema(endpoint.request_body);
      parts.push(`Request: ${requestSchema}`);
    }

    // Response schemas (simplified)
    if (endpoint.responses && endpoint.responses.length > 0) {
      const successResponses = endpoint.responses.filter((r) => r.status_code.startsWith('2'));
      if (successResponses.length > 0) {
        const response = successResponses[0];
        if (response.schema) {
          const responseSchema = this.simplifySchema(response.schema);
          parts.push(`Response: ${responseSchema}`);
        }
      }
    }

    // Tags
    if (endpoint.tags && endpoint.tags.length > 0) {
      parts.push(`Tags: ${endpoint.tags.join(', ')}`);
    }

    // Implementation reference (if linked)
    if (endpoint.implementation) {
      parts.push(`Implemented in: ${endpoint.implementation.file_path}`);
      if (endpoint.implementation.function_name) {
        parts.push(`Function: ${endpoint.implementation.function_name}`);
      }
    }

    // Metadata
    if (endpoint.metadata) {
      // Add GraphQL return type
      if (endpoint.metadata.return_type) {
        const returnType =
          typeof endpoint.metadata.return_type === 'string'
            ? endpoint.metadata.return_type
            : JSON.stringify(endpoint.metadata.return_type);
        parts.push(`Returns: ${returnType}`);
      }

      // Add gRPC streaming info
      if (endpoint.metadata.client_streaming || endpoint.metadata.server_streaming) {
        const streamType = [];
        if (endpoint.metadata.client_streaming) streamType.push('client-streaming');
        if (endpoint.metadata.server_streaming) streamType.push('server-streaming');
        parts.push(`Streaming: ${streamType.join(', ')}`);
      }
    }

    return parts.join('\n');
  };

  /**
   * Simplify schema to string representation
   *
   * Converts complex schema objects to readable strings for embedding.
   *
   * @param schema - API schema object
   * @returns Simplified string representation
   */
  private simplifySchema = (schema: APISchema | Record<string, unknown> | undefined): string => {
    if (!schema || typeof schema !== 'object') {
      return String(schema);
    }

    const type = schema.type as string | undefined;

    if (type === 'object' && schema.properties) {
      // Object type - list properties
      const props = schema.properties as Record<string, unknown>;
      const propNames = Object.keys(props).slice(0, 10); // Limit to first 10
      return `{ ${propNames.join(', ')}${propNames.length > 10 ? ', ...' : ''} }`;
    }

    if (type === 'array' && schema.items) {
      // Array type - show item type
      const items = schema.items as Record<string, unknown>;
      return `Array<${this.simplifySchema(items)}>`;
    }

    if (schema.ref) {
      // Reference type - show ref name
      const ref = schema.ref as string;
      return ref.split('/').pop() ?? ref;
    }

    // Primitive type
    return type ?? 'unknown';
  };
}

/**
 * Create API endpoint embedding generator instance
 *
 * @param embeddingGenerator - Existing embedding generator
 * @returns Initialized APIEndpointEmbeddingGenerator
 */
export const createAPIEndpointEmbeddingGenerator = (
  embeddingGenerator: EmbeddingGenerator
): APIEndpointEmbeddingGenerator => {
  return new APIEndpointEmbeddingGenerator(embeddingGenerator);
};
