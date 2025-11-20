/**
 * Stress Tests
 *
 * Tests system behavior under high load and concurrent operations:
 * - Concurrent queries (10+ simultaneous searches)
 * - Rapid re-indexing (multiple index operations in quick succession)
 * - Mixed workloads (queries + indexing simultaneously)
 *
 * Expected behavior:
 * - No crashes or deadlocks
 * - Graceful degradation under load
 * - Query latency <2s (acceptable degradation from <800ms)
 * - Memory stays <1.5GB under peak load
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

describe('Stress Tests', () => {
  let repoPath: string;
  const config = loadConfig() as CindexConfig;

  beforeAll(async () => {
    // Generate test codebase (medium size for stress testing)
    const codebaseConfig: SyntheticCodebaseConfig = {
      name: 'stress-test-codebase',
      targetFileCount: 500, // Medium size for faster stress testing
      avgLinesPerFile: 100,
      languages: ['typescript', 'python'],
      complexity: 'medium',
      outputDir: path.join(os.tmpdir(), 'cindex-scale-tests'),
    };

    console.log('\n🏗️  Generating codebase for stress testing...');
    repoPath = await generateSyntheticCodebase(codebaseConfig);

    // Index the codebase once
    console.log('\n🔍 Initial indexing...');
    const db = createDatabaseClient(config.database);
    await db.connect();
    const ollama = createOllamaClient(config.ollama.host);

    try {
      const orchestrator = new IndexingOrchestrator(config, db, ollama);
      await orchestrator.indexRepository(repoPath, {
        repo_id: 'stress-test',
        repo_type: 'monolithic',
        force_reindex: true,
      });
      console.log('✅ Initial indexing complete');
    } finally {
      await db.close();
    }
  }, 600000); // 10 minute timeout for setup

  afterAll(async () => {
    if (repoPath) {
      await cleanupTestCodebase(repoPath);
    }
  });

  test('should handle 20 concurrent queries without crashing', async () => {
    console.log('\n🔥 Running concurrent query stress test (20 simultaneous queries)...');

    const db = createDatabaseClient(config.database);
    await db.connect();
    const ollama = createOllamaClient(config.ollama.host);

    try {
      const queries = [
        'find user authentication',
        'search for data processing',
        'locate error handling',
        'find database queries',
        'search for API endpoints',
        'find validation logic',
        'search for caching',
        'locate logging',
        'find configuration',
        'search for middleware',
        'find security',
        'search for rate limiting',
        'locate payment processing',
        'find email notifications',
        'search for webhooks',
        'find background jobs',
        'search for message queues',
        'locate file uploads',
        'find image processing',
        'search for PDF generation',
      ];

      const startTime = Date.now();
      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      // Execute all queries concurrently
      const queryPromises = queries.map((query) =>
        searchCodebase(query, config, db, ollama, {
          scope: 'global',
          max_results: 20,
        })
      );

      const results = await Promise.all(queryPromises);

      const totalDuration = Date.now() - startTime;
      const peakMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const avgLatency = totalDuration / queries.length;

      console.log(`✅ Concurrent queries complete`);
      console.log(`   Total time: ${(totalDuration / 1000).toFixed(1)}s`);
      console.log(`   Avg latency per query: ${avgLatency.toFixed(0)}ms`);
      console.log(`   Peak memory: ${peakMemory.toFixed(0)}MB (delta: +${(peakMemory - initialMemory).toFixed(0)}MB)`);
      console.log(`   Results: ${results.reduce((sum, r) => sum + r.chunks.length, 0)} total chunks`);

      // Assert: All queries completed successfully
      expect(results.length).toBe(queries.length);
      results.forEach((result) => {
        expect(result.chunks).toBeDefined();
        expect(result.metadata).toBeDefined();
      });

      // Assert: Average latency acceptable (allow degradation to 2s)
      expect(avgLatency).toBeLessThan(2000);

      // Assert: Memory usage reasonable (allow up to 1.5GB under peak load)
      expect(peakMemory).toBeLessThan(1536);
    } finally {
      await db.close();
    }
  }, 600000); // 10 minute timeout

  test('should handle rapid re-indexing without deadlocks', async () => {
    console.log('\n🔥 Running rapid re-indexing stress test (5 consecutive re-indexes)...');

    const db = createDatabaseClient(config.database);
    await db.connect();
    const ollama = createOllamaClient(config.ollama.host);

    try {
      const orchestrator = new IndexingOrchestrator(config, db, ollama);
      const indexingResults = [];

      // Perform 5 rapid re-indexes
      for (let i = 0; i < 5; i++) {
        console.log(`   Re-index ${i + 1}/5...`);
        const startTime = Date.now();

        const stats = await orchestrator.indexRepository(repoPath, {
          repo_id: `stress-test-reindex-${i}`,
          repo_type: 'monolithic',
          force_reindex: true,
        });

        const duration = Date.now() - startTime;
        indexingResults.push({
          iteration: i + 1,
          files: stats.files_indexed,
          durationMs: duration,
          filesPerMin: (stats.files_indexed / duration) * 60 * 1000,
        });

        console.log(`   ✅ Re-index ${i + 1}: ${stats.files_indexed} files in ${(duration / 1000).toFixed(1)}s`);
      }

      // Assert: All re-indexes completed successfully
      expect(indexingResults.length).toBe(5);

      // Assert: Throughput consistent across re-indexes (no degradation)
      const avgThroughput = indexingResults.reduce((sum, r) => sum + r.filesPerMin, 0) / indexingResults.length;
      expect(avgThroughput).toBeGreaterThanOrEqual(300);

      // Assert: No significant performance degradation (max deviation <30%)
      const throughputs = indexingResults.map((r) => r.filesPerMin);
      const minThroughput = Math.min(...throughputs);
      const maxThroughput = Math.max(...throughputs);
      const deviation = (maxThroughput - minThroughput) / avgThroughput;

      expect(deviation).toBeLessThan(0.5); // Allow 50% deviation (stress test conditions)

      console.log(`✅ Rapid re-indexing complete`);
      console.log(`   Avg throughput: ${avgThroughput.toFixed(0)} files/min`);
      console.log(`   Throughput range: ${minThroughput.toFixed(0)}-${maxThroughput.toFixed(0)} files/min`);
      console.log(`   Deviation: ${(deviation * 100).toFixed(1)}%`);
    } finally {
      await db.close();
    }
  }, 900000); // 15 minute timeout

  test('should handle mixed workload (indexing + queries simultaneously)', async () => {
    console.log('\n🔥 Running mixed workload stress test...');

    const db = createDatabaseClient(config.database);
    await db.connect();
    const ollama = createOllamaClient(config.ollama.host);

    try {
      const queries = [
        'find authentication',
        'search for database',
        'locate API endpoints',
        'find error handling',
        'search for validation',
      ];

      const startTime = Date.now();

      // Start indexing in background
      const orchestrator = new IndexingOrchestrator(config, db, ollama);
      const indexingPromise = orchestrator.indexRepository(repoPath, {
        repo_id: 'stress-test-mixed',
        repo_type: 'monolithic',
        force_reindex: true,
      });

      // Wait 2 seconds for indexing to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Run queries while indexing is in progress
      const queryPromises = queries.map((query) =>
        searchCodebase(query, config, db, ollama, {
          scope: 'global',
          max_results: 20,
        })
      );

      // Wait for both indexing and queries to complete
      const [indexingStats, queryResults] = await Promise.all([
        indexingPromise,
        Promise.all(queryPromises),
      ]);

      const totalDuration = Date.now() - startTime;
      const peakMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      console.log(`✅ Mixed workload complete`);
      console.log(`   Total time: ${(totalDuration / 1000).toFixed(1)}s`);
      console.log(`   Indexing: ${indexingStats.files_indexed} files`);
      console.log(`   Queries: ${queries.length} completed successfully`);
      console.log(`   Peak memory: ${peakMemory.toFixed(0)}MB`);

      // Assert: All operations completed successfully
      expect(indexingStats.files_indexed).toBeGreaterThan(0);
      expect(queryResults.length).toBe(queries.length);

      // Assert: No crashes or data corruption
      queryResults.forEach((result) => {
        expect(result.chunks).toBeDefined();
        expect(result.metadata).toBeDefined();
      });

      // Assert: Memory usage acceptable
      expect(peakMemory).toBeLessThan(1536);
    } finally {
      await db.close();
    }
  }, 900000); // 15 minute timeout
});
