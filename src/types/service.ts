/**
 * Service detection and boundary types
 * Supports: Microservice architectures, service boundaries in monorepos
 */

/**
 * Detected service configuration
 */
export interface DetectedService {
  service_id: string; // Generated unique ID
  service_name: string;
  service_path: string; // Relative path from repo root
  service_type: ServiceType;
  api_config?: APIConfig;
  dependencies: ServiceDependencies;
  metadata?: ServiceConfigMetadata;
}

/**
 * Service types
 */
export type ServiceType = 'rest' | 'graphql' | 'grpc' | 'library' | 'worker' | 'other';

/**
 * API configuration (detected from code or config files)
 */
export interface APIConfig {
  type: 'rest' | 'graphql' | 'grpc' | 'websocket';
  endpoints: DetectedAPIEndpoint[];
  base_path?: string;
  port?: number;
  protocol?: string;
  schema_files?: string[]; // OpenAPI, GraphQL schema, proto files
}

/**
 * Detected API endpoint
 */
export interface DetectedAPIEndpoint {
  method?: string; // HTTP method (for REST)
  path: string;
  handler_file?: string; // Source file containing handler
  handler_function?: string; // Function name
  line_number?: number;
  description?: string;
  parameters?: APIParameter[];
}

/**
 * API parameter
 */
export interface APIParameter {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/**
 * Service dependencies
 */
export interface ServiceDependencies {
  internal: InternalServiceDependency[]; // Other services in same/different repo
  external: ExternalServiceDependency[]; // Third-party APIs, databases
  libraries: LibraryDependency[]; // Shared libraries
}

/**
 * Internal service dependency (service-to-service)
 */
export interface InternalServiceDependency {
  service_id: string;
  service_name: string;
  dependency_type: 'api' | 'event' | 'database' | 'cache';
  endpoints?: string[]; // Specific endpoints called
  repo_id?: string; // If cross-repo
}

/**
 * External service dependency
 */
export interface ExternalServiceDependency {
  service_name: string;
  service_type: 'database' | 'cache' | 'queue' | 'storage' | 'api' | 'other';
  connection_string?: string;
  endpoints?: string[];
}

/**
 * Library dependency (shared code)
 */
export interface LibraryDependency {
  package_name: string;
  version: string;
  is_internal: boolean; // Whether it's an internal library
}

/**
 * Service configuration metadata
 */
export interface ServiceConfigMetadata {
  framework?: string; // Express, Fastify, NestJS, etc.
  language?: string;
  dockerfile?: string;
  compose_service?: string; // docker-compose service name
  [key: string]: unknown;
}

/**
 * Service boundary configuration
 */
export interface ServiceBoundary {
  service_id: string;
  boundaries: BoundaryRule[];
  allowed_dependencies: string[]; // Allowed service IDs
  forbidden_patterns: string[]; // Forbidden import patterns
}

/**
 * Boundary rule (architectural constraints)
 */
export interface BoundaryRule {
  type: 'import' | 'api' | 'database';
  pattern: string; // Regex or glob pattern
  allowed: boolean;
  reason?: string;
}

/**
 * Service boundary detection strategy
 */
export interface ServiceBoundaryStrategy {
  detect_from_directories: boolean; // Use directory structure (services/*, apps/*)
  detect_from_docker_compose: boolean; // Parse docker-compose.yml
  detect_from_package_json: boolean; // Use package.json metadata
  detect_from_api_routes: boolean; // Analyze route definitions
  custom_patterns?: string[]; // Custom glob patterns for services
}

/**
 * Service indexing options
 */
export interface ServiceIndexingOptions {
  detect_services: boolean; // Enable service detection (default: true)
  detect_api_endpoints: boolean; // Parse API endpoints (default: true)
  respect_service_boundaries: boolean; // Don't cross boundaries (default: false)
  index_service_dependencies: boolean; // Track dependencies (default: true)
  boundary_strategy: ServiceBoundaryStrategy;
  excluded_services?: string[]; // Service IDs to exclude
  included_services?: string[]; // Only index these services
}

/**
 * Service search filter (for MCP tools)
 */
export interface ServiceSearchFilter {
  service_ids?: string[]; // Filter by service IDs
  service_types?: ServiceType[]; // Filter by service type
  service_names?: string[]; // Filter by service names
  exclude_services?: string[]; // Exclude these services
  include_api_endpoints?: boolean; // Include endpoint definitions in results
  include_service_deps?: boolean; // Include dependencies in results
}

/**
 * Service API call analysis
 */
export interface ServiceAPICall {
  caller_service_id: string;
  caller_file: string;
  caller_line: number;
  target_service_id: string;
  endpoint: string;
  method?: string;
  call_type: 'rest' | 'graphql' | 'grpc' | 'websocket';
}

/**
 * Service dependency graph node
 */
export interface ServiceGraphNode {
  service_id: string;
  service_name: string;
  service_type: ServiceType;
  repo_id: string;
  dependencies: ServiceGraphEdge[];
}

/**
 * Service dependency graph edge
 */
export interface ServiceGraphEdge {
  target_service_id: string;
  dependency_type: 'api' | 'event' | 'database' | 'library';
  weight?: number; // Number of calls/references
  endpoints?: string[];
}
