/**
 * Type definitions for Phase 2: Core Indexing Pipeline
 *
 * Defines interfaces and types for file discovery, parsing, chunking,
 * and metadata extraction across single-repo, monorepo, and microservice architectures.
 */

import { type RepositoryType } from '@/types/database';

/**
 * Supported programming languages for code parsing and analysis
 */
export enum Language {
  TypeScript = 'typescript',
  JavaScript = 'javascript',
  Python = 'python',
  Java = 'java',
  Go = 'go',
  Rust = 'rust',
  C = 'c',
  CPP = 'cpp',
  Ruby = 'ruby',
  PHP = 'php',
  CSharp = 'csharp',
  Swift = 'swift',
  Kotlin = 'kotlin',
  Unknown = 'unknown',
}

/**
 * File extensions mapped to languages
 */
export const LANGUAGE_EXTENSIONS: Record<string, Language> = {
  '.ts': Language.TypeScript,
  '.tsx': Language.TypeScript,
  '.js': Language.JavaScript,
  '.jsx': Language.JavaScript,
  '.mjs': Language.JavaScript,
  '.cjs': Language.JavaScript,
  '.py': Language.Python,
  '.pyw': Language.Python,
  '.java': Language.Java,
  '.go': Language.Go,
  '.rs': Language.Rust,
  '.c': Language.C,
  '.h': Language.C,
  '.cpp': Language.CPP,
  '.cc': Language.CPP,
  '.cxx': Language.CPP,
  '.hpp': Language.CPP,
  '.hh': Language.CPP,
  '.rb': Language.Ruby,
  '.php': Language.PHP,
  '.cs': Language.CSharp,
  '.swift': Language.Swift,
  '.kt': Language.Kotlin,
  '.kts': Language.Kotlin,
};

/**
 * Metadata for a discovered file during directory traversal
 * Used by file-walker.ts before parsing and chunking
 */
export interface DiscoveredFile {
  /** Absolute path to the file */
  absolute_path: string;

  /** Path relative to repository root */
  relative_path: string;

  /** SHA256 hash of file contents (for incremental indexing) */
  file_hash: string;

  /** Detected programming language */
  language: Language;

  /** Total number of lines in file */
  line_count: number;

  /** File size in bytes */
  file_size_bytes: number;

  /** Last modified timestamp */
  modified_time: Date;

  /** File encoding (default: utf-8) */
  encoding: string;

  // Multi-project context fields (nullable for single-repo mode)

  /** Repository ID for multi-project support */
  repo_id?: string;

  /** Workspace ID for monorepo packages */
  workspace_id?: string;

  /** Package name from package.json (monorepo) */
  package_name?: string;

  /** Service ID for microservice architectures */
  service_id?: string;
}

/**
 * Type of parsed syntax node from tree-sitter
 */
export enum NodeType {
  Function = 'function',
  Class = 'class',
  Method = 'method',
  Import = 'import',
  Export = 'export',
  Variable = 'variable',
  Constant = 'constant',
  Interface = 'interface',
  Type = 'type',
  TopLevelBlock = 'top_level_block',
}

/**
 * Parameter definition for function/method signatures
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string;

  /** Type annotation (if available) */
  type?: string;

  /** Default value (if present) */
  default_value?: string;

  /** Whether parameter is optional */
  is_optional: boolean;

  /** Whether parameter is rest/spread parameter */
  is_rest: boolean;
}

/**
 * Parsed syntax node from tree-sitter
 * Represents functions, classes, imports, exports, etc.
 */
export interface ParsedNode {
  /** Type of syntax node */
  node_type: NodeType;

  /** Node identifier (function/class/variable name) */
  name: string;

  /** Starting line number (1-indexed) */
  start_line: number;

  /** Ending line number (1-indexed) */
  end_line: number;

  /** Raw code text of the node */
  code_text: string;

  /** Function/method parameters */
  parameters?: ParameterInfo[];

  /** Return type annotation (if available) */
  return_type?: string;

  /** Docstring or JSDoc comment */
  docstring?: string;

  /** Cyclomatic complexity (for functions/methods) */
  complexity?: number;

  /** Child nodes (e.g., methods within a class) */
  children?: ParsedNode[];

  /** Whether function/method is async */
  is_async?: boolean;

  /** Whether function/method is static */
  is_static?: boolean;

  /** Whether function/method is private/protected/public */
  visibility?: 'private' | 'protected' | 'public';
}

/**
 * Import statement information
 */
export interface ImportInfo {
  /** Imported symbols/identifiers */
  symbols: string[];

  /** Source module/file path */
  source: string;

  /** Whether this is a default import */
  is_default: boolean;

  /** Whether this is a namespace import (import * as) */
  is_namespace: boolean;

  /** Alias for namespace imports (e.g., "React" in "import * as React") */
  namespace_alias?: string;

  /** Whether this is an internal workspace import (monorepo) */
  is_internal?: boolean;

  /** Line number where import appears */
  line_number: number;
}

/**
 * Export statement information
 */
export interface ExportInfo {
  /** Exported symbols/identifiers */
  symbols: string[];

  /** Whether this is a default export */
  is_default: boolean;

  /** Whether this is a re-export (export { x } from './y') */
  is_reexport: boolean;

  /** Source module for re-exports */
  reexport_source?: string;

  /** Line number where export appears */
  line_number: number;
}

/**
 * Chunk type classification
 */
export enum ChunkType {
  /** File summary (first 100 lines or entire file) */
  FileSummary = 'file_summary',

  /** Import block (all imports grouped) */
  ImportBlock = 'import_block',

  /** Function definition */
  Function = 'function',

  /** Class definition with methods */
  Class = 'class',

  /** Top-level code block */
  Block = 'block',

  /** Fallback chunk from regex-based parsing */
  Fallback = 'fallback',
}

/**
 * Code chunk with metadata (output of chunker.ts)
 * This is the intermediate representation before database insertion
 */
export interface CodeChunkInput {
  /** Unique identifier (UUID v4) */
  chunk_id: string;

  /** Absolute file path */
  file_path: string;

  /** Programming language (e.g., 'typescript', 'python', 'rust') */
  language: string;

  /** Raw code content */
  chunk_content: string;

  /** Chunk classification */
  chunk_type: ChunkType;

  /** Starting line number in file (1-indexed) */
  start_line: number;

  /** Ending line number in file (1-indexed) */
  end_line: number;

  /** Estimated token count (4 chars ≈ 1 token) */
  token_count: number;

  /** Chunk metadata (functions, classes, imports, exports, complexity) */
  metadata: Record<string, unknown>;

  /** Timestamp when chunk was created */
  created_at: Date;

  // Multi-project context fields

  /** Repository ID */
  repo_id?: string;

  /** Workspace ID (monorepo) */
  workspace_id?: string;

  /** Package name (monorepo) */
  package_name?: string;

  /** Service ID (microservice) */
  service_id?: string;

  /** Whether this chunk is from a large file (>5000 lines) */
  large_file?: boolean;
}

/**
 * Metadata extracted from code chunks
 * Stored in chunk metadata field as JSONB
 */
export interface ChunkMetadata {
  /** Function names defined in this chunk */
  function_names: string[];

  /** Class names defined in this chunk */
  class_names: string[];

  /** Imported symbols/modules */
  imported_symbols: string[];

  /** Exported symbols */
  exported_symbols: string[];

  /** Dependencies (other files/modules referenced) */
  dependencies: string[];

  /** Cyclomatic complexity (total for chunk) */
  complexity: number;

  /** Whether chunk contains async/await */
  has_async: boolean;

  /** Whether chunk contains loops */
  has_loops: boolean;

  /** Whether chunk contains conditionals */
  has_conditionals: boolean;

  /** Whether imports are internal workspace imports (monorepo) */
  is_internal_import?: boolean;

  /** API endpoints defined in this chunk (microservices) */
  api_endpoints?: APIEndpointInfo[];

  /** Additional language-specific metadata */
  [key: string]: unknown;
}

/**
 * API endpoint information extracted from code
 * Used for microservice architectures
 */
export interface APIEndpointInfo {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH) or GraphQL/gRPC */
  method: string;

  /** Endpoint path or operation name */
  path: string;

  /** Handler function name */
  handler?: string;

  /** Line number where endpoint is defined */
  line_number: number;

  /** API type (rest, graphql, grpc) */
  api_type: 'rest' | 'graphql' | 'grpc';
}

/**
 * File processing options for indexing pipeline
 */
export interface IndexingOptions {
  // Core options
  /** Enable incremental indexing (skip unchanged files) */
  incremental?: boolean;

  /** Languages to index (empty array = all languages) */
  languages?: string[];

  /** Include markdown files (except README.md which is always included) */
  includeMarkdown?: boolean;

  /** Respect .gitignore patterns during file discovery */
  respectGitignore?: boolean;

  /** Maximum file size in lines (skip larger files) */
  maxFileSize?: number;

  /** Enable secret file protection (detect .env, credentials, keys) */
  protectSecrets?: boolean;

  /** Custom patterns for secret file detection (glob-style) */
  secretPatterns?: string[];

  /** Summary generation method */
  summaryMethod?: 'llm' | 'rule-based';

  // Repository configuration
  /** Repository ID for multi-project mode */
  repoId?: string;

  /** Repository name */
  repoName?: string;

  /** Repository type */
  repoType?: RepositoryType;

  // Multi-project options
  /** Enable workspace detection for monorepos */
  detectWorkspaces?: boolean;

  /** Workspace configuration (package.json patterns, etc.) */
  workspaceConfig?: unknown;

  /** Resolve workspace import aliases */
  resolveWorkspaceAliases?: boolean;

  /** Enable service detection for microservices */
  detectServices?: boolean;

  /** Service configuration (docker-compose, serverless, etc.) */
  serviceConfig?: unknown;

  /** Detect API endpoints in services */
  detectApiEndpoints?: boolean;

  /** Link to other indexed repositories */
  linkToRepos?: string[];

  /** Update cross-repository dependencies */
  updateCrossRepoDeps?: boolean;

  // Reference repository options
  /** Version string for reference repositories */
  version?: string;

  /** Force re-indexing even if version matches */
  forceReindex?: boolean;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Progress callback for MCP notifications */
  onProgress?: (stage: string, current: number, total: number, message: string, etaSeconds?: number) => void;

  // Legacy properties (for backwards compatibility)
  /** @deprecated Use includeMarkdown */
  include_markdown?: boolean;

  /** @deprecated Use maxFileSize */
  max_file_size?: number;

  /** Target chunk size range */
  chunk_size_min?: number;
  chunk_size_max?: number;

  /** @deprecated Use detectWorkspaces */
  enable_workspace_detection?: boolean;

  /** @deprecated Use detectServices */
  enable_service_detection?: boolean;

  /** Enable multi-repository support */
  enable_multi_repo?: boolean;

  /** @deprecated Use detectApiEndpoints */
  enable_api_endpoint_detection?: boolean;

  /** @deprecated Use repoId */
  repo_id?: string;

  /** @deprecated Use repoType */
  repo_type?: 'monorepo' | 'microservice' | 'monolithic';
}

/**
 * Result of file parsing operation
 */
export interface ParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed nodes (functions, classes, imports, exports) */
  nodes: ParsedNode[];

  /** Import statements */
  imports: ImportInfo[];

  /** Export statements */
  exports: ExportInfo[];

  /** Error message if parsing failed */
  error?: string;

  /** Whether fallback parsing was used */
  used_fallback: boolean;
}

/**
 * Result of chunking operation
 */
export interface ChunkingResult {
  /** Generated code chunks */
  chunks: CodeChunkInput[];

  /** Total number of chunks created */
  chunk_count: number;

  /** Whether file was processed as large file (structure-only) */
  is_large_file: boolean;

  /** Warnings encountered during chunking */
  warnings: string[];
}

/**
 * Statistics for file discovery operation
 */
export interface FileDiscoveryStats {
  /** Total files discovered */
  total_files: number;

  /** Files excluded by gitignore */
  excluded_by_gitignore: number;

  /** Binary files excluded */
  excluded_binary: number;

  /** Files skipped due to size */
  excluded_size: number;

  /** Files excluded by secret file protection */
  excluded_by_secret_protection: number;

  /** Files by language */
  files_by_language: Record<Language, number>;

  /** Total lines of code */
  total_lines: number;
}

/**
 * ============================================================================
 * Phase 3: Embedding & Summary Generation Types
 * ============================================================================
 */

/**
 * File summary result (LLM or rule-based)
 */
export interface FileSummary {
  /** File path */
  file_path: string;

  /** Generated summary text */
  summary_text: string;

  /** Method used to generate summary */
  summary_method: 'llm' | 'rule-based';

  /** Model name used (if LLM method) */
  model_used?: string;

  /** Time taken to generate summary in milliseconds */
  generation_time_ms: number;
}

/**
 * Chunk embedding result
 */
export interface ChunkEmbedding {
  /** Chunk ID (UUID) */
  chunk_id: string;

  /** Generated embedding vector */
  embedding: number[];

  /** Embedding model name */
  embedding_model: string;

  /** Vector dimension */
  dimension: number;

  /** Time taken to generate embedding in milliseconds */
  generation_time_ms: number;

  /** Enhanced text used for embedding */
  enhanced_text: string;
}

/**
 * Extracted symbol with embedding
 */
export interface ExtractedSymbol {
  /** Symbol ID (UUID) */
  symbol_id: string;

  /** Symbol name */
  symbol_name: string;

  /** Symbol type */
  symbol_type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'constant' | 'method';

  /** File path where symbol is defined */
  file_path: string;

  /** Line number */
  line_number: number;

  /** Symbol definition text */
  definition: string;

  /** Symbol embedding vector */
  embedding: number[];

  /** Symbol scope */
  scope: 'exported' | 'internal';

  /** Repository context (multi-project) */
  repo_id?: string;
  workspace_id?: string;
  package_name?: string;
  service_id?: string;
}

/**
 * Indexing pipeline stage
 */
export enum IndexingStage {
  Starting = 'starting',
  Discovering = 'discovering',
  Parsing = 'parsing',
  Chunking = 'chunking',
  Summarizing = 'summarizing',
  Embedding = 'embedding',
  Symbols = 'symbols',
  Persisting = 'persisting',
  Complete = 'complete',
  Failed = 'failed',
}

/**
 * Complete indexing statistics
 */
export interface IndexingStats {
  // Repository identification
  /** Repository ID */
  repo_id?: string;

  /** Repository type */
  repo_type?: string;

  // File statistics
  /** Total files to process */
  files_total: number;

  /** Files successfully indexed (alias for files_processed) */
  files_indexed: number;

  /** Files successfully processed */
  files_processed: number;

  /** Files that failed processing */
  files_failed: number;

  // Chunk statistics
  /** Total chunks generated */
  chunks_total: number;

  /** Chunks created (alias for chunks_total) */
  chunks_created: number;

  /** Chunks successfully embedded */
  chunks_embedded: number;

  // Symbol statistics
  /** Symbols extracted */
  symbols_extracted: number;

  // Multi-project statistics
  /** Workspaces detected (monorepo) */
  workspaces_detected?: number;

  /** Services detected (microservice) */
  services_detected?: number;

  /** API endpoints found */
  api_endpoints_found?: number;

  // Timing statistics
  /** Total time taken in milliseconds */
  total_time_ms: number;

  /** Indexing time in milliseconds (alias for total_time_ms) */
  indexing_time_ms: number;

  /** Average time per file in milliseconds */
  avg_file_time_ms: number;

  // Summary statistics
  /** Summaries generated using LLM */
  summaries_llm: number;

  /** Summaries generated using rule-based fallback */
  summaries_fallback: number;

  /** Current indexing stage */
  stage: IndexingStage;

  /** Errors encountered during indexing */
  errors: {
    file_path?: string;
    stage: IndexingStage;
    error: string;
  }[];
}

/**
 * Batch insert operation result
 */
export interface BatchInsertResult {
  /** Number of successfully inserted records */
  inserted: number;

  /** Number of failed inserts */
  failed: number;

  /** Errors encountered */
  errors: {
    batch: number;
    error: string;
  }[];
}
