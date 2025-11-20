/**
 * Structured logging utility for cindex MCP server
 * Outputs to stderr following MCP conventions
 */

import chalk from 'chalk';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Log context metadata
 */
export type LogContext = Record<string, unknown>;

/**
 * Logger configuration
 */
interface LoggerConfig {
  level: LogLevel;
  enableColors: boolean;
  enableTimestamps: boolean;
}

/**
 * Log level priorities for filtering
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Logger class with structured logging support
 *
 * Features:
 * - Configurable log levels with filtering
 * - Colored output for better readability
 * - Structured context metadata
 * - Specialized methods for common patterns (startup, health checks)
 * - Outputs to stderr following MCP conventions
 */
class Logger {
  private config: LoggerConfig = {
    level: 'INFO',
    enableColors: true,
    enableTimestamps: true,
  };

  /**
   * Set minimum log level for filtering
   *
   * @param level - Minimum level to log (DEBUG, INFO, WARN, ERROR)
   */
  setLevel = (level: LogLevel): void => {
    this.config.level = level;
  };

  /**
   * Enable or disable colored output
   *
   * @param enabled - True to enable colors, false for plain text
   */
  setColors = (enabled: boolean): void => {
    this.config.enableColors = enabled;
  };

  /**
   * Enable or disable timestamps in log output
   *
   * @param enabled - True to include timestamps
   */
  setTimestamps = (enabled: boolean): void => {
    this.config.enableTimestamps = enabled;
  };

  /**
   * Check if a log level should be logged based on configured minimum level
   *
   * @param level - Log level to check
   * @returns True if level should be logged
   */
  private shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  };

  /**
   * Format current timestamp as ISO 8601 string
   *
   * @returns ISO formatted timestamp
   */
  private formatTimestamp = (): string => {
    return new Date().toISOString();
  };

  /**
   * Apply color to log level based on severity
   *
   * @param level - Log level
   * @returns Colorized level string (or plain if colors disabled)
   */
  private colorizeLevel = (level: LogLevel): string => {
    if (!this.config.enableColors) {
      return level;
    }

    switch (level) {
      case 'DEBUG':
        return chalk.gray(level);
      case 'INFO':
        return chalk.blue(level);
      case 'WARN':
        return chalk.yellow(level);
      case 'ERROR':
        return chalk.red(level);
    }
  };

  /**
   * Format complete log message with timestamp, level, message, and context
   *
   * Format: "TIMESTAMP LEVEL message {context}"
   *
   * @param level - Log level
   * @param message - Log message
   * @param context - Optional structured context metadata
   * @returns Formatted log string
   */
  private formatMessage = (level: LogLevel, message: string, context?: LogContext): string => {
    const parts: string[] = [];

    // Timestamp
    if (this.config.enableTimestamps) {
      parts.push(chalk.gray(this.formatTimestamp()));
    }

    // Level
    parts.push(this.colorizeLevel(level));

    // Message
    parts.push(message);

    // Context
    if (context && Object.keys(context).length > 0) {
      const contextStr = JSON.stringify(context);
      parts.push(chalk.gray(contextStr));
    }

    return parts.join(' ');
  };

  /**
   * Write formatted log message to stderr
   *
   * @param level - Log level
   * @param message - Log message
   * @param context - Optional context metadata
   */
  private write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, message, context);
    console.error(formatted);
  };

  /**
   * Log debug message (lowest severity)
   *
   * @param message - Debug message
   * @param context - Optional context metadata
   */
  debug = (message: string, context?: LogContext): void => {
    this.write('DEBUG', message, context);
  };

  /**
   * Log info message (informational, not an issue)
   *
   * @param message - Info message
   * @param context - Optional context metadata
   */
  info = (message: string, context?: LogContext): void => {
    this.write('INFO', message, context);
  };

  /**
   * Log warning message (potential issue, but recoverable)
   *
   * @param message - Warning message
   * @param context - Optional context metadata
   */
  warn = (message: string, context?: LogContext): void => {
    this.write('WARN', message, context);
  };

  /**
   * Log error message (error condition)
   *
   * @param message - Error message
   * @param context - Optional context metadata
   */
  error = (message: string, context?: LogContext): void => {
    this.write('ERROR', message, context);
  };

  /**
   * Log error with full stack trace
   *
   * @param message - Error description
   * @param error - Error object with stack trace
   * @param context - Optional additional context
   */
  errorWithStack = (message: string, error: Error, context?: LogContext): void => {
    this.error(message, {
      ...context,
      error: error.message,
      stack: error.stack,
    });
  };

  /**
   * Log server startup message with ASCII banner
   *
   * @param config - Startup configuration (version, models)
   */
  startup = (config: { version: string; models: string[] }): void => {
    if (!this.shouldLog('INFO')) {
      return;
    }

    const banner = `
TPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPW
Q                    cindex MCP Server                     Q
Q          Semantic Code Search & Context Retrieval        Q
ZPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP]
`;

    console.error(chalk.cyan(banner));
    this.info(`Version: ${config.version}`);
    this.info(`Embedding Model: ${config.models[0]}`);
    this.info(`Summary Model: ${config.models[1]}`);
    this.info('Server starting...');
  };

  /**
   * Log graceful shutdown message
   */
  shutdown = (): void => {
    this.info('Server shutting down gracefully...');
  };

  /**
   * Log successful service connection
   *
   * @param service - Service name (e.g., "PostgreSQL", "Ollama")
   * @param details - Optional connection details
   */
  connected = (service: string, details?: LogContext): void => {
    this.info(`Connected to ${service}`, details);
  };

  /**
   * Log health check result
   *
   * @param service - Service name
   * @param status - Health check status (OK or FAILED)
   * @param details - Optional details about the check
   */
  healthCheck = (service: string, status: 'OK' | 'FAILED', details?: LogContext): void => {
    if (status === 'OK') {
      this.info(`Health check: ${service} OK`, details);
    } else {
      this.error(`Health check: ${service} FAILED`, details);
    }
  };
}

/**
 * Singleton logger instance for application-wide logging
 */
export const logger = new Logger();

/**
 * Initialize logger with log level
 *
 * @param level - Minimum log level (default: INFO)
 */
export const initLogger = (level: LogLevel = 'INFO'): void => {
  logger.setLevel(level);
};
