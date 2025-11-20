/**
 * Very Large Codebase Scale Test (1M LoC, ~10,000 files)
 *
 * Tests indexing and query performance on a very large codebase.
 * This test validates cindex can handle enterprise-scale codebases.
 *
 * Expected performance:
 * - Indexing: 300-600 files/min (5-35 min for 10k files)
 * - Query latency: <800ms
 * - Memory: <1GB
 *
 * ⚠️ WARNING: This test takes 30-60 minutes to run and generates ~1M LoC of code.
 * Only run manually with: npm test -- tests/scale/very-large.test.ts
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

describe('Very Large Codebase Scale Test (1M LoC)', () => {
  let repoPath: string;
  const testQueries = [
    // Core functionality queries
    'find user authentication functions',
    'search for data processing logic',
    'locate error handling code',
    'find database query methods',
    'search for API endpoint handlers',

    // Feature queries
    'find file upload functionality',
    'search for validation logic',
    'locate caching implementations',
    'find logging utilities',
    'search for configuration management',

    // Security queries
    'find security middleware',
    'search for rate limiting code',
    'locate authentication middleware',
    'find input sanitization',
    'search for CORS configuration',

    // Infrastructure queries
    'find payment processing',
    'search for email notification logic',
    'locate webhook handlers',
    'find background job processing',
    'search for message queue handlers',
  ];

  beforeAll(async () => {
    // Generate synthetic very large codebase (1M LoC)
    const config: SyntheticCodebaseConfig = {
      name: 'very-large-codebase-1m-loc',
      targetFileCount: 10000, // 10k files * 100 lines = 1M LoC
      avgLinesPerFile: 100,
      languages: ['typescript', 'python'],
      complexity: 'medium',
      outputDir: path.join(os.tmpdir(), 'cindex-scale-tests'),
    };

    console.log('\n🏗️  Generating very large codebase for scale test...');
    console.log('⚠️  This will take 10-15 minutes to generate 10,000 files...');
    repoPath = await generateSyntheticCodebase(config);
  }, 1200000); // 20 minute timeout for setup

  afterAll(async () => {
    // Cleanup generated codebase
    if (repoPath) {
      console.log('\n🗑️  Cleaning up very large test codebase...');
      await cleanupTestCodebase(repoPath);
    }
  }, 120000); // 2 minute timeout for cleanup

  test('should index 1M LoC codebase within performance targets', async () => {
    console.log('\n📊 Running very large codebase scale test (1M LoC)...');
    console.log('⚠️  This test will take 30-60 minutes...');
    console.log('   - Indexing: 5-35 minutes (depends on hardware)');
    console.log('   - Queries: 5-10 minutes');
    console.log('   - Expected throughput: 300-600 files/min');

    const results = await runScaleTest(repoPath, testQueries);

    // Assert indexing performance
    expect(results.indexing.totalFiles).toBe(10000);
    expect(results.indexing.filesPerMin).toBeGreaterThanOrEqual(300);
    expect(results.indexing.filesPerMin).toBeLessThanOrEqual(1000);

    // Assert memory usage (CRITICAL: must stay under 1GB for 1M LoC)
    expect(results.indexing.peakMemoryMB).toBeLessThan(1024);

    // Assert query performance (should still be fast despite massive index)
    expect(results.queries.avgLatencyMs).toBeLessThan(800);
    expect(results.queries.p95LatencyMs).toBeLessThan(2000); // Allow higher p95 for 1M LoC
    expect(results.queries.p99LatencyMs).toBeLessThan(3000); // Allow higher p99 for 1M LoC

    // Assert targets met
    expect(results.meetsTargets.indexingThroughput).toBe(true);
    expect(results.meetsTargets.queryLatency).toBe(true);
    expect(results.meetsTargets.memoryUsage).toBe(true);

    // Log detailed summary
    console.log('\n✅ Very large codebase test complete (1M LoC)');
    console.log('\n📈 Indexing Metrics:');
    console.log(`   Files indexed: ${results.indexing.totalFiles.toLocaleString()}`);
    console.log(`   Total time: ${(results.indexing.totalDurationMs / 60000).toFixed(1)} minutes`);
    console.log(`   Throughput: ${results.indexing.filesPerMin.toFixed(0)} files/min`);
    console.log(`   Peak memory: ${results.indexing.peakMemoryMB.toFixed(0)}MB`);
    console.log(`   Avg memory: ${results.indexing.avgMemoryMB.toFixed(0)}MB`);

    console.log('\n📈 Query Metrics:');
    console.log(`   Total queries: ${results.queries.totalQueries}`);
    console.log(`   Avg latency: ${results.queries.avgLatencyMs.toFixed(0)}ms`);
    console.log(`   P50 latency: ${results.queries.p50LatencyMs.toFixed(0)}ms`);
    console.log(`   P95 latency: ${results.queries.p95LatencyMs.toFixed(0)}ms`);
    console.log(`   P99 latency: ${results.queries.p99LatencyMs.toFixed(0)}ms`);
    console.log(`   Max latency: ${results.queries.maxLatencyMs.toFixed(0)}ms`);
    console.log(`   Avg results: ${results.queries.avgResultsReturned.toFixed(1)} per query`);

    console.log('\n📊 Target Comparison:');
    console.log(`   Indexing: ${results.indexing.filesPerMin.toFixed(0)} files/min (target: 300-600) ${results.meetsTargets.indexingThroughput ? '✅' : '❌'}`);
    console.log(`   Query: ${results.queries.avgLatencyMs.toFixed(0)}ms avg (target: <800ms) ${results.meetsTargets.queryLatency ? '✅' : '❌'}`);
    console.log(`   Memory: ${results.indexing.peakMemoryMB.toFixed(0)}MB peak (target: <1024MB) ${results.meetsTargets.memoryUsage ? '✅' : '❌'}`);

    // Additional validation for 1M LoC scale
    if (results.indexing.bottlenecks.length > 0) {
      console.log('\n⚠️  Performance Bottlenecks Detected:');
      results.indexing.bottlenecks.forEach((bottleneck) => {
        console.log(`   - ${bottleneck}`);
      });
    }
  }, 3600000); // 60 minute timeout (indexing + queries for 1M LoC)
});
