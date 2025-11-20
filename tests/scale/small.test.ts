/**
 * Small Codebase Scale Test (1k LoC, ~10 files)
 *
 * Tests indexing and query performance on a small codebase.
 * Expected performance:
 * - Indexing: 300-600 files/min
 * - Query latency: <800ms
 * - Memory: <100MB
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

describe('Small Codebase Scale Test (1k LoC)', () => {
  let repoPath: string;
  const testQueries = [
    'find user authentication functions',
    'search for data processing logic',
    'locate error handling code',
    'find database query methods',
    'search for API endpoint handlers',
  ];

  beforeAll(async () => {
    // Generate synthetic small codebase
    const config: SyntheticCodebaseConfig = {
      name: 'small-codebase-1k-loc',
      targetFileCount: 10,
      avgLinesPerFile: 100,
      languages: ['typescript', 'python'],
      complexity: 'medium',
      outputDir: path.join(os.tmpdir(), 'cindex-scale-tests'),
    };

    console.log('\n🏗️  Generating small codebase for scale test...');
    repoPath = await generateSyntheticCodebase(config);
  }, 120000); // 2 minute timeout for setup

  afterAll(async () => {
    // Cleanup generated codebase
    if (repoPath) {
      await cleanupTestCodebase(repoPath);
    }
  });

  test('should index small codebase within performance targets', async () => {
    console.log('\n📊 Running small codebase scale test...');

    const results = await runScaleTest(repoPath, testQueries);

    // Assert indexing performance
    expect(results.indexing.totalFiles).toBe(10);
    expect(results.indexing.filesPerMin).toBeGreaterThanOrEqual(300);
    expect(results.indexing.filesPerMin).toBeLessThanOrEqual(1000);

    // Assert memory usage (should be very low for small codebase)
    expect(results.indexing.peakMemoryMB).toBeLessThan(200);

    // Assert query performance
    expect(results.queries.avgLatencyMs).toBeLessThan(800);
    expect(results.queries.p95LatencyMs).toBeLessThan(1000);

    // Assert targets met
    expect(results.meetsTargets.indexingThroughput).toBe(true);
    expect(results.meetsTargets.queryLatency).toBe(true);
    expect(results.meetsTargets.memoryUsage).toBe(true);

    // Log summary
    console.log('\n✅ Small codebase test complete');
    console.log(`   Files indexed: ${results.indexing.totalFiles.toLocaleString()}`);
    console.log(`   Indexing: ${results.indexing.filesPerMin.toFixed(0)} files/min`);
    console.log(`   Query latency: ${results.queries.avgLatencyMs.toFixed(0)}ms avg, ${results.queries.p95LatencyMs.toFixed(0)}ms p95`);
    console.log(`   Memory: ${results.indexing.peakMemoryMB.toFixed(0)}MB peak`);
  }, 600000); // 10 minute timeout (indexing + queries)
});
