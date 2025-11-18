/**
 * Unit tests for configuration system
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { loadConfig, validateConfig } from '@config/env';
import { ConfigurationError } from '@utils/errors';

describe('Configuration System', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore environment after each test
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load configuration with defaults', () => {
      process.env.POSTGRES_PASSWORD = 'testpass';

      const config = loadConfig();

      expect(config.embedding.model).toBe('bge-m3:567m');
      expect(config.embedding.dimensions).toBe(1024);
      expect(config.database.host).toBe('localhost');
      expect(config.database.port).toBe(5432);
      expect(config.database.password).toBe('testpass');
    });

    it('should override defaults with environment variables', () => {
      process.env.POSTGRES_PASSWORD = 'testpass';
      process.env.EMBEDDING_MODEL = 'custom-model';
      process.env.EMBEDDING_DIMENSIONS = '768';
      process.env.POSTGRES_HOST = 'custom-host';
      process.env.POSTGRES_PORT = '5433';

      const config = loadConfig();

      expect(config.embedding.model).toBe('custom-model');
      expect(config.embedding.dimensions).toBe(768);
      expect(config.database.host).toBe('custom-host');
      expect(config.database.port).toBe(5433);
    });

    it('should throw error if POSTGRES_PASSWORD is missing', () => {
      delete process.env.POSTGRES_PASSWORD;

      expect(() => loadConfig()).toThrow(ConfigurationError);
      expect(() => loadConfig()).toThrow('POSTGRES_PASSWORD');
    });

    it('should validate numeric ranges', () => {
      process.env.POSTGRES_PASSWORD = 'testpass';
      process.env.POSTGRES_PORT = '99999'; // Invalid port

      expect(() => loadConfig()).toThrow(ConfigurationError);
    });

    it('should parse boolean values correctly', () => {
      process.env.POSTGRES_PASSWORD = 'testpass';
      process.env.ENABLE_WORKSPACE_DETECTION = 'false';
      process.env.ENABLE_MULTI_REPO = 'true';

      const config = loadConfig();

      expect(config.features.enable_workspace_detection).toBe(false);
      expect(config.features.enable_multi_repo).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should validate embedding dimensions', () => {
      const config = loadConfig();
      config.embedding.dimensions = 999; // Invalid dimension

      expect(() => {
        validateConfig(config);
      }).toThrow(ConfigurationError);
    });

    it('should validate similarity thresholds', () => {
      const config = loadConfig();
      config.performance.similarity_threshold = 0.95;
      config.performance.dedup_threshold = 0.8; // Lower than similarity

      expect(() => {
        validateConfig(config);
      }).toThrow(ConfigurationError);
    });

    it('should pass with valid configuration', () => {
      process.env.POSTGRES_PASSWORD = 'testpass';
      const config = loadConfig();

      expect(() => {
        validateConfig(config);
      }).not.toThrow();
    });
  });
});
