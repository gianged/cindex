/**
 * MCP Tool: index_documentation
 *
 * Index markdown files for documentation search.
 * Standalone from code indexing - for syntax.md, Context7-fetched docs, etc.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type pg from 'pg';

import {
  estimateTokenCount,
  findMarkdownFiles,
  getFileHash,
  parseMarkdownForDocumentation,
} from '@indexing/doc-chunker';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import {
  type IndexDocumentationError,
  type IndexDocumentationInput,
  type IndexDocumentationOutput,
  type ParsedDocChunk,
} from '@/types/documentation';

/** Default context window for embeddings */
const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * Generate embedding for documentation chunk
 *
 * @param ollamaClient - Ollama client
 * @param model - Embedding model name
 * @param dimensions - Embedding dimensions
 * @param contextWindow - Context window size (optional, defaults to 4096)
 * @param chunk - Documentation chunk
 * @param headingContext - Heading path for context
 * @returns Embedding vector
 */
const generateDocEmbedding = async (
  ollamaClient: OllamaClient,
  model: string,
  dimensions: number,
  contextWindow: number | undefined,
  chunk: ParsedDocChunk,
  headingContext: string
): Promise<number[]> => {
  // Build enhanced text for embedding
  let enhancedText = '';

  if (chunk.chunk_type === 'section') {
    enhancedText = `Documentation section: ${headingContext}\n\n${chunk.content}`;
  } else {
    // Code block
    enhancedText = `Code example (${chunk.language ?? 'text'}) in ${headingContext}:\n\n${chunk.content}`;
  }

  return ollamaClient.generateEmbedding(model, enhancedText, dimensions, contextWindow ?? DEFAULT_CONTEXT_WINDOW);
};

/**
 * Insert documentation file metadata
 */
const insertDocFile = async (
  pool: pg.Pool,
  docId: string,
  filePath: string,
  fileHash: string,
  title: string | null,
  description: string | null,
  tags: string[],
  frontMatter: Record<string, unknown> | null,
  toc: unknown[],
  sectionCount: number,
  codeBlockCount: number
): Promise<void> => {
  const sql = `
    INSERT INTO documentation_files (
      doc_id, file_path, file_hash, title, description, tags,
      front_matter, table_of_contents, section_count, code_block_count,
      indexed_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    ON CONFLICT (file_path) DO UPDATE SET
      doc_id = EXCLUDED.doc_id,
      file_hash = EXCLUDED.file_hash,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      tags = EXCLUDED.tags,
      front_matter = EXCLUDED.front_matter,
      table_of_contents = EXCLUDED.table_of_contents,
      section_count = EXCLUDED.section_count,
      code_block_count = EXCLUDED.code_block_count,
      updated_at = NOW()
  `;

  await pool.query(sql, [
    docId,
    filePath,
    fileHash,
    title,
    description,
    tags,
    frontMatter ? JSON.stringify(frontMatter) : null,
    JSON.stringify(toc),
    sectionCount,
    codeBlockCount,
  ]);
};

/**
 * Insert documentation chunk with embedding
 */
const insertDocChunk = async (
  pool: pg.Pool,
  chunkId: string,
  docId: string,
  filePath: string,
  headingPath: string[],
  chunkType: string,
  content: string,
  language: string | null,
  embedding: number[] | null,
  tags: string[],
  fileHash: string,
  startLine: number | null,
  endLine: number | null,
  tokenCount: number,
  metadata: Record<string, unknown> | null
): Promise<void> => {
  const sql = `
    INSERT INTO documentation_chunks (
      chunk_id, doc_id, file_path, heading_path, chunk_type, content,
      language, embedding, tags, file_hash, start_line, end_line,
      token_count, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
    ON CONFLICT (chunk_id) DO UPDATE SET
      content = EXCLUDED.content,
      embedding = EXCLUDED.embedding,
      tags = EXCLUDED.tags,
      file_hash = EXCLUDED.file_hash,
      token_count = EXCLUDED.token_count,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `;

  await pool.query(sql, [
    chunkId,
    docId,
    filePath,
    headingPath,
    chunkType,
    content,
    language,
    embedding ? `[${embedding.join(',')}]` : null,
    tags,
    fileHash,
    startLine,
    endLine,
    tokenCount,
    metadata ? JSON.stringify(metadata) : null,
  ]);
};

/**
 * Delete existing chunks for a file (for re-indexing)
 */
const deleteFileChunks = async (pool: pg.Pool, filePath: string): Promise<number> => {
  const result = await pool.query('DELETE FROM documentation_chunks WHERE file_path = $1', [filePath]);
  return result.rowCount ?? 0;
};

/**
 * Check if file needs re-indexing by comparing hashes
 */
const checkFileHash = async (pool: pg.Pool, filePath: string): Promise<string | null> => {
  const result = await pool.query<{ file_hash: string }>(
    'SELECT file_hash FROM documentation_files WHERE file_path = $1',
    [filePath]
  );
  return result.rows[0]?.file_hash ?? null;
};

/**
 * Derive doc_id from path(s)
 */
const deriveDocId = (paths: string[]): string => {
  if (paths.length === 1) {
    // Single file: use filename without extension
    return path.basename(paths[0], path.extname(paths[0]));
  }
  // Multiple files: use first directory name
  return path.basename(path.dirname(paths[0]));
};

/**
 * Resolve paths to absolute paths and expand directories
 */
const resolvePaths = async (paths: string[]): Promise<string[]> => {
  const resolvedFiles: string[] = [];

  for (const p of paths) {
    const absolutePath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);

    try {
      const stat = await fs.stat(absolutePath);

      if (stat.isDirectory()) {
        // Find all markdown files in directory
        const mdFiles = await findMarkdownFiles(absolutePath, true);
        resolvedFiles.push(...mdFiles);
      } else if (stat.isFile()) {
        resolvedFiles.push(absolutePath);
      }
    } catch {
      // Path doesn't exist - will be reported as error later
      resolvedFiles.push(absolutePath);
    }
  }

  return resolvedFiles;
};

/**
 * Index documentation MCP tool implementation
 *
 * @param pool - Database connection pool
 * @param ollamaClient - Ollama client for embeddings
 * @param embeddingConfig - Embedding configuration
 * @param input - Tool input parameters
 * @returns Indexing results
 */
export const indexDocumentationTool = async (
  pool: pg.Pool,
  ollamaClient: OllamaClient,
  embeddingConfig: { model: string; dimensions: number; context_window?: number },
  input: IndexDocumentationInput
): Promise<IndexDocumentationOutput> => {
  const startTime = Date.now();

  // Validate input (paths already validated by Zod schema)
  if (input.paths.length === 0) {
    throw new Error('paths is required and must contain at least one path');
  }

  // Resolve paths (expand directories)
  const files = await resolvePaths(input.paths);

  if (files.length === 0) {
    throw new Error('No markdown files found in specified paths');
  }

  // Derive doc_id
  const docId = input.doc_id ?? deriveDocId(input.paths);
  const tags = input.tags ?? [];
  const forceReindex = input.force_reindex ?? false;

  logger.info('Starting documentation indexing', {
    doc_id: docId,
    files_found: files.length,
    tags,
    force_reindex: forceReindex,
  });

  // Track results
  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksCreated = 0;
  let codeBlocksIndexed = 0;
  let sectionsIndexed = 0;
  const errors: IndexDocumentationError[] = [];

  // Process each file
  for (const filePath of files) {
    try {
      // Check if file exists
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) {
        errors.push({ file_path: filePath, error: 'File not found' });
        continue;
      }

      // Get current file hash
      const currentHash = await getFileHash(filePath);

      // Check if file needs re-indexing
      if (!forceReindex) {
        const existingHash = await checkFileHash(pool, filePath);
        if (existingHash === currentHash) {
          logger.debug('Skipping unchanged file', { file: filePath });
          filesSkipped++;
          continue;
        }
      }

      // Parse markdown file
      const parsed = await parseMarkdownForDocumentation(filePath);

      // Delete existing chunks for this file
      await deleteFileChunks(pool, filePath);

      // Count chunks by type
      const sectionCount = parsed.chunks.filter((c) => c.chunk_type === 'section').length;
      const codeBlockCount = parsed.chunks.filter((c) => c.chunk_type === 'code_block').length;

      // Insert file metadata
      await insertDocFile(
        pool,
        docId,
        filePath,
        parsed.file_hash,
        parsed.title,
        parsed.description,
        tags,
        parsed.front_matter,
        parsed.table_of_contents,
        sectionCount,
        codeBlockCount
      );

      // Process chunks
      for (const chunk of parsed.chunks) {
        const chunkId = randomUUID();
        const headingContext = chunk.heading_path.join(' > ');

        // Generate embedding
        let embedding: number[] | null = null;
        try {
          embedding = await generateDocEmbedding(
            ollamaClient,
            embeddingConfig.model,
            embeddingConfig.dimensions,
            embeddingConfig.context_window,
            chunk,
            headingContext
          );
        } catch (error) {
          logger.warn('Failed to generate embedding for chunk', {
            file: filePath,
            heading: headingContext,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Calculate token count
        const tokenCount = estimateTokenCount(chunk.content);

        // Insert chunk
        await insertDocChunk(
          pool,
          chunkId,
          docId,
          filePath,
          chunk.heading_path,
          chunk.chunk_type,
          chunk.content,
          chunk.language,
          embedding,
          tags,
          parsed.file_hash,
          chunk.start_line,
          chunk.end_line,
          tokenCount,
          chunk.metadata ?? null
        );

        chunksCreated++;
        if (chunk.chunk_type === 'code_block') {
          codeBlocksIndexed++;
        } else {
          sectionsIndexed++;
        }
      }

      filesIndexed++;

      logger.info('Indexed documentation file', {
        file: path.basename(filePath),
        sections: sectionCount,
        code_blocks: codeBlockCount,
      });
    } catch (error) {
      errors.push({
        file_path: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.warn('Failed to index documentation file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const durationMs = Date.now() - startTime;

  logger.info('Documentation indexing complete', {
    doc_id: docId,
    files_indexed: filesIndexed,
    files_skipped: filesSkipped,
    chunks_created: chunksCreated,
    errors: errors.length,
    duration_ms: durationMs,
  });

  return {
    success: errors.length === 0,
    doc_id: docId,
    files_indexed: filesIndexed,
    files_skipped: filesSkipped,
    chunks_created: chunksCreated,
    code_blocks_indexed: codeBlocksIndexed,
    sections_indexed: sectionsIndexed,
    errors,
    duration_ms: durationMs,
  };
};

/**
 * Format index_documentation output for MCP
 */
export const formatIndexDocumentationOutput = (output: IndexDocumentationOutput): string => {
  const lines: string[] = [];

  lines.push(`## Documentation Indexed: ${output.doc_id}`);
  lines.push('');

  if (output.success) {
    lines.push('Status: Success');
  } else {
    lines.push(`Status: Completed with ${String(output.errors.length)} error(s)`);
  }

  lines.push('');
  lines.push('### Statistics');
  lines.push(`- Files indexed: ${String(output.files_indexed)}`);
  lines.push(`- Files skipped (unchanged): ${String(output.files_skipped)}`);
  lines.push(`- Sections indexed: ${String(output.sections_indexed)}`);
  lines.push(`- Code blocks indexed: ${String(output.code_blocks_indexed)}`);
  lines.push(`- Total chunks: ${String(output.chunks_created)}`);
  lines.push(`- Duration: ${String(output.duration_ms)}ms`);

  if (output.errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    for (const error of output.errors) {
      lines.push(`- ${error.file_path}: ${error.error}`);
    }
  }

  return lines.join('\n');
};
