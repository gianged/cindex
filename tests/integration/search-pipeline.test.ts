/**
 * Integration tests for multi-project search pipeline
 *
 * Tests the 9-stage retrieval pipeline with scope filtering:
 * - Stage 0: Scope Filtering
 * - Stage 1: Query Processing
 * - Stage 2: File Retrieval (scope-filtered)
 * - Stage 3: Chunk Retrieval (scope-filtered)
 * - Stage 4: Symbol Resolution
 * - Stage 5: Import Expansion
 * - Stage 6: API Contract Enrichment
 * - Stage 7: Deduplication
 * - Stage 8: Context Assembly
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createDatabaseClient, type DatabaseClient } from '@database/client';
import { upsertRepository } from '@database/queries';
import { determineSearchScope } from '@retrieval/scope-filter';
import { searchCodebase } from '@retrieval/search';
import { createOllamaClient, type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';
import { type SearchOptions } from '@/types/retrieval';

describe('Search Pipeline Integration Tests', () => {
  let db: DatabaseClient;
  let ollama: OllamaClient;
  let config: CindexConfig;

  // Test repository IDs
  const REPO_MAIN = 'test-repo-main';
  const REPO_SERVICE_A = 'test-repo-service-a';
  const REPO_SERVICE_B = 'test-repo-service-b';
  const REPO_REFERENCE = 'test-repo-reference-nestjs';

  beforeAll(async () => {
    // Initialize database connection
    db = createDatabaseClient({
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number.parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      database: process.env.POSTGRES_DB ?? 'cindex_test',
      user: process.env.POSTGRES_USER ?? 'postgres',
      password: process.env.POSTGRES_PASSWORD ?? 'postgres',
    });

    // Initialize Ollama client
    ollama = createOllamaClient({
      host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    });

    // Create test configuration
    config = {
      embedding: {
        model: 'bge-m3:567m',
        dimensions: 1024,
        context_window: 4096,
      },
      summary: {
        model: 'qwen2.5-coder:7b',
        context_window: 4096,
      },
      performance: {
        hnsw_ef_search: 100, // Faster for tests
        hnsw_ef_construction: 50,
        similarity_threshold: 0.7,
        dedup_threshold: 0.92,
        import_depth: 2, // Reduced for tests
      },
      ollama: {
        host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
      },
      database: {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number.parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
        database: process.env.POSTGRES_DB ?? 'cindex_test',
        user: process.env.POSTGRES_USER ?? 'postgres',
        password: process.env.POSTGRES_PASSWORD ?? 'postgres',
      },
    };

    // Setup test repositories
    await setupTestRepositories();
  }, 30000);

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();

    // Close connections
    await db.end();
  });

  /**
   * Setup test repositories with different types
   */
  const setupTestRepositories = async (): Promise<void> => {
    // Main application repository
    await upsertRepository(db, {
      repo_id: REPO_MAIN,
      repo_path: '/test/main-app',
      repo_type: 'monolithic',
      repo_name: 'Main Application',
      metadata: { description: 'Main application repository' },
    });

    // Microservice A
    await upsertRepository(db, {
      repo_id: REPO_SERVICE_A,
      repo_path: '/test/service-a',
      repo_type: 'microservice',
      repo_name: 'Service A',
      metadata: { description: 'Authentication service' },
    });

    // Microservice B
    await upsertRepository(db, {
      repo_id: REPO_SERVICE_B,
      repo_path: '/test/service-b',
      repo_type: 'microservice',
      repo_name: 'Service B',
      metadata: { description: 'Payment service' },
    });

    // Reference repository (NestJS framework)
    await upsertRepository(db, {
      repo_id: REPO_REFERENCE,
      repo_path: '/test/reference/nestjs',
      repo_type: 'reference',
      repo_name: 'NestJS Framework',
      metadata: {
        description: 'NestJS framework for learning',
        version: 'v10.3.0',
        upstream_url: 'https://github.com/nestjs/nest',
      },
    });

    // Insert test files and chunks (simplified for test)
    // In real tests, you'd index actual code here
  };

  /**
   * Cleanup test data
   */
  const cleanupTestData = async (): Promise<void> => {
    await db.query('DELETE FROM repositories WHERE repo_id LIKE $1', ['test-repo-%']);
  };

  describe('Stage 0: Scope Filtering', () => {
    it('should filter by global scope (exclude references by default)', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'global',
        },
        db
      );

      expect(scopeFilter.mode).toBe('global');
      expect(scopeFilter.include_references).toBe(false);
      expect(scopeFilter.include_documentation).toBe(false);

      // Should include main app and services, but not reference
      const repoIds = scopeFilter.repo_ids;
      expect(repoIds).not.toContain(REPO_REFERENCE);
    });

    it('should filter by global scope (include references)', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'global',
          include_references: true,
        },
        db
      );

      expect(scopeFilter.include_references).toBe(true);

      // Should include reference repository
      const repoIds = scopeFilter.repo_ids;
      expect(repoIds).toContain(REPO_REFERENCE);
    });

    it('should filter by specific repository', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'repository',
          repo_ids: [REPO_MAIN],
        },
        db
      );

      expect(scopeFilter.mode).toBe('repository');
      expect(scopeFilter.repo_ids).toEqual([REPO_MAIN]);
    });

    it('should exclude specific repositories', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'global',
          exclude_repos: [REPO_SERVICE_B],
        },
        db
      );

      expect(scopeFilter.repo_ids).not.toContain(REPO_SERVICE_B);
    });

    it('should exclude specific repo types', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'global',
          exclude_repo_types: ['microservice'],
        },
        db
      );

      // Should only include monolithic repos, excluding microservices and references
      const repoIds = scopeFilter.repo_ids;
      expect(repoIds).toContain(REPO_MAIN);
      expect(repoIds).not.toContain(REPO_SERVICE_A);
      expect(repoIds).not.toContain(REPO_SERVICE_B);
    });
  });

  describe('Full Pipeline: Search with Scope Filtering', () => {
    // Note: These tests require indexed data to work properly
    // For now, we'll test that the pipeline executes without errors

    it('should execute search with global scope', async () => {
      const options: SearchOptions = {
        max_files: 5,
        max_snippets: 10,
      };

      // This will return empty results since we haven't indexed test data,
      // but it should execute the full pipeline without errors
      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      expect(result.query).toBe('test query');
      expect(result.metadata).toBeDefined();
      expect(result.context).toBeDefined();
    }, 30000);

    it('should execute search with repository filter', async () => {
      const options: SearchOptions = {
        repo_filter: [REPO_MAIN],
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      expect(result.query).toBe('test query');
    }, 30000);

    it('should execute search excluding reference repos', async () => {
      const options: SearchOptions = {
        include_references: false,
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      // Results should not include reference repositories
    }, 30000);

    it('should execute search including reference repos', async () => {
      const options: SearchOptions = {
        include_references: true,
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      // Results may include reference repositories
    }, 30000);

    it('should execute search with service filter', async () => {
      const options: SearchOptions = {
        service_filter: ['service-a-id'],
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
    }, 30000);

    it('should execute search with workspace filter', async () => {
      const options: SearchOptions = {
        workspace_filter: ['workspace-id'],
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
    }, 30000);

    it('should execute search with API contract enrichment disabled', async () => {
      const options: SearchOptions = {
        search_api_contracts: false,
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      expect(result.context).toBeDefined();
    }, 30000);

    it('should execute search with API contract enrichment enabled', async () => {
      const options: SearchOptions = {
        search_api_contracts: true,
        api_types: ['rest'],
        include_deprecated_apis: false,
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      // API context should be included (empty if no APIs indexed)
    }, 30000);
  });

  describe('Performance and Edge Cases', () => {
    it('should handle empty search results gracefully', async () => {
      const options: SearchOptions = {
        repo_filter: ['nonexistent-repo'],
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      expect(result.context.relevant_files).toHaveLength(0);
      expect(result.context.code_locations).toHaveLength(0);
    }, 30000);

    it('should handle scope with no matching repositories', async () => {
      const scopeFilter = await determineSearchScope(
        {
          mode: 'repository',
          repo_ids: ['nonexistent-repo'],
        },
        db
      );

      expect(scopeFilter.repo_ids).toEqual(['nonexistent-repo']);
    });

    it('should handle very restrictive scope filters', async () => {
      const options: SearchOptions = {
        repo_filter: [REPO_MAIN],
        exclude_repos: [REPO_MAIN], // Contradictory filters
        max_files: 5,
        max_snippets: 10,
      };

      const result = await searchCodebase('test query', config, db, ollama, options);

      expect(result).toBeDefined();
      // Should return empty results due to contradictory filters
      expect(result.context.relevant_files).toHaveLength(0);
    }, 30000);
  });
});
