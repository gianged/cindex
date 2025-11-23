/**
 * MCP Tool: search_references
 *
 * Search reference materials including markdown documentation and reference repository code.
 * Combines documentation chunks and code from reference repos (frameworks, libraries).
 */
import type pg from 'pg';

import {
  deleteDocumentation,
  formatSearchReferencesOutput,
  listDocumentation,
  searchReferences,
} from '@retrieval/doc-search';
import { type OllamaClient } from '@utils/ollama';
import {
  type DeleteDocumentationInput,
  type DeleteDocumentationOutput,
  type ListDocumentationInput,
  type ListDocumentationOutput,
  type SearchReferencesInput,
  type SearchReferencesOutput,
} from '@/types/documentation';

/**
 * Search references MCP tool implementation
 * Searches both markdown documentation and reference repository code
 *
 * @param pool - Database connection pool
 * @param ollamaClient - Ollama client for embeddings
 * @param embeddingConfig - Embedding configuration
 * @param input - Search parameters
 * @returns Search results from both documentation and reference repos
 */
export const searchReferencesTool = async (
  pool: pg.Pool,
  ollamaClient: OllamaClient,
  embeddingConfig: { model: string; dimensions: number; context_window?: number },
  input: SearchReferencesInput
): Promise<{ formatted_result: string; output: SearchReferencesOutput }> => {
  const output = await searchReferences(pool, ollamaClient, embeddingConfig, input);
  const formattedResult = formatSearchReferencesOutput(output);

  return { formatted_result: formattedResult, output };
};

/**
 * List documentation MCP tool implementation
 *
 * @param pool - Database connection pool
 * @param input - List parameters
 * @returns List of indexed documentation
 */
export const listDocumentationTool = async (
  pool: pg.Pool,
  input: ListDocumentationInput
): Promise<{ formatted_result: string; output: ListDocumentationOutput }> => {
  const result = await listDocumentation(pool, input.doc_ids, input.tags);

  const output: ListDocumentationOutput = {
    documents: result.documents.map((doc) => ({
      doc_id: doc.doc_id,
      files: doc.files,
      tags: doc.tags,
      section_count: doc.section_count,
      code_block_count: doc.code_block_count,
      indexed_at: doc.indexed_at,
    })),
    total_documents: result.total_documents,
    total_chunks: result.total_chunks,
  };

  // Format output
  const lines: string[] = [];
  lines.push('## Indexed Documentation');
  lines.push('');
  lines.push(`Total: ${String(output.total_documents)} document(s), ${String(output.total_chunks)} chunks`);
  lines.push('');

  if (output.documents.length === 0) {
    lines.push('No documentation indexed yet.');
    lines.push('');
    lines.push('Use `index_documentation` to index markdown files.');
  } else {
    for (const doc of output.documents) {
      lines.push(`### ${doc.doc_id}`);
      lines.push(`- Files: ${String(doc.files.length)}`);
      lines.push(`- Sections: ${String(doc.section_count)}`);
      lines.push(`- Code blocks: ${String(doc.code_block_count)}`);
      if (doc.tags.length > 0) {
        lines.push(`- Tags: ${doc.tags.join(', ')}`);
      }
      lines.push(`- Indexed: ${doc.indexed_at.toISOString()}`);
      lines.push('');
    }
  }

  return { formatted_result: lines.join('\n'), output };
};

/**
 * Delete documentation MCP tool implementation
 *
 * @param pool - Database connection pool
 * @param input - Delete parameters
 * @returns Deletion results
 */
export const deleteDocumentationTool = async (
  pool: pg.Pool,
  input: DeleteDocumentationInput
): Promise<{ formatted_result: string; output: DeleteDocumentationOutput }> => {
  if (input.doc_ids.length === 0) {
    throw new Error('doc_ids is required and must contain at least one doc_id');
  }

  const result = await deleteDocumentation(pool, input.doc_ids);

  const output: DeleteDocumentationOutput = {
    success: true,
    deleted_doc_ids: result.deleted_doc_ids,
    chunks_deleted: result.chunks_deleted,
    files_deleted: result.files_deleted,
  };

  // Format output
  const lines: string[] = [];
  lines.push('## Documentation Deleted');
  lines.push('');
  lines.push(`Deleted doc_ids: ${output.deleted_doc_ids.join(', ')}`);
  lines.push(`Chunks deleted: ${String(output.chunks_deleted)}`);
  lines.push(`Files deleted: ${String(output.files_deleted)}`);

  return { formatted_result: lines.join('\n'), output };
};
