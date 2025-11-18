/**
 * Semantic Chunker: Code Chunking Strategy
 *
 * Creates semantically meaningful code chunks for embedding:
 * - File summary chunks (first 100 lines or entire file)
 * - Import block chunks (all imports grouped)
 * - Function chunks (one per function with docstring)
 * - Class chunks (one per class with all methods)
 * - Top-level code blocks
 *
 * Handles size constraints, large files, and multi-project context tagging.
 */

import { v4 as uuidv4 } from 'uuid';

import { logger } from '@utils/logger';
import {
  ChunkType,
  NodeType,
  type ChunkingResult,
  type CodeChunkInput,
  type DiscoveredFile,
  type IndexingOptions,
  type ParseResult,
} from '@/types/indexing';

/**
 * Default chunk size constraints (in lines)
 */
const CHUNK_SIZE_MIN = 50;
const CHUNK_SIZE_MAX = 500;

/**
 * File size thresholds for special handling
 */
const LARGE_FILE_THRESHOLD = 1000; // Lines
const VERY_LARGE_FILE_THRESHOLD = 5000; // Lines

/**
 * Token estimation: approximately 4 characters = 1 token
 */
const CHARS_PER_TOKEN = 4;

/**
 * Semantic code chunker
 */
export class CodeChunker {
  private readonly chunkSizeMin: number;
  private readonly chunkSizeMax: number;

  constructor(options: Partial<IndexingOptions> = {}) {
    this.chunkSizeMin = options.chunk_size_min ?? CHUNK_SIZE_MIN;
    this.chunkSizeMax = options.chunk_size_max ?? CHUNK_SIZE_MAX;
  }

  /**
   * Create semantic chunks from parsed code
   *
   * @param file - Discovered file metadata
   * @param parseResult - Parse result with nodes, imports, exports
   * @param fileContent - Raw file content
   * @returns Chunking result with generated chunks
   */
  public createChunks = (file: DiscoveredFile, parseResult: ParseResult, fileContent: string): ChunkingResult => {
    const chunks: CodeChunkInput[] = [];
    const warnings: string[] = [];

    logger.debug('Creating chunks', {
      file: file.relative_path,
      lines: file.line_count,
    });

    // Handle very large files (>5000 lines): structure-only indexing
    if (file.line_count > VERY_LARGE_FILE_THRESHOLD) {
      logger.warn('Very large file detected, using structure-only indexing', {
        file: file.relative_path,
        lines: file.line_count,
      });
      warnings.push(`File exceeds ${VERY_LARGE_FILE_THRESHOLD.toString()} lines, using structure-only indexing`);

      return this.createStructureOnlyChunks(file, parseResult, fileContent, warnings);
    }

    // Handle large files (1000-5000 lines): section-based chunking
    if (file.line_count > LARGE_FILE_THRESHOLD) {
      logger.info('Large file detected, using section-based chunking', {
        file: file.relative_path,
        lines: file.line_count,
      });
      return this.createSectionBasedChunks(file, parseResult, fileContent, warnings);
    }

    // Standard chunking strategy for normal-sized files
    // 1. File summary chunk (first 100 lines or entire file)
    const summaryChunk = this.createFileSummaryChunk(file, fileContent);
    chunks.push(summaryChunk);

    // 2. Import block chunk (if imports exist)
    if (parseResult.imports.length > 0) {
      const importChunk = this.createImportBlockChunk(file, parseResult, fileContent);
      if (importChunk) {
        chunks.push(importChunk);
      }
    }

    // 3. Function chunks (one per function)
    const functionChunks = this.createFunctionChunks(file, parseResult, fileContent);
    chunks.push(...functionChunks);

    // 4. Class chunks (one per class with all methods)
    const classChunks = this.createClassChunks(file, parseResult, fileContent);
    chunks.push(...classChunks);

    // 5. Top-level block chunks (remaining code)
    const blockChunks = this.createTopLevelBlocks(file, parseResult, fileContent, chunks);
    chunks.push(...blockChunks);

    logger.info('Chunks created', {
      file: file.relative_path,
      chunk_count: chunks.length,
    });

    return {
      chunks,
      chunk_count: chunks.length,
      is_large_file: false,
      warnings,
    };
  };

  /**
   * Create file summary chunk (first 100 lines or entire file)
   */
  private createFileSummaryChunk = (file: DiscoveredFile, content: string): CodeChunkInput => {
    const lines = content.split('\n');
    const summaryLines = Math.min(100, lines.length);
    const summaryContent = lines.slice(0, summaryLines).join('\n');

    return {
      chunk_id: uuidv4(),
      file_path: file.absolute_path,
      chunk_content: summaryContent,
      chunk_type: ChunkType.FileSummary,
      start_line: 1,
      end_line: summaryLines,
      token_count: this.estimateTokens(summaryContent),
      metadata: {
        file_hash: file.file_hash,
        language: file.language,
        total_lines: file.line_count,
      },
      created_at: new Date(),
      repo_id: file.repo_id,
      workspace_id: file.workspace_id,
      package_name: file.package_name,
      service_id: file.service_id,
    };
  };

  /**
   * Create import block chunk
   */
  private createImportBlockChunk = (
    file: DiscoveredFile,
    parseResult: ParseResult,
    content: string
  ): CodeChunkInput | null => {
    if (parseResult.imports.length === 0) {
      return null;
    }

    // Find start and end lines of import block
    const importLines = parseResult.imports.map((imp) => imp.line_number).sort((a, b) => a - b);
    const startLine = importLines[0];
    const endLine = importLines[importLines.length - 1];

    const lines = content.split('\n');
    const importContent = lines.slice(startLine - 1, endLine).join('\n');

    // Check if import block is too small
    const lineCount = endLine - startLine + 1;
    if (lineCount < 3) {
      // Too small, skip import block chunk
      return null;
    }

    return {
      chunk_id: uuidv4(),
      file_path: file.absolute_path,
      chunk_content: importContent,
      chunk_type: ChunkType.ImportBlock,
      start_line: startLine,
      end_line: endLine,
      token_count: this.estimateTokens(importContent),
      metadata: {
        import_count: parseResult.imports.length,
        imported_modules: parseResult.imports.map((imp) => imp.source),
      },
      created_at: new Date(),
      repo_id: file.repo_id,
      workspace_id: file.workspace_id,
      package_name: file.package_name,
      service_id: file.service_id,
    };
  };

  /**
   * Create function chunks
   */
  private createFunctionChunks = (
    file: DiscoveredFile,
    parseResult: ParseResult,
    _content: string
  ): CodeChunkInput[] => {
    const chunks: CodeChunkInput[] = [];

    const functionNodes = parseResult.nodes.filter(
      (node) => node.node_type === NodeType.Function || node.node_type === NodeType.Method
    );

    for (const func of functionNodes) {
      const lineCount = func.end_line - func.start_line + 1;

      // Skip tiny functions (<10 lines)
      if (lineCount < 10) {
        continue;
      }

      // Handle large functions (>500 lines) - split if possible
      if (lineCount > this.chunkSizeMax) {
        logger.warn('Large function detected', {
          file: file.relative_path,
          function: func.name,
          lines: lineCount,
        });
        // For now, include it as-is (could implement splitting logic later)
      }

      chunks.push({
        chunk_id: uuidv4(),
        file_path: file.absolute_path,
        chunk_content: func.code_text,
        chunk_type: ChunkType.Function,
        start_line: func.start_line,
        end_line: func.end_line,
        token_count: this.estimateTokens(func.code_text),
        metadata: {
          function_name: func.name,
          parameters: func.parameters,
          return_type: func.return_type,
          complexity: func.complexity,
          is_async: func.is_async,
          docstring: func.docstring,
        },
        created_at: new Date(),
        repo_id: file.repo_id,
        workspace_id: file.workspace_id,
        package_name: file.package_name,
        service_id: file.service_id,
      });
    }

    return chunks;
  };

  /**
   * Create class chunks
   */
  private createClassChunks = (file: DiscoveredFile, parseResult: ParseResult, _content: string): CodeChunkInput[] => {
    const chunks: CodeChunkInput[] = [];

    const classNodes = parseResult.nodes.filter((node) => node.node_type === NodeType.Class);

    for (const cls of classNodes) {
      const lineCount = cls.end_line - cls.start_line + 1;

      // Skip tiny classes (<10 lines)
      if (lineCount < 10) {
        continue;
      }

      // Extract method names from children
      const methodNames = cls.children?.map((child) => child.name) ?? [];

      chunks.push({
        chunk_id: uuidv4(),
        file_path: file.absolute_path,
        chunk_content: cls.code_text,
        chunk_type: ChunkType.Class,
        start_line: cls.start_line,
        end_line: cls.end_line,
        token_count: this.estimateTokens(cls.code_text),
        metadata: {
          class_name: cls.name,
          method_names: methodNames,
          method_count: methodNames.length,
          docstring: cls.docstring,
        },
        created_at: new Date(),
        repo_id: file.repo_id,
        workspace_id: file.workspace_id,
        package_name: file.package_name,
        service_id: file.service_id,
      });
    }

    return chunks;
  };

  /**
   * Create top-level block chunks for remaining code
   *
   * Groups code that isn't part of functions or classes
   */
  private createTopLevelBlocks = (
    file: DiscoveredFile,
    _parseResult: ParseResult,
    content: string,
    existingChunks: CodeChunkInput[]
  ): CodeChunkInput[] => {
    const chunks: CodeChunkInput[] = [];
    const lines = content.split('\n');

    // Build set of lines already covered by existing chunks
    const coveredLines = new Set<number>();

    for (const chunk of existingChunks) {
      // Skip file summary chunk (it overlaps with everything)
      if (chunk.chunk_type === ChunkType.FileSummary) {
        continue;
      }

      for (let i = chunk.start_line; i <= chunk.end_line; i++) {
        coveredLines.add(i);
      }
    }

    // Find uncovered regions and create block chunks
    let blockStart: number | null = null;

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      if (!coveredLines.has(lineNum)) {
        blockStart ??= lineNum;
      } else {
        if (blockStart !== null) {
          // End of uncovered block
          const blockEnd = lineNum - 1;
          const blockSize = blockEnd - blockStart + 1;

          if (blockSize >= this.chunkSizeMin) {
            const blockContent = lines.slice(blockStart - 1, blockEnd).join('\n');

            chunks.push({
              chunk_id: uuidv4(),
              file_path: file.absolute_path,
              chunk_content: blockContent,
              chunk_type: ChunkType.Block,
              start_line: blockStart,
              end_line: blockEnd,
              token_count: this.estimateTokens(blockContent),
              metadata: {},
              created_at: new Date(),
              repo_id: file.repo_id,
              workspace_id: file.workspace_id,
              package_name: file.package_name,
              service_id: file.service_id,
            });
          }

          blockStart = null;
        }
      }
    }

    // Handle final block if file ends with uncovered code
    if (blockStart !== null) {
      const blockEnd = lines.length;
      const blockSize = blockEnd - blockStart + 1;

      if (blockSize >= this.chunkSizeMin) {
        const blockContent = lines.slice(blockStart - 1, blockEnd).join('\n');

        chunks.push({
          chunk_id: uuidv4(),
          file_path: file.absolute_path,
          chunk_content: blockContent,
          chunk_type: ChunkType.Block,
          start_line: blockStart,
          end_line: blockEnd,
          token_count: this.estimateTokens(blockContent),
          metadata: {},
          created_at: new Date(),
          repo_id: file.repo_id,
          workspace_id: file.workspace_id,
          package_name: file.package_name,
          service_id: file.service_id,
        });
      }
    }

    return chunks;
  };

  /**
   * Create structure-only chunks for very large files (>5000 lines)
   *
   * Only indexes:
   * - File summary (first 100 lines)
   * - Export statements
   */
  private createStructureOnlyChunks = (
    file: DiscoveredFile,
    parseResult: ParseResult,
    content: string,
    warnings: string[]
  ): ChunkingResult => {
    const chunks: CodeChunkInput[] = [];

    // 1. File summary
    const summaryChunk = this.createFileSummaryChunk(file, content);
    summaryChunk.large_file = true;
    chunks.push(summaryChunk);

    // 2. Exports chunk (if exports exist)
    if (parseResult.exports.length > 0) {
      const exportLines = parseResult.exports.map((exp) => exp.line_number).sort((a, b) => a - b);
      const lines = content.split('\n');

      // Group exports into a single chunk
      const exportContent = exportLines.map((lineNum) => lines[lineNum - 1]).join('\n');

      chunks.push({
        chunk_id: uuidv4(),
        file_path: file.absolute_path,
        chunk_content: exportContent,
        chunk_type: ChunkType.Block,
        start_line: exportLines[0],
        end_line: exportLines[exportLines.length - 1],
        token_count: this.estimateTokens(exportContent),
        metadata: {
          export_count: parseResult.exports.length,
          structure_only: true,
        },
        created_at: new Date(),
        large_file: true,
        repo_id: file.repo_id,
        workspace_id: file.workspace_id,
        package_name: file.package_name,
        service_id: file.service_id,
      });
    }

    return {
      chunks,
      chunk_count: chunks.length,
      is_large_file: true,
      warnings,
    };
  };

  /**
   * Create section-based chunks for large files (1000-5000 lines)
   *
   * Divides file into logical sections based on parsed nodes
   */
  private createSectionBasedChunks = (
    file: DiscoveredFile,
    parseResult: ParseResult,
    content: string,
    warnings: string[]
  ): ChunkingResult => {
    // For now, use standard chunking strategy
    // Could implement more sophisticated section detection later
    const chunks: CodeChunkInput[] = [];

    // File summary
    chunks.push(this.createFileSummaryChunk(file, content));

    // Import block
    if (parseResult.imports.length > 0) {
      const importChunk = this.createImportBlockChunk(file, parseResult, content);
      if (importChunk) {
        chunks.push(importChunk);
      }
    }

    // Function and class chunks
    chunks.push(...this.createFunctionChunks(file, parseResult, content));
    chunks.push(...this.createClassChunks(file, parseResult, content));

    return {
      chunks,
      chunk_count: chunks.length,
      is_large_file: false,
      warnings,
    };
  };

  /**
   * Estimate token count for code content
   *
   * Formula: ~4 characters = 1 token
   */
  private estimateTokens = (content: string): number => {
    return Math.ceil(content.length / CHARS_PER_TOKEN);
  };
}

/**
 * Create semantic chunks from file (convenience function)
 *
 * @param file - Discovered file metadata
 * @param parseResult - Parse result with nodes
 * @param fileContent - Raw file content
 * @param options - Indexing options
 * @returns Chunking result
 */
export const createChunks = (
  file: DiscoveredFile,
  parseResult: ParseResult,
  fileContent: string,
  options?: Partial<IndexingOptions>
): ChunkingResult => {
  const chunker = new CodeChunker(options);
  return chunker.createChunks(file, parseResult, fileContent);
};
