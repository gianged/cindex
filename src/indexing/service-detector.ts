/**
 * Service Detector: Microservice Architecture & Project Type Support
 *
 * Detects and analyzes service boundaries and project structures:
 *
 * **Microservices:**
 * - Service directory detection (services/*, apps/*, packages/*)
 * - Docker Compose parsing with full configuration extraction
 * - Service type classification (REST, GraphQL, gRPC, library, docker, serverless, mobile)
 * - API endpoint extraction from code
 * - API spec file parsing (OpenAPI, GraphQL, gRPC Proto)
 *
 * **Serverless:**
 * - Serverless Framework (serverless.yml)
 * - Vercel Functions (vercel.json)
 * - Netlify Functions (netlify.toml)
 * - AWS SAM (template.yaml)
 * - AWS CDK (cdk.json)
 *
 * **Mobile:**
 * - React Native (app.json)
 * - Expo (app.json with expo config)
 * - Flutter (pubspec.yaml)
 * - Capacitor (capacitor.config.*)
 * - Ionic (ionic.config.json)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

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
  DockerService = 'docker_service',
  Serverless = 'serverless',
  Mobile = 'mobile',
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

  /** Docker Compose configuration */
  dockerConfig?: DockerServiceConfig;

  /** Serverless configuration */
  serverlessConfig?: ServerlessConfig;

  /** Mobile project configuration */
  mobileConfig?: MobileConfig;
}

/**
 * Docker Compose service configuration
 */
export interface DockerServiceConfig {
  /** Container image */
  image?: string;

  /** Build configuration */
  build?: string | Record<string, unknown>;

  /** Exposed ports (format: "host:container") */
  ports?: string[];

  /** Environment variables */
  environment?: Record<string, string> | string[];

  /** Volumes */
  volumes?: string[];

  /** Networks */
  networks?: string[];

  /** Service dependencies */
  depends_on?: string[];

  /** Command override */
  command?: string | string[];
}

/**
 * Serverless framework configuration
 */
export interface ServerlessConfig {
  /** Serverless provider (aws, vercel, netlify, etc.) */
  provider: string;

  /** Functions defined */
  functions?: ServerlessFunctionInfo[];

  /** Framework (serverless, vercel, netlify, etc.) */
  framework?: string;
}

/**
 * Serverless function information
 */
export interface ServerlessFunctionInfo {
  /** Function name */
  name: string;

  /** Handler path */
  handler?: string;

  /** Runtime */
  runtime?: string;

  /** HTTP route/trigger */
  route?: string;

  /** Event triggers */
  events?: string[];
}

/**
 * Mobile project configuration
 */
export interface MobileConfig {
  /** Mobile framework (react-native, flutter, expo, etc.) */
  framework: string;

  /** Target platforms */
  platforms?: string[];

  /** App identifier */
  appId?: string;

  /** Package name */
  packageName?: string;
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
   * Parse docker-compose.yml file using js-yaml
   *
   * @returns Parsed Docker Compose configuration with services
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

        // Parse YAML using js-yaml
        const parsed = yaml.load(content);

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue;
        }

        // Extract services section
        const services = (parsed as Record<string, unknown>).services as Record<string, unknown> | undefined;

        if (!services || typeof services !== 'object') {
          continue;
        }

        logger.info('Parsed docker-compose.yml', {
          file: filename,
          services: Object.keys(services),
        });

        return services;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Error parsing docker-compose file', { file: filename, error });
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
   *
   * Extracts ports, networks, volumes, dependencies from Docker Compose configuration
   */
  private enrichServicesWithDockerData = (services: ServiceInfo[], dockerConfig: Record<string, unknown>): void => {
    for (const service of services) {
      const dockerService = (dockerConfig[service.id] ?? dockerConfig[service.name]) as
        | Record<string, unknown>
        | undefined;

      if (dockerService && typeof dockerService === 'object') {
        // Extract Docker configuration
        const dockerServiceConfig: DockerServiceConfig = {};

        if (dockerService.image && typeof dockerService.image === 'string') {
          dockerServiceConfig.image = dockerService.image;
        }

        if (dockerService.build) {
          dockerServiceConfig.build = dockerService.build as string | Record<string, unknown>;
        }

        if (Array.isArray(dockerService.ports)) {
          dockerServiceConfig.ports = dockerService.ports.map((p) => String(p));
          // Extract port numbers for service info
          service.ports = dockerServiceConfig.ports
            .map((p) => {
              const match = /(\d+):/.exec(p);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter((p) => p > 0);
        }

        if (dockerService.environment) {
          dockerServiceConfig.environment = dockerService.environment as Record<string, string> | string[];
        }

        if (Array.isArray(dockerService.volumes)) {
          dockerServiceConfig.volumes = dockerService.volumes.map((v) => String(v));
        }

        if (Array.isArray(dockerService.networks)) {
          dockerServiceConfig.networks = dockerService.networks.map((n) => String(n));
        } else if (dockerService.networks && typeof dockerService.networks === 'object') {
          dockerServiceConfig.networks = Object.keys(dockerService.networks);
        }

        if (dockerService.depends_on) {
          if (Array.isArray(dockerService.depends_on)) {
            dockerServiceConfig.depends_on = dockerService.depends_on.map((d) => String(d));
            service.serviceDependencies = dockerServiceConfig.depends_on;
          } else if (typeof dockerService.depends_on === 'object') {
            dockerServiceConfig.depends_on = Object.keys(dockerService.depends_on);
            service.serviceDependencies = dockerServiceConfig.depends_on;
          }
        }

        if (dockerService.command) {
          dockerServiceConfig.command = dockerService.command as string | string[];
        }

        service.dockerConfig = dockerServiceConfig;
        service.type = ServiceType.DockerService;

        logger.debug('Enriched service with docker-compose data', {
          service: service.name,
          ports: service.ports,
          dependencies: service.serviceDependencies,
        });
      }
    }
  };

  /**
   * Classify service type based on detected patterns
   */
  public classifyServiceType = async (service: ServiceInfo): Promise<ServiceType> => {
    // If already classified as Docker service, keep it
    if (service.type === ServiceType.DockerService) {
      return ServiceType.DockerService;
    }

    // Check for serverless frameworks
    const serverlessConfig = await this.detectServerlessFramework(service.path);
    if (serverlessConfig) {
      service.serverlessConfig = serverlessConfig;
      return ServiceType.Serverless;
    }

    // Check for mobile frameworks
    const mobileConfig = await this.detectMobileFramework(service.path);
    if (mobileConfig) {
      service.mobileConfig = mobileConfig;
      return ServiceType.Mobile;
    }

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
   * Detect serverless framework configuration
   *
   * Detects: Serverless Framework, Vercel, Netlify, AWS SAM, AWS CDK
   */
  private detectServerlessFramework = async (servicePath: string): Promise<ServerlessConfig | null> => {
    // Serverless Framework (serverless.yml)
    const serverlessYmlPath = path.join(servicePath, 'serverless.yml');
    try {
      const content = await fs.readFile(serverlessYmlPath, 'utf-8');
      const parsed = yaml.load(content) as Record<string, unknown>;

      const functions = this.extractServerlessFunctions(parsed);
      const providerConfig = parsed.provider as Record<string, unknown> | undefined;
      const provider = (providerConfig?.name as string | undefined) ?? 'aws';

      return {
        provider,
        framework: 'serverless',
        functions,
      };
    } catch {
      // Not Serverless Framework
    }

    // Vercel (vercel.json)
    const vercelJsonPath = path.join(servicePath, 'vercel.json');
    try {
      const content = await fs.readFile(vercelJsonPath, 'utf-8');
      const parsed = parseJsonToRecord(content);

      const functions = this.extractVercelFunctions(parsed);

      return {
        provider: 'vercel',
        framework: 'vercel',
        functions,
      };
    } catch {
      // Not Vercel
    }

    // Netlify (netlify.toml)
    const netlifyTomlPath = path.join(servicePath, 'netlify.toml');
    try {
      await fs.access(netlifyTomlPath);

      return {
        provider: 'netlify',
        framework: 'netlify',
      };
    } catch {
      // Not Netlify
    }

    // AWS SAM (template.yaml)
    const samTemplatePath = path.join(servicePath, 'template.yaml');
    try {
      const content = await fs.readFile(samTemplatePath, 'utf-8');
      const parsed = yaml.load(content) as Record<string, unknown>;

      if (parsed.AWSTemplateFormatVersion) {
        return {
          provider: 'aws',
          framework: 'sam',
        };
      }
    } catch {
      // Not AWS SAM
    }

    // AWS CDK (cdk.json)
    const cdkJsonPath = path.join(servicePath, 'cdk.json');
    try {
      await fs.access(cdkJsonPath);

      return {
        provider: 'aws',
        framework: 'cdk',
      };
    } catch {
      // Not AWS CDK
    }

    return null;
  };

  /**
   * Extract functions from Serverless Framework config
   */
  private extractServerlessFunctions = (config: Record<string, unknown>): ServerlessFunctionInfo[] => {
    const functions: ServerlessFunctionInfo[] = [];
    const functionsConfig = config.functions as Record<string, Record<string, unknown>> | undefined;

    if (!functionsConfig) return functions;

    for (const [name, funcConfig] of Object.entries(functionsConfig)) {
      const events = funcConfig.events as Record<string, unknown>[] | undefined;
      const httpEvent = events?.find((e) => e.http);

      functions.push({
        name,
        handler: funcConfig.handler as string | undefined,
        runtime: funcConfig.runtime as string | undefined,
        route: httpEvent ? String((httpEvent.http as Record<string, unknown>).path) : undefined,
        events: events?.map((e) => Object.keys(e)[0] ?? ''),
      });
    }

    return functions;
  };

  /**
   * Extract functions from Vercel config
   */
  private extractVercelFunctions = (config: Record<string, unknown>): ServerlessFunctionInfo[] => {
    const functions: ServerlessFunctionInfo[] = [];
    const rewrites = config.rewrites as Record<string, unknown>[] | undefined;

    if (rewrites) {
      for (const rewrite of rewrites) {
        const destination = rewrite.destination;
        const source = rewrite.source;

        if (typeof destination === 'string' && destination.startsWith('/api/')) {
          functions.push({
            name: destination.replace('/api/', ''),
            route: typeof source === 'string' ? source : destination,
          });
        }
      }
    }

    return functions;
  };

  /**
   * Detect mobile framework configuration
   *
   * Detects: React Native, Expo, Flutter, Capacitor, Ionic
   */
  private detectMobileFramework = async (servicePath: string): Promise<MobileConfig | null> => {
    // React Native (app.json with displayName)
    const appJsonPath = path.join(servicePath, 'app.json');
    try {
      const content = await fs.readFile(appJsonPath, 'utf-8');
      const parsed = parseJsonToRecord(content);

      if (parsed.expo) {
        // Expo project
        const expoConfig = parsed.expo as Record<string, unknown>;
        const platforms = expoConfig.platforms;
        return {
          framework: 'expo',
          platforms: Array.isArray(platforms) ? platforms : ['ios', 'android'],
          appId: expoConfig.slug as string | undefined,
          packageName: expoConfig.android
            ? ((expoConfig.android as Record<string, unknown>).package as string)
            : undefined,
        };
      }

      if (parsed.displayName) {
        // React Native project
        return {
          framework: 'react-native',
          platforms: ['ios', 'android'],
          appId: parsed.name as string | undefined,
        };
      }
    } catch {
      // Not React Native or Expo
    }

    // Flutter (pubspec.yaml)
    const pubspecPath = path.join(servicePath, 'pubspec.yaml');
    try {
      const content = await fs.readFile(pubspecPath, 'utf-8');
      const parsed = yaml.load(content) as Record<string, unknown>;

      if (parsed.flutter) {
        return {
          framework: 'flutter',
          platforms: ['ios', 'android', 'web'],
          packageName: parsed.name as string | undefined,
        };
      }
    } catch {
      // Not Flutter
    }

    // Capacitor (capacitor.config.ts or capacitor.config.json)
    const capacitorPaths = ['capacitor.config.ts', 'capacitor.config.json'];
    for (const filename of capacitorPaths) {
      try {
        await fs.access(path.join(servicePath, filename));
        return {
          framework: 'capacitor',
          platforms: ['ios', 'android', 'web'],
        };
      } catch {
        continue;
      }
    }

    // Ionic (ionic.config.json)
    const ionicConfigPath = path.join(servicePath, 'ionic.config.json');
    try {
      await fs.access(ionicConfigPath);
      return {
        framework: 'ionic',
        platforms: ['ios', 'android', 'web'],
      };
    } catch {
      // Not Ionic
    }

    return null;
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
