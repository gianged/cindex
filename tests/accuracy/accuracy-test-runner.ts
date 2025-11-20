/**
 * Accuracy Test Runner
 *
 * Framework for evaluating search accuracy and relevance.
 * Measures precision, recall, MRR (Mean Reciprocal Rank), and NDCG.
 *
 * Test Methodology:
 * 1. Define queries with expected results (ground truth)
 * 2. Execute queries against indexed codebase
 * 3. Compare actual results with expected results
 * 4. Calculate relevance metrics
 *
 * Target Metrics:
 * - Precision@10: >92% (top 10 results are relevant)
 * - MRR: >0.85 (relevant result appears early)
 * - Context noise: <2% (irrelevant chunks)
 */

import { searchCodebase } from '@retrieval/search';
import { type CindexConfig } from '@/types/config';
import { type DatabaseClient } from '@database/client';
import { type OllamaClient } from '@utils/ollama';
import { type SearchOptions, type SearchResult } from '@/types/mcp-tools';

/**
 * Ground truth query
 */
export interface AccuracyQuery {
  query: string;
  category: string; // e.g., 'function-search', 'symbol-resolution', 'cross-file-dependencies'
  expectedResults: {
    filePath: string; // Expected file to appear in results
    minRelevanceScore?: number; // Minimum expected relevance (0-1)
    shouldBeInTopN?: number; // Expected position (1-10)
  }[];
  unexpectedResults?: {
    filePath: string; // File that should NOT appear (noise)
  }[];
}

/**
 * Accuracy test result for single query
 */
export interface AccuracyTestResult {
  query: string;
  category: string;

  // Retrieval metrics
  totalResults: number;
  relevantResults: number;
  irrelevantResults: number;

  // Precision & Recall
  precision: number; // Relevant / Total returned
  recall: number; // Relevant found / Total relevant expected

  // Ranking metrics
  mrr: number; // Mean Reciprocal Rank (1 / rank of first relevant)
  avgRelevantRank: number; // Average rank of relevant results

  // Context quality
  contextNoise: number; // % of results that are irrelevant

  // Details
  expectedFound: string[]; // Expected files that were found
  expectedMissing: string[]; // Expected files that were NOT found
  unexpectedFound: string[]; // Unexpected files that were found (noise)
}

/**
 * Aggregate accuracy metrics
 */
export interface AggregateAccuracyMetrics {
  totalQueries: number;
  queriesByCategory: Record<string, number>;

  // Overall metrics
  avgPrecision: number;
  avgRecall: number;
  avgMRR: number;
  avgContextNoise: number;

  // Target comparison
  meetsTargets: {
    precision: boolean; // >92%
    mrr: boolean; // >0.85
    contextNoise: boolean; // <2%
  };

  // Category breakdown
  categoryMetrics: Record<
    string,
    {
      avgPrecision: number;
      avgRecall: number;
      avgMRR: number;
    }
  >;

  // Failed queries (didn't meet targets)
  failedQueries: {
    query: string;
    category: string;
    issue: string; // e.g., "Low precision: 0.65"
  }[];
}

/**
 * Run accuracy test for single query
 *
 * @param accuracyQuery - Ground truth query
 * @param config - Cindex config
 * @param db - Database client
 * @param ollama - Ollama client
 * @returns Accuracy test result
 */
export const runAccuracyTest = async (
  accuracyQuery: AccuracyQuery,
  config: CindexConfig,
  db: DatabaseClient,
  ollama: OllamaClient
): Promise<AccuracyTestResult> => {
  const { query, category, expectedResults, unexpectedResults = [] } = accuracyQuery;

  // Execute search
  const searchOptions: SearchOptions = {
    scope: 'global',
    max_results: 20,
  };

  const result: SearchResult = await searchCodebase(query, config, db, ollama, searchOptions);

  // Extract file paths from results
  const actualFilePaths = result.chunks.map((chunk) => chunk.file_path);

  // Calculate metrics
  const expectedFilePaths = expectedResults.map((e) => e.filePath);
  const unexpectedFilePaths = unexpectedResults.map((u) => u.filePath);

  // Find matches
  const expectedFound = expectedFilePaths.filter((path) => actualFilePaths.includes(path));
  const expectedMissing = expectedFilePaths.filter((path) => !actualFilePaths.includes(path));
  const unexpectedFound = unexpectedFilePaths.filter((path) => actualFilePaths.includes(path));

  // Precision & Recall
  const relevantResults = expectedFound.length;
  const irrelevantResults = unexpectedFound.length + Math.max(0, actualFilePaths.length - relevantResults);
  const precision = relevantResults / Math.max(1, actualFilePaths.length);
  const recall = relevantResults / Math.max(1, expectedFilePaths.length);

  // MRR (Mean Reciprocal Rank)
  let mrr = 0;
  const firstRelevantIndex = actualFilePaths.findIndex((path) => expectedFilePaths.includes(path));
  if (firstRelevantIndex !== -1) {
    mrr = 1 / (firstRelevantIndex + 1); // +1 because ranks start at 1
  }

  // Average rank of relevant results
  const relevantRanks = expectedFound.map((path) => actualFilePaths.indexOf(path) + 1);
  const avgRelevantRank =
    relevantRanks.length > 0 ? relevantRanks.reduce((sum, rank) => sum + rank, 0) / relevantRanks.length : 0;

  // Context noise
  const contextNoise = irrelevantResults / Math.max(1, actualFilePaths.length);

  return {
    query,
    category,
    totalResults: actualFilePaths.length,
    relevantResults,
    irrelevantResults,
    precision,
    recall,
    mrr,
    avgRelevantRank,
    contextNoise,
    expectedFound,
    expectedMissing,
    unexpectedFound,
  };
};

/**
 * Run accuracy tests for multiple queries
 *
 * @param queries - Ground truth queries
 * @param config - Cindex config
 * @param db - Database client
 * @param ollama - Ollama client
 * @returns Aggregate accuracy metrics
 */
export const runAccuracyTestSuite = async (
  queries: AccuracyQuery[],
  config: CindexConfig,
  db: DatabaseClient,
  ollama: OllamaClient
): Promise<AggregateAccuracyMetrics> => {
  console.log(`\n🎯 Running accuracy test suite (${queries.length} queries)...\n`);

  const results: AccuracyTestResult[] = [];

  // Run tests for each query
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`[${i + 1}/${queries.length}] Testing: "${query.query.substring(0, 50)}..."`);

    const result = await runAccuracyTest(query, config, db, ollama);
    results.push(result);

    console.log(
      `   Precision: ${(result.precision * 100).toFixed(1)}%, Recall: ${(result.recall * 100).toFixed(1)}%, MRR: ${result.mrr.toFixed(3)}`
    );
  }

  // Calculate aggregate metrics
  const avgPrecision = results.reduce((sum, r) => sum + r.precision, 0) / results.length;
  const avgRecall = results.reduce((sum, r) => sum + r.recall, 0) / results.length;
  const avgMRR = results.reduce((sum, r) => sum + r.mrr, 0) / results.length;
  const avgContextNoise = results.reduce((sum, r) => sum + r.contextNoise, 0) / results.length;

  // Category breakdown
  const categories = [...new Set(results.map((r) => r.category))];
  const categoryMetrics: Record<
    string,
    {
      avgPrecision: number;
      avgRecall: number;
      avgMRR: number;
    }
  > = {};

  for (const category of categories) {
    const categoryResults = results.filter((r) => r.category === category);
    categoryMetrics[category] = {
      avgPrecision: categoryResults.reduce((sum, r) => sum + r.precision, 0) / categoryResults.length,
      avgRecall: categoryResults.reduce((sum, r) => sum + r.recall, 0) / categoryResults.length,
      avgMRR: categoryResults.reduce((sum, r) => sum + r.mrr, 0) / categoryResults.length,
    };
  }

  // Check targets
  const meetsTargets = {
    precision: avgPrecision >= 0.92, // >92%
    mrr: avgMRR >= 0.85, // >0.85
    contextNoise: avgContextNoise < 0.02, // <2%
  };

  // Identify failed queries
  const failedQueries: { query: string; category: string; issue: string }[] = [];

  for (const result of results) {
    if (result.precision < 0.92) {
      failedQueries.push({
        query: result.query,
        category: result.category,
        issue: `Low precision: ${(result.precision * 100).toFixed(1)}%`,
      });
    }
    if (result.mrr < 0.85) {
      failedQueries.push({
        query: result.query,
        category: result.category,
        issue: `Low MRR: ${result.mrr.toFixed(3)}`,
      });
    }
    if (result.contextNoise > 0.02) {
      failedQueries.push({
        query: result.query,
        category: result.category,
        issue: `High context noise: ${(result.contextNoise * 100).toFixed(1)}%`,
      });
    }
  }

  // Count queries by category
  const queriesByCategory: Record<string, number> = {};
  for (const category of categories) {
    queriesByCategory[category] = results.filter((r) => r.category === category).length;
  }

  return {
    totalQueries: queries.length,
    queriesByCategory,
    avgPrecision,
    avgRecall,
    avgMRR,
    avgContextNoise,
    meetsTargets,
    categoryMetrics,
    failedQueries,
  };
};

/**
 * Log accuracy test results
 *
 * @param metrics - Aggregate accuracy metrics
 */
export const logAccuracyResults = (metrics: AggregateAccuracyMetrics): void => {
  console.log('\n' + '='.repeat(80));
  console.log('📊 ACCURACY TEST RESULTS');
  console.log('='.repeat(80));

  console.log(`\nTotal queries: ${metrics.totalQueries}`);

  console.log('\n📈 Overall Metrics:');
  console.log(`   Avg Precision: ${(metrics.avgPrecision * 100).toFixed(1)}% (target: >92%) ${metrics.meetsTargets.precision ? '✅' : '❌'}`);
  console.log(`   Avg Recall: ${(metrics.avgRecall * 100).toFixed(1)}%`);
  console.log(`   Avg MRR: ${metrics.avgMRR.toFixed(3)} (target: >0.85) ${metrics.meetsTargets.mrr ? '✅' : '❌'}`);
  console.log(`   Avg Context Noise: ${(metrics.avgContextNoise * 100).toFixed(2)}% (target: <2%) ${metrics.meetsTargets.contextNoise ? '✅' : '❌'}`);

  console.log('\n📊 Category Breakdown:');
  for (const [category, stats] of Object.entries(metrics.categoryMetrics)) {
    const queryCount = metrics.queriesByCategory[category];
    console.log(`   ${category} (${queryCount} queries):`);
    console.log(`     Precision: ${(stats.avgPrecision * 100).toFixed(1)}%`);
    console.log(`     Recall: ${(stats.avgRecall * 100).toFixed(1)}%`);
    console.log(`     MRR: ${stats.avgMRR.toFixed(3)}`);
  }

  if (metrics.failedQueries.length > 0) {
    console.log(`\n⚠️  Failed Queries (${metrics.failedQueries.length}):`);
    for (const failed of metrics.failedQueries.slice(0, 10)) {
      // Show first 10
      console.log(`   - "${failed.query.substring(0, 50)}..." [${failed.category}]: ${failed.issue}`);
    }
    if (metrics.failedQueries.length > 10) {
      console.log(`   ... and ${metrics.failedQueries.length - 10} more`);
    }
  } else {
    console.log('\n✅ All queries passed accuracy targets!');
  }

  console.log('\n' + '='.repeat(80));
};
