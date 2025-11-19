/**
 * Service Detector: Microservice Architecture Support
 *
 * Detects and analyzes microservice boundaries:
 * - Service directory detection (services/*, apps/*)
 * - docker-compose.yml parsing
 * - Service type classification (REST, GraphQL, gRPC, library)
 * - API endpoint extraction from code
 * - API spec file parsing (OpenAPI, GraphQL, gRPC Proto)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { logger } from '@utils/logger';
import { type PackageJsonInfo } from '@/types/workspace';

/**
 * Service type classification
 */
export enum ServiceType {
  REST = 'rest',
  GraphQL = 'graphql',
  GRPC = 'grpc',
  Library = 'library',
  Unknown = 'unknown',
}

/**
 * API contract format
 */
export enum APIContractFormat {
  OpenAPI = 'openapi',
  Swagger = 'swagger',
  GraphQL = 'graphql',
  GRPC = 'grpc',
  Unknown = 'unknown',
}

/**
 * Service information
 */
export interface ServiceInfo {
  /** Service ID (directory name or docker-compose service name) */
  id: string;

  /** Service name (from package.json or docker-compose) */
  name: string;

  /** Absolute path to service directory */
  path: string;

  /** Relative path from repository root */
  relativePath: string;

  /** Service type */
  type: ServiceType;

  /** Port(s) exposed by service */
  ports?: number[];

  /** API endpoint patterns detected in code */
  apiEndpoints?: string[];

  /** API contract files */
  apiContracts?: APIContract[];

  /** Dependencies on other services */
  serviceDependencies?: string[];

  /** Framework/technology detected */
  framework?: string;
}

/**
 * API contract/specification
 */
export interface APIContract {
  /** Contract format */
  format: APIContractFormat;

  /** Absolute path to contract file */
  filePath: string;

  /** Parsed contract content */
  content: Record<string, unknown>;

  /** Endpoint/operation definitions */
  endpoints?: APIEndpointDefinition[];
}

/**
 * API endpoint definition from spec file
 */
export interface APIEndpointDefinition {
  /** HTTP method or operation type */
  method: string;

  /** Endpoint path or operation name */
  path: string;

  /** Request schema */
  request?: Record<string, unknown>;

  /** Response schema */
  response?: Record<string, unknown>;

  /** Description */
  description?: string;
}

/**
 * OpenAPI operation object (simplified)
 * Represents a single operation in an OpenAPI spec
 */
interface OpenAPIOperation {
  /** Short summary of the operation */
  summary?: string;

  /** Detailed description of the operation */
  description?: string;

  /** Other operation properties (operationId, tags, etc.) */
  [key: string]: unknown;
}

/**
 * Service configuration from repository
 */
export interface ServiceConfig {
  /** Repository root path */
  rootPath: string;

  /** Detected services */
  services: ServiceInfo[];

  /** Whether docker-compose.yml exists */
  hasDockerCompose: boolean;

  /** Docker Compose services (if available) */
  dockerServices?: Record<string, unknown>;
}

/**
 * Type guard to check if a value is a valid PackageJson-like object
 */
const isPackageJsonLike = (value: unknown): value is Partial<PackageJsonInfo> => {
  return typeof value === 'object' && value !== null;
};

/**
 * Safely parse package.json content
 */
const parsePackageJson = (content: string): Partial<PackageJsonInfo> => {
  const parsed: unknown = JSON.parse(content);
  if (!isPackageJsonLike(parsed)) {
    return {};
  }
  return parsed;
};

/**
 * Safely parse JSON to Record<string, unknown>
 */
const parseJsonToRecord = (content: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
};

/**
 * Service detector for microservice architectures
 */
export class ServiceDetector {
  constructor(private readonly rootPath: string) {}

  /**
   * Detect all services in repository
   *
   * @returns Service configuration
   */
  public detectServices = async (): Promise<ServiceConfig> => {
    logger.info('Detecting services', { root: this.rootPath });

    const services: ServiceInfo[] = [];

    // 1. Try to parse docker-compose.yml
    const dockerConfig = await this.parseDockerCompose();

    // 2. Detect services from directory structure
    const directoryServices = await this.detectServicesFromDirectories();
    services.push(...directoryServices);

    // 3. Enrich with docker-compose data if available
    if (dockerConfig) {
      this.enrichServicesWithDockerData(services, dockerConfig);
    }

    // 4. Detect API contracts for each service
    for (const service of services) {
      service.apiContracts = await this.detectAPIContracts(service.path);
      service.type = await this.classifyServiceType(service);
    }

    logger.info('Services detected', { count: services.length });

    return {
      rootPath: this.rootPath,
      services,
      hasDockerCompose: dockerConfig !== null,
      dockerServices: dockerConfig ?? undefined,
    };
  };

  /**
   * Parse docker-compose.yml file
   */
  public parseDockerCompose = async (): Promise<Record<string, unknown> | null> => {
    const dockerComposePaths = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'docker-compose.dev.yml',
      'docker-compose.prod.yml',
    ];

    for (const filename of dockerComposePaths) {
      const filePath = path.join(this.rootPath, filename);

      try {
        const content = await fs.readFile(filePath, 'utf-8');

        // Simple YAML parsing for services section
        const servicesMatch = /services:\s*\n((?:\s+\w+:[\s\S]*?(?=\n\S|\n$))+)/.exec(content);

        if (!servicesMatch) {
          continue;
        }

        // Parse service names
        const serviceLines = servicesMatch[1].split('\n');
        const services: Record<string, unknown> = {};

        let currentService: string | null = null;

        for (const line of serviceLines) {
          const serviceMatch = /^\s+(\w+):/.exec(line);
          if (serviceMatch) {
            currentService = serviceMatch[1];
            services[currentService] = {};
          }
        }

        logger.info('Parsed docker-compose.yml', {
          file: filename,
          services: Object.keys(services),
        });

        return services;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Error reading docker-compose file', { file: filename, error });
        }
      }
    }

    return null;
  };

  /**
   * Detect services from directory structure
   *
   * Looks for services/*, apps/*, or packages/* directories
   */
  private detectServicesFromDirectories = async (): Promise<ServiceInfo[]> => {
    const services: ServiceInfo[] = [];
    const serviceDirs = ['services', 'apps', 'packages', 'microservices'];

    for (const dirName of serviceDirs) {
      const dirPath = path.join(this.rootPath, dirName);

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            const servicePath = path.join(dirPath, entry.name);
            const serviceInfo = await this.createServiceInfo(servicePath, entry.name);

            if (serviceInfo) {
              services.push(serviceInfo);
            }
          }
        }
      } catch {
        // Directory doesn't exist, skip
        continue;
      }
    }

    return services;
  };

  /**
   * Create service info from directory
   */
  private createServiceInfo = async (servicePath: string, serviceId: string): Promise<ServiceInfo | null> => {
    // Check if directory has package.json
    const packageJsonPath = path.join(servicePath, 'package.json');

    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = parsePackageJson(content);

      const relativePath = path.relative(this.rootPath, servicePath);

      return {
        id: serviceId,
        name: packageJson.name ?? serviceId,
        path: servicePath,
        relativePath,
        type: ServiceType.Unknown, // Will be classified later
      };
    } catch {
      // No package.json, might still be a service
      const relativePath = path.relative(this.rootPath, servicePath);

      return {
        id: serviceId,
        name: serviceId,
        path: servicePath,
        relativePath,
        type: ServiceType.Unknown,
      };
    }
  };

  /**
   * Enrich services with docker-compose data
   */
  private enrichServicesWithDockerData = (services: ServiceInfo[], dockerConfig: Record<string, unknown>): void => {
    // Match services by name
    for (const service of services) {
      if (dockerConfig[service.id] ?? dockerConfig[service.name]) {
        // Docker Compose data available for this service
        logger.debug('Enriched service with docker-compose data', { service: service.name });
      }
    }
  };

  /**
   * Classify service type based on detected patterns
   */
  public classifyServiceType = async (service: ServiceInfo): Promise<ServiceType> => {
    // Check for API contract files
    if (service.apiContracts) {
      for (const contract of service.apiContracts) {
        if (contract.format === APIContractFormat.OpenAPI || contract.format === APIContractFormat.Swagger) {
          return ServiceType.REST;
        }
        if (contract.format === APIContractFormat.GraphQL) {
          return ServiceType.GraphQL;
        }
        if (contract.format === APIContractFormat.GRPC) {
          return ServiceType.GRPC;
        }
      }
    }

    // Check package.json dependencies
    const packageJsonPath = path.join(service.path, 'package.json');

    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = parsePackageJson(content);
      const dependencies = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      };

      // Check for framework indicators
      if (dependencies.express || dependencies.fastify || dependencies.koa) {
        return ServiceType.REST;
      }

      if (dependencies['@apollo/server'] || dependencies.graphql || dependencies['@nestjs/graphql']) {
        return ServiceType.GraphQL;
      }

      if (dependencies['@grpc/grpc-js'] || dependencies.grpc) {
        return ServiceType.GRPC;
      }

      // If no server dependencies, likely a library
      if (!dependencies.express && !dependencies.fastify && !dependencies['@apollo/server']) {
        return ServiceType.Library;
      }
    } catch {
      // Can't determine from package.json
    }

    return ServiceType.Unknown;
  };

  /**
   * Detect API contract files in service directory
   */
  public detectAPIContracts = async (servicePath: string): Promise<APIContract[]> => {
    const contracts: APIContract[] = [];

    // OpenAPI/Swagger specs
    const openAPIFiles = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.json'];

    for (const filename of openAPIFiles) {
      const filePath = path.join(servicePath, filename);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = filename.endsWith('.json') ? parseJsonToRecord(content) : this.parseYAML(content);

        contracts.push({
          format: filename.includes('swagger') ? APIContractFormat.Swagger : APIContractFormat.OpenAPI,
          filePath,
          content: parsed,
          endpoints: this.extractOpenAPIEndpoints(parsed),
        });

        logger.info('Detected OpenAPI contract', { file: filename });
      } catch {
        // File doesn't exist, skip
        continue;
      }
    }

    // GraphQL schemas
    const graphQLFiles = ['schema.graphql', 'schema.gql', 'api.graphql'];

    for (const filename of graphQLFiles) {
      const filePath = path.join(servicePath, filename);

      try {
        const content = await fs.readFile(filePath, 'utf-8');

        contracts.push({
          format: APIContractFormat.GraphQL,
          filePath,
          content: { schema: content },
          endpoints: this.extractGraphQLEndpoints(content),
        });

        logger.info('Detected GraphQL schema', { file: filename });
      } catch {
        continue;
      }
    }

    // gRPC proto files
    const protoFiles = await this.findProtoFiles(servicePath);

    for (const filePath of protoFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');

        contracts.push({
          format: APIContractFormat.GRPC,
          filePath,
          content: { proto: content },
          endpoints: this.extractGRPCEndpoints(content),
        });

        logger.info('Detected gRPC proto file', { file: path.basename(filePath) });
      } catch {
        continue;
      }
    }

    return contracts;
  };

  /**
   * Find .proto files in service directory
   */
  private findProtoFiles = async (servicePath: string): Promise<string[]> => {
    const protoFiles: string[] = [];

    try {
      const entries = await fs.readdir(servicePath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(servicePath, entry.name);

        if (entry.isFile() && entry.name.endsWith('.proto')) {
          protoFiles.push(fullPath);
        } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          // Recursively search subdirectories
          const subFiles = await this.findProtoFiles(fullPath);
          protoFiles.push(...subFiles);
        }
      }
    } catch {
      // Ignore errors
    }

    return protoFiles;
  };

  /**
   * Extract OpenAPI endpoints from spec
   */
  private extractOpenAPIEndpoints = (spec: Record<string, unknown>): APIEndpointDefinition[] => {
    const endpoints: APIEndpointDefinition[] = [];

    const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
    if (!paths) return endpoints;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, definition] of Object.entries(methods)) {
        if (typeof definition === 'object' && definition !== null) {
          const operation = definition as OpenAPIOperation;
          endpoints.push({
            method: method.toUpperCase(),
            path,
            description: operation.summary ?? operation.description,
          });
        }
      }
    }

    return endpoints;
  };

  /**
   * Extract GraphQL operations from schema
   */
  private extractGraphQLEndpoints = (schema: string): APIEndpointDefinition[] => {
    const endpoints: APIEndpointDefinition[] = [];

    // Simple regex to extract Query and Mutation fields
    const queryMatch = /type\s+Query\s*{([^}]+)}/.exec(schema);
    if (queryMatch) {
      const fields = queryMatch[1].match(/(\w+)\s*(?:\([^)]*\))?\s*:\s*\w+/g);
      if (fields) {
        for (const field of fields) {
          const name = /(\w+)/.exec(field)?.[1];
          if (name) {
            endpoints.push({
              method: 'QUERY',
              path: name,
            });
          }
        }
      }
    }

    const mutationMatch = /type\s+Mutation\s*{([^}]+)}/.exec(schema);
    if (mutationMatch) {
      const fields = mutationMatch[1].match(/(\w+)\s*(?:\([^)]*\))?\s*:\s*\w+/g);
      if (fields) {
        for (const field of fields) {
          const name = /(\w+)/.exec(field)?.[1];
          if (name) {
            endpoints.push({
              method: 'MUTATION',
              path: name,
            });
          }
        }
      }
    }

    return endpoints;
  };

  /**
   * Extract gRPC RPCs from proto file
   */
  private extractGRPCEndpoints = (proto: string): APIEndpointDefinition[] => {
    const endpoints: APIEndpointDefinition[] = [];

    // Extract service definitions
    const serviceRegex = /service\s+(\w+)\s*{([^}]+)}/g;
    let serviceMatch;

    while ((serviceMatch = serviceRegex.exec(proto)) !== null) {
      const serviceName = serviceMatch[1];
      const serviceBody = serviceMatch[2];

      // Extract rpc methods
      const rpcRegex = /rpc\s+(\w+)/g;
      let rpcMatch;

      while ((rpcMatch = rpcRegex.exec(serviceBody)) !== null) {
        const rpcName = rpcMatch[1];

        endpoints.push({
          method: 'RPC',
          path: `${serviceName}.${rpcName}`,
        });
      }
    }

    return endpoints;
  };

  /**
   * Simple YAML parser (for basic structures)
   *
   * Note: For production, use a proper YAML library like 'js-yaml'
   */
  private parseYAML = (_content: string): Record<string, unknown> => {
    // Very basic YAML parsing - for production, use a library
    try {
      // Attempt to convert simple YAML to JSON-like structure
      // This is a placeholder - real implementation would use js-yaml
      return {};
    } catch {
      return {};
    }
  };
}

/**
 * Detect services in repository (convenience function)
 *
 * @param rootPath - Repository root path
 * @returns Service configuration
 */
export const detectServices = async (rootPath: string): Promise<ServiceConfig> => {
  const detector = new ServiceDetector(rootPath);
  return detector.detectServices();
};

/**
 * Detect API endpoints in code file (convenience function)
 *
 * @param code - Source code content
 * @returns Array of detected endpoint patterns
 */
export const detectAPIEndpoints = (code: string): string[] => {
  const endpoints: string[] = [];

  // Express routes
  const expressRegex = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = expressRegex.exec(code)) !== null) {
    endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
  }

  // NestJS decorators
  const nestRegex = /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]+)['"]/g;

  while ((match = nestRegex.exec(code)) !== null) {
    endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
  }

  return endpoints;
};
