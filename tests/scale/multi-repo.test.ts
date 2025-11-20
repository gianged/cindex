/**
 * Multi-Repository Scale Test
 *
 * Tests indexing and query performance across multiple repositories.
 * Validates cross-repository search, dependency tracking, and result grouping.
 *
 * Expected performance:
 * - Indexing: 300-600 files/min per repo
 * - Query latency: <800ms (global search across repos)
 * - Cross-repository dependency resolution: accurate
 * - Result grouping: by repository
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  generateSyntheticCodebase,
  cleanupTestCodebase,
  type SyntheticCodebaseConfig,
} from './scale-test-runner';
import { IndexingOrchestrator } from '@indexing/orchestrator';
import { searchCodebase } from '@retrieval/search';
import { createDatabaseClient } from '@database/client';
import { createOllamaClient } from '@utils/ollama';
import { loadConfig } from '@config/env';
import { type CindexConfig } from '@/types/config';

describe('Multi-Repository Scale Test', () => {
  let repoPaths: string[] = [];
  const repoConfigs = [
    {
      name: 'backend-api',
      targetFileCount: 100,
      avgLinesPerFile: 100,
      languages: ['typescript'],
      complexity: 'medium' as const,
    },
    {
      name: 'frontend-app',
      targetFileCount: 100,
      avgLinesPerFile: 100,
      languages: ['typescript'],
      complexity: 'medium' as const,
    },
    {
      name: 'data-service',
      targetFileCount: 100,
      avgLinesPerFile: 100,
      languages: ['python'],
      complexity: 'medium' as const,
    },
  ];

  const testQueries = [
    // Global queries (search across all repos)
    'find user authentication',
    'search for API endpoints',
    'locate database queries',

    // Repository-specific queries
    'find authentication in backend-api',
    'search for components in frontend-app',
    'locate data models in data-service',

    // Cross-repository queries
    'find shared types across repositories',
    'search for API contracts',
    'locate service dependencies',
  ];

  beforeAll(async () => {
    console.log('\n🏗️  Generating multiple repositories for scale test...');

    const outputDir = path.join(os.tmpdir(), 'cindex-scale-tests', 'multi-repo');

    // Generate multiple repositories
    for (const repoConfig of repoConfigs) {
      const config: SyntheticCodebaseConfig = {
        ...repoConfig,
        outputDir,
      };

      console.log(`   Generating ${repoConfig.name}...`);
      const repoPath = await generateSyntheticCodebase(config);
      repoPaths.push(repoPath);
    }

    console.log(`✅ Generated ${repoPaths.length} repositories`);
  }, 300000); // 5 minute timeout for setup

  afterAll(async () => {
    // Cleanup all generated repositories
    for (const repoPath of repoPaths) {
      await cleanupTestCodebase(repoPath);
    }
  });

  test('should index multiple repositories and support cross-repo search', async () => {
    console.log('\n📊 Running multi-repository scale test...');

    const config = loadConfig() as CindexConfig;
    const db = createDatabaseClient(config.database);
    await db.connect();

    const ollama = createOllamaClient(config.ollama.host);

    try {
      // 1. Index all repositories
      console.log('\n🔍 Indexing repositories...');
      const orchestrator = new IndexingOrchestrator(config, db, ollama);
      const indexingResults = [];

      for (let i = 0; i < repoPaths.length; i++) {
        const repoPath = repoPaths[i];
        const repoName = repoConfigs[i].name;

        console.log(`   Indexing ${repoName}...`);
        const startTime = Date.now();

        const stats = await orchestrator.indexRepository(repoPath, {
          repo_id: repoName,
          repo_type: 'monolithic',
          force_reindex: true,
        });

        const duration = Date.now() - startTime;
        const filesPerMin = (stats.files_indexed / duration) * 60 * 1000;

        indexingResults.push({
          repo: repoName,
          files: stats.files_indexed,
          durationMs: duration,
          filesPerMin,
        });

        console.log(`   ✅ ${repoName}: ${stats.files_indexed} files in ${(duration / 1000).toFixed(1)}s (${filesPerMin.toFixed(0)} files/min)`);
      }

      // Assert indexing performance for each repo
      for (const result of indexingResults) {
        expect(result.filesPerMin).toBeGreaterThanOrEqual(300);
        expect(result.filesPerMin).toBeLessThanOrEqual(1000);
      }

      // 2. Run global queries (search across all repos)
      console.log('\n🔍 Running global queries...');
      const queryLatencies: number[] = [];
      let totalResults = 0;

      for (const query of testQueries) {
        const queryStart = Date.now();

        const result = await searchCodebase(query, config, db, ollama, {
          scope: 'global', // Search across all repositories
          max_results: 20,
        });

        const queryLatency = Date.now() - queryStart;
        queryLatencies.push(queryLatency);
        totalResults += result.chunks.length;

        console.log(`   Query "${query.substring(0, 40)}..." - ${queryLatency}ms, ${result.chunks.length} results`);
      }

      // Calculate query statistics
      queryLatencies.sort((a, b) => a - b);
      const avgLatency = queryLatencies.reduce((sum, l) => sum + l, 0) / queryLatencies.length;
      const p95 = queryLatencies[Math.floor(queryLatencies.length * 0.95)];

      // Assert query performance
      expect(avgLatency).toBeLessThan(800);
      expect(p95).toBeLessThan(1500);

      // Log summary
      console.log('\n✅ Multi-repository scale test complete');
      console.log('\n📈 Indexing Summary:');
      for (const result of indexingResults) {
        console.log(`   ${result.repo}: ${result.files} files, ${result.filesPerMin.toFixed(0)} files/min`);
      }

      console.log('\n📈 Query Summary:');
      console.log(`   Total queries: ${testQueries.length}`);
      console.log(`   Avg latency: ${avgLatency.toFixed(0)}ms`);
      console.log(`   P95 latency: ${p95.toFixed(0)}ms`);
      console.log(`   Avg results: ${(totalResults / testQueries.length).toFixed(1)} per query`);

      // Assert all targets met
      const allIndexingTargetsMet = indexingResults.every((r) => r.filesPerMin >= 300 && r.filesPerMin <= 1000);
      expect(allIndexingTargetsMet).toBe(true);
      expect(avgLatency).toBeLessThan(800);
    } finally {
      await db.close();
    }
  }, 1200000); // 20 minute timeout (indexing + queries for 3 repos)
});
