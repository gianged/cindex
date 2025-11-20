/**
 * Edge Case Handler Module
 *
 * Comprehensive error handling for edge cases during indexing and retrieval.
 * Ensures robust operation even with malformed code, encoding issues, and circular dependencies.
 *
 * Key Features:
 * - Circular import detection and prevention
 * - Malformed code handling with graceful degradation
 * - Encoding detection and conversion
 * - Tree-sitter parsing fallback strategies
 * - Memory leak prevention
 * - Timeout handling for long-running operations
 *
 * Performance Target: Handle edge cases without crashing or hanging
 */

import { logger } from '@utils/logger';
import { type DiscoveredFile } from '@/types/indexing';

/**
 * Circular dependency tracker for import chain traversal
 *
 * Maintains two data structures:
 * - visitedPaths: All files visited during traversal (Set)
 * - currentPath: Current import chain being traversed (Array/Stack)
 *
 * Used to prevent infinite loops when following import chains.
 */
export class CircularDependencyTracker {
  private visitedPaths = new Set<string>();
  private currentPath: string[] = [];

  /**
   * Check if path would create a circular dependency
   *
   * @param filePath - File path to check
   * @returns True if circular dependency detected
   */
  isCircular = (filePath: string): boolean => {
    return this.currentPath.includes(filePath);
  };

  /**
   * Enter a file path (mark as visiting)
   *
   * @param filePath - File path to enter
   * @returns True if successfully entered (not circular)
   */
  enter = (filePath: string): boolean => {
    if (this.isCircular(filePath)) {
      logger.warn('Circular dependency detected', {
        filePath,
        importChain: [...this.currentPath, filePath],
      });
      return false;
    }

    this.currentPath.push(filePath);
    this.visitedPaths.add(filePath);
    return true;
  };

  /**
   * Exit a file path (mark as visited)
   *
   * @param filePath - File path to exit
   */
  exit = (filePath: string): void => {
    const index = this.currentPath.lastIndexOf(filePath);
    if (index !== -1) {
      this.currentPath.splice(index, 1);
    }
  };

  /**
   * Check if path has been visited
   *
   * @param filePath - File path to check
   * @returns True if visited
   */
  hasVisited = (filePath: string): boolean => {
    return this.visitedPaths.has(filePath);
  };

  /**
   * Get current import chain
   *
   * @returns Current import chain
   */
  getImportChain = (): string[] => {
    return [...this.currentPath];
  };

  /**
   * Reset tracker (for new traversal)
   */
  reset = (): void => {
    this.visitedPaths.clear();
    this.currentPath = [];
  };

  /**
   * Get traversal statistics
   *
   * @returns Traversal stats
   */
  getStats = (): { visitedFiles: number; currentDepth: number } => {
    return {
      visitedFiles: this.visitedPaths.size,
      currentDepth: this.currentPath.length,
    };
  };
}

/**
 * Encoding detection result
 */
export interface EncodingDetectionResult {
  encoding: string;
  confidence: number; // 0-1
  hasInvalidChars: boolean;
}

/**
 * Detect file encoding using BOM and heuristics
 *
 * Detection strategy:
 * 1. Check for BOM (Byte Order Mark) - most reliable
 * 2. Check for null bytes (indicates UTF-16 or binary)
 * 3. Try UTF-8 decoding (default for text files)
 * 4. Fall back to Latin1 if UTF-8 fails
 *
 * Supported encodings:
 * - UTF-8 (with or without BOM)
 * - UTF-16 (LE/BE)
 * - ISO-8859-1 (Latin1)
 * - Binary (detected, not decoded)
 *
 * @param buffer - File buffer to analyze
 * @returns Encoding detection result with confidence score
 */
export const detectEncoding = (buffer: Buffer): EncodingDetectionResult => {
  // Step 1: Check for BOM (Byte Order Mark) - 100% confidence
  if (buffer.length >= 3) {
    // UTF-8 BOM: EF BB BF
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { encoding: 'utf-8', confidence: 1.0, hasInvalidChars: false };
    }
  }

  if (buffer.length >= 2) {
    // UTF-16 LE BOM: FF FE
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { encoding: 'utf-16le', confidence: 1.0, hasInvalidChars: false };
    }
    // UTF-16 BE BOM: FE FF
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return { encoding: 'utf-16be', confidence: 1.0, hasInvalidChars: false };
    }
  }

  // Step 2: No BOM found, use heuristics
  // Check for null bytes (0x00) - indicates UTF-16 or binary
  const hasNullBytes = buffer.includes(0x00);
  if (hasNullBytes) {
    // Check alternating null byte pattern (characteristic of UTF-16)
    let utf16LELikely = true; // Null bytes at odd positions
    let utf16BELikely = true; // Null bytes at even positions

    // Sample first 1000 bytes for performance
    for (let i = 0; i < Math.min(buffer.length, 1000); i += 2) {
      if (buffer[i] === 0x00 && buffer[i + 1] !== 0x00) {
        utf16BELikely = false;
      }
      if (buffer[i] !== 0x00 && buffer[i + 1] === 0x00) {
        utf16LELikely = false;
      }
    }

    if (utf16LELikely) {
      return { encoding: 'utf-16le', confidence: 0.8, hasInvalidChars: false };
    }
    if (utf16BELikely) {
      return { encoding: 'utf-16be', confidence: 0.8, hasInvalidChars: false };
    }

    // Has null bytes but not UTF-16 pattern: likely binary file
    return { encoding: 'binary', confidence: 0.9, hasInvalidChars: true };
  }

  // Step 3: Try UTF-8 decoding (most common for text files)
  const content = buffer.toString('utf-8');
  const hasInvalidChars = content.includes('\ufffd'); // U+FFFD replacement character

  if (!hasInvalidChars) {
    return { encoding: 'utf-8', confidence: 0.95, hasInvalidChars: false };
  }

  // Step 4: UTF-8 failed, try Latin1 (ISO-8859-1)
  const latin1Content = buffer.toString('latin1');
  const validLatin1 = !latin1Content.includes('\ufffd');

  if (validLatin1) {
    return { encoding: 'latin1', confidence: 0.7, hasInvalidChars: false };
  }

  // Fallback: UTF-8 with invalid characters (may be corrupted)
  return { encoding: 'utf-8', confidence: 0.5, hasInvalidChars: true };
};

/**
 * Parse error types
 */
export type ParseErrorType =
  | 'syntax-error'
  | 'timeout'
  | 'encoding-error'
  | 'memory-limit'
  | 'tree-sitter-crash'
  | 'unknown';

/**
 * Parse error context
 */
export interface ParseErrorContext {
  type: ParseErrorType;
  message: string;
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
  originalError?: Error;
}

/**
 * Create parse error context
 *
 * @param type - Error type
 * @param message - Error message
 * @param filePath - File path
 * @param error - Original error (optional)
 * @returns Parse error context
 */
export const createParseError = (
  type: ParseErrorType,
  message: string,
  filePath: string,
  error?: Error
): ParseErrorContext => {
  return {
    type,
    message,
    filePath,
    originalError: error,
  };
};

/**
 * Handle tree-sitter parsing error
 *
 * Implements fallback strategies:
 * 1. Try regex-based chunking
 * 2. Extract structure-only (imports/exports)
 * 3. Skip file if all strategies fail
 *
 * @param error - Parse error context
 * @param content - File content
 * @returns Fallback strategy result
 */
export const handleTreeSitterError = (
  error: ParseErrorContext,
  _content: string
): { useFallback: boolean; reason: string } => {
  logger.warn('Tree-sitter parsing failed', {
    file: error.filePath,
    errorType: error.type,
    message: error.message,
  });

  // Strategy: Use regex-based fallback for all parsing errors
  return {
    useFallback: true,
    reason: `Tree-sitter parsing failed (${error.type}): ${error.message}`,
  };
};

/**
 * Memory usage tracker for detecting memory leaks
 *
 * Periodically samples heap usage and tracks high water mark.
 * Logs warnings if memory usage exceeds 1GB threshold.
 */
export class MemoryTracker {
  private highWaterMark = 0;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Start monitoring memory usage at regular intervals
   *
   * @param intervalMs - Check interval in milliseconds (default: 5000)
   */
  start = (intervalMs = 5000): void => {
    this.checkInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsed = memUsage.heapUsed;

      // Track peak memory usage
      if (heapUsed > this.highWaterMark) {
        this.highWaterMark = heapUsed;
      }

      // Warn if heap usage exceeds 1GB threshold
      if (heapUsed > 1024 * 1024 * 1024) {
        logger.warn('High memory usage detected', {
          heapUsedMB: Math.round(heapUsed / 1024 / 1024),
          highWaterMarkMB: Math.round(this.highWaterMark / 1024 / 1024),
        });
      }
    }, intervalMs);
  };

  /**
   * Stop monitoring memory usage
   */
  stop = (): void => {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  };

  /**
   * Get current memory usage
   *
   * @returns Memory usage in MB
   */
  getCurrentUsage = (): number => {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  };

  /**
   * Get high water mark
   *
   * @returns High water mark in MB
   */
  getHighWaterMark = (): number => {
    return Math.round(this.highWaterMark / 1024 / 1024);
  };

  /**
   * Reset high water mark
   */
  reset = (): void => {
    this.highWaterMark = 0;
  };
}

/**
 * Timeout handler for long-running operations
 *
 * @param promise - Promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Operation name for logging
 * @returns Promise result or timeout error
 */
export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs.toString()}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    throw error;
  }
};

/**
 * Safe operation wrapper
 *
 * Wraps an operation with error handling, timeout, and logging.
 *
 * @param operation - Operation to execute
 * @param operationName - Operation name for logging
 * @param options - Options (timeout, retries)
 * @returns Operation result or undefined on error
 */
export const safeOperation = async <T>(
  operation: () => Promise<T>,
  operationName: string,
  options: {
    timeoutMs?: number;
    retries?: number;
    fallbackValue?: T;
  } = {}
): Promise<T | undefined> => {
  const { timeoutMs = 30000, retries = 0, fallbackValue } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(operation(), timeoutMs, operationName);
      return result;
    } catch (error) {
      logger.error(`${operationName} failed (attempt ${(attempt + 1).toString()}/${(retries + 1).toString()})`, {
        error: error instanceof Error ? error.message : String(error),
      });

      if (attempt === retries) {
        // Final attempt failed
        if (fallbackValue !== undefined) {
          logger.warn(`${operationName} using fallback value`, { fallbackValue });
          return fallbackValue;
        }
        return undefined;
      }

      // Wait before retry (exponential backoff)
      const waitMs = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return undefined;
};

/**
 * Validate file for indexing safety
 *
 * Performs comprehensive validation to prevent issues:
 * - File size limits (prevents OOM)
 * - Control character detection (prevents binary files)
 * - Line length limits (prevents minified files)
 *
 * @param file - Discovered file metadata
 * @param content - File content (optional, for content-based checks)
 * @returns Validation result with reason for rejection
 */
export const validateFileForIndexing = (
  file: DiscoveredFile,
  content?: string
): { valid: boolean; reason?: string } => {
  // Check 1: File size (defense-in-depth, already checked by FileWalker)
  if (file.line_count > 10000) {
    return {
      valid: false,
      reason: `File too large (${file.line_count.toLocaleString()} lines exceeds 10,000 line limit)`,
    };
  }

  // Check 2: Content validation (if content provided)
  if (content) {
    // Check for suspicious control characters (indicates binary or corrupted file)
    const suspiciousPatterns = [
      // Control characters except: \n (0x0A), \t (0x09), \r (0x0D)
      // eslint-disable-next-line no-control-regex
      /[\x00-\x08\x0B\x0C\x0E-\x1F]/g,
    ];

    for (const pattern of suspiciousPatterns) {
      const matches = content.match(pattern);
      // Allow a few occurrences (false positives), but reject if excessive
      if (matches && matches.length > 10) {
        return {
          valid: false,
          reason: `File contains suspicious control characters (${matches.length.toString()} occurrences)`,
        };
      }
    }

    // Check for extremely long lines (indicates minified code or data files)
    const lines = content.split('\n');
    const veryLongLines = lines.filter((line) => line.length > 10000);
    if (veryLongLines.length > 0) {
      return {
        valid: false,
        reason: `File contains extremely long lines (${veryLongLines.length.toString()} lines exceed 10,000 chars)`,
      };
    }
  }

  return { valid: true };
};

/**
 * Error recovery strategies for malformed files
 *
 * Provides fallback mechanisms when standard parsing fails.
 */
export const errorRecoveryStrategies = {
  /**
   * Handle encoding errors by trying alternative encodings
   *
   * Attempts to decode buffer with multiple encodings until one succeeds.
   *
   * @param buffer - File buffer with encoding issues
   * @returns Decoded content or undefined if all encodings fail
   */
  handleEncodingError: (buffer: Buffer): string | undefined => {
    const encodings: BufferEncoding[] = ['utf-8', 'latin1', 'utf-16le'];

    for (const encoding of encodings) {
      try {
        const content = buffer.toString(encoding);
        if (!content.includes('\ufffd')) {
          logger.debug('Successfully decoded file with alternative encoding', { encoding });
          return content;
        }
      } catch {
        continue;
      }
    }

    logger.warn('Failed to decode file with any known encoding');
    return undefined;
  },

  /**
   * Extract minimal metadata from malformed files
   *
   * Uses regex patterns to detect if file contains code,
   * even when tree-sitter parsing fails.
   *
   * @param fileContent - File content to analyze
   * @returns Metadata with hasCode flag
   */
  extractMinimalMetadata: (fileContent: string): { hasCode: boolean; language?: string } => {
    // Simple heuristics to detect if file contains code
    const codePatterns = [
      /function\s+\w+/,
      /class\s+\w+/,
      /import\s+.+\s+from/,
      /def\s+\w+/,
      /public\s+(static\s+)?(void|int|string)/,
    ];

    const hasCode = codePatterns.some((pattern) => pattern.test(fileContent));

    return { hasCode };
  },

  /**
   * Clean malformed code by removing invalid characters
   *
   * Removes control characters that can break parsing,
   * while preserving valid whitespace.
   *
   * @param content - File content with invalid characters
   * @returns Cleaned content safe for parsing
   */
  cleanMalformedCode: (content: string): string => {
    // Remove null bytes (0x00)
    let cleaned = content.replace(/\0/g, '');

    // Remove control characters except: newline (0x0A), tab (0x09), carriage return (0x0D)
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    return cleaned;
  },
};
