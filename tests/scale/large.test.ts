/**
 * Large Codebase Scale Test (100k LoC, ~1000 files)
 *
 * Tests indexing and query performance on a large codebase.
 * Expected performance:
 * - Indexing: 300-600 files/min
 * - Query latency: <800ms
 * - Memory: <1GB
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  generateSyntheticCodebase,
  runScaleTest,
  cleanupTestCodebase,
  type SyntheticCodebaseConfig,
} from './scale-test-runner';

describe('Large Codebase Scale Test (100k LoC)', () => {
  let repoPath: string;
  const testQueries = [
    'find user authentication functions',
    'search for data processing logic',
    'locate error handling code',
    'find database query methods',
    'search for API endpoint handlers',
    'find file upload functionality',
    'search for validation logic',
    'locate caching implementations',
    'find logging utilities',
    'search for configuration management',
    'find security middleware',
    'search for rate limiting code',
    'locate payment processing',
    'find email notification logic',
    'search for webhook handlers',
  ];

  beforeAll(async () => {
    // Generate synthetic large codebase
    const config: SyntheticCodebaseConfig = {
      name: 'large-codebase-100k-loc',
      targetFileCount: 1000,
      avgLinesPerFile: 100,
      languages: ['typescript', 'python'],
      complexity: 'medium',
      outputDir: path.join(os.tmpdir(), 'cindex-scale-tests'),
    };

    console.log('\n🏗️  Generating large codebase for scale test...');
    console.log('⚠️  This may take 2-3 minutes...');
    repoPath = await generateSyntheticCodebase(config);
  }, 300000); // 5 minute timeout for setup

  afterAll(async () => {
    // Cleanup generated codebase
    if (repoPath) {
      await cleanupTestCodebase(repoPath);
    }
  });

  test('should index large codebase within performance targets', async () => {
    console.log('\n📊 Running large codebase scale test...');
    console.log('⚠️  This test may take 5-10 minutes...');

    const results = await runScaleTest(repoPath, testQueries);

    // Assert indexing performance
    expect(results.indexing.totalFiles).toBe(1000);
    expect(results.indexing.filesPerMin).toBeGreaterThanOrEqual(300);
    expect(results.indexing.filesPerMin).toBeLessThanOrEqual(1000);

    // Assert memory usage (should stay under 1GB)
    expect(results.indexing.peakMemoryMB).toBeLessThan(1024);

    // Assert query performance (should still be fast despite large index)
    expect(results.queries.avgLatencyMs).toBeLessThan(800);
    expect(results.queries.p95LatencyMs).toBeLessThan(1500);

    // Assert targets met
    expect(results.meetsTargets.indexingThroughput).toBe(true);
    expect(results.meetsTargets.queryLatency).toBe(true);
    expect(results.meetsTargets.memoryUsage).toBe(true);

    // Log summary
    console.log('\n✅ Large codebase test complete');
    console.log(`   Files indexed: ${results.indexing.totalFiles.toLocaleString()}`);
    console.log(`   Indexing: ${results.indexing.filesPerMin.toFixed(0)} files/min (${(results.indexing.totalDurationMs / 60000).toFixed(1)} min total)`);
    console.log(`   Query latency: ${results.queries.avgLatencyMs.toFixed(0)}ms avg, ${results.queries.p95LatencyMs.toFixed(0)}ms p95`);
    console.log(`   Memory: ${results.indexing.peakMemoryMB.toFixed(0)}MB peak`);

    // Additional metrics for large codebase
    console.log('\n📈 Additional metrics:');
    console.log(`   P99 query latency: ${results.queries.p99LatencyMs.toFixed(0)}ms`);
    console.log(`   Max query latency: ${results.queries.maxLatencyMs.toFixed(0)}ms`);
    console.log(`   Avg results per query: ${results.queries.avgResultsReturned.toFixed(1)}`);
  }, 1200000); // 20 minute timeout (indexing + queries for large codebase)
});
