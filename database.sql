-- cindex - RAG MCP for Code Context - Database Schema
-- Project: @gianged/cindex
-- PostgreSQL with pgvector extension required

-- CONFIGURATION NOTE:
-- Vector dimensions below (1024) match mxbai-embed-large model
-- If using a different embedding model in MCP config (EMBEDDING_MODEL env var),
-- update all vector(1024) declarations to match EMBEDDING_DIMENSIONS:
--   - mxbai-embed-large: 1024
--   - nomic-embed-text: 768
--   - Custom models: Check model documentation

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Core embeddings table
CREATE TABLE code_chunks (
    id BIGSERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_type TEXT NOT NULL, -- 'file_summary', 'function', 'class', 'import_block', 'fallback'
    chunk_content TEXT NOT NULL,
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    language TEXT NOT NULL,
    embedding vector(1024), -- mxbai-embed-large dimension
    token_count INT, -- For context budget management
    metadata JSONB, -- {function_name, class_name, complexity, dependencies}
    indexed_at TIMESTAMP DEFAULT NOW()
);

-- File-level index for quick filtering
CREATE TABLE code_files (
    id SERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_summary TEXT, -- High-level "what this file does"
    summary_embedding vector(1024),
    language TEXT NOT NULL,
    total_lines INT,
    imports TEXT[], -- Array of import statements
    exports TEXT[], -- Exported symbols
    file_hash TEXT NOT NULL, -- SHA256 for change detection
    last_modified TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT NOW()
);

-- Symbol registry for quick lookup
CREATE TABLE code_symbols (
    id SERIAL PRIMARY KEY,
    repo_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL, -- 'function', 'class', 'variable', 'type'
    file_path TEXT NOT NULL,
    line_number INT NOT NULL,
    definition TEXT, -- Actual definition line
    embedding vector(1024)
);

-- Standard indexes
CREATE INDEX idx_chunks_file ON code_chunks(file_path);
CREATE INDEX idx_chunks_type ON code_chunks(chunk_type);
CREATE INDEX idx_files_hash ON code_files(file_hash);
CREATE INDEX idx_symbols_name ON code_symbols(symbol_name);

-- Vector indexes (HNSW for production, consider IVFFlat for testing)
-- Note: Building HNSW on large datasets (1M+ vectors) takes 10-30 minutes
CREATE INDEX idx_chunks_vector ON code_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_files_vector ON code_files USING hnsw (summary_embedding vector_cosine_ops);
CREATE INDEX idx_symbols_vector ON code_symbols USING hnsw (embedding vector_cosine_ops);

-- Alternative for testing (faster build, slightly slower queries):
-- CREATE INDEX idx_chunks_vector ON code_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_files_vector ON code_files USING ivfflat (summary_embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_symbols_vector ON code_symbols USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Performance tuning for HNSW (Accuracy-focused configuration)
-- These settings can be overridden at runtime via MCP environment variables
-- See MCP configuration section in implementation plan for details

-- Adjust ef_search for accuracy/speed tradeoff
-- Higher values = better accuracy, slower queries
-- Recommended for accuracy priority: 200-400
-- MCP env var: HNSW_EF_SEARCH (default: 300)
SET hnsw.ef_search = 300;

-- For index creation (affects build time and quality)
-- MCP env var: HNSW_EF_CONSTRUCTION (default: 200)
-- SET hnsw.ef_construction = 200; -- Default is 64, higher = better quality index

-- NOTE: Changes to ef_search take effect immediately (runtime parameter)
-- Changes to ef_construction require index rebuild

-- Comments for table purposes
COMMENT ON TABLE code_chunks IS 'Stores embeddings for code chunks (functions, classes, blocks)';
COMMENT ON TABLE code_files IS 'File-level metadata and summaries for quick filtering';
COMMENT ON TABLE code_symbols IS 'Symbol registry for function/class/variable lookups';

COMMENT ON COLUMN code_chunks.chunk_type IS 'Type of chunk: file_summary, function, class, import_block, or fallback';
COMMENT ON COLUMN code_chunks.token_count IS 'Estimated token count for context window management (~4 chars = 1 token)';
COMMENT ON COLUMN code_files.file_hash IS 'SHA256 hash for incremental update detection';
COMMENT ON COLUMN code_files.imports IS 'Array of import statements for dependency tracking';
COMMENT ON COLUMN code_files.exports IS 'Exported symbols for import chain resolution';