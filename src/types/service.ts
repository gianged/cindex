/**
 * Service detection and boundary types for microservice architectures
 *
 * Supports: Microservice architectures, service boundaries in monorepos
 */

/**
 * Detected service configuration in codebase
 */
export interface DetectedService {
  /** Generated unique identifier */
  service_id: string;
  /** Service name */
  service_name: string;
  /** Relative path from repository root */
  service_path: string;
  /** Service type classification */
  service_type: ServiceType;
  /** API configuration (if service exposes APIs) */
  api_config?: APIConfig;
  /** Service dependencies (internal and external) */
  dependencies: ServiceDependencies;
  /** Additional service metadata */
  metadata?: ServiceConfigMetadata;
}

/**
 * Service type classification
 */
export type ServiceType = 'rest' | 'graphql' | 'grpc' | 'library' | 'worker' | 'other';

/**
 * API configuration detected from code or specification files
 */
export interface APIConfig {
  /** API type */
  type: 'rest' | 'graphql' | 'grpc' | 'websocket';
  /** Detected API endpoints */
  endpoints: DetectedAPIEndpoint[];
  /** Base path prefix for all endpoints */
  base_path?: string;
  /** Service port number */
  port?: number;
  /** Protocol (http, https, grpc) */
  protocol?: string;
  /** Schema file paths (OpenAPI, GraphQL schema, proto files) */
  schema_files?: string[];
}

/**
 * Detected API endpoint from code analysis
 */
export interface DetectedAPIEndpoint {
  /** HTTP method (GET, POST, etc.) for REST APIs */
  method?: string;
  /** Endpoint path or GraphQL operation name */
  path: string;
  /** Source file containing handler implementation */
  handler_file?: string;
  /** Handler function name */
  handler_function?: string;
  /** Line number where endpoint is defined */
  line_number?: number;
  /** Endpoint description */
  description?: string;
  /** Endpoint parameters */
  parameters?: APIParameter[];
}

/**
 * API parameter definition
 */
export interface APIParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: string;
  /** Whether parameter is required */
  required?: boolean;
  /** Parameter description */
  description?: string;
}

/**
 * Service dependencies (internal, external, and library)
 */
export interface ServiceDependencies {
  /** Dependencies on other services in same or different repositories */
  internal: InternalServiceDependency[];
  /** Dependencies on third-party APIs, databases, etc. */
  external: ExternalServiceDependency[];
  /** Dependencies on shared libraries */
  libraries: LibraryDependency[];
}

/**
 * Internal service-to-service dependency
 */
export interface InternalServiceDependency {
  /** Target service identifier */
  service_id: string;
  /** Target service name */
  service_name: string;
  /** Type of dependency relationship */
  dependency_type: 'api' | 'event' | 'database' | 'cache';
  /** Specific API endpoints called */
  endpoints?: string[];
  /** Repository ID (for cross-repository dependencies) */
  repo_id?: string;
}

/**
 * External service dependency (third-party services)
 */
export interface ExternalServiceDependency {
  /** External service name */
  service_name: string;
  /** Type of external service */
  service_type: 'database' | 'cache' | 'queue' | 'storage' | 'api' | 'other';
  /** Connection string or URL */
  connection_string?: string;
  /** API endpoints accessed */
  endpoints?: string[];
}

/**
 * Shared library dependency
 */
export interface LibraryDependency {
  /** Package name */
  package_name: string;
  /** Version specifier */
  version: string;
  /** Whether library is internal to organization */
  is_internal: boolean;
}

/**
 * Service configuration metadata
 */
export interface ServiceConfigMetadata {
  /** Framework used (Express, Fastify, NestJS, etc.) */
  framework?: string;
  /** Programming language */
  language?: string;
  /** Dockerfile path */
  dockerfile?: string;
  /** Docker Compose service name */
  compose_service?: string;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Service boundary configuration for architectural constraints
 */
export interface ServiceBoundary {
  /** Service identifier */
  service_id: string;
  /** Boundary rules defining allowed/forbidden patterns */
  boundaries: BoundaryRule[];
  /** Allowed service identifiers for dependencies */
  allowed_dependencies: string[];
  /** Forbidden import patterns (regex) */
  forbidden_patterns: string[];
}

/**
 * Boundary rule defining architectural constraints
 */
export interface BoundaryRule {
  /** Type of boundary constraint */
  type: 'import' | 'api' | 'database';
  /** Pattern to match (regex or glob) */
  pattern: string;
  /** Whether pattern is allowed or forbidden */
  allowed: boolean;
  /** Explanation for the rule */
  reason?: string;
}

/**
 * Service boundary detection strategy configuration
 */
export interface ServiceBoundaryStrategy {
  /** Detect from directory structure (services/*, apps/*) */
  detect_from_directories: boolean;
  /** Parse docker-compose.yml for service definitions */
  detect_from_docker_compose: boolean;
  /** Use package.json metadata for detection */
  detect_from_package_json: boolean;
  /** Analyze route definitions for API endpoints */
  detect_from_api_routes: boolean;
  /** Custom glob patterns for service detection */
  custom_patterns?: string[];
}

/**
 * Service detection and indexing options
 */
export interface ServiceIndexingOptions {
  /** Enable service detection (default: true) */
  detect_services: boolean;
  /** Parse and index API endpoints (default: true) */
  detect_api_endpoints: boolean;
  /** Don't cross service boundaries (default: false) */
  respect_service_boundaries: boolean;
  /** Track service dependencies (default: true) */
  index_service_dependencies: boolean;
  /** Detection strategy configuration */
  boundary_strategy: ServiceBoundaryStrategy;
  /** Service IDs to exclude from indexing */
  excluded_services?: string[];
  /** Only index these services (if specified) */
  included_services?: string[];
}

/**
 * Service search filter for MCP tools
 */
export interface ServiceSearchFilter {
  /** Filter by service identifiers */
  service_ids?: string[];
  /** Filter by service types */
  service_types?: ServiceType[];
  /** Filter by service names */
  service_names?: string[];
  /** Exclude these services from results */
  exclude_services?: string[];
  /** Include API endpoint definitions in results */
  include_api_endpoints?: boolean;
  /** Include service dependencies in results */
  include_service_deps?: boolean;
}

/**
 * Service API call detected in code
 */
export interface ServiceAPICall {
  /** Calling service identifier */
  caller_service_id: string;
  /** Source file making the call */
  caller_file: string;
  /** Line number of the call */
  caller_line: number;
  /** Target service identifier */
  target_service_id: string;
  /** Called endpoint path */
  endpoint: string;
  /** HTTP method or operation type */
  method?: string;
  /** Type of API call */
  call_type: 'rest' | 'graphql' | 'grpc' | 'websocket';
}

/**
 * Service dependency graph node
 */
export interface ServiceGraphNode {
  /** Service identifier */
  service_id: string;
  /** Service name */
  service_name: string;
  /** Service type */
  service_type: ServiceType;
  /** Repository identifier */
  repo_id: string;
  /** Outgoing dependencies to other services */
  dependencies: ServiceGraphEdge[];
}

/**
 * Service dependency graph edge
 */
export interface ServiceGraphEdge {
  /** Target service identifier */
  target_service_id: string;
  /** Type of dependency relationship */
  dependency_type: 'api' | 'event' | 'database' | 'library';
  /** Number of calls or references (strength of dependency) */
  weight?: number;
  /** Specific endpoints called */
  endpoints?: string[];
}
