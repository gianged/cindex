/**
 * MCP Tool: get_service_context
 * Get full context for a service with API contracts (microservice support)
 */
import { type Pool } from 'pg';

import { getServiceContext, type ServiceContext } from '@database/queries';
import { formatServiceContext } from '@mcp/formatter';
import {
  validateBoolean,
  validateNumberInRange,
  validateRepoId,
  validateServiceId,
  validateString,
} from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for get_service_context tool
 */
export interface GetServiceContextInput {
  service_id?: string; // Service ID (required if service_name not provided)
  service_name?: string; // Service name (required if service_id not provided)
  repo_id?: string; // Optional: Repository ID for disambiguation
  include_dependencies?: boolean; // Default: true - Include service dependencies
  include_dependents?: boolean; // Default: true - Include services that depend on this one
  include_api_contracts?: boolean; // Default: true - Include API endpoints/contracts
  dependency_depth?: number; // Default: 2, Range: 1-5 - Depth of dependency tree
}

/**
 * Output schema for get_service_context tool
 */
export interface GetServiceContextOutput {
  formatted_result: string; // Markdown-formatted service context
  context: ServiceContext; // Raw service context
}

/**
 * Get service context MCP tool implementation
 *
 * @param db - Database connection pool
 * @param input - Get service context parameters
 * @returns Formatted service context with API contracts
 */
export const getServiceContextTool = async (
  db: Pool,
  input: GetServiceContextInput
): Promise<GetServiceContextOutput> => {
  logger.info('get_service_context tool invoked', {
    service_id: input.service_id,
    service_name: input.service_name,
  });

  // Validate required parameters (either service_id or service_name)
  const serviceId = validateServiceId(input.service_id, false);
  const serviceName = validateString('service_name', input.service_name, false);

  if (!serviceId && !serviceName) {
    throw new Error('Either service_id or service_name is required');
  }

  // Validate optional parameters
  const repoId = validateRepoId(input.repo_id, false);
  const includeDependencies = validateBoolean('include_dependencies', input.include_dependencies, false) ?? true;
  const includeDependents = validateBoolean('include_dependents', input.include_dependents, false) ?? true;
  const includeApiContracts = validateBoolean('include_api_contracts', input.include_api_contracts, false) ?? true;
  const dependencyDepth = validateNumberInRange('dependency_depth', input.dependency_depth, 1, 5, false) ?? 2;

  logger.debug('Getting service context', {
    serviceId,
    serviceName,
    repoId,
    includeDependencies,
    includeDependents,
    includeApiContracts,
    dependencyDepth,
  });

  // Get service context from database
  const context = await getServiceContext(db, {
    serviceId,
    serviceName,
    repoId,
    includeDependencies,
    includeDependents,
    includeApiContracts,
    dependencyDepth,
  });

  if (!context) {
    const identifier = serviceId ?? serviceName ?? 'unknown';
    throw new Error(`Service not found: ${identifier}`);
  }

  // Format output
  const formattedResult = formatServiceContext(context);

  logger.info('get_service_context completed', {
    service_id: context.service.id,
    service_name: context.service.service_name,
    dependencies_count: context.dependencies.length,
    dependents_count: context.dependents.length,
    api_endpoints_count: context.api_endpoints.length,
  });

  return {
    formatted_result: formattedResult,
    context,
  };
};
