/**
 * Documentation Types Module
 *
 * Type definitions for standalone documentation indexing and search.
 * Separate from code indexing - used for markdown files like syntax.md,
 * Context7-fetched docs, and reference documentation.
 */

/**
 * Documentation chunk type
 */
export type DocChunkType = 'section' | 'code_block';

/**
 * Documentation chunk stored in database
 */
export interface DocumentationChunk {
  chunk_id: string;
  doc_id: string;
  file_path: string;
  heading_path: string[];
  chunk_type: DocChunkType;
  content: string;
  language: string | null;
  embedding: number[] | null;
  tags: string[];
  file_hash: string;
  start_line: number | null;
  end_line: number | null;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Documentation file metadata stored in database
 */
export interface DocumentationFile {
  id: number;
  doc_id: string;
  file_path: string;
  file_hash: string;
  title: string | null;
  description: string | null;
  tags: string[];
  front_matter: Record<string, unknown> | null;
  table_of_contents: TableOfContentsEntry[] | null;
  code_block_count: number;
  section_count: number;
  indexed_at: Date;
  updated_at: Date;
}

/**
 * Table of contents entry
 */
export interface TableOfContentsEntry {
  heading: string;
  level: number;
  line: number;
  children?: TableOfContentsEntry[];
}

/**
 * Input for index_documentation tool
 */
export interface IndexDocumentationInput {
  paths: string[];
  doc_id?: string;
  tags?: string[];
  force_reindex?: boolean;
}

/**
 * Output for index_documentation tool
 */
export interface IndexDocumentationOutput {
  success: boolean;
  doc_id: string;
  files_indexed: number;
  files_skipped: number;
  chunks_created: number;
  code_blocks_indexed: number;
  sections_indexed: number;
  errors: IndexDocumentationError[];
  duration_ms: number;
}

/**
 * Indexing error details
 */
export interface IndexDocumentationError {
  file_path: string;
  error: string;
}

/**
 * Input for search_documentation tool
 */
export interface SearchDocumentationInput {
  query: string;
  tags?: string[];
  doc_ids?: string[];
  max_results?: number;
  include_code_blocks?: boolean;
  similarity_threshold?: number;
}

/**
 * Output for search_documentation tool
 */
export interface SearchDocumentationOutput {
  query: string;
  results: DocumentationSearchResult[];
  total_results: number;
  search_time_ms: number;
}

/**
 * Single search result
 */
export interface DocumentationSearchResult {
  chunk_id: string;
  doc_id: string;
  file_path: string;
  heading_path: string[];
  chunk_type: DocChunkType;
  content: string;
  language: string | null;
  relevance_score: number;
  tags: string[];
  start_line: number | null;
  end_line: number | null;
}

/**
 * Parsed documentation chunk (before embedding)
 */
export interface ParsedDocChunk {
  heading_path: string[];
  chunk_type: DocChunkType;
  content: string;
  language: string | null;
  start_line: number;
  end_line: number;
  metadata?: Record<string, unknown>;
}

/**
 * Parsed documentation file (before storage)
 */
export interface ParsedDocFile {
  file_path: string;
  file_hash: string;
  title: string | null;
  description: string | null;
  front_matter: Record<string, unknown> | null;
  table_of_contents: TableOfContentsEntry[];
  chunks: ParsedDocChunk[];
}

/**
 * Input for list_documentation tool
 */
export interface ListDocumentationInput {
  doc_ids?: string[];
  tags?: string[];
}

/**
 * Output for list_documentation tool
 */
export interface ListDocumentationOutput {
  documents: DocumentationSummary[];
  total_documents: number;
  total_chunks: number;
}

/**
 * Summary of an indexed documentation
 */
export interface DocumentationSummary {
  doc_id: string;
  files: string[];
  tags: string[];
  section_count: number;
  code_block_count: number;
  indexed_at: Date;
}

/**
 * Input for delete_documentation tool
 */
export interface DeleteDocumentationInput {
  doc_ids: string[];
}

/**
 * Output for delete_documentation tool
 */
export interface DeleteDocumentationOutput {
  success: boolean;
  deleted_doc_ids: string[];
  chunks_deleted: number;
  files_deleted: number;
}
