/**
 * MCP Tool Input Validation
 * Provides comprehensive validation functions for all MCP tool parameters
 */
import { CindexError } from '@utils/errors';

/**
 * Validation error - invalid tool input parameters
 */
export class ValidationError extends CindexError {
  constructor(parameter: string, message: string, details?: unknown, suggestion?: string) {
    super(`Invalid parameter '${parameter}': ${message}`, 'VALIDATION_ERROR', details, suggestion);
  }

  /**
   * Create error for missing required parameter
   */
  static missingRequired(parameter: string): ValidationError {
    return new ValidationError(
      parameter,
      'This parameter is required',
      undefined,
      `Provide a value for '${parameter}'`
    );
  }

  /**
   * Create error for wrong type
   */
  static wrongType(parameter: string, expected: string, actual: string): ValidationError {
    return new ValidationError(
      parameter,
      `Expected ${expected}, got ${actual}`,
      { expected, actual },
      `Provide a ${expected} value for '${parameter}'`
    );
  }

  /**
   * Create error for value out of range
   */
  static outOfRange(parameter: string, value: number, min: number, max: number): ValidationError {
    return new ValidationError(
      parameter,
      `Value ${String(value)} is out of range [${String(min)}, ${String(max)}]`,
      { value, min, max },
      `Provide a value between ${String(min)} and ${String(max)}`
    );
  }

  /**
   * Create error for invalid enum value
   */
  static invalidEnum(parameter: string, value: string, allowed: string[]): ValidationError {
    return new ValidationError(
      parameter,
      `Invalid value '${value}'`,
      { value, allowed },
      `Use one of: ${allowed.join(', ')}`
    );
  }

  /**
   * Create error for empty array
   */
  static emptyArray(parameter: string): ValidationError {
    return new ValidationError(parameter, 'Array cannot be empty', undefined, `Provide at least one element`);
  }

  /**
   * Create error for array too long
   */
  static arrayTooLong(parameter: string, length: number, maxLength: number): ValidationError {
    return new ValidationError(
      parameter,
      `Array has ${String(length)} elements, maximum is ${String(maxLength)}`,
      { length, maxLength },
      `Reduce array to ${String(maxLength)} or fewer elements`
    );
  }
}

/**
 * Validate that a value is a string
 */
export const validateString = (parameter: string, value: unknown, required = true): string | undefined => {
  if (value === undefined || value === null) {
    if (required) {
      throw ValidationError.missingRequired(parameter);
    }
    return undefined;
  }

  if (typeof value !== 'string') {
    throw ValidationError.wrongType(parameter, 'string', typeof value);
  }

  return value;
};

/**
 * Validate that a value is a non-empty string
 */
export const validateNonEmptyString = (parameter: string, value: unknown, required = true): string | undefined => {
  const str = validateString(parameter, value, required);

  if (str?.trim().length === 0) {
    throw new ValidationError(parameter, 'String cannot be empty', undefined, 'Provide a non-empty string');
  }

  return str;
};

/**
 * Validate that a value is a number
 */
export const validateNumber = (parameter: string, value: unknown, required = true): number | undefined => {
  if (value === undefined || value === null) {
    if (required) {
      throw ValidationError.missingRequired(parameter);
    }
    return undefined;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw ValidationError.wrongType(parameter, 'number', typeof value);
  }

  return value;
};

/**
 * Validate that a number is within a range (inclusive)
 */
export const validateNumberInRange = (
  parameter: string,
  value: unknown,
  min: number,
  max: number,
  required = true
): number | undefined => {
  const num = validateNumber(parameter, value, required);

  if (num !== undefined && (num < min || num > max)) {
    throw ValidationError.outOfRange(parameter, num, min, max);
  }

  return num;
};

/**
 * Validate that a value is an integer
 */
export const validateInteger = (parameter: string, value: unknown, required = true): number | undefined => {
  const num = validateNumber(parameter, value, required);

  if (num !== undefined && !Number.isInteger(num)) {
    throw new ValidationError(parameter, 'Must be an integer', { value: num }, 'Provide an integer value');
  }

  return num;
};

/**
 * Validate that a value is a boolean
 */
export const validateBoolean = (parameter: string, value: unknown, required = true): boolean | undefined => {
  if (value === undefined || value === null) {
    if (required) {
      throw ValidationError.missingRequired(parameter);
    }
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw ValidationError.wrongType(parameter, 'boolean', typeof value);
  }

  return value;
};

/**
 * Validate that a value is an array
 */
export const validateArray = (parameter: string, value: unknown, required = true): unknown[] | undefined => {
  if (value === undefined || value === null) {
    if (required) {
      throw ValidationError.missingRequired(parameter);
    }
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw ValidationError.wrongType(parameter, 'array', typeof value);
  }

  return value as unknown[];
};

/**
 * Validate that an array is non-empty
 */
export const validateNonEmptyArray = (parameter: string, value: unknown, required = true): unknown[] | undefined => {
  const arr = validateArray(parameter, value, required);

  if (arr?.length === 0) {
    throw ValidationError.emptyArray(parameter);
  }

  return arr;
};

/**
 * Validate that an array length is within a range
 */
export const validateArrayLength = (
  parameter: string,
  value: unknown,
  minLength: number,
  maxLength: number,
  required = true
): unknown[] | undefined => {
  const arr = validateArray(parameter, value, required);

  if (arr !== undefined) {
    if (arr.length < minLength) {
      throw new ValidationError(
        parameter,
        `Array must have at least ${String(minLength)} elements`,
        { length: arr.length, minLength },
        `Add ${String(minLength - arr.length)} more elements`
      );
    }

    if (arr.length > maxLength) {
      throw ValidationError.arrayTooLong(parameter, arr.length, maxLength);
    }
  }

  return arr;
};

/**
 * Validate that a value is one of allowed enum values
 */
export const validateEnum = <T extends string>(
  parameter: string,
  value: unknown,
  allowed: readonly T[],
  required = true
): T | undefined => {
  const str = validateString(parameter, value, required);

  if (str !== undefined && !allowed.includes(str as T)) {
    throw ValidationError.invalidEnum(parameter, str, [...allowed]);
  }

  return str as T | undefined;
};

/**
 * Validate that a value is an object
 */
export const validateObject = (
  parameter: string,
  value: unknown,
  required = true
): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) {
    if (required) {
      throw ValidationError.missingRequired(parameter);
    }
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw ValidationError.wrongType(parameter, 'object', Array.isArray(value) ? 'array' : typeof value);
  }

  return value as Record<string, unknown>;
};

/**
 * Validate a threshold value (0.0 to 1.0)
 */
export const validateThreshold = (parameter: string, value: unknown, required = true): number | undefined => {
  return validateNumberInRange(parameter, value, 0.0, 1.0, required);
};

/**
 * Validate max_files parameter (1-50)
 */
export const validateMaxFiles = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('max_files', value, 1, 50, required);
};

/**
 * Validate max_snippets parameter (1-100)
 */
export const validateMaxSnippets = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('max_snippets', value, 1, 100, required);
};

/**
 * Validate import_depth parameter (1-3)
 */
export const validateImportDepth = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('import_depth', value, 1, 3, required);
};

/**
 * Validate dependency_depth parameter (1-5)
 */
export const validateDependencyDepth = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('dependency_depth', value, 1, 5, required);
};

/**
 * Validate max_results parameter (1-100)
 */
export const validateMaxResults = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('max_results', value, 1, 100, required);
};

/**
 * Validate file_path parameter
 */
export const validateFilePath = (value: unknown, required = true): string | undefined => {
  const path = validateNonEmptyString('file_path', value, required);

  if (path !== undefined && !path.startsWith('/')) {
    throw new ValidationError(
      'file_path',
      'Must be an absolute path',
      { path },
      'Provide an absolute file path starting with /'
    );
  }

  return path;
};

/**
 * Validate repo_id parameter
 */
export const validateRepoId = (value: unknown, required = true): string | undefined => {
  return validateNonEmptyString('repo_id', value, required);
};

/**
 * Validate repo_path parameter
 */
export const validateRepoPath = (value: unknown, required = true): string | undefined => {
  const path = validateNonEmptyString('repo_path', value, required);

  if (path !== undefined && !path.startsWith('/')) {
    throw new ValidationError(
      'repo_path',
      'Must be an absolute path',
      { path },
      'Provide an absolute directory path starting with /'
    );
  }

  return path;
};

/**
 * Validate symbol_name parameter
 */
export const validateSymbolName = (value: unknown, required = true): string | undefined => {
  return validateNonEmptyString('symbol_name', value, required);
};

/**
 * Validate query parameter
 */
export const validateQuery = (value: unknown, required = true): string | undefined => {
  const query = validateNonEmptyString('query', value, required);

  if (query !== undefined && query.length < 2) {
    throw new ValidationError(
      'query',
      'Query must be at least 2 characters',
      { length: query.length },
      'Provide a longer search query'
    );
  }

  return query;
};

/**
 * Validate scope filter parameter
 */
export const validateScopeFilter = (value: unknown, required = false): 'all' | 'exported' | 'internal' | undefined => {
  return validateEnum('scope_filter', value, ['all', 'exported', 'internal'] as const, required);
};

/**
 * Validate repo_type parameter
 */
export const validateRepoType = (
  value: unknown,
  required = false
): 'monolithic' | 'microservice' | 'monorepo' | 'library' | 'reference' | 'documentation' | undefined => {
  return validateEnum(
    'repo_type',
    value,
    ['monolithic', 'microservice', 'monorepo', 'library', 'reference', 'documentation'] as const,
    required
  );
};

/**
 * Validate service_type parameter
 */
export const validateServiceType = (
  value: unknown,
  required = false
): 'rest' | 'graphql' | 'grpc' | 'other' | undefined => {
  return validateEnum('service_type', value, ['rest', 'graphql', 'grpc', 'other'] as const, required);
};

/**
 * Validate API types array
 */
export const validateApiTypes = (value: unknown, required = false): ('rest' | 'graphql' | 'grpc')[] | undefined => {
  const arr = validateArray('api_types', value, required) as string[] | undefined;

  if (arr !== undefined) {
    const allowedTypes = ['rest', 'graphql', 'grpc'] as const;
    for (const type of arr) {
      if (!allowedTypes.includes(type as 'rest' | 'graphql' | 'grpc')) {
        throw ValidationError.invalidEnum('api_types', type, [...allowedTypes]);
      }
    }
    return arr as ('rest' | 'graphql' | 'grpc')[];
  }

  return undefined;
};

/**
 * Validate languages array
 */
export const validateLanguages = (value: unknown, required = false): string[] | undefined => {
  return validateArray('languages', value, required) as string[] | undefined;
};

/**
 * Validate workspace_id parameter
 */
export const validateWorkspaceId = (value: unknown, required = false): string | undefined => {
  return validateNonEmptyString('workspace_id', value, required);
};

/**
 * Validate service_id parameter
 */
export const validateServiceId = (value: unknown, required = false): string | undefined => {
  return validateNonEmptyString('service_id', value, required);
};

/**
 * Validate package_name parameter
 */
export const validatePackageName = (value: unknown, required = false): string | undefined => {
  return validateNonEmptyString('package_name', value, required);
};

/**
 * Validate service_name parameter
 */
export const validateServiceName = (value: unknown, required = false): string | undefined => {
  return validateNonEmptyString('service_name', value, required);
};

/**
 * Validate endpoint_pattern parameter (regex pattern)
 */
export const validateEndpointPattern = (value: unknown, required = false): string | undefined => {
  const pattern = validateString('endpoint_pattern', value, required);

  if (pattern !== undefined) {
    try {
      new RegExp(pattern);
    } catch (error) {
      throw new ValidationError(
        'endpoint_pattern',
        'Invalid regular expression',
        { pattern, error: error instanceof Error ? error.message : String(error) },
        'Provide a valid regular expression pattern'
      );
    }
  }

  return pattern;
};

/**
 * Validate max_file_size parameter (in lines, 100-10000)
 */
export const validateMaxFileSize = (value: unknown, required = false): number | undefined => {
  return validateNumberInRange('max_file_size', value, 100, 10000, required);
};

/**
 * Validate summary_method parameter
 */
export const validateSummaryMethod = (value: unknown, required = false): 'llm' | 'rule-based' | undefined => {
  return validateEnum('summary_method', value, ['llm', 'rule-based'] as const, required);
};
