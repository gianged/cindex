/**
 * API contract parsing types
 *
 * Supports OpenAPI/Swagger, GraphQL schemas, and gRPC protobufs
 */

/**
 * API specification format types
 */
export type APISpecFormat = 'openapi' | 'swagger' | 'graphql' | 'grpc' | 'unknown';

/**
 * API specification version
 */
export interface APISpecVersion {
  format: APISpecFormat;
  version: string; // e.g., "3.0.0", "2.0", "SDL"
}

/**
 * HTTP methods supported
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Parsed API endpoint
 */
export interface ParsedAPIEndpoint {
  method: string; // HTTP method or gRPC method name or GraphQL operation type
  path: string; // URL path or GraphQL operation name
  description?: string;
  parameters?: APIParameter[];
  request_body?: APISchema;
  responses?: APIResponse[];
  tags?: string[];
  operation_id?: string;
  implementation?: EndpointImplementation; // Linked code implementation
  metadata?: Record<string, unknown>;
}

/**
 * API parameter definition
 */
export interface APIParameter {
  name: string;
  location: 'path' | 'query' | 'header' | 'body' | 'cookie'; // OpenAPI locations
  type: string;
  required: boolean;
  description?: string;
  schema?: APISchema;
}

/**
 * API schema definition (simplified)
 */
export interface APISchema {
  type: string; // primitive type or object/array
  properties?: Record<string, APISchema>;
  items?: APISchema; // For arrays
  required?: string[];
  description?: string;
  example?: unknown;
  ref?: string; // $ref reference
}

/**
 * API response definition
 */
export interface APIResponse {
  status_code: string; // "200", "404", "default"
  description?: string;
  schema?: APISchema;
  headers?: Record<string, APISchema>;
}

/**
 * Endpoint implementation linking result
 */
export interface EndpointImplementation {
  file_path: string; // Relative path to implementation file
  line_start: number;
  line_end: number;
  function_name?: string;
  class_name?: string;
  confidence: number; // 0.0-1.0 confidence score
  match_type: ImplementationMatchType;
}

/**
 * Implementation matching strategy types
 */
export type ImplementationMatchType =
  | 'file_path' // Matched by file path pattern
  | 'function_name' // Matched by function/method name
  | 'decorator' // Matched by decorator/annotation
  | 'route_definition' // Matched by route definition (app.get, router.post)
  | 'operation_id' // Matched by operationId in spec
  | 'manual'; // Manually specified

/**
 * OpenAPI/Swagger specification
 */
export interface OpenAPISpec {
  openapi?: string; // OpenAPI 3.x version
  swagger?: string; // Swagger 2.0 version
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: { url: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>; // Path → Method → Operation
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  definitions?: Record<string, unknown>; // Swagger 2.0
}

/**
 * GraphQL schema information
 */
export interface GraphQLSchemaInfo {
  types: GraphQLTypeInfo[];
  queries: GraphQLOperationInfo[];
  mutations: GraphQLOperationInfo[];
  subscriptions: GraphQLOperationInfo[];
  schema_text: string; // Raw SDL text
}

/**
 * GraphQL type definition
 */
export interface GraphQLTypeInfo {
  name: string;
  kind: 'object' | 'input' | 'enum' | 'scalar' | 'union' | 'interface';
  fields?: {
    name: string;
    type: string;
    description?: string;
    arguments?: { name: string; type: string }[];
  }[];
  description?: string;
}

/**
 * GraphQL operation (query/mutation/subscription)
 */
export interface GraphQLOperationInfo {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
  arguments?: { name: string; type: string; description?: string }[];
  return_type: string;
  description?: string;
  implementation?: EndpointImplementation;
}

/**
 * gRPC service definition
 */
export interface GRPCServiceInfo {
  service_name: string;
  package_name?: string;
  methods: GRPCMethodInfo[];
  messages: GRPCMessageInfo[];
  proto_file: string;
}

/**
 * gRPC method definition
 */
export interface GRPCMethodInfo {
  name: string;
  request_type: string;
  response_type: string;
  client_streaming: boolean;
  server_streaming: boolean;
  description?: string;
  implementation?: EndpointImplementation;
}

/**
 * gRPC message type definition
 */
export interface GRPCMessageInfo {
  name: string;
  fields: {
    name: string;
    type: string;
    number: number; // Field number
    repeated: boolean;
    optional: boolean;
  }[];
  description?: string;
}

/**
 * API parsing result
 */
export interface APIParsingResult {
  spec_format: APISpecFormat;
  spec_version: string;
  spec_file: string; // Path to spec file
  endpoints: ParsedAPIEndpoint[];
  spec_info: OpenAPISpec | GraphQLSchemaInfo | GRPCServiceInfo;
  parsing_errors: ParsingError[];
  metadata?: Record<string, unknown>;
}

/**
 * API parsing error
 */
export interface ParsingError {
  file: string;
  line?: number;
  error: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Cross-service API call detection result
 */
export interface DetectedAPICall {
  source_file: string;
  source_line: number;
  call_type: 'http' | 'grpc' | 'graphql';
  target_endpoint?: string; // URL or endpoint path
  target_service?: string; // Service name (if resolvable)
  method?: string;
  confidence: number; // 0.0-1.0
  code_snippet: string; // Actual code making the call
}

/**
 * API call pattern (for detection)
 */
export interface APICallPattern {
  pattern: RegExp;
  call_type: 'http' | 'grpc' | 'graphql';
  extractEndpoint: (match: RegExpMatchArray) => string | null;
  extractMethod?: (match: RegExpMatchArray) => string | null;
}

/**
 * API parser interface
 */
export interface APIParser {
  /**
   * Check if this parser can handle the given file
   */
  canParse: (filePath: string) => boolean;

  /**
   * Parse API specification file
   */
  parse: (filePath: string, content: string) => Promise<APIParsingResult>;

  /**
   * Get supported file extensions
   */
  getSupportedExtensions: () => string[];
}

/**
 * Implementation linker interface
 */
export interface ImplementationLinker {
  /**
   * Link API endpoints to implementation code
   */
  linkImplementation: (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ) => Promise<EndpointImplementation | null>;

  /**
   * Batch link multiple endpoints
   */
  linkBatch: (
    endpoints: ParsedAPIEndpoint[],
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ) => Promise<Map<string, EndpointImplementation | null>>;
}

/**
 * Search hints for implementation linking
 */
export interface ImplementationSearchHints {
  controller_dirs?: string[]; // Directories to search for controllers
  handler_patterns?: string[]; // File name patterns
  framework?: 'express' | 'fastify' | 'nestjs' | 'spring' | 'django' | 'fastapi' | 'unknown';
  base_path?: string; // Base path for relative paths
}

/**
 * API call detector interface
 */
export interface APICallDetector {
  /**
   * Detect API calls in code
   */
  detectCalls: (filePath: string, content: string, language: string) => DetectedAPICall[];

  /**
   * Get supported languages
   */
  getSupportedLanguages: () => string[];
}

/**
 * API parsing options
 */
export interface APIParsingOptions {
  link_implementations: boolean; // Whether to link endpoints to code
  generate_embeddings: boolean; // Whether to generate embeddings
  detect_cross_service_calls: boolean; // Whether to detect API calls
  strict_mode: boolean; // Fail on parsing errors vs. warn
  search_hints?: ImplementationSearchHints;
}

/**
 * API endpoint with embedding
 */
export interface APIEndpointWithEmbedding extends ParsedAPIEndpoint {
  embedding: number[]; // Vector embedding
  embedding_text: string; // Text used for embedding
}
