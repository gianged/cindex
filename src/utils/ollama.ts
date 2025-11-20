/**
 * Ollama client with comprehensive error handling
 * Handles embedding generation, model validation, and connection health checks
 */

import { type OllamaConfig } from '@/types/config';

import {
  EmbeddingGenerationError,
  ModelNotFoundError,
  OllamaConnectionError,
  RequestTimeoutError,
  retryWithBackoff,
  VectorDimensionError,
} from './errors';
import { logger } from './logger';

/**
 * Response from Ollama /api/tags endpoint
 */
interface OllamaListResponse {
  models: {
    name: string;
    model: string;
    modified_at: string;
    size: number;
  }[];
}

/**
 * Response from Ollama /api/embeddings endpoint
 */
interface OllamaEmbedResponse {
  embedding: number[];
}

/**
 * Response from Ollama /api/generate endpoint
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Ollama client for embeddings and LLM operations
 *
 * Provides methods for:
 * - Health checks and model validation
 * - Embedding generation with retry logic
 * - LLM-based summary generation
 * - Batch operations with concurrency control
 */
export class OllamaClient {
  /**
   * Create Ollama client
   *
   * @param config - Ollama configuration (host, timeout, retry settings)
   */
  constructor(private config: OllamaConfig) {}

  /**
   * Ping Ollama to check if it's running
   *
   * @returns True if Ollama is accessible, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      // Use AbortController for timeout handling
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.config.timeout);

      const response = await fetch(`${this.config.host}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Health check - verify Ollama is running and models are available
   *
   * @param embeddingModel - Name of embedding model to validate
   * @param summaryModel - Name of summary model to validate
   * @throws {OllamaConnectionError} If Ollama is not accessible
   * @throws {ModelNotFoundError} If required models are not available
   */
  async healthCheck(embeddingModel: string, summaryModel: string): Promise<void> {
    logger.debug('Performing Ollama health check', {
      host: this.config.host,
      embeddingModel,
      summaryModel,
    });

    // Check if Ollama is running
    const isRunning = await this.ping();
    if (!isRunning) {
      throw new OllamaConnectionError(this.config.host);
    }

    logger.healthCheck('Ollama', 'OK', { host: this.config.host });

    // Check if models are available
    await this.checkModelAvailable(embeddingModel);
    await this.checkModelAvailable(summaryModel);

    logger.info('All Ollama models available', {
      embeddingModel,
      summaryModel,
    });
  }

  /**
   * List available models on Ollama instance
   *
   * @returns Array of model names
   * @throws {RequestTimeoutError} If request times out
   * @throws {OllamaConnectionError} If connection fails
   */
  async listModels(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.config.timeout);

      const response = await fetch(`${this.config.host}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaListResponse;
      return data.models.map((m) => m.name);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RequestTimeoutError('Ollama list models', this.config.timeout);
      }
      throw new OllamaConnectionError(this.config.host, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Check if a model is available on Ollama instance
   *
   * @param modelName - Name of model to check
   * @throws {ModelNotFoundError} If model is not found
   */
  async checkModelAvailable(modelName: string): Promise<void> {
    const models = await this.listModels();
    const available = models.some((m) => m === modelName || m.startsWith(modelName + ':'));

    if (!available) {
      throw new ModelNotFoundError(modelName, this.config.host);
    }
  }

  /**
   * Generate embedding vector for text
   *
   * Uses retry logic with exponential backoff for transient failures.
   * Validates embedding dimensions match expected model output.
   *
   * @param modelName - Name of embedding model (e.g., "bge-m3:567m")
   * @param text - Text to embed (will be truncated if too long)
   * @param expectedDimensions - Expected vector dimensions (e.g., 1024)
   * @param contextWindow - Optional context window size in tokens
   * @returns Embedding vector as array of floats
   * @throws {EmbeddingGenerationError} If embedding generation fails
   * @throws {VectorDimensionError} If dimensions don't match expected
   * @throws {RequestTimeoutError} If request times out
   */
  async generateEmbedding(
    modelName: string,
    text: string,
    expectedDimensions: number,
    contextWindow?: number
  ): Promise<number[]> {
    const generateFn = async (): Promise<number[]> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, this.config.timeout);

        const response = await fetch(`${this.config.host}/api/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            prompt: text,
            ...(contextWindow && {
              options: {
                num_ctx: contextWindow,
              },
            }),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
        }

        const data = (await response.json()) as OllamaEmbedResponse;

        // Validate dimensions
        if (data.embedding.length !== expectedDimensions) {
          throw new VectorDimensionError(expectedDimensions, data.embedding.length, `Embedding model ${modelName}`);
        }

        return data.embedding;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new RequestTimeoutError(`Generate embedding with ${modelName}`, this.config.timeout);
        }
        if (error instanceof VectorDimensionError || error instanceof RequestTimeoutError) {
          throw error;
        }
        throw new EmbeddingGenerationError(modelName, text, error instanceof Error ? error : new Error(String(error)));
      }
    };

    return retryWithBackoff(generateFn, this.config.retry_attempts, 1000, `Generate embedding with ${modelName}`);
  }

  /**
   * Generate text summary using LLM
   *
   * Uses retry logic with exponential backoff for transient failures.
   *
   * @param modelName - Name of LLM model (e.g., "qwen2.5-coder:7b")
   * @param prompt - Prompt for summary generation
   * @param contextWindow - Optional context window size in tokens
   * @returns Generated summary text
   * @throws {RequestTimeoutError} If request times out
   * @throws {Error} If summary generation fails after retries
   */
  async generateSummary(modelName: string, prompt: string, contextWindow?: number): Promise<string> {
    const generateFn = async (): Promise<string> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, this.config.timeout);

        const response = await fetch(`${this.config.host}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            prompt,
            stream: false,
            ...(contextWindow && {
              options: {
                num_ctx: contextWindow,
              },
            }),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        return data.response.trim();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new RequestTimeoutError(`Generate summary with ${modelName}`, this.config.timeout);
        }
        throw new Error(`Summary generation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    return retryWithBackoff(generateFn, this.config.retry_attempts, 1000, `Generate summary with ${modelName}`);
  }

  /**
   * Batch generate embeddings for multiple texts
   *
   * Processes texts in batches with concurrency control to avoid overwhelming Ollama.
   * Failed embeddings are logged but don't stop the batch operation.
   *
   * @param modelName - Name of embedding model
   * @param texts - Array of texts to embed
   * @param expectedDimensions - Expected vector dimensions
   * @param concurrency - Number of concurrent requests (default: 5)
   * @param contextWindow - Optional context window size in tokens
   * @returns Array of embedding vectors (undefined for failed embeddings)
   */
  async generateEmbeddingBatch(
    modelName: string,
    texts: string[],
    expectedDimensions: number,
    concurrency = 5,
    contextWindow?: number
  ): Promise<number[][]> {
    const results: number[][] = new Array<number[]>(texts.length);
    const errors: { index: number; error: Error }[] = [];

    // Process in batches with limited concurrency
    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, Math.min(i + concurrency, texts.length));
      const promises = batch.map(async (text, batchIndex) => {
        const index = i + batchIndex;
        try {
          const embedding = await this.generateEmbedding(modelName, text, expectedDimensions, contextWindow);
          results[index] = embedding;
        } catch (error) {
          errors.push({
            index,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

      await Promise.all(promises);

      // Log progress
      logger.debug('Embedding batch progress', {
        completed: Math.min(i + concurrency, texts.length),
        total: texts.length,
      });
    }

    // Report errors
    if (errors.length > 0) {
      logger.warn(`Failed to generate ${String(errors.length)} embeddings`, {
        failedIndices: errors.map((e) => e.index),
      });
    }

    return results;
  }
}

/**
 * Create Ollama client instance
 *
 * @param config - Ollama configuration
 * @returns Initialized OllamaClient
 */
export const createOllamaClient = (config: OllamaConfig): OllamaClient => {
  return new OllamaClient(config);
};
