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
 */
class Logger {
  private config: LoggerConfig = {
    level: 'INFO',
    enableColors: true,
    enableTimestamps: true,
  };

  /**
   * Set log level
   */
  setLevel = (level: LogLevel): void => {
    this.config.level = level;
  };

  /**
   * Enable/disable colored output
   */
  setColors = (enabled: boolean): void => {
    this.config.enableColors = enabled;
  };

  /**
   * Enable/disable timestamps
   */
  setTimestamps = (enabled: boolean): void => {
    this.config.enableTimestamps = enabled;
  };

  /**
   * Check if a log level should be logged
   */
  private shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  };

  /**
   * Format timestamp
   */
  private formatTimestamp = (): string => {
    return new Date().toISOString();
  };

  /**
   * Colorize log level
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
   * Format log message
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
   * Write log to stderr
   */
  private write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (!this.shouldLog(level)) {
      return;
    }

    const formatted = this.formatMessage(level, message, context);
    console.error(formatted);
  };

  /**
   * Log debug message
   */
  debug = (message: string, context?: LogContext): void => {
    this.write('DEBUG', message, context);
  };

  /**
   * Log info message
   */
  info = (message: string, context?: LogContext): void => {
    this.write('INFO', message, context);
  };

  /**
   * Log warning message
   */
  warn = (message: string, context?: LogContext): void => {
    this.write('WARN', message, context);
  };

  /**
   * Log error message
   */
  error = (message: string, context?: LogContext): void => {
    this.write('ERROR', message, context);
  };

  /**
   * Log error with stack trace
   */
  errorWithStack = (message: string, error: Error, context?: LogContext): void => {
    this.error(message, {
      ...context,
      error: error.message,
      stack: error.stack,
    });
  };

  /**
   * Log startup message with banner
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
   * Log shutdown message
   */
  shutdown = (): void => {
    this.info('Server shutting down gracefully...');
  };

  /**
   * Log connection established
   */
  connected = (service: string, details?: LogContext): void => {
    this.info(`Connected to ${service}`, details);
  };

  /**
   * Log health check
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
 * Singleton logger instance
 */
export const logger = new Logger();

/**
 * Initialize logger with configuration
 */
export const initLogger = (level: LogLevel = 'INFO'): void => {
  logger.setLevel(level);
};
