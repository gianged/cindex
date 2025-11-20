/**
 * MCP Tool: find_cross_service_calls
 * Find inter-service API calls across microservices
 */
import { type Pool } from 'pg';

import { findCrossServiceCalls } from '@database/queries';
import { formatCrossServiceCalls } from '@mcp/formatter';
import { validateBoolean, validateServiceId, validateString } from '@mcp/validator';
import { logger } from '@utils/logger';

/**
 * Input schema for find_cross_service_calls tool
 */
export interface FindCrossServiceCallsInput {
  source_service_id?: string; // Optional: Source service ID
  target_service_id?: string; // Optional: Target service ID
  endpoint_pattern?: string; // Optional: Endpoint regex pattern (e.g., /api/users/.*)
  include_reverse?: boolean; // Default: false - Also show calls in reverse direction
}

/**
 * Output schema for find_cross_service_calls tool
 */
export interface FindCrossServiceCallsOutput {
  formatted_result: string; // Markdown-formatted API call results
  calls: {
    source_service_id: string;
    target_service_id: string;
    endpoint_path: string;
    call_count: number;
  }[];
  total_calls: number;
}

/**
 * Find cross-service calls MCP tool implementation
 *
 * Searches for inter-service API calls in microservice architectures. Supports
 * filtering by source/target service, endpoint patterns, and bidirectional search.
 * Useful for analyzing service dependencies and API usage patterns.
 *
 * @param db - Database connection pool
 * @param input - Find cross-service calls parameters
 * @returns Formatted API call results with source, target, endpoint, and call count
 * @throws {Error} If validation fails for any parameter
 */
export const findCrossServiceCallsTool = async (
  db: Pool,
  input: FindCrossServiceCallsInput
): Promise<FindCrossServiceCallsOutput> => {
  logger.info('find_cross_service_calls tool invoked', {
    source_service_id: input.source_service_id,
    target_service_id: input.target_service_id,
  });

  // Validate optional parameters
  const sourceServiceId = validateServiceId(input.source_service_id, false);
  const targetServiceId = validateServiceId(input.target_service_id, false);
  const endpointPattern = validateString('endpoint_pattern', input.endpoint_pattern, false);
  const includeReverse = validateBoolean('include_reverse', input.include_reverse, false) ?? false;

  logger.debug('Finding cross-service calls', {
    sourceServiceId,
    targetServiceId,
    endpointPattern,
    includeReverse,
  });

  // Get cross-service calls from database
  const calls = await findCrossServiceCalls(db, {
    sourceServiceId,
    targetServiceId,
    endpointPattern,
  });

  // If include_reverse is true, also get reverse calls (swap source and target)
  // This allows bidirectional analysis of service communication patterns
  let reverseCalls: typeof calls = [];
  if (includeReverse && (sourceServiceId ?? targetServiceId)) {
    reverseCalls = await findCrossServiceCalls(db, {
      sourceServiceId: targetServiceId,
      targetServiceId: sourceServiceId,
      endpointPattern,
    });
  }

  // Combine forward and reverse calls for complete analysis
  const allCalls = [...calls, ...reverseCalls];

  if (allCalls.length === 0) {
    const message =
      '# Cross-Service API Calls\n\nNo inter-service API calls found.\n\n**Tip:** API calls are detected during indexing from service dependencies.';

    logger.info('No cross-service calls found', {
      source_service_id: sourceServiceId,
      target_service_id: targetServiceId,
    });

    return {
      formatted_result: message,
      calls: [],
      total_calls: 0,
    };
  }

  // Format output
  const formattedResult = formatCrossServiceCalls(allCalls);

  logger.info('find_cross_service_calls completed', {
    source_service_id: sourceServiceId,
    target_service_id: targetServiceId,
    total_calls: allCalls.length,
  });

  return {
    formatted_result: formattedResult,
    calls: allCalls,
    total_calls: allCalls.length,
  };
};
