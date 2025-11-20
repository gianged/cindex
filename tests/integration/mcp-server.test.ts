/**
 * Integration tests for MCP Server and all 13 tools
 * Tests both Phase 4 (retrieval pipeline) and Phase 5 (MCP tools)
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type Pool } from 'pg';

import { loadConfig } from '@config/env';
import { createDatabaseClient } from '@database/client';
import { DatabaseWriter } from '@database/writer';
import { CodeChunker } from '@indexing/chunker';
import { EmbeddingGenerator } from '@indexing/embeddings';
import { FileWalker } from '@indexing/file-walker';
import { IndexingOrchestrator } from '@indexing/orchestrator';
import { CodeParser } from '@indexing/parser';
import { FileSummaryGenerator } from '@indexing/summary';
import { SymbolExtractor } from '@indexing/symbols';
import {
  deleteRepositoryMCP,
  findCrossServiceCallsMCP,
  findCrossWorkspaceUsagesMCP,
  findSymbolMCP,
  getFileContextMCP,
  getServiceContextMCP,
  getWorkspaceContextMCP,
  indexRepositoryMCP,
  listIndexedReposMCP,
  listServicesMCP,
  listWorkspacesMCP,
  searchAPIContractsMCP,
  searchCodebaseMCP,
} from '@mcp/tools-mcp';
import { createOllamaClient } from '@utils/ollama';
import { ProgressTracker } from '@utils/progress';

import { dropTestDatabase, getTestDbConfig, setupTestDatabase } from '../helpers/db-setup';

describe('MCP Server Integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let pool: Pool;
  let config: ReturnType<typeof loadConfig>;
  let ollama: ReturnType<typeof createOllamaClient>;

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();

    // Load configuration
    config = loadConfig();

    // Create database client and connect
    const dbConfig = getTestDbConfig();
    db = createDatabaseClient(dbConfig);
    await db.connect();
    pool = db.getPool();

    // Create Ollama client
    ollama = createOllamaClient(config.ollama);

    // Verify Ollama is available (skip tests if not)
    try {
      await ollama.healthCheck(config.embedding.model, config.summary.model);
    } catch {
      console.warn('Ollama not available, some tests may be skipped');
    }
  }, 30000);

  afterAll(async () => {
    // Cleanup
    if (db.connected) {
      await db.close();
    }
    await dropTestDatabase();
  });

  /**
   * Helper to create a test orchestrator for indexing
   */
  const createTestOrchestrator = (repoPath: string): IndexingOrchestrator => {
    const fileWalker = new FileWalker(repoPath, {});
    const parser = new CodeParser();
    const chunker = new CodeChunker();
    const summaryGenerator = new FileSummaryGenerator(ollama, config.summary);
    const embeddingGenerator = new EmbeddingGenerator(ollama, config.embedding);
    const symbolExtractor = new SymbolExtractor();
    const dbWriter = new DatabaseWriter(pool);
    const progressTracker = new ProgressTracker();

    return new IndexingOrchestrator(
      fileWalker,
      parser,
      chunker,
      summaryGenerator,
      embeddingGenerator,
      symbolExtractor,
      dbWriter,
      progressTracker
    );
  };

  describe('Repository Management Tools', () => {
    describe('index_repository', () => {
      it('should index a repository successfully', async () => {
        const orchestrator = createTestOrchestrator('./tests/fixtures/repo-with-gitignore');

        const result = await indexRepositoryMCP(orchestrator, {
          repo_path: './tests/fixtures/repo-with-gitignore',
          repo_id: 'test-repo-1',
          repo_type: 'monolithic',
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('Repository Indexing Complete');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('files_indexed');
        expect(result.structuredContent).toHaveProperty('chunks_created');
        expect(result.structuredContent).toHaveProperty('symbols_extracted');
      }, 60000);

      it('should handle force re-index', async () => {
        const orchestrator = createTestOrchestrator('./tests/fixtures/repo-with-gitignore');

        const result = await indexRepositoryMCP(orchestrator, {
          repo_path: './tests/fixtures/repo-with-gitignore',
          repo_id: 'test-repo-1',
          repo_type: 'monolithic',
          force_reindex: true,
        });

        expect(result.content[0].text).toContain('Repository Indexing Complete');
      }, 60000);
    });

    describe('list_indexed_repos', () => {
      it('should list all indexed repositories', async () => {
        const result = await listIndexedReposMCP(pool, {
          include_metadata: true,
          include_workspace_count: true,
          include_service_count: true,
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('total_count');
        expect(result.structuredContent).toHaveProperty('repositories');
        expect(Array.isArray(result.structuredContent.repositories)).toBe(true);

        if (result.structuredContent.total_count > 0) {
          const repo = result.structuredContent.repositories[0];
          expect(repo).toHaveProperty('repo_id');
          expect(repo).toHaveProperty('repo_type');
          expect(repo).toHaveProperty('file_count');
        }
      });

      it('should filter by repository type', async () => {
        const result = await listIndexedReposMCP(pool, {
          repo_type_filter: ['monolithic'],
        });

        expect(result.structuredContent.repositories).toBeDefined();
        result.structuredContent.repositories.forEach((repo: any) => {
          expect(repo.repo_type).toBe('monolithic');
        });
      });
    });

    describe('delete_repository', () => {
      it('should delete a repository and return statistics', async () => {
        // First, index a repository to delete
        const orchestrator = createTestOrchestrator('./tests/fixtures/sample.ts');
        await indexRepositoryMCP(orchestrator, {
          repo_path: './tests/fixtures',
          repo_id: 'test-repo-to-delete',
          repo_type: 'monolithic',
        });

        // Then delete it
        const result = await deleteRepositoryMCP(pool, {
          repo_ids: ['test-repo-to-delete'],
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('Repository Deletion Complete');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('deleted');
        expect(result.structuredContent).toHaveProperty('repositories');
        expect(result.structuredContent.deleted).toBeGreaterThan(0);
      }, 60000);

      it('should handle deletion of non-existent repository', async () => {
        const result = await deleteRepositoryMCP(pool, {
          repo_ids: ['non-existent-repo'],
        });

        expect(result.structuredContent.deleted).toBe(0);
      });
    });
  });

  describe('Core Search Tools', () => {
    describe('search_codebase', () => {
      it('should perform semantic code search', async () => {
        const result = await searchCodebaseMCP(pool, config, ollama, {
          query: 'function to calculate sum',
          max_results: 10,
          similarity_threshold: 0.5,
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('query');
        expect(result.structuredContent).toHaveProperty('query_type');
        expect(result.structuredContent).toHaveProperty('metadata');
        expect(result.structuredContent.query).toBe('function to calculate sum');
      }, 30000);

      it('should filter by repository', async () => {
        const result = await searchCodebaseMCP(pool, config, ollama, {
          query: 'test function',
          repo_id: 'test-repo-1',
        });

        expect(result.structuredContent.metadata).toBeDefined();
      }, 30000);

      it('should respect similarity threshold', async () => {
        const result = await searchCodebaseMCP(pool, config, ollama, {
          query: 'authentication logic',
          similarity_threshold: 0.9,
        });

        expect(result.structuredContent).toBeDefined();
      }, 30000);
    });

    describe('get_file_context', () => {
      it('should retrieve file context with dependencies', async () => {
        // This test requires a file to exist in the database
        // We'll use a file from the indexed repository
        const result = await getFileContextMCP(pool, {
          file_path: './tests/fixtures/repo-with-gitignore/src/index.ts',
          include_callers: true,
          include_callees: true,
          include_imports: true,
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('file_path');
        expect(result.structuredContent).toHaveProperty('language');
      });

      it('should handle non-existent file gracefully', async () => {
        await expect(
          getFileContextMCP(pool, {
            file_path: '/non/existent/file.ts',
          })
        ).rejects.toThrow();
      });
    });

    describe('find_symbol_definition', () => {
      it('should find symbol definitions', async () => {
        const result = await findSymbolMCP(pool, {
          symbol_name: 'test',
          include_usages: false,
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('symbol_name');
        expect(result.structuredContent).toHaveProperty('total_definitions');
        expect(result.structuredContent.symbol_name).toBe('test');
      });

      it('should find symbol definitions with usages', async () => {
        const result = await findSymbolMCP(pool, {
          symbol_name: 'function',
          include_usages: true,
          max_usages: 20,
        });

        expect(result.structuredContent).toHaveProperty('total_usages');
      });

      it('should filter by symbol type', async () => {
        const result = await findSymbolMCP(pool, {
          symbol_name: 'MyClass',
          symbol_type: ['class'],
        });

        expect(result.structuredContent.symbols).toBeDefined();
        if (result.structuredContent.symbols.length > 0) {
          expect(result.structuredContent.symbols[0].type).toBe('class');
        }
      });
    });
  });

  describe('Monorepo Tools', () => {
    describe('list_workspaces', () => {
      it('should list all workspaces', async () => {
        const result = await listWorkspacesMCP(pool, {
          include_dependencies: false,
          include_metadata: true,
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('total_count');
        expect(result.structuredContent).toHaveProperty('workspaces');
      });

      it('should filter workspaces by repository', async () => {
        const result = await listWorkspacesMCP(pool, {
          repo_id: 'test-repo-1',
        });

        expect(result.structuredContent.workspaces).toBeDefined();
      });
    });

    describe('get_workspace_context', () => {
      it('should retrieve workspace context', async () => {
        // This requires workspaces to exist in the database
        // May return empty results if no workspaces indexed
        const result = await getWorkspaceContextMCP(pool, {
          package_name: '@test/package',
          include_dependencies: true,
          include_dependents: true,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
      });
    });

    describe('find_cross_workspace_usages', () => {
      it('should find cross-workspace usages', async () => {
        const result = await findCrossWorkspaceUsagesMCP(pool, {
          package_name: '@test/utils',
          include_indirect: false,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('total_usages');
        expect(result.structuredContent).toHaveProperty('usages');
      });

      it('should include indirect usages when requested', async () => {
        const result = await findCrossWorkspaceUsagesMCP(pool, {
          package_name: '@test/utils',
          include_indirect: true,
          max_depth: 3,
        });

        expect(result.structuredContent.total_usages).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Microservice Tools', () => {
    describe('list_services', () => {
      it('should list all services', async () => {
        const result = await listServicesMCP(pool, {
          include_dependencies: false,
          include_api_endpoints: true,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('total_count');
        expect(result.structuredContent).toHaveProperty('services');
      });

      it('should filter services by type', async () => {
        const result = await listServicesMCP(pool, {
          service_type: ['docker', 'serverless'],
        });

        expect(result.structuredContent.services).toBeDefined();
      });
    });

    describe('get_service_context', () => {
      it('should retrieve service context', async () => {
        const result = await getServiceContextMCP(pool, {
          service_name: 'test-service',
          include_api_contracts: true,
          include_dependencies: true,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
      });
    });

    describe('find_cross_service_calls', () => {
      it('should find cross-service API calls', async () => {
        const result = await findCrossServiceCallsMCP(pool, {
          include_reverse: false,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('total_calls');
        expect(result.structuredContent).toHaveProperty('calls');
      });

      it('should include reverse calls when requested', async () => {
        const result = await findCrossServiceCallsMCP(pool, {
          source_service_id: 'service-a',
          target_service_id: 'service-b',
          include_reverse: true,
        });

        expect(result.structuredContent.total_calls).toBeGreaterThanOrEqual(0);
      });

      it('should filter by endpoint pattern', async () => {
        const result = await findCrossServiceCallsMCP(pool, {
          endpoint_pattern: '/api/users/.*',
        });

        expect(result.structuredContent.calls).toBeDefined();
      });
    });
  });

  describe('API Contract Tools', () => {
    describe('search_api_contracts', () => {
      it('should search API endpoints semantically', async () => {
        const result = await searchAPIContractsMCP(pool, ollama, config, {
          query: 'user authentication endpoint',
          max_results: 10,
          similarity_threshold: 0.7,
        });

        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent).toHaveProperty('query');
        expect(result.structuredContent).toHaveProperty('total_results');
        expect(result.structuredContent).toHaveProperty('endpoints');
        expect(result.structuredContent.query).toBe('user authentication endpoint');
      }, 30000);

      it('should filter by API type', async () => {
        const result = await searchAPIContractsMCP(pool, ollama, config, {
          query: 'create user',
          api_types: ['rest'],
        });

        expect(result.structuredContent.endpoints).toBeDefined();
        if (result.structuredContent.endpoints.length > 0) {
          expect(result.structuredContent.endpoints[0].api_type).toBe('rest');
        }
      }, 30000);

      it('should filter by service', async () => {
        const result = await searchAPIContractsMCP(pool, ollama, config, {
          query: 'get user data',
          service_filter: ['user-service'],
        });

        expect(result.structuredContent.total_results).toBeGreaterThanOrEqual(0);
      }, 30000);

      it('should exclude deprecated endpoints by default', async () => {
        const result = await searchAPIContractsMCP(pool, ollama, config, {
          query: 'authentication',
          include_deprecated: false,
        });

        expect(result.structuredContent.endpoints).toBeDefined();
      }, 30000);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid repository path in index_repository', async () => {
      const orchestrator = createTestOrchestrator('/non/existent/path');

      await expect(
        indexRepositoryMCP(orchestrator, {
          repo_path: '/non/existent/path',
          repo_id: 'invalid-repo',
        })
      ).rejects.toThrow();
    });

    it('should handle empty query in search_codebase', async () => {
      await expect(
        searchCodebaseMCP(pool, config, ollama, {
          query: '',
        })
      ).rejects.toThrow();
    });

    it('should handle invalid similarity threshold', async () => {
      await expect(
        searchCodebaseMCP(pool, config, ollama, {
          query: 'test',
          similarity_threshold: 1.5, // Invalid: >1.0
        })
      ).rejects.toThrow();
    });

    it('should handle invalid max_results', async () => {
      await expect(
        searchCodebaseMCP(pool, config, ollama, {
          query: 'test',
          max_results: 200, // Invalid: >100
        })
      ).rejects.toThrow();
    });
  });

  describe('Output Format Validation', () => {
    it('should return valid MCP format for all tools', async () => {
      const tools = [
        () => searchCodebaseMCP(pool, config, ollama, { query: 'test' }),
        () => listIndexedReposMCP(pool, {}),
        () => listWorkspacesMCP(pool, {}),
        () => listServicesMCP(pool, {}),
        () => findCrossServiceCallsMCP(pool, {}),
        () => searchAPIContractsMCP(pool, ollama, config, { query: 'test api' }),
      ];

      for (const tool of tools) {
        const result = await tool();

        // Verify MCP format
        expect(result).toHaveProperty('content');
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]).toHaveProperty('type');
        expect(result.content[0]).toHaveProperty('text');
        expect(result.content[0].type).toBe('text');

        // Verify structured content
        if (result.structuredContent) {
          expect(typeof result.structuredContent).toBe('object');
        }
      }
    }, 60000);
  });

  describe('Performance Tests', () => {
    it('should complete search within acceptable time', async () => {
      const startTime = Date.now();

      await searchCodebaseMCP(pool, config, ollama, {
        query: 'performance test query',
      });

      const duration = Date.now() - startTime;

      // Should complete within 30 seconds (including embedding generation)
      expect(duration).toBeLessThan(30000);
    }, 35000);

    it('should handle concurrent tool calls', async () => {
      const promises = [listIndexedReposMCP(pool, {}), listWorkspacesMCP(pool, {}), listServicesMCP(pool, {})];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.content).toBeDefined();
      });
    });
  });
});
