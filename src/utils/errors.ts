/**
 * Custom error classes for cindex MCP server
 * Each error includes user-friendly messages and suggested resolutions
 */

import { logger } from '@utils/logger';

/**
 * Base error class for cindex
 */
export class CindexError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get formatted error message for display
   */
  getFormattedMessage(): string {
    let msg = `[${this.code}] ${this.message}`;
    if (this.suggestion) {
      msg += `\n\nSuggestion: ${this.suggestion}`;
    }
    if (this.details) {
      const detailsStr = typeof this.details === 'string' ? this.details : JSON.stringify(this.details, null, 2);
      msg += `\n\nDetails: ${detailsStr}`;
    }
    return msg;
  }
}

/**
 * Configuration error - missing or invalid configuration
 */
export class ConfigurationError extends CindexError {
  constructor(message: string, details?: unknown, suggestion?: string) {
    super(message, 'CONFIG_ERROR', details, suggestion);
  }

  static missingRequired(variableName: string): ConfigurationError {
    return new ConfigurationError(
      `Missing required environment variable: ${variableName}`,
      { variable: variableName },
      `Set the ${variableName} environment variable in your MCP configuration.`
    );
  }

  static invalidValue(variableName: string, value: unknown, expected: string): ConfigurationError {
    return new ConfigurationError(
      `Invalid value for ${variableName}: ${String(value)}`,
      { variable: variableName, value, expected },
      `Expected ${expected}. Check your MCP configuration.`
    );
  }
}

/**
 * File system error - file access, reading, or parsing issues
 */
export class FileSystemError extends CindexError {
  constructor(message: string, details?: unknown, suggestion?: string) {
    super(message, 'FILE_SYSTEM_ERROR', details, suggestion);
  }
}

/**
 * Database connection error
 */
export class DatabaseConnectionError extends CindexError {
  constructor(message: string, details?: unknown, suggestion?: string) {
    super(message, 'DB_CONNECTION_ERROR', details, suggestion);
  }

  static cannotConnect(host: string, port: number, database: string, cause?: Error): DatabaseConnectionError {
    return new DatabaseConnectionError(
      `Cannot connect to PostgreSQL database '${database}' at ${host}:${String(port)}`,
      { host, port, database, cause: cause?.message },
      `Check that:\n1. PostgreSQL is running on ${host}:${String(port)}\n2. Database '${database}' exists (create with: createdb ${database})\n3. Credentials are correct (POSTGRES_USER, POSTGRES_PASSWORD)\n4. Firewall allows connections`
    );
  }
}

/**
 * Database not connected error
 */
export class DatabaseNotConnectedError extends CindexError {
  constructor(operation: string, context?: string) {
    super(
      `Database not connected${context ? ': ' + context : ''}`,
      'DB_NOT_CONNECTED',
      { operation, context },
      `Call connect() before attempting ${operation}. Ensure the database connection is established before performing any operations.`
    );
  }
}

/**
 * Database doesn't exist error
 */
export class DatabaseNotFoundError extends CindexError {
  constructor(database: string, host: string, port: number) {
    super(
      `Database '${database}' does not exist on ${host}:${String(port)}`,
      'DB_NOT_FOUND',
      { database, host, port },
      `Create the database:\n  createdb ${database}\n\nOr update POSTGRES_DB environment variable to use an existing database.`
    );
  }
}

/**
 * pgvector extension error
 */
export class VectorExtensionError extends CindexError {
  constructor(database: string, details?: unknown) {
    super(
      `pgvector extension is not installed in database '${database}'`,
      'PGVECTOR_NOT_FOUND',
      details,
      `Install the pgvector extension:\n  psql ${database} -c "CREATE EXTENSION vector;"\n\nMake sure pgvector is installed on your system:\n  sudo apt install postgresql-16-pgvector  # Debian/Ubuntu\n  brew install pgvector  # macOS`
    );
  }
}

/**
 * Vector dimension mismatch error
 */
export class VectorDimensionError extends CindexError {
  constructor(expected: number, actual: number, context: string) {
    super(
      `Vector dimension mismatch: expected ${String(expected)} but got ${String(actual)}`,
      'VECTOR_DIM_MISMATCH',
      { expected, actual, context },
      `The embedding model outputs ${String(actual)} dimensions, but the database expects ${String(expected)}.\n\nOptions:\n1. Update EMBEDDING_DIMENSIONS=${String(actual)} in your config\n2. Or rebuild database with vector(${String(actual)}) columns\n3. Or use a different embedding model that outputs ${String(expected)} dimensions`
    );
  }
}

/**
 * Database query error
 */
export class DatabaseQueryError extends CindexError {
  constructor(query: string, params: unknown[], cause: Error) {
    super(
      `Database query failed: ${cause.message}`,
      'DB_QUERY_ERROR',
      {
        query: query.slice(0, 200), // Truncate long queries
        params,
        cause: cause.message,
      },
      'Check the query syntax and parameters. See details above.'
    );
  }
}

/**
 * Ollama connection error
 */
export class OllamaConnectionError extends CindexError {
  constructor(host: string, cause?: Error) {
    super(
      `Cannot connect to Ollama at ${host}`,
      'OLLAMA_CONNECTION_ERROR',
      { host, cause: cause?.message },
      `Check that Ollama is running:\n  ollama serve\n\nOr update OLLAMA_HOST to point to your Ollama instance.`
    );
  }
}

/**
 * Ollama model not found error
 */
export class ModelNotFoundError extends CindexError {
  constructor(modelName: string, host: string) {
    super(
      `Model '${modelName}' not found on Ollama instance at ${host}`,
      'MODEL_NOT_FOUND',
      { model: modelName, host },
      `Pull the model:\n  ollama pull ${modelName}\n\nOr update your config to use an available model. List available models:\n  ollama list`
    );
  }
}

/**
 * Embedding generation error
 */
export class EmbeddingGenerationError extends CindexError {
  constructor(modelName: string, text: string, cause: Error) {
    super(
      `Failed to generate embedding with model '${modelName}'`,
      'EMBEDDING_ERROR',
      {
        model: modelName,
        textLength: text.length,
        cause: cause.message,
      },
      'Check that:\n1. The model is loaded correctly\n2. The input text is not too long\n3. Ollama has enough memory'
    );
  }
}

/**
 * Summary generation error
 */
export class SummaryGenerationError extends CindexError {
  constructor(modelName: string, file: string, cause: Error) {
    super(
      `Failed to generate summary for ${file} with model '${modelName}'`,
      'SUMMARY_ERROR',
      {
        model: modelName,
        file,
        cause: cause.message,
      },
      'Falling back to rule-based summary generation.'
    );
  }
}

/**
 * Request timeout error
 */
export class RequestTimeoutError extends CindexError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `${operation} timed out after ${String(timeoutMs)}ms`,
      'TIMEOUT_ERROR',
      { operation, timeoutMs },
      `Increase the timeout in your configuration or check that the service is responding.`
    );
  }
}

/**
 * Check if error is a retriable error (transient failure)
 */
export const isRetriableError = (error: Error): boolean => {
  const retriableCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];

  return (
    retriableCodes.some((code) => error.message.toLowerCase().includes(code.toLowerCase())) ||
    error instanceof RequestTimeoutError ||
    error instanceof OllamaConnectionError
  );
};

/**
 * Retry an async operation with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  operationName: string
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !isRetriableError(lastError)) {
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn(
        `[RETRY] ${operationName} failed (attempt ${String(attempt + 1)}/${String(maxRetries)}), retrying in ${String(delayMs)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!lastError) {
    throw new Error(`${operationName} failed with no error captured`);
  }
  throw lastError;
};
