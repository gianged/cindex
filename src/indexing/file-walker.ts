/**
 * File Walker: Directory Traversal with Gitignore Support
 *
 * Recursively discovers code files in a repository with:
 * - .gitignore pattern application
 * - Binary and generated file exclusion
 * - SHA256 hash computation for incremental indexing
 * - Language detection by file extension
 * - Line counting and file statistics
 * - Multi-project context detection (repo_id, workspace_id, service_id)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import ignore, { type Ignore } from 'ignore';

import { FileSystemError } from '@utils/errors';
import { logger } from '@utils/logger';
import {
  Language,
  LANGUAGE_EXTENSIONS,
  type DiscoveredFile,
  type FileDiscoveryStats,
  type IndexingOptions,
} from '@/types/indexing';

/**
 * Binary file extensions to exclude from indexing
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.webp',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
]);

/**
 * Generated file patterns to exclude
 */
const GENERATED_FILE_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  '.min.js',
  '.bundle.js',
  '.min.css',
  '.map',
  '-min.js',
  '-bundle.js',
];

/**
 * Hardcoded directory exclusions (always ignored)
 */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  'env',
  '.venv',
  '.env',
  'target', // Rust
  'bin',
  'obj', // C#
  'vendor', // PHP/Go
  '.gradle',
  '.mvn',
  'bower_components',
]);

/**
 * Default indexing options
 */
const DEFAULT_OPTIONS: IndexingOptions = {
  include_markdown: false,
  max_file_size: 5000,
  chunk_size_min: 50,
  chunk_size_max: 500,
  enable_workspace_detection: false,
  enable_service_detection: false,
  enable_multi_repo: false,
  enable_api_endpoint_detection: false,
};

/**
 * File walker for code discovery
 */
export class FileWalker {
  private ignoreFilter: Ignore | null = null;
  private stats: FileDiscoveryStats = {
    total_files: 0,
    excluded_by_gitignore: 0,
    excluded_binary: 0,
    excluded_size: 0,
    files_by_language: {} as Record<Language, number>,
    total_lines: 0,
  };

  constructor(
    private readonly rootPath: string,
    options?: Partial<IndexingOptions>
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private readonly options: IndexingOptions;

  /**
   * Discover all indexable files in the repository
   */
  public discoverFiles = async (): Promise<DiscoveredFile[]> => {
    logger.info('Starting file discovery', {
      root: this.rootPath,
      options: this.options,
    });

    // Load .gitignore patterns
    await this.loadGitignore();

    // Recursively walk directory tree
    const files = await this.walkDirectory(this.rootPath);

    logger.info('File discovery complete', { ...this.stats });

    return files;
  };

  /**
   * Get file discovery statistics
   */
  public getStats = (): FileDiscoveryStats => {
    return { ...this.stats };
  };

  /**
   * Load and parse .gitignore file
   */
  private loadGitignore = async (): Promise<void> => {
    const gitignorePath = path.join(this.rootPath, '.gitignore');

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      this.ignoreFilter = ignore().add(content);
      logger.debug('Loaded .gitignore', { path: gitignorePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('No .gitignore found, using default exclusions only');
        this.ignoreFilter = ignore();
      } else {
        logger.warn('Error loading .gitignore', { error });
        this.ignoreFilter = ignore();
      }
    }
  };

  /**
   * Recursively walk directory tree
   */
  private walkDirectory = async (dirPath: string): Promise<DiscoveredFile[]> => {
    const files: DiscoveredFile[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);

        // Check if path is ignored by .gitignore
        if (this.isIgnored(relativePath)) {
          if (entry.isDirectory()) {
            logger.debug('Directory ignored by .gitignore', { path: relativePath });
          }
          this.stats.excluded_by_gitignore++;
          continue;
        }

        // Handle directories
        if (entry.isDirectory()) {
          // Skip excluded directories
          if (EXCLUDED_DIRECTORIES.has(entry.name)) {
            logger.debug('Skipping excluded directory', { name: entry.name });
            continue;
          }

          // Recursively walk subdirectory
          const subFiles = await this.walkDirectory(fullPath);
          files.push(...subFiles);
          continue;
        }

        // Handle files
        if (entry.isFile()) {
          const discoveredFile = await this.processFile(fullPath, relativePath);
          if (discoveredFile) {
            files.push(discoveredFile);
            this.stats.total_files++;
          }
        }
      }
    } catch (error) {
      throw new FileSystemError(`Failed to read directory: ${dirPath}`, error as Error);
    }

    return files;
  };

  /**
   * Check if path is ignored by .gitignore patterns
   */
  private isIgnored = (relativePath: string): boolean => {
    if (!this.ignoreFilter) {
      return false;
    }

    // Normalize path separators for ignore library (always use forward slashes)
    const normalizedPath = relativePath.split(path.sep).join('/');

    return this.ignoreFilter.ignores(normalizedPath);
  };

  /**
   * Process individual file and extract metadata
   */
  private processFile = async (absolutePath: string, relativePath: string): Promise<DiscoveredFile | null> => {
    const ext = path.extname(absolutePath).toLowerCase();
    const basename = path.basename(absolutePath);

    // Exclude binary files
    if (BINARY_EXTENSIONS.has(ext)) {
      logger.debug('Skipping binary file', { path: relativePath });
      this.stats.excluded_binary++;
      return null;
    }

    // Exclude generated files
    if (this.isGeneratedFile(basename)) {
      logger.debug('Skipping generated file', { path: relativePath });
      this.stats.excluded_binary++;
      return null;
    }

    // Detect language
    const language = this.detectLanguage(ext, basename);

    // Handle markdown files
    if (ext === '.md') {
      // Always include README.md at root
      const isRootReadme = basename.toLowerCase() === 'readme.md' && path.dirname(relativePath) === '.';

      if (!isRootReadme && !this.options.includeMarkdown) {
        logger.debug('Skipping markdown file', { path: relativePath });
        return null;
      }
    }

    // Skip unknown file types
    if (language === Language.Unknown && ext !== '.md') {
      logger.debug('Skipping unknown file type', { path: relativePath, ext });
      return null;
    }

    try {
      // Read file stats and content
      const stats = await fs.stat(absolutePath);
      const content = await fs.readFile(absolutePath, 'utf-8');

      // Count lines
      const lineCount = this.countLines(content);

      // Check file size limit (default: 5000 lines)
      const maxFileSize = this.options.maxFileSize ?? 5000;
      if (lineCount > maxFileSize) {
        logger.warn('Skipping large file', {
          path: relativePath,
          lines: lineCount,
          max: maxFileSize,
        });
        this.stats.excluded_size++;
        return null;
      }

      // Compute SHA256 hash for incremental indexing
      const fileHash = this.computeHash(content);

      // Update statistics
      this.stats.files_by_language[language] = (this.stats.files_by_language[language] || 0) + 1;
      this.stats.total_lines += lineCount;

      // Build discovered file metadata
      const discoveredFile: DiscoveredFile = {
        absolute_path: absolutePath,
        relative_path: relativePath,
        file_hash: fileHash,
        language,
        line_count: lineCount,
        file_size_bytes: stats.size,
        modified_time: stats.mtime,
        encoding: 'utf-8',
      };

      // Add multi-project context if enabled
      if (this.options.enable_multi_repo && this.options.repoId) {
        discoveredFile.repo_id = this.options.repoId;
      }

      logger.debug('File discovered', {
        path: relativePath,
        language,
        lines: lineCount,
        hash: fileHash.substring(0, 8),
      });

      return discoveredFile;
    } catch (error) {
      // Handle encoding errors (binary files misdetected as text)
      if ((error as Error).message.includes('invalid')) {
        logger.debug('Skipping file with encoding issues', { path: relativePath });
        this.stats.excluded_binary++;
        return null;
      }

      throw new FileSystemError(`Failed to process file: ${relativePath}`, error as Error);
    }
  };

  /**
   * Detect programming language from file extension
   */
  private detectLanguage = (ext: string, _basename: string): Language => {
    // Special case for markdown
    if (ext === '.md') {
      return Language.Unknown; // Markdown handled separately
    }

    return LANGUAGE_EXTENSIONS[ext] ?? Language.Unknown;
  };

  /**
   * Check if file is a generated/build artifact
   */
  private isGeneratedFile = (basename: string): boolean => {
    return GENERATED_FILE_PATTERNS.some((pattern) => basename.includes(pattern));
  };

  /**
   * Count lines in file content
   */
  private countLines = (content: string): number => {
    if (content.length === 0) {
      return 0;
    }

    // Count newlines + 1 (last line may not have newline)
    const lines = content.split('\n').length;
    return lines;
  };

  /**
   * Compute SHA256 hash of file content
   *
   * Used for incremental indexing - only re-index files with changed hashes
   */
  private computeHash = (content: string): string => {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  };
}

/**
 * Discover files in a repository (convenience function)
 *
 * @param rootPath - Absolute path to repository root
 * @param options - Indexing options
 * @returns Array of discovered files with metadata
 */
export const discoverFiles = async (
  rootPath: string,
  options?: Partial<IndexingOptions>
): Promise<DiscoveredFile[]> => {
  const walker = new FileWalker(rootPath, options as IndexingOptions);
  return walker.discoverFiles();
};

/**
 * Get file discovery statistics (convenience function)
 *
 * @param rootPath - Absolute path to repository root
 * @param options - Indexing options
 * @returns File discovery statistics
 */
export const getDiscoveryStats = async (
  rootPath: string,
  options?: Partial<IndexingOptions>
): Promise<FileDiscoveryStats> => {
  const walker = new FileWalker(rootPath, options as IndexingOptions);
  await walker.discoverFiles();
  return walker.getStats();
};
