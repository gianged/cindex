/**
 * MCP Tool: list_services
 * List all services across indexed repositories (microservice support)
 */
import { type Pool } from 'pg';

import { getServiceAPIEndpoints, listServices } from '@database/queries';
import { formatServiceList, type ServiceInfo } from '@mcp/formatter';
import { validateArray, validateBoolean, validateRepoId } from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for list_services tool
 */
export interface ListServicesInput {
  repo_id?: string; // Optional: Filter by repository ID
  service_type?: string[]; // Optional: Filter by service type (docker, serverless, mobile)
  include_dependencies?: boolean; // Default: false - Include service dependencies
  include_api_endpoints?: boolean; // Default: false - Include API endpoint counts
}

/**
 * Output schema for list_services tool
 */
export interface ListServicesOutput {
  formatted_result: string; // Markdown-formatted service list
  services: ServiceInfo[]; // Transformed service data
  total_count: number; // Total number of services
}

/**
 * List services MCP tool implementation
 *
 * Lists all detected services in microservice or monorepo architectures with optional
 * filtering by repository and service type. Includes service metadata and optionally
 * fetches API endpoints and dependencies for each service.
 *
 * @param db - Database connection pool
 * @param input - List services parameters with optional repo and type filters
 * @returns Formatted service list with metadata and optional API endpoint counts
 * @throws {Error} If validation fails or database query fails
 */
export const listServicesTool = async (db: Pool, input: ListServicesInput): Promise<ListServicesOutput> => {
  logger.info('list_services tool invoked', { repo_id: input.repo_id });

  // Validate optional parameters
  const repoId = validateRepoId(input.repo_id, false);
  const serviceType = validateArray('service_type', input.service_type, false) as string[] | undefined;
  const includeDependencies = validateBoolean('include_dependencies', input.include_dependencies, false) ?? false;
  const includeApiEndpoints = validateBoolean('include_api_endpoints', input.include_api_endpoints, false) ?? false;

  logger.debug('Listing services', {
    repoId,
    serviceType,
    includeDependencies,
    includeApiEndpoints,
  });

  // Get services from database
  const dbServices = await listServices(db, repoId, {
    serviceType,
    includeDependencies,
    includeApiEndpoints,
  });

  if (dbServices.length === 0) {
    const message = repoId
      ? `# Services\n\nNo services found in repository \`${repoId}\`.\n\n**Tip:** Services are detected during indexing for microservice projects.`
      : '# Services\n\nNo services found in any indexed repository.\n\n**Tip:** Services are detected during indexing for microservice projects.';

    logger.info('No services found', { repo_id: repoId });

    return {
      formatted_result: message,
      services: [],
      total_count: 0,
    };
  }

  // Transform services to match formatter's expected type
  // Fetch API endpoints asynchronously if requested (can be slow for many services)
  const services: ServiceInfo[] = await Promise.all(
    dbServices.map(async (service) => ({
      service_id: service.service_id,
      service_name: service.service_name,
      service_type: service.service_type,
      repo_id: service.repo_id,
      api_endpoints: includeApiEndpoints ? await getServiceAPIEndpoints(db, service.service_id) : undefined,
    }))
  );

  // Format output
  const formattedResult = formatServiceList(services);

  logger.info('list_services completed', {
    total_count: services.length,
    repo_id: repoId,
  });

  return {
    formatted_result: formattedResult,
    services,
    total_count: services.length,
  };
};
