/**
 * API contract parser
 *
 * Parses OpenAPI/Swagger, GraphQL schemas, and gRPC protobufs
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/naming-convention
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildSchema, type GraphQLField, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import protobuf from 'protobufjs';

import { logger } from '@utils/logger';
import {
  type APIParser,
  type APIParsingResult,
  type APISchema,
  type APISpecFormat,
  type GraphQLOperationInfo,
  type GraphQLSchemaInfo,
  type GraphQLTypeInfo,
  type GRPCMessageInfo,
  type GRPCMethodInfo,
  type GRPCServiceInfo,
  type HTTPMethod,
  type OpenAPISpec,
  type ParsedAPIEndpoint,
  type ParsingError,
} from '@/types/api-parsing';

/**
 * OpenAPI/Swagger parser
 */
export class OpenAPIParser implements APIParser {
  /**
   * Check if file is OpenAPI/Swagger spec
   */
  public canParse = (filePath: string): boolean => {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      fileName.includes('openapi') ||
      fileName.includes('swagger') ||
      fileName === 'api.yaml' ||
      fileName === 'api.yml' ||
      fileName === 'api.json'
    );
  };

  /**
   * Get supported file extensions
   */
  public getSupportedExtensions = (): string[] => {
    return ['.yaml', '.yml', '.json'];
  };

  /**
   * Parse OpenAPI/Swagger specification
   */
  public parse = async (filePath: string, _content: string): Promise<APIParsingResult> => {
    const errors: ParsingError[] = [];

    try {
      // Use swagger-parser to validate and dereference the spec
      const api = (await SwaggerParser.validate(filePath)) as OpenAPISpec;

      // Determine version
      const specVersion = api.openapi ?? api.swagger ?? 'unknown';
      const specFormat: APISpecFormat = api.openapi ? 'openapi' : api.swagger ? 'swagger' : 'unknown';

      // Extract endpoints
      const endpoints: ParsedAPIEndpoint[] = [];

      for (const [urlPath, pathItem] of Object.entries(api.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
          // Skip non-HTTP method keys (like parameters, $ref, etc.)
          if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
            continue;
          }

          const op = operation as Record<string, unknown>;

          const endpoint: ParsedAPIEndpoint = {
            method: method.toUpperCase() as HTTPMethod,
            path: urlPath,
            description: (op.description as string | undefined) ?? (op.summary as string | undefined),
            operation_id: op.operationId as string | undefined,
            tags: (op.tags as string[] | undefined) ?? [],
            parameters: this.extractParameters(op),
            request_body: this.extractRequestBody(op),
            responses: this.extractResponses(op),
            metadata: {
              deprecated: op.deprecated as boolean | undefined,
              security: op.security as unknown[] | undefined,
            },
          };

          endpoints.push(endpoint);
        }
      }

      logger.info('OpenAPI spec parsed successfully', {
        file: filePath,
        version: specVersion,
        endpoint_count: endpoints.length,
      });

      return {
        spec_format: specFormat,
        spec_version: specVersion,
        spec_file: filePath,
        endpoints,
        spec_info: api,
        parsing_errors: errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({
        file: filePath,
        error: errorMessage,
        severity: 'error',
      });

      logger.error('Failed to parse OpenAPI spec', {
        file: filePath,
        error: errorMessage,
      });

      // Return partial result with errors
      return {
        spec_format: 'openapi',
        spec_version: 'unknown',
        spec_file: filePath,
        endpoints: [],
        spec_info: {} as OpenAPISpec,
        parsing_errors: errors,
      };
    }
  };

  /**
   * Extract parameters from OpenAPI operation
   */
  private extractParameters = (operation: Record<string, unknown>) => {
    const params = operation.parameters as Record<string, unknown>[] | undefined;
    if (!params) return undefined;

    return params.map((p) => ({
      name: p.name as string,
      location: (p.in as 'path' | 'query' | 'header' | 'body' | 'cookie' | undefined) ?? 'query',
      type: ((p.schema as Record<string, unknown> | undefined)?.type as string | undefined) ?? 'string',
      required: (p.required as boolean | undefined) ?? false,
      description: p.description as string | undefined,
      schema: p.schema as APISchema | undefined,
    }));
  };

  /**
   * Extract request body from OpenAPI operation
   */
  private extractRequestBody = (operation: Record<string, unknown>) => {
    const requestBody = operation.requestBody as Record<string, unknown> | undefined;
    if (!requestBody) return undefined;

    const content = requestBody.content as Record<string, Record<string, unknown>> | undefined;
    if (!content) return undefined;

    // Get first content type (usually application/json)
    const firstContentType = Object.values(content)[0] as Record<string, unknown> | undefined;
    if (!firstContentType) return undefined;

    return firstContentType.schema as APISchema | undefined;
  };

  /**
   * Extract responses from OpenAPI operation
   */
  private extractResponses = (operation: Record<string, unknown>) => {
    const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
    if (!responses) return undefined;

    return Object.entries(responses).map(([statusCode, response]) => ({
      status_code: statusCode,
      description: response.description as string | undefined,
      schema:
        ((response.content as Record<string, Record<string, unknown>> | undefined)?.['application/json']?.schema as
          | APISchema
          | undefined) ?? undefined,
    }));
  };
}

/**
 * GraphQL schema parser
 */
export class GraphQLParser implements APIParser {
  /**
   * Check if file is GraphQL schema
   */
  public canParse = (filePath: string): boolean => {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.graphql' || ext === '.gql' || filePath.endsWith('schema.graphql');
  };

  /**
   * Get supported file extensions
   */
  public getSupportedExtensions = (): string[] => {
    return ['.graphql', '.gql'];
  };

  /**
   * Parse GraphQL schema
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public parse = async (filePath: string, content: string): Promise<APIParsingResult> => {
    const errors: ParsingError[] = [];

    try {
      // Build GraphQL schema from SDL
      const schema: GraphQLSchema = buildSchema(content);

      // Extract queries, mutations, subscriptions
      const queryType = schema.getQueryType();
      const mutationType = schema.getMutationType();
      const subscriptionType = schema.getSubscriptionType();

      const queries: GraphQLOperationInfo[] = queryType ? this.extractOperations(queryType, 'query') : [];
      const mutations: GraphQLOperationInfo[] = mutationType ? this.extractOperations(mutationType, 'mutation') : [];
      const subscriptions: GraphQLOperationInfo[] = subscriptionType
        ? this.extractOperations(subscriptionType, 'subscription')
        : [];

      // Extract types
      const typeMap = schema.getTypeMap();
      const types: GraphQLTypeInfo[] = [];

      for (const [typeName, type] of Object.entries(typeMap)) {
        // Skip built-in types
        if (typeName.startsWith('__')) continue;

        types.push({
          name: typeName,
          kind: this.getTypeKind(type),
          description: type.description ?? undefined,
        });
      }

      // Convert to ParsedAPIEndpoint format
      const endpoints: ParsedAPIEndpoint[] = [
        ...queries.map((q) => this.operationToEndpoint(q)),
        ...mutations.map((m) => this.operationToEndpoint(m)),
        ...subscriptions.map((s) => this.operationToEndpoint(s)),
      ];

      const schemaInfo: GraphQLSchemaInfo = {
        types,
        queries,
        mutations,
        subscriptions,
        schema_text: content,
      };

      logger.info('GraphQL schema parsed successfully', {
        file: filePath,
        query_count: queries.length,
        mutation_count: mutations.length,
        subscription_count: subscriptions.length,
      });

      return {
        spec_format: 'graphql',
        spec_version: 'SDL',
        spec_file: filePath,
        endpoints,
        spec_info: schemaInfo,
        parsing_errors: errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({
        file: filePath,
        error: errorMessage,
        severity: 'error',
      });

      logger.error('Failed to parse GraphQL schema', {
        file: filePath,
        error: errorMessage,
      });

      return {
        spec_format: 'graphql',
        spec_version: 'SDL',
        spec_file: filePath,
        endpoints: [],
        spec_info: { types: [], queries: [], mutations: [], subscriptions: [], schema_text: content },
        parsing_errors: errors,
      };
    }
  };

  /**
   * Extract operations from GraphQL type
   */
  private extractOperations = (
    type: GraphQLObjectType,
    operationType: 'query' | 'mutation' | 'subscription'
  ): GraphQLOperationInfo[] => {
    const fields = type.getFields();

    return Object.entries(fields).map(([fieldName, field]: [string, GraphQLField<unknown, unknown>]) => ({
      name: fieldName,
      type: operationType,
      arguments: field.args.map((arg) => ({
        name: arg.name,
        type: arg.type.toString(),
        description: arg.description ?? undefined,
      })),
      return_type: field.type.toString(),
      description: field.description ?? undefined,
    }));
  };

  /**
   * Convert GraphQL operation to ParsedAPIEndpoint
   */
  private operationToEndpoint = (operation: GraphQLOperationInfo): ParsedAPIEndpoint => {
    return {
      method: operation.type.toUpperCase(), // QUERY, MUTATION, SUBSCRIPTION
      path: operation.name,
      description: operation.description,
      parameters: operation.arguments?.map((arg) => ({
        name: arg.name,
        location: 'body',
        type: arg.type,
        required: arg.type.endsWith('!'), // GraphQL non-null types
        description: arg.description,
      })),
      metadata: {
        return_type: operation.return_type,
      },
    };
  };

  /**
   * Get GraphQL type kind
   */
  private getTypeKind = (type: unknown): GraphQLTypeInfo['kind'] => {
    const typeStr = String(type);
    if (typeStr.includes('GraphQLObjectType')) return 'object';
    if (typeStr.includes('GraphQLInputObjectType')) return 'input';
    if (typeStr.includes('GraphQLEnumType')) return 'enum';
    if (typeStr.includes('GraphQLScalarType')) return 'scalar';
    if (typeStr.includes('GraphQLUnionType')) return 'union';
    if (typeStr.includes('GraphQLInterfaceType')) return 'interface';
    return 'object';
  };
}

/**
 * gRPC protobuf parser
 */
export class GRPCParser implements APIParser {
  /**
   * Check if file is protobuf definition
   */
  public canParse = (filePath: string): boolean => {
    return path.extname(filePath).toLowerCase() === '.proto';
  };

  /**
   * Get supported file extensions
   */
  public getSupportedExtensions = (): string[] => {
    return ['.proto'];
  };

  /**
   * Parse gRPC protobuf file
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public parse = async (filePath: string, content: string): Promise<APIParsingResult> => {
    const errors: ParsingError[] = [];

    try {
      // Parse proto file
      const root = protobuf.parse(content, { keepCase: true }).root;

      // Extract services
      const services: GRPCServiceInfo[] = [];
      const endpoints: ParsedAPIEndpoint[] = [];

      root.nestedArray.forEach((nested) => {
        if (nested instanceof protobuf.Service) {
          const service = nested;
          const methods: GRPCMethodInfo[] = [];

          // Extract methods
          service.methodsArray.forEach((method) => {
            const grpcMethod: GRPCMethodInfo = {
              name: method.name,
              request_type: method.requestType,
              response_type: method.responseType,
              client_streaming: method.requestStream ?? false,
              server_streaming: method.responseStream ?? false,
              description: method.comment ?? undefined,
            };

            methods.push(grpcMethod);

            // Convert to ParsedAPIEndpoint
            endpoints.push({
              method: 'RPC',
              path: `${service.name}.${method.name}`,
              description: method.comment ?? undefined,
              metadata: {
                request_type: method.requestType,
                response_type: method.responseType,
                client_streaming: method.requestStream,
                server_streaming: method.responseStream,
              },
            });
          });

          // Extract messages
          const messages: GRPCMessageInfo[] = [];
          root.nestedArray.forEach((msg) => {
            if (msg instanceof protobuf.Type) {
              const messageType = msg;
              messages.push({
                name: messageType.name,
                fields: messageType.fieldsArray.map((field) => ({
                  name: field.name,
                  type: field.type,
                  number: field.id,
                  repeated: field.repeated,
                  optional: field.optional,
                })),
                description: messageType.comment ?? undefined,
              });
            }
          });

          services.push({
            service_name: service.name,
            package_name: root.name,
            methods,
            messages,
            proto_file: filePath,
          });
        }
      });

      logger.info('gRPC proto file parsed successfully', {
        file: filePath,
        service_count: services.length,
        method_count: endpoints.length,
      });

      return {
        spec_format: 'grpc',
        spec_version: 'proto3',
        spec_file: filePath,
        endpoints,
        spec_info: services[0] ?? { service_name: '', methods: [], messages: [], proto_file: filePath },
        parsing_errors: errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({
        file: filePath,
        error: errorMessage,
        severity: 'error',
      });

      logger.error('Failed to parse gRPC proto file', {
        file: filePath,
        error: errorMessage,
      });

      return {
        spec_format: 'grpc',
        spec_version: 'proto3',
        spec_file: filePath,
        endpoints: [],
        spec_info: { service_name: '', methods: [], messages: [], proto_file: filePath },
        parsing_errors: errors,
      };
    }
  };
}

/**
 * Main API specification parser
 *
 * Coordinates OpenAPI, GraphQL, and gRPC parsers
 */
export class APISpecificationParser {
  private parsers: APIParser[];

  constructor() {
    this.parsers = [new OpenAPIParser(), new GraphQLParser(), new GRPCParser()];
  }

  /**
   * Detect and parse API specification file
   */
  public parseFile = async (filePath: string): Promise<APIParsingResult | null> => {
    try {
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');

      // Find appropriate parser
      const parser = this.parsers.find((p) => p.canParse(filePath));

      if (!parser) {
        logger.debug('No parser found for file', { file: filePath });
        return null;
      }

      // Parse with found parser
      return await parser.parse(filePath, content);
    } catch (error) {
      logger.error('Failed to read/parse API spec file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  /**
   * Check if file is an API specification
   */
  public isAPISpec = (filePath: string): boolean => {
    return this.parsers.some((p) => p.canParse(filePath));
  };

  /**
   * Get all supported file extensions
   */
  public getSupportedExtensions = (): string[] => {
    return Array.from(new Set(this.parsers.flatMap((p) => p.getSupportedExtensions())));
  };
}

/**
 * Create API specification parser instance
 */
export const createAPIParser = (): APISpecificationParser => {
  return new APISpecificationParser();
};
