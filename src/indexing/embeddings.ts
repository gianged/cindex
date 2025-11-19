/**
 * Embedding generation with enhanced text construction
 *
 * Generates vector embeddings for code chunks using Ollama with a structured
 * text format that includes file context, code type, language, content, and symbols.
 * Supports batch processing with concurrency control and dimension validation.
 */

import { EmbeddingGenerationError, VectorDimensionError } from '@utils/errors';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type EmbeddingConfig } from '@/types/config';
import { type ChunkEmbedding, type CodeChunkInput } from '@/types/indexing';

/**
 * Embedding generator with enhanced text construction
 */
export class EmbeddingGenerator {
  constructor(
    private readonly ollamaClient: OllamaClient,
    private readonly config: EmbeddingConfig
  ) {}

  /**
   * Generate embedding for a single code chunk
   *
   * Constructs enhanced text with file context and generates embedding vector
   * using the configured model. Validates dimension matches configuration.
   *
   * @param chunk - Code chunk to embed
   * @returns Chunk embedding with vector and metadata
   * @throws {VectorDimensionError} If embedding dimensions don't match config
   * @throws {EmbeddingGenerationError} If embedding generation fails
   */
  public generateEmbedding = async (chunk: CodeChunkInput): Promise<ChunkEmbedding> => {
    const startTime = Date.now();

    // Build enhanced text with context
    const enhancedText = this.buildEnhancedText(chunk);

    try {
      // Generate embedding via Ollama
      const embedding = await this.ollamaClient.generateEmbedding(
        this.config.model,
        enhancedText,
        this.config.dimensions
      );

      // Validate dimensions (OllamaClient also validates, but double-check)
      if (embedding.length !== this.config.dimensions) {
        throw new VectorDimensionError(
          this.config.dimensions,
          embedding.length,
          `Embedding for chunk in ${chunk.file_path}`
        );
      }

      const generationTime = Date.now() - startTime;

      logger.debug('Embedding generated', {
        chunk_id: chunk.chunk_id,
        file: chunk.file_path,
        type: chunk.chunk_type,
        dimensions: embedding.length,
        time_ms: generationTime,
      });

      return {
        chunk_id: chunk.chunk_id,
        embedding,
        embedding_model: this.config.model,
        dimension: embedding.length,
        generation_time_ms: generationTime,
        enhanced_text: enhancedText,
      };
    } catch (error) {
      if (error instanceof VectorDimensionError) {
        throw error;
      }

      throw new EmbeddingGenerationError(
        this.config.model,
        enhancedText.slice(0, 100),
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  /**
   * Batch generate embeddings for multiple chunks
   *
   * Processes chunks in batches with concurrency control using the Ollama
   * batch embedding endpoint for efficiency.
   *
   * @param chunks - Array of code chunks to embed
   * @param concurrency - Maximum concurrent requests (default: 5)
   * @returns Array of chunk embeddings
   */
  public generateBatch = async (chunks: CodeChunkInput[], concurrency = 5): Promise<ChunkEmbedding[]> => {
    logger.info('Generating batch embeddings', {
      total: chunks.length,
      concurrency,
      model: this.config.model,
      dimensions: this.config.dimensions,
    });

    const startTime = Date.now();

    // Build all enhanced texts first
    const enhancedTexts = chunks.map((chunk) => this.buildEnhancedText(chunk));

    // Generate embeddings via Ollama batch API
    const embeddings = await this.ollamaClient.generateEmbeddingBatch(
      this.config.model,
      enhancedTexts,
      this.config.dimensions,
      concurrency
    );

    // Map embeddings to chunk results
    const results: ChunkEmbedding[] = chunks.map((chunk, index) => {
      const embedding = embeddings[index] ?? [];

      if (embedding.length === 0) {
        logger.warn('Embedding missing for chunk', {
          chunk_id: chunk.chunk_id,
          file: chunk.file_path,
        });
      }

      return {
        chunk_id: chunk.chunk_id,
        embedding,
        embedding_model: this.config.model,
        dimension: embedding.length,
        generation_time_ms: 0, // Not available for batch operations
        enhanced_text: enhancedTexts[index] ?? '',
      };
    });

    const totalTime = Date.now() - startTime;

    logger.info('Batch embeddings generated', {
      total: chunks.length,
      successful: results.filter((r) => r.embedding.length > 0).length,
      failed: results.filter((r) => r.embedding.length === 0).length,
      total_time_ms: totalTime,
      avg_time_ms: Math.round(totalTime / chunks.length),
    });

    return results;
  };

  /**
   * Build enhanced text format for chunk embedding
   *
   * Format: "FILE: {path} | TYPE: {type} | LANG: {lang} | CODE: {content} | SYMBOLS: {list}"
   *
   * This structured format helps the embedding model understand the context and
   * relationships between different code chunks.
   *
   * @param chunk - Code chunk to enhance
   * @returns Enhanced text string for embedding
   */
  private buildEnhancedText = (chunk: CodeChunkInput): string => {
    // Extract symbols from metadata
    const symbols: string[] = [];

    if (chunk.metadata.function_names && Array.isArray(chunk.metadata.function_names)) {
      symbols.push(...(chunk.metadata.function_names as string[]));
    }

    if (chunk.metadata.class_names && Array.isArray(chunk.metadata.class_names)) {
      symbols.push(...(chunk.metadata.class_names as string[]));
    }

    // Build symbol list (comma-separated, max 200 chars)
    const symbolList = symbols.length > 0 ? symbols.join(', ') : 'none';
    const truncatedSymbols = symbolList.length > 200 ? symbolList.slice(0, 197) + '...' : symbolList;

    // Build enhanced text with structured format
    const enhancedText = [
      `FILE: ${chunk.file_path}`,
      `TYPE: ${chunk.chunk_type}`,
      `LANG: ${chunk.language}`,
      `CODE: ${chunk.chunk_content}`,
      `SYMBOLS: ${truncatedSymbols}`,
    ].join(' | ');

    return enhancedText;
  };

  /**
   * Generate embedding for a plain text string
   *
   * Utility method for embedding non-code text (e.g., file summaries, symbol definitions).
   *
   * @param text - Plain text to embed
   * @param context - Optional context label for logging
   * @returns Embedding vector
   */
  public generateTextEmbedding = async (text: string, context?: string): Promise<number[]> => {
    const startTime = Date.now();

    try {
      const embedding = await this.ollamaClient.generateEmbedding(this.config.model, text, this.config.dimensions);

      // Validate dimensions
      if (embedding.length !== this.config.dimensions) {
        throw new VectorDimensionError(this.config.dimensions, embedding.length, context ?? 'Text embedding');
      }

      const generationTime = Date.now() - startTime;

      logger.debug('Text embedding generated', {
        context: context ?? 'unknown',
        text_length: text.length,
        dimensions: embedding.length,
        time_ms: generationTime,
      });

      return embedding;
    } catch (error) {
      if (error instanceof VectorDimensionError) {
        throw error;
      }

      throw new EmbeddingGenerationError(
        this.config.model,
        text.slice(0, 100),
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };

  /**
   * Estimate token count for chunk content
   *
   * Rough estimation: ~4 characters per token
   *
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  public estimateTokens = (text: string): number => {
    return Math.ceil(text.length / 4);
  };

  /**
   * Validate embedding dimensions
   *
   * Helper method to check if an embedding has the correct dimensions.
   *
   * @param embedding - Embedding vector to validate
   * @returns True if dimensions match configuration
   */
  public validateDimensions = (embedding: number[]): boolean => {
    return embedding.length === this.config.dimensions;
  };
}

/**
 * Create embedding generator instance
 *
 * @param ollamaClient - Ollama client for embedding operations
 * @param config - Embedding generation configuration
 * @returns Initialized EmbeddingGenerator
 */
export const createEmbeddingGenerator = (ollamaClient: OllamaClient, config: EmbeddingConfig): EmbeddingGenerator => {
  return new EmbeddingGenerator(ollamaClient, config);
};
