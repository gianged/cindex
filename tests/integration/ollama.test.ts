/**
 * Integration tests for Ollama client
 */

import { beforeAll, describe, expect, it } from '@jest/globals';

import type { OllamaConfig } from '@/types/config';

import { createOllamaClient } from '../../src/utils/ollama';

describe('Ollama Integration', () => {
  let ollama: ReturnType<typeof createOllamaClient>;

  const config: OllamaConfig = {
    host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    timeout: 90000, // Increased for 14B model summaries
    retry_attempts: 3,
  };

  beforeAll(() => {
    ollama = createOllamaClient(config);
  });

  describe('Connection', () => {
    it('should ping Ollama successfully', async () => {
      const isRunning = await ollama.ping();
      expect(isRunning).toBe(true);
    }, 10000);

    it('should list available models', async () => {
      const models = await ollama.listModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Model Availability', () => {
    it('should check if model is available', async () => {
      const models = await ollama.listModels();

      if (models.length > 0) {
        await expect(ollama.checkModelAvailable(models[0])).resolves.not.toThrow();
      }
    }, 10000);

    it('should throw error for unavailable model', async () => {
      await expect(ollama.checkModelAvailable('non-existent-model-12345')).rejects.toThrow();
    }, 10000);
  });

  describe('Embeddings', () => {
    it('should generate embedding for text', async () => {
      const models = await ollama.listModels();

      // Prioritize embedding models (bge, embed) and exclude coder models
      const embeddingModel =
        models.find((m) => m.includes('bge') || m.includes('embed')) ??
        models.find((m) => !m.includes('coder') && !m.includes('llama')) ??
        models[0];

      // Determine dimensions based on model
      const expectedDimensions = embeddingModel.includes('bge-m3')
        ? 1024
        : embeddingModel.includes('deepcoder')
          ? 5120
          : embeddingModel.includes('mxbai')
            ? 1024
            : 768;

      const text = 'function hello() { return "world"; }';
      const embedding = await ollama.generateEmbedding(embeddingModel, text, expectedDimensions);

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(expectedDimensions);
      expect(embedding.every((n) => typeof n === 'number')).toBe(true);
    }, 90000); // Increased for initial model loading

    it('should generate batch embeddings', async () => {
      const models = await ollama.listModels();

      // Prioritize embedding models and exclude coder models
      const embeddingModel =
        models.find((m) => m.includes('bge') || m.includes('embed')) ??
        models.find((m) => !m.includes('coder') && !m.includes('llama')) ??
        models[0];

      const expectedDimensions = embeddingModel.includes('bge-m3')
        ? 1024
        : embeddingModel.includes('deepcoder')
          ? 5120
          : embeddingModel.includes('mxbai')
            ? 1024
            : 768;

      const texts = ['const x = 1;', 'const y = 2;', 'const z = 3;'];

      const embeddings = await ollama.generateEmbeddingBatch(embeddingModel, texts, expectedDimensions, 2);

      expect(embeddings.length).toBe(3);
      expect(embeddings.every((e) => e.length === expectedDimensions)).toBe(true);
    }, 90000); // Increased for consistency
  });

  describe('Summary Generation', () => {
    it('should generate text summary', async () => {
      const models = await ollama.listModels();
      const summaryModel = models.find((m) => m.includes('coder') || m.includes('llama')) ?? models[0];

      const prompt = 'Summarize this code in one sentence: function add(a, b) { return a + b; }';
      const summary = await ollama.generateSummary(summaryModel, prompt);

      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    }, 90000); // Increased timeout for 14B model
  });
});
