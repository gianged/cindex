/**
 * Documentation Search Module
 *
 * Vector similarity search for indexed documentation.
 * Returns ranked results with section context and code blocks.
 */
import type pg from 'pg';

import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import {
  type DocChunkType,
  type DocumentationSearchResult,
  type ReferenceCodeResult,
  type SearchReferencesInput,
  type SearchReferencesOutput,
} from '@/types/documentation';

/**
 * Internal search documentation input (for legacy searchDocumentation function)
 */
interface SearchDocumentationInput {
  query: string;
  tags?: string[];
  doc_ids?: string[];
  max_results?: number;
  include_code_blocks?: boolean;
  similarity_threshold?: number;
}

/**
 * Internal search documentation output
 */
interface SearchDocumentationOutput {
  query: string;
  results: DocumentationSearchResult[];
  total_results: number;
  search_time_ms: number;
}

/**
 * Default similarity threshold for documentation search
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.65;

/**
 * Default max results
 */
const DEFAULT_MAX_RESULTS = 10;

/**
 * Default context window for embeddings
 */
const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * Database row type for documentation chunk search results
 */
interface DocumentationChunkRow {
  chunk_id: string;
  doc_id: string;
  file_path: string;
  heading_path: string[] | null;
  chunk_type: DocChunkType;
  content: string;
  language: string | null;
  tags: string[] | null;
  start_line: number | null;
  end_line: number | null;
  relevance_score: string;
}

/**
 * Database row type for documentation file list results
 */
interface DocumentationFileRow {
  doc_id: string;
  files: string[] | null;
  tags: string[] | null;
  section_count: string;
  code_block_count: string;
  indexed_at: string;
}

/**
 * Search documentation using vector similarity
 *
 * @param pool - Database connection pool
 * @param ollamaClient - Ollama client for query embedding
 * @param embeddingConfig - Embedding configuration
 * @param input - Search parameters
 * @returns Search results with relevance scores
 */
export const searchDocumentation = async (
  pool: pg.Pool,
  ollamaClient: OllamaClient,
  embeddingConfig: { model: string; dimensions: number; context_window?: number },
  input: SearchDocumentationInput
): Promise<SearchDocumentationOutput> => {
  const startTime = Date.now();

  // Validate input
  if (!input.query || input.query.trim().length === 0) {
    throw new Error('query is required');
  }

  const maxResults = input.max_results ?? DEFAULT_MAX_RESULTS;
  const similarityThreshold = input.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const includeCodeBlocks = input.include_code_blocks ?? true;

  logger.debug('Searching documentation', {
    query: input.query,
    tags: input.tags,
    doc_ids: input.doc_ids,
    max_results: maxResults,
  });

  // Generate query embedding
  const queryEmbedding = await ollamaClient.generateEmbedding(
    embeddingConfig.model,
    input.query,
    embeddingConfig.dimensions,
    embeddingConfig.context_window ?? DEFAULT_CONTEXT_WINDOW
  );

  // Build SQL query with filters
  const conditions: string[] = ['embedding IS NOT NULL'];
  const params: unknown[] = [`[${queryEmbedding.join(',')}]`, similarityThreshold];
  let paramIndex = 3;

  // Filter by tags
  if (input.tags && input.tags.length > 0) {
    conditions.push(`tags && $${String(paramIndex)}`);
    params.push(input.tags);
    paramIndex++;
  }

  // Filter by doc_ids
  if (input.doc_ids && input.doc_ids.length > 0) {
    conditions.push(`doc_id = ANY($${String(paramIndex)})`);
    params.push(input.doc_ids);
    paramIndex++;
  }

  // Filter by chunk type if not including code blocks
  if (!includeCodeBlocks) {
    conditions.push("chunk_type = 'section'");
  }

  // Add max results parameter
  params.push(maxResults);

  const sql = `
    SELECT
      chunk_id,
      doc_id,
      file_path,
      heading_path,
      chunk_type,
      content,
      language,
      tags,
      start_line,
      end_line,
      1 - (embedding <=> $1) AS relevance_score
    FROM documentation_chunks
    WHERE ${conditions.join(' AND ')}
      AND 1 - (embedding <=> $1) > $2
    ORDER BY relevance_score DESC
    LIMIT $${String(paramIndex)}
  `;

  const result = await pool.query<DocumentationChunkRow>(sql, params);

  const results: DocumentationSearchResult[] = result.rows.map((row) => ({
    chunk_id: row.chunk_id,
    doc_id: row.doc_id,
    file_path: row.file_path,
    heading_path: row.heading_path ?? [],
    chunk_type: row.chunk_type,
    content: row.content,
    language: row.language,
    relevance_score: parseFloat(row.relevance_score),
    tags: row.tags ?? [],
    start_line: row.start_line,
    end_line: row.end_line,
  }));

  const searchTimeMs = Date.now() - startTime;

  logger.info('Documentation search complete', {
    query: input.query.slice(0, 50),
    results_found: results.length,
    search_time_ms: searchTimeMs,
  });

  return {
    query: input.query,
    results,
    total_results: results.length,
    search_time_ms: searchTimeMs,
  };
};

/**
 * Database row type for reference code chunk search results
 */
interface ReferenceCodeRow {
  chunk_id: string;
  repo_id: string;
  repo_name: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  language: string;
  chunk_type: string;
  symbol_name: string | null;
  relevance_score: string;
}

/**
 * Search references (documentation + reference repo code)
 *
 * @param pool - Database connection pool
 * @param ollamaClient - Ollama client for query embedding
 * @param embeddingConfig - Embedding configuration
 * @param input - Search parameters
 * @returns Combined search results from docs and reference repos
 */
export const searchReferences = async (
  pool: pg.Pool,
  ollamaClient: OllamaClient,
  embeddingConfig: { model: string; dimensions: number; context_window?: number },
  input: SearchReferencesInput
): Promise<SearchReferencesOutput> => {
  const startTime = Date.now();

  // Validate input
  if (!input.query || input.query.trim().length === 0) {
    throw new Error('query is required');
  }

  const maxResults = input.max_results ?? DEFAULT_MAX_RESULTS;
  const similarityThreshold = input.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const includeDocs = input.include_docs ?? true;
  const includeCode = input.include_code ?? true;
  const includeCodeBlocks = input.include_code_blocks ?? true;

  logger.debug('Searching references', {
    query: input.query,
    include_docs: includeDocs,
    include_code: includeCode,
    max_results: maxResults,
  });

  // Generate query embedding
  const queryEmbedding = await ollamaClient.generateEmbedding(
    embeddingConfig.model,
    input.query,
    embeddingConfig.dimensions,
    embeddingConfig.context_window ?? DEFAULT_CONTEXT_WINDOW
  );

  const docResults: DocumentationSearchResult[] = [];
  const codeResults: ReferenceCodeResult[] = [];

  // Search documentation chunks if enabled
  if (includeDocs) {
    const docConditions: string[] = ['embedding IS NOT NULL'];
    const docParams: unknown[] = [`[${queryEmbedding.join(',')}]`, similarityThreshold];
    let docParamIndex = 3;

    // Filter by tags
    if (input.tags && input.tags.length > 0) {
      docConditions.push(`tags && $${String(docParamIndex)}`);
      docParams.push(input.tags);
      docParamIndex++;
    }

    // Filter by doc_ids
    if (input.doc_ids && input.doc_ids.length > 0) {
      docConditions.push(`doc_id = ANY($${String(docParamIndex)})`);
      docParams.push(input.doc_ids);
      docParamIndex++;
    }

    // Filter by chunk type if not including code blocks
    if (!includeCodeBlocks) {
      docConditions.push("chunk_type = 'section'");
    }

    // Add max results parameter
    docParams.push(Math.ceil(maxResults / 2)); // Split results between docs and code

    const docSql = `
      SELECT
        chunk_id,
        doc_id,
        file_path,
        heading_path,
        chunk_type,
        content,
        language,
        tags,
        start_line,
        end_line,
        1 - (embedding <=> $1) AS relevance_score
      FROM documentation_chunks
      WHERE ${docConditions.join(' AND ')}
        AND 1 - (embedding <=> $1) > $2
      ORDER BY relevance_score DESC
      LIMIT $${String(docParamIndex)}
    `;

    const docResult = await pool.query<DocumentationChunkRow>(docSql, docParams);

    for (const row of docResult.rows) {
      docResults.push({
        chunk_id: row.chunk_id,
        doc_id: row.doc_id,
        file_path: row.file_path,
        heading_path: row.heading_path ?? [],
        chunk_type: row.chunk_type,
        content: row.content,
        language: row.language,
        relevance_score: parseFloat(row.relevance_score),
        tags: row.tags ?? [],
        start_line: row.start_line,
        end_line: row.end_line,
      });
    }
  }

  // Search reference repository code if enabled
  if (includeCode) {
    const codeParams: unknown[] = [
      `[${queryEmbedding.join(',')}]`,
      similarityThreshold,
      Math.ceil(maxResults / 2), // Split results between docs and code
    ];

    const codeSql = `
      SELECT
        cc.chunk_id,
        cc.repo_id,
        r.repo_name,
        cc.file_path,
        cc.start_line,
        cc.end_line,
        cc.content,
        cc.language,
        cc.chunk_type,
        cc.symbol_name,
        1 - (cc.embedding <=> $1) AS relevance_score
      FROM code_chunks cc
      JOIN repositories r ON cc.repo_id = r.repo_id
      WHERE cc.embedding IS NOT NULL
        AND r.repo_type = 'reference'
        AND 1 - (cc.embedding <=> $1) > $2
      ORDER BY relevance_score DESC
      LIMIT $3
    `;

    const codeResult = await pool.query<ReferenceCodeRow>(codeSql, codeParams);

    for (const row of codeResult.rows) {
      codeResults.push({
        chunk_id: row.chunk_id,
        repo_id: row.repo_id,
        repo_name: row.repo_name ?? undefined,
        file_path: row.file_path,
        start_line: row.start_line,
        end_line: row.end_line,
        content: row.content,
        language: row.language,
        relevance_score: parseFloat(row.relevance_score),
        symbol_name: row.symbol_name ?? undefined,
        chunk_type: row.chunk_type,
      });
    }
  }

  const searchTimeMs = Date.now() - startTime;

  logger.info('Reference search complete', {
    query: input.query.slice(0, 50),
    doc_results: docResults.length,
    code_results: codeResults.length,
    search_time_ms: searchTimeMs,
  });

  return {
    query: input.query,
    doc_results: docResults,
    code_results: codeResults,
    total_results: docResults.length + codeResults.length,
    search_time_ms: searchTimeMs,
  };
};

/**
 * Format search_references output for MCP
 */
export const formatSearchReferencesOutput = (output: SearchReferencesOutput): string => {
  const lines: string[] = [];

  lines.push(`## Reference Search Results`);
  lines.push('');
  lines.push(`Query: "${output.query}"`);
  lines.push(`Found: ${String(output.total_results)} results (${String(output.search_time_ms)}ms)`);
  lines.push(`- Documentation: ${String(output.doc_results.length)} results`);
  lines.push(`- Reference Code: ${String(output.code_results.length)} results`);

  if (output.total_results === 0) {
    lines.push('');
    lines.push('No matching references found.');
    return lines.join('\n');
  }

  // Documentation results
  if (output.doc_results.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('### Documentation');
    lines.push('');

    for (let i = 0; i < output.doc_results.length; i++) {
      const result = output.doc_results[i];
      const breadcrumb = result.heading_path.join(' > ');

      lines.push(`#### ${String(i + 1)}. ${breadcrumb || result.file_path}`);
      lines.push(`Score: ${(result.relevance_score * 100).toFixed(1)}% | Type: ${result.chunk_type}`);

      if (result.chunk_type === 'code_block' && result.language) {
        lines.push(`Language: ${result.language}`);
      }

      lines.push(`File: ${result.file_path}${result.start_line ? `:${String(result.start_line)}` : ''}`);
      lines.push('');

      // Show content (truncated)
      if (result.chunk_type === 'code_block') {
        const codeLines = result.content.split('\n').slice(0, 15);
        lines.push('```' + (result.language ?? ''));
        lines.push(codeLines.join('\n'));
        lines.push('```');
      } else {
        const contentLines = result.content.split('\n').slice(0, 8);
        lines.push(contentLines.join('\n'));
      }
      lines.push('');
    }
  }

  // Reference code results
  if (output.code_results.length > 0) {
    lines.push('---');
    lines.push('### Reference Repository Code');
    lines.push('');

    for (let i = 0; i < output.code_results.length; i++) {
      const result = output.code_results[i];
      const title = result.symbol_name ?? result.file_path.split('/').pop() ?? 'Code';

      lines.push(`#### ${String(i + 1)}. ${title}`);
      lines.push(`Score: ${(result.relevance_score * 100).toFixed(1)}% | Repo: ${result.repo_name ?? result.repo_id}`);
      lines.push(`File: ${result.file_path}:${String(result.start_line)}-${String(result.end_line)}`);
      lines.push(`Type: ${result.chunk_type} | Language: ${result.language}`);
      lines.push('');

      // Show code (truncated)
      const codeLines = result.content.split('\n').slice(0, 20);
      lines.push('```' + result.language);
      lines.push(codeLines.join('\n'));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
};

/**
 * List all indexed documentation
 *
 * @param pool - Database connection pool
 * @param docIds - Optional filter by doc_ids
 * @param tags - Optional filter by tags
 * @returns List of indexed documentation summaries
 */
export const listDocumentation = async (
  pool: pg.Pool,
  docIds?: string[],
  tags?: string[]
): Promise<{
  documents: {
    doc_id: string;
    files: string[];
    tags: string[];
    section_count: number;
    code_block_count: number;
    indexed_at: Date;
  }[];
  total_documents: number;
  total_chunks: number;
}> => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (docIds && docIds.length > 0) {
    conditions.push(`doc_id = ANY($${String(paramIndex)})`);
    params.push(docIds);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`tags && $${String(paramIndex)}`);
    params.push(tags);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get document summaries grouped by doc_id
  const sql = `
    SELECT
      doc_id,
      array_agg(DISTINCT file_path) AS files,
      array_agg(DISTINCT unnest_tags) AS tags,
      SUM(section_count) AS section_count,
      SUM(code_block_count) AS code_block_count,
      MAX(indexed_at) AS indexed_at
    FROM documentation_files,
    LATERAL unnest(tags) AS unnest_tags
    ${whereClause}
    GROUP BY doc_id
    ORDER BY indexed_at DESC
  `;

  // Fallback for docs without tags
  const sqlFallback = `
    SELECT
      doc_id,
      array_agg(DISTINCT file_path) AS files,
      COALESCE(array_agg(DISTINCT t) FILTER (WHERE t IS NOT NULL), '{}') AS tags,
      SUM(section_count) AS section_count,
      SUM(code_block_count) AS code_block_count,
      MAX(indexed_at) AS indexed_at
    FROM documentation_files
    LEFT JOIN LATERAL unnest(tags) AS t ON true
    ${whereClause}
    GROUP BY doc_id
    ORDER BY indexed_at DESC
  `;

  let result: pg.QueryResult<DocumentationFileRow>;
  try {
    result = await pool.query<DocumentationFileRow>(sql, params);
  } catch {
    // Fallback if LATERAL unnest fails (empty tags)
    result = await pool.query<DocumentationFileRow>(sqlFallback, params);
  }

  // Get total chunk count
  const chunkCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM documentation_chunks ${whereClause}`,
    params
  );

  return {
    documents: result.rows.map((row) => ({
      doc_id: row.doc_id,
      files: row.files ?? [],
      tags: row.tags ?? [],
      section_count: parseInt(row.section_count, 10) || 0,
      code_block_count: parseInt(row.code_block_count, 10) || 0,
      indexed_at: new Date(row.indexed_at),
    })),
    total_documents: result.rows.length,
    total_chunks: parseInt(chunkCountResult.rows[0]?.count ?? '0', 10),
  };
};

/**
 * Delete documentation by doc_id(s)
 *
 * @param pool - Database connection pool
 * @param docIds - Document IDs to delete
 * @returns Deletion statistics
 */
export const deleteDocumentation = async (
  pool: pg.Pool,
  docIds: string[]
): Promise<{
  deleted_doc_ids: string[];
  chunks_deleted: number;
  files_deleted: number;
}> => {
  if (docIds.length === 0) {
    return { deleted_doc_ids: [], chunks_deleted: 0, files_deleted: 0 };
  }

  // Delete chunks first (no foreign key, but logically related)
  const chunksResult = await pool.query('DELETE FROM documentation_chunks WHERE doc_id = ANY($1)', [docIds]);

  // Delete files
  const filesResult = await pool.query('DELETE FROM documentation_files WHERE doc_id = ANY($1)', [docIds]);

  logger.info('Deleted documentation', {
    doc_ids: docIds,
    chunks_deleted: chunksResult.rowCount,
    files_deleted: filesResult.rowCount,
  });

  return {
    deleted_doc_ids: docIds,
    chunks_deleted: chunksResult.rowCount ?? 0,
    files_deleted: filesResult.rowCount ?? 0,
  };
};
