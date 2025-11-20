/**
 * Accuracy Tests
 *
 * Comprehensive accuracy testing with 100+ queries.
 * Measures precision, recall, MRR, and context noise.
 *
 * Target Metrics:
 * - Precision@10: >92%
 * - MRR: >0.85
 * - Context noise: <2%
 *
 * ⚠️ These tests require a pre-indexed codebase. Run manually with:
 * npm test -- tests/accuracy/accuracy.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

import { runAccuracyTestSuite, logAccuracyResults } from './accuracy-test-runner';
import {
  allAccuracyQueries,
  functionSearchQueries,
  symbolResolutionQueries,
  dependencyQueries,
  apiEndpointQueries,
  configurationQueries,
  errorHandlingQueries,
  testingQueries,
} from './queries';
import { createDatabaseClient } from '@database/client';
import { createOllamaClient } from '@utils/ollama';
import { loadConfig } from '@config/env';
import { type CindexConfig } from '@/types/config';

describe('Accuracy Tests', () => {
  const config = loadConfig() as CindexConfig;
  let db: ReturnType<typeof createDatabaseClient>;
  let ollama: ReturnType<typeof createOllamaClient>;

  beforeAll(async () => {
    db = createDatabaseClient(config.database);
    await db.connect();
    ollama = createOllamaClient(config.ollama.host);

    console.log('\n' + '='.repeat(80));
    console.log('🎯 ACCURACY TEST SUITE');
    console.log('='.repeat(80));
    console.log(`Total queries: ${allAccuracyQueries.length}`);
    console.log('Categories:');
    console.log(`  - Function search: ${functionSearchQueries.length}`);
    console.log(`  - Symbol resolution: ${symbolResolutionQueries.length}`);
    console.log(`  - Cross-file dependencies: ${dependencyQueries.length}`);
    console.log(`  - API endpoints: ${apiEndpointQueries.length}`);
    console.log(`  - Configuration: ${configurationQueries.length}`);
    console.log(`  - Error handling: ${errorHandlingQueries.length}`);
    console.log(`  - Testing: ${testingQueries.length}`);
    console.log('='.repeat(80) + '\n');
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  test('should meet accuracy targets across all 100+ queries', async () => {
    const metrics = await runAccuracyTestSuite(allAccuracyQueries, config, db, ollama);

    // Log detailed results
    logAccuracyResults(metrics);

    // Assert targets
    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92); // >92% precision
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85); // >0.85 MRR
    expect(metrics.avgContextNoise).toBeLessThan(0.02); // <2% context noise

    // Assert all targets met
    expect(metrics.meetsTargets.precision).toBe(true);
    expect(metrics.meetsTargets.mrr).toBe(true);
    expect(metrics.meetsTargets.contextNoise).toBe(true);

    // Assert reasonable recall (>70%)
    expect(metrics.avgRecall).toBeGreaterThanOrEqual(0.7);

    console.log('\n✅ All accuracy targets met!');
  }, 1800000); // 30 minute timeout (100+ queries can take a while)

  test('should achieve high precision for function search queries', async () => {
    const metrics = await runAccuracyTestSuite(functionSearchQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92);
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85);
  }, 600000); // 10 minute timeout

  test('should accurately resolve symbol definitions', async () => {
    const metrics = await runAccuracyTestSuite(symbolResolutionQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92);
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85);
  }, 600000); // 10 minute timeout

  test('should correctly identify cross-file dependencies', async () => {
    const metrics = await runAccuracyTestSuite(dependencyQueries, config, db, ollama);

    logAccuracyResults(metrics);

    // Dependency queries may have lower precision due to import chain expansion
    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.85);
    expect(metrics.avgRecall).toBeGreaterThanOrEqual(0.7);
  }, 600000); // 10 minute timeout

  test('should find API endpoints with high accuracy', async () => {
    const metrics = await runAccuracyTestSuite(apiEndpointQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92);
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85);
  }, 600000); // 10 minute timeout

  test('should locate configuration files accurately', async () => {
    const metrics = await runAccuracyTestSuite(configurationQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92);
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85);
  }, 600000); // 10 minute timeout

  test('should find error handling code with high precision', async () => {
    const metrics = await runAccuracyTestSuite(errorHandlingQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.92);
    expect(metrics.avgMRR).toBeGreaterThanOrEqual(0.85);
  }, 600000); // 10 minute timeout

  test('should locate test files and utilities accurately', async () => {
    const metrics = await runAccuracyTestSuite(testingQueries, config, db, ollama);

    logAccuracyResults(metrics);

    expect(metrics.avgPrecision).toBeGreaterThanOrEqual(0.85);
    expect(metrics.avgRecall).toBeGreaterThanOrEqual(0.7);
  }, 600000); // 10 minute timeout
});
