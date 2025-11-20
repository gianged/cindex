/**
 * API contract parsing types for OpenAPI, GraphQL, and gRPC specifications
 *
 * Supports OpenAPI/Swagger, GraphQL schemas, and gRPC protobufs
 */

/**
 * API specification format types
 */
export type APISpecFormat = 'openapi' | 'swagger' | 'graphql' | 'grpc' | 'unknown';

/**
 * API specification version information
 */
export interface APISpecVersion {
  /** Specification format */
  format: APISpecFormat;
  /** Version string (e.g., "3.0.0", "2.0", "SDL") */
  version: string;
}

/**
 * Supported HTTP methods
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Parsed API endpoint from specification file
 */
export interface ParsedAPIEndpoint {
  /** HTTP method, gRPC method name, or GraphQL operation type */
  method: string;
  /** URL path or GraphQL operation name */
  path: string;
  /** Endpoint description */
  description?: string;
  /** Endpoint parameters */
  parameters?: APIParameter[];
  /** Request body schema */
  request_body?: APISchema;
  /** Response schemas by status code */
  responses?: APIResponse[];
  /** OpenAPI tags for grouping */
  tags?: string[];
  /** Unique operation identifier */
  operation_id?: string;
  /** Linked code implementation (if found) */
  implementation?: EndpointImplementation;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * API parameter definition from specification
 */
export interface APIParameter {
  /** Parameter name */
  name: string;
  /** Parameter location in request */
  location: 'path' | 'query' | 'header' | 'body' | 'cookie';
  /** Parameter type */
  type: string;
  /** Whether parameter is required */
  required: boolean;
  /** Parameter description */
  description?: string;
  /** JSON schema for parameter */
  schema?: APISchema;
}

/**
 * Simplified API schema definition (OpenAPI, JSON Schema)
 */
export interface APISchema {
  /** Type (primitive, object, array) */
  type: string;
  /** Object properties (for object types) */
  properties?: Record<string, APISchema>;
  /** Array item schema (for array types) */
  items?: APISchema;
  /** Required property names (for object types) */
  required?: string[];
  /** Schema description */
  description?: string;
  /** Example value */
  example?: unknown;
  /** JSON Schema $ref reference */
  ref?: string;
}

/**
 * API response definition from specification
 */
export interface APIResponse {
  /** HTTP status code ("200", "404", "default") */
  status_code: string;
  /** Response description */
  description?: string;
  /** Response body schema */
  schema?: APISchema;
  /** Response headers */
  headers?: Record<string, APISchema>;
}

/**
 * Result of linking API endpoint to code implementation
 */
export interface EndpointImplementation {
  /** Relative path to implementation file */
  file_path: string;
  /** Starting line number */
  line_start: number;
  /** Ending line number */
  line_end: number;
  /** Handler function name */
  function_name?: string;
  /** Handler class name */
  class_name?: string;
  /** Confidence score (0.0-1.0) */
  confidence: number;
  /** Matching strategy used */
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
 * OpenAPI/Swagger specification structure
 */
export interface OpenAPISpec {
  /** OpenAPI 3.x version string */
  openapi?: string;
  /** Swagger 2.0 version string */
  swagger?: string;
  /** API metadata */
  info: {
    title: string;
    version: string;
    description?: string;
  };
  /** Server URLs */
  servers?: { url: string; description?: string }[];
  /** API paths and operations */
  paths: Record<string, Record<string, unknown>>;
  /** Reusable components (OpenAPI 3.x) */
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
  /** Schema definitions (Swagger 2.0) */
  definitions?: Record<string, unknown>;
}

/**
 * Parsed GraphQL schema information
 */
export interface GraphQLSchemaInfo {
  /** Defined types */
  types: GraphQLTypeInfo[];
  /** Query operations */
  queries: GraphQLOperationInfo[];
  /** Mutation operations */
  mutations: GraphQLOperationInfo[];
  /** Subscription operations */
  subscriptions: GraphQLOperationInfo[];
  /** Raw SDL schema text */
  schema_text: string;
}

/**
 * GraphQL type definition
 */
export interface GraphQLTypeInfo {
  /** Type name */
  name: string;
  /** Type kind */
  kind: 'object' | 'input' | 'enum' | 'scalar' | 'union' | 'interface';
  /** Type fields (for object, input, interface) */
  fields?: {
    name: string;
    type: string;
    description?: string;
    arguments?: { name: string; type: string }[];
  }[];
  /** Type description */
  description?: string;
}

/**
 * GraphQL operation (query, mutation, or subscription)
 */
export interface GraphQLOperationInfo {
  /** Operation name */
  name: string;
  /** Operation type */
  type: 'query' | 'mutation' | 'subscription';
  /** Operation arguments */
  arguments?: { name: string; type: string; description?: string }[];
  /** Return type */
  return_type: string;
  /** Operation description */
  description?: string;
  /** Linked code implementation */
  implementation?: EndpointImplementation;
}

/**
 * Parsed gRPC service definition from proto file
 */
export interface GRPCServiceInfo {
  /** Service name */
  service_name: string;
  /** Package name */
  package_name?: string;
  /** Service methods */
  methods: GRPCMethodInfo[];
  /** Message types */
  messages: GRPCMessageInfo[];
  /** Path to proto file */
  proto_file: string;
}

/**
 * gRPC method definition
 */
export interface GRPCMethodInfo {
  /** Method name */
  name: string;
  /** Request message type */
  request_type: string;
  /** Response message type */
  response_type: string;
  /** Whether client streams requests */
  client_streaming: boolean;
  /** Whether server streams responses */
  server_streaming: boolean;
  /** Method description */
  description?: string;
  /** Linked code implementation */
  implementation?: EndpointImplementation;
}

/**
 * gRPC message type definition
 */
export interface GRPCMessageInfo {
  /** Message name */
  name: string;
  /** Message fields */
  fields: {
    name: string;
    type: string;
    /** Protobuf field number */
    number: number;
    /** Whether field is repeated */
    repeated: boolean;
    /** Whether field is optional */
    optional: boolean;
  }[];
  /** Message description */
  description?: string;
}

/**
 * Complete API parsing result
 */
export interface APIParsingResult {
  /** Detected specification format */
  spec_format: APISpecFormat;
  /** Specification version */
  spec_version: string;
  /** Path to specification file */
  spec_file: string;
  /** Parsed API endpoints */
  endpoints: ParsedAPIEndpoint[];
  /** Full specification structure */
  spec_info: OpenAPISpec | GraphQLSchemaInfo | GRPCServiceInfo;
  /** Parsing errors encountered */
  parsing_errors: ParsingError[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * API parsing error information
 */
export interface ParsingError {
  /** File where error occurred */
  file: string;
  /** Line number (if applicable) */
  line?: number;
  /** Error message */
  error: string;
  /** Error severity level */
  severity: 'error' | 'warning' | 'info';
}

/**
 * Detected cross-service API call in code
 */
export interface DetectedAPICall {
  /** Source file making the call */
  source_file: string;
  /** Line number of the call */
  source_line: number;
  /** Type of API call */
  call_type: 'http' | 'grpc' | 'graphql';
  /** Target endpoint URL or path */
  target_endpoint?: string;
  /** Target service name (if resolvable) */
  target_service?: string;
  /** HTTP method or operation */
  method?: string;
  /** Detection confidence score (0.0-1.0) */
  confidence: number;
  /** Code snippet containing the call */
  code_snippet: string;
}

/**
 * Pattern for detecting API calls in code
 */
export interface APICallPattern {
  /** Regular expression pattern */
  pattern: RegExp;
  /** Type of API call this pattern detects */
  call_type: 'http' | 'grpc' | 'graphql';
  /** Extract endpoint from regex match */
  extractEndpoint: (match: RegExpMatchArray) => string | null;
  /** Extract HTTP method from regex match */
  extractMethod?: (match: RegExpMatchArray) => string | null;
}

/**
 * API specification parser interface
 */
export interface APIParser {
  /** Check if this parser can handle the given file */
  canParse: (filePath: string) => boolean;

  /** Parse API specification file and extract endpoints */
  parse: (filePath: string, content: string) => Promise<APIParsingResult>;

  /** Get supported file extensions for this parser */
  getSupportedExtensions: () => string[];
}

/**
 * Implementation linker interface for connecting API specs to code
 */
export interface ImplementationLinker {
  /** Link single API endpoint to its implementation code */
  linkImplementation: (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ) => Promise<EndpointImplementation | null>;

  /** Link multiple endpoints in batch for efficiency */
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
  /** Directories to search for controller/handler files */
  controller_dirs?: string[];
  /** File name patterns for handlers */
  handler_patterns?: string[];
  /** Framework being used (affects search strategy) */
  framework?: 'express' | 'fastify' | 'nestjs' | 'spring' | 'django' | 'fastapi' | 'unknown';
  /** Base path for resolving relative paths */
  base_path?: string;
}

/**
 * API call detector interface for finding cross-service calls
 */
export interface APICallDetector {
  /** Detect API calls in code file */
  detectCalls: (filePath: string, content: string, language: string) => DetectedAPICall[];

  /** Get programming languages supported by this detector */
  getSupportedLanguages: () => string[];
}

/**
 * API parsing options configuration
 */
export interface APIParsingOptions {
  /** Whether to link endpoints to implementation code */
  link_implementations: boolean;
  /** Whether to generate embeddings for endpoints */
  generate_embeddings: boolean;
  /** Whether to detect cross-service API calls */
  detect_cross_service_calls: boolean;
  /** Fail on parsing errors (true) or warn (false) */
  strict_mode: boolean;
  /** Search hints for implementation linking */
  search_hints?: ImplementationSearchHints;
}

/**
 * API endpoint with vector embedding for semantic search
 */
export interface APIEndpointWithEmbedding extends ParsedAPIEndpoint {
  /** Vector embedding (1024 dimensions) */
  embedding: number[];
  /** Text used to generate embedding */
  embedding_text: string;
}
