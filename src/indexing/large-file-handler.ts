/**
 * Large File Handler Module
 *
 * Handles large files, generated files, and minified code during indexing.
 * Implements intelligent strategies to avoid performance issues and embedding pollution.
 *
 * Key Features:
 * - Detect generated/minified files (skip or use structure-only indexing)
 * - Binary file detection and skipping
 * - Structure-only indexing for very large files (>5000 lines)
 * - Section-based chunking for large files (1000-5000 lines)
 * - Normal chunking for small files (<1000 lines)
 *
 * Performance Target: Handle 10k+ line files without memory issues
 */

import { readFile } from 'node:fs/promises';

import { logger } from '@utils/logger';
import { type DiscoveredFile } from '@/types/indexing';

/**
 * File size category for indexing strategy selection
 */
export type FileSizeCategory = 'small' | 'large' | 'very-large';

/**
 * File type detection result
 */
export type FileType = 'normal' | 'generated' | 'minified' | 'binary';

/**
 * Large file handling strategy
 */
export interface LargeFileStrategy {
  category: FileSizeCategory;
  fileType: FileType;
  shouldIndex: boolean;
  useStructureOnly: boolean; // Only extract structure (imports, exports, top-level declarations)
  reason?: string; // Why this strategy was chosen
}

/**
 * Structure-only metadata (for very large files)
 */
export interface StructureOnlyMetadata {
  imports: string[];
  exports: string[];
  topLevelDeclarations: string[]; // Function/class names
  totalLines: number;
}

/**
 * File size thresholds (lines)
 */
const SIZE_THRESHOLDS = {
  SMALL: 1000, // <1000 lines: normal chunking
  LARGE: 5000, // 1000-5000 lines: section-based chunking
  VERY_LARGE: 5000, // >5000 lines: structure-only indexing
} as const;

/**
 * Binary file detection patterns
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.webp',
  // Videos
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  // Audio
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  // Executables
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  // Fonts
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  // Other binary
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

/**
 * Generated file detection patterns
 */
const GENERATED_FILE_PATTERNS = [
  // Build output
  /\.bundle\.js$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.chunk\.js$/,
  /\.map$/,
  /\.d\.ts$/,
  // Generated code
  /\.generated\./,
  /_generated\./,
  /\.proto\.js$/,
  /\.proto\.ts$/,
  // Package lock files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  // Build directories (should be filtered earlier, but double-check)
  /\/dist\//,
  /\/build\//,
  /\/out\//,
  /\/\.next\//,
  /\/node_modules\//,
];

/**
 * Minified code detection patterns
 */
const MINIFIED_PATTERNS = {
  // Very long lines (>500 chars is suspicious)
  LONG_LINE_THRESHOLD: 500,
  MAX_LONG_LINES: 5, // If >5 lines exceed threshold, likely minified

  // Low average line length variance (minified code is uniform)
  MIN_VARIANCE_THRESHOLD: 10,

  // High character density (few spaces)
  MIN_SPACE_RATIO: 0.05, // Less than 5% spaces is suspicious
};

/**
 * Check if file is binary by extension
 *
 * Fast check before attempting to read file content.
 *
 * @param filePath - File path to check
 * @returns True if file is binary
 */
export const isBinaryFile = (filePath: string): boolean => {
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
};

/**
 * Check if file is generated code
 *
 * Detects build output, generated code, lock files, etc.
 *
 * @param filePath - File path to check
 * @returns True if file is generated
 */
export const isGeneratedFile = (filePath: string): boolean => {
  return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
};

/**
 * Detect minified code by analyzing content
 *
 * Uses heuristics:
 * - Very long lines (>500 chars)
 * - Low line length variance (uniform length)
 * - Low space ratio (few spaces)
 *
 * @param content - File content
 * @returns True if content appears minified
 */
export const isMinifiedCode = (content: string): boolean => {
  const lines = content.split('\n');
  if (lines.length < 10) return false; // Too small to detect

  // Check 1: Count very long lines
  const longLines = lines.filter((line) => line.length > MINIFIED_PATTERNS.LONG_LINE_THRESHOLD).length;
  if (longLines > MINIFIED_PATTERNS.MAX_LONG_LINES) {
    return true; // Multiple very long lines = minified
  }

  // Check 2: Calculate line length variance
  const lineLengths = lines.map((line) => line.length);
  const avgLength = lineLengths.reduce((sum, len) => sum + len, 0) / lineLengths.length;
  const variance = lineLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lineLengths.length;

  if (variance < MINIFIED_PATTERNS.MIN_VARIANCE_THRESHOLD) {
    return true; // Very uniform line length = minified
  }

  // Check 3: Calculate space ratio
  const totalChars = content.length;
  const spaces = (content.match(/ /g) ?? []).length;
  const spaceRatio = spaces / totalChars;

  if (spaceRatio < MINIFIED_PATTERNS.MIN_SPACE_RATIO) {
    return true; // Very few spaces = minified
  }

  return false;
};

/**
 * Determine file type (normal, generated, minified, binary)
 *
 * @param file - Discovered file
 * @param content - File content (if available)
 * @returns File type
 */
export const detectFileType = (file: DiscoveredFile, content?: string): FileType => {
  // Check 1: Binary file (by extension)
  if (isBinaryFile(file.absolute_path)) {
    return 'binary';
  }

  // Check 2: Generated file (by path patterns)
  if (isGeneratedFile(file.relative_path)) {
    return 'generated';
  }

  // Check 3: Minified code (by content analysis)
  if (content && isMinifiedCode(content)) {
    return 'minified';
  }

  return 'normal';
};

/**
 * Determine file size category
 *
 * @param lineCount - Number of lines in file
 * @returns File size category
 */
export const categorizeFileSize = (lineCount: number): FileSizeCategory => {
  if (lineCount < SIZE_THRESHOLDS.SMALL) {
    return 'small';
  } else if (lineCount < SIZE_THRESHOLDS.LARGE) {
    return 'large';
  } else {
    return 'very-large';
  }
};

/**
 * Determine large file handling strategy
 *
 * Decision tree:
 * 1. Binary files → skip (shouldIndex = false)
 * 2. Generated files → skip or structure-only (configurable)
 * 3. Minified files → skip (low semantic value)
 * 4. Very large files (>5000 lines) → structure-only
 * 5. Large files (1000-5000 lines) → section-based chunking
 * 6. Small files (&lt;1000 lines) → normal chunking
 *
 * @param file - Discovered file
 * @param content - File content (optional, for minification detection)
 * @returns Indexing strategy
 */
export const determineLargeFileStrategy = (file: DiscoveredFile, content?: string): LargeFileStrategy => {
  const fileType = detectFileType(file, content);
  const category = categorizeFileSize(file.line_count);

  // Binary files: skip
  if (fileType === 'binary') {
    return {
      category,
      fileType,
      shouldIndex: false,
      useStructureOnly: false,
      reason: 'Binary file',
    };
  }

  // Generated files: skip (low semantic value for RAG)
  if (fileType === 'generated') {
    return {
      category,
      fileType,
      shouldIndex: false,
      useStructureOnly: false,
      reason: 'Generated file (build output, lock file, etc.)',
    };
  }

  // Minified files: skip (low semantic value)
  if (fileType === 'minified') {
    return {
      category,
      fileType,
      shouldIndex: false,
      useStructureOnly: false,
      reason: 'Minified code',
    };
  }

  // Very large files: structure-only indexing
  if (category === 'very-large') {
    return {
      category,
      fileType,
      shouldIndex: true,
      useStructureOnly: true,
      reason: `Large file (${file.line_count.toLocaleString()} lines) - using structure-only indexing`,
    };
  }

  // Large files: section-based chunking (handled by chunker)
  if (category === 'large') {
    return {
      category,
      fileType,
      shouldIndex: true,
      useStructureOnly: false,
      reason: `Large file (${file.line_count.toLocaleString()} lines) - using section-based chunking`,
    };
  }

  // Small files: normal chunking
  return {
    category,
    fileType,
    shouldIndex: true,
    useStructureOnly: false,
  };
};

/**
 * Extract structure-only metadata (for very large files)
 *
 * Extracts:
 * - Import statements
 * - Export statements
 * - Top-level function/class declarations
 *
 * Does NOT parse full syntax tree (too expensive for large files).
 * Uses regex-based extraction for performance.
 *
 * @param content - File content
 * @returns Structure metadata
 */
export const extractStructureOnlyMetadata = (content: string): StructureOnlyMetadata => {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const topLevelDeclarations: string[] = [];

  // Regex patterns for common syntax (TypeScript, JavaScript, Python, etc.)
  const importPatterns = [
    /^import\s+.*\s+from\s+['"](.+)['"]/,
    /^import\s+['"](.+)['"]/,
    /^from\s+(.+)\s+import\s+/,
    /^require\(['"](.+)['"]\)/,
  ];

  const exportPatterns = [
    /^export\s+(default\s+)?(class|function|const|let|var|interface|type)\s+(\w+)/,
    /^export\s+\{([^}]+)\}/,
    /^module\.exports\s*=/,
  ];

  const declarationPatterns = [
    /^(export\s+)?(default\s+)?(class|function|const|let|var|interface|type|enum)\s+(\w+)/,
    /^def\s+(\w+)/,
    /^class\s+(\w+)/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract imports
    for (const pattern of importPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        imports.push(match[1]);
        break;
      }
    }

    // Extract exports
    for (const pattern of exportPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        if (match[3]) {
          exports.push(match[3]);
        } else if (match[1]) {
          exports.push(match[1].trim());
        }
        break;
      }
    }

    // Extract top-level declarations
    for (const pattern of declarationPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const name = match[4] || match[1];
        if (name) {
          topLevelDeclarations.push(name);
        }
        break;
      }
    }
  }

  return {
    imports: [...new Set(imports)], // Deduplicate
    exports: [...new Set(exports)],
    topLevelDeclarations: [...new Set(topLevelDeclarations)],
    totalLines: lines.length,
  };
};

/**
 * Check if file should be indexed
 *
 * Convenience function that determines strategy and returns shouldIndex.
 *
 * @param file - Discovered file
 * @param content - File content (optional)
 * @returns True if file should be indexed
 */
export const shouldIndexFile = (file: DiscoveredFile, content?: string): boolean => {
  const strategy = determineLargeFileStrategy(file, content);

  if (!strategy.shouldIndex && strategy.reason) {
    logger.debug('Skipping file', {
      file: file.relative_path,
      reason: strategy.reason,
      fileType: strategy.fileType,
      lines: file.line_count,
    });
  }

  return strategy.shouldIndex;
};

/**
 * Read file content safely with error handling
 *
 * Handles encoding errors and returns undefined if file cannot be read.
 *
 * @param absolutePath - Absolute file path
 * @returns File content or undefined if error
 */
export const readFileContentSafely = async (absolutePath: string): Promise<string | undefined> => {
  try {
    return await readFile(absolutePath, 'utf-8');
  } catch (error) {
    logger.warn('Failed to read file content', {
      file: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};
