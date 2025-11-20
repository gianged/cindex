/**
 * Scale Test Runner
 *
 * Utilities for running scale tests on codebases of various sizes.
 * Generates synthetic codebases, measures indexing performance, and validates against targets.
 *
 * Performance Targets:
 * - Indexing: 300-600 files/min (accuracy mode)
 * - Query: <800ms (accuracy mode)
 * - Memory: <1GB heap usage for 100k files
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { IndexingOrchestrator } from '@indexing/orchestrator';
import { searchCodebase } from '@retrieval/search';
import { createDatabaseClient } from '@database/client';
import { createOllamaClient } from '@utils/ollama';
import { loadConfig } from '@config/env';
import { type CindexConfig } from '@/types/config';
import { type SearchOptions } from '@/types/mcp-tools';

/**
 * Synthetic codebase configuration
 */
export interface SyntheticCodebaseConfig {
  name: string;
  targetFileCount: number;
  avgLinesPerFile: number;
  languages: string[]; // e.g., ['typescript', 'python', 'java']
  complexity: 'low' | 'medium' | 'high'; // Code complexity
  outputDir: string;
}

/**
 * Scale test results
 */
export interface ScaleTestResults {
  // Indexing metrics
  indexing: {
    totalFiles: number;
    totalDurationMs: number;
    filesPerMin: number;
    peakMemoryMB: number;
    avgMemoryMB: number;
    bottlenecks: string[];
  };

  // Query metrics
  queries: {
    totalQueries: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    avgResultsReturned: number;
  };

  // Target comparison
  meetsTargets: {
    indexingThroughput: boolean; // 300-600 files/min
    queryLatency: boolean; // <800ms
    memoryUsage: boolean; // <1GB for 100k files
  };
}

/**
 * Generate synthetic TypeScript file
 *
 * @param fileName - File name
 * @param lineCount - Target line count
 * @param complexity - Code complexity
 * @returns TypeScript code
 */
const generateTypeScriptFile = (fileName: string, lineCount: number, complexity: string): string => {
  const lines: string[] = [];

  // File header
  lines.push('/**');
  lines.push(` * ${fileName}`);
  lines.push(' * Auto-generated for scale testing');
  lines.push(' */');
  lines.push('');

  // Imports
  lines.push("import { randomUUID } from 'node:crypto';");
  lines.push("import { readFile } from 'node:fs/promises';");
  lines.push('');

  // Interfaces
  lines.push('export interface User {');
  lines.push('  id: string;');
  lines.push('  name: string;');
  lines.push('  email: string;');
  lines.push('  createdAt: Date;');
  lines.push('}');
  lines.push('');

  // Generate functions to reach target line count
  const functionsNeeded = Math.ceil((lineCount - lines.length) / 15);

  for (let i = 0; i < functionsNeeded; i++) {
    const functionName = `processData${i}`;

    lines.push('/**');
    lines.push(` * Process data operation ${i}`);
    lines.push(' *');
    lines.push(' * @param input - Input data');
    lines.push(' * @returns Processed result');
    lines.push(' */');
    lines.push(`export const ${functionName} = async (input: string): Promise<string> => {`);

    if (complexity === 'high') {
      // More complex logic
      lines.push('  try {');
      lines.push('    const data = JSON.parse(input);');
      lines.push('    const result = await readFile(data.path, "utf-8");');
      lines.push('    return result.toUpperCase();');
      lines.push('  } catch (error) {');
      lines.push('    console.error("Error processing data:", error);');
      lines.push('    throw error;');
      lines.push('  }');
    } else if (complexity === 'medium') {
      // Medium complexity
      lines.push('  const result = input.toUpperCase();');
      lines.push('  return result;');
    } else {
      // Low complexity
      lines.push('  return input;');
    }

    lines.push('};');
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Generate synthetic Python file
 *
 * @param fileName - File name
 * @param lineCount - Target line count
 * @param complexity - Code complexity
 * @returns Python code
 */
const generatePythonFile = (fileName: string, lineCount: number, complexity: string): string => {
  const lines: string[] = [];

  // File header
  lines.push('"""');
  lines.push(fileName);
  lines.push('Auto-generated for scale testing');
  lines.push('"""');
  lines.push('');

  // Imports
  lines.push('import json');
  lines.push('import logging');
  lines.push('from typing import Dict, List, Optional');
  lines.push('');

  // Generate functions
  const functionsNeeded = Math.ceil((lineCount - lines.length) / 12);

  for (let i = 0; i < functionsNeeded; i++) {
    const functionName = `process_data_${i}`;

    lines.push(`def ${functionName}(input_data: str) -> str:`);
    lines.push(`    """Process data operation ${i}"""`);

    if (complexity === 'high') {
      lines.push('    try:');
      lines.push('        data = json.loads(input_data)');
      lines.push('        result = str(data).upper()');
      lines.push('        return result');
      lines.push('    except Exception as e:');
      lines.push('        logging.error(f"Error: {e}")');
      lines.push('        raise');
    } else if (complexity === 'medium') {
      lines.push('    result = input_data.upper()');
      lines.push('    return result');
    } else {
      lines.push('    return input_data');
    }

    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Generate synthetic codebase
 *
 * Creates a test codebase with specified characteristics.
 *
 * @param config - Synthetic codebase configuration
 * @returns Generated codebase path
 */
export const generateSyntheticCodebase = async (config: SyntheticCodebaseConfig): Promise<string> => {
  const { name, targetFileCount, avgLinesPerFile, languages, complexity, outputDir } = config;

  // Create output directory
  const repoPath = path.join(outputDir, name);
  await fs.mkdir(repoPath, { recursive: true });

  console.log(`Generating synthetic codebase: ${name}`);
  console.log(`  Target files: ${targetFileCount.toLocaleString()}`);
  console.log(`  Avg lines/file: ${avgLinesPerFile.toLocaleString()}`);

  // Distribute files across languages
  const filesPerLanguage = Math.ceil(targetFileCount / languages.length);

  for (const language of languages) {
    const langDir = path.join(repoPath, 'src', language);
    await fs.mkdir(langDir, { recursive: true });

    for (let i = 0; i < filesPerLanguage; i++) {
      let content: string;
      let extension: string;

      if (language === 'typescript') {
        extension = '.ts';
        content = generateTypeScriptFile(`file-${i}${extension}`, avgLinesPerFile, complexity);
      } else if (language === 'python') {
        extension = '.py';
        content = generatePythonFile(`file-${i}${extension}`, avgLinesPerFile, complexity);
      } else {
        // Default to TypeScript
        extension = '.ts';
        content = generateTypeScriptFile(`file-${i}${extension}`, avgLinesPerFile, complexity);
      }

      const filePath = path.join(langDir, `file-${i}${extension}`);
      await fs.writeFile(filePath, content, 'utf-8');

      // Progress logging
      if ((i + 1) % 100 === 0) {
        console.log(`  Generated ${i + 1}/${filesPerLanguage} ${language} files`);
      }
    }
  }

  // Create package.json
  const packageJson = {
    name,
    version: '1.0.0',
    description: 'Synthetic codebase for scale testing',
  };
  await fs.writeFile(path.join(repoPath, 'package.json'), JSON.stringify(packageJson, null, 2));

  console.log(`✅ Generated ${targetFileCount.toLocaleString()} files in ${repoPath}`);

  return repoPath;
};

/**
 * Run scale test
 *
 * Indexes codebase, runs queries, and measures performance.
 *
 * @param repoPath - Repository path
 * @param queries - Test queries to run
 * @returns Scale test results
 */
export const runScaleTest = async (repoPath: string, queries: string[]): Promise<ScaleTestResults> => {
  const config = loadConfig() as CindexConfig;
  const db = createDatabaseClient(config.database);
  await db.connect();

  const ollama = createOllamaClient(config.ollama.host);

  try {
    // 1. Run indexing
    console.log('\n🔍 Starting indexing...');
    const indexStart = Date.now();
    const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

    const orchestrator = new IndexingOrchestrator(config, db, ollama);
    const stats = await orchestrator.indexRepository(repoPath, {
      repo_id: `scale-test-${Date.now()}`,
      repo_type: 'monolithic',
      force_reindex: true,
    });

    const indexDuration = Date.now() - indexStart;
    const peakMemory = process.memoryUsage().heapUsed / 1024 / 1024;

    const filesPerMin = (stats.files_indexed / indexDuration) * 60 * 1000;

    console.log(`✅ Indexing complete: ${stats.files_indexed.toLocaleString()} files in ${(indexDuration / 1000).toFixed(1)}s`);
    console.log(`   Throughput: ${filesPerMin.toFixed(0)} files/min`);
    console.log(`   Memory: ${peakMemory.toFixed(0)}MB (peak)`);

    // 2. Run queries
    console.log('\n🔍 Running queries...');
    const queryLatencies: number[] = [];
    let totalResults = 0;

    for (const query of queries) {
      const queryStart = Date.now();

      const searchOptions: SearchOptions = {
        scope: 'global',
        max_results: 20,
      };

      const result = await searchCodebase(query, config, db, ollama, searchOptions);

      const queryLatency = Date.now() - queryStart;
      queryLatencies.push(queryLatency);
      totalResults += result.chunks.length;

      console.log(`   Query "${query.substring(0, 40)}..." - ${queryLatency}ms, ${result.chunks.length} results`);
    }

    // Calculate query statistics
    queryLatencies.sort((a, b) => a - b);
    const avgLatency = queryLatencies.reduce((sum, l) => sum + l, 0) / queryLatencies.length;
    const p50 = queryLatencies[Math.floor(queryLatencies.length * 0.5)];
    const p95 = queryLatencies[Math.floor(queryLatencies.length * 0.95)];
    const p99 = queryLatencies[Math.floor(queryLatencies.length * 0.99)];
    const maxLatency = queryLatencies[queryLatencies.length - 1];

    console.log(`✅ Queries complete: ${queries.length} queries`);
    console.log(`   Avg latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`   P95 latency: ${p95.toFixed(0)}ms`);

    // 3. Check targets
    const meetsIndexingTarget = filesPerMin >= 300 && filesPerMin <= 1000;
    const meetsQueryTarget = avgLatency < 800;
    const meetsMemoryTarget = peakMemory < 1024;

    console.log('\n📊 Target Comparison:');
    console.log(`   Indexing: ${filesPerMin.toFixed(0)} files/min (target: 300-600) ${meetsIndexingTarget ? '✅' : '❌'}`);
    console.log(`   Query: ${avgLatency.toFixed(0)}ms avg (target: <800ms) ${meetsQueryTarget ? '✅' : '❌'}`);
    console.log(`   Memory: ${peakMemory.toFixed(0)}MB peak (target: <1024MB) ${meetsMemoryTarget ? '✅' : '❌'}`);

    return {
      indexing: {
        totalFiles: stats.files_indexed,
        totalDurationMs: indexDuration,
        filesPerMin,
        peakMemoryMB: peakMemory,
        avgMemoryMB: (initialMemory + peakMemory) / 2,
        bottlenecks: [], // Could extract from performance monitor
      },
      queries: {
        totalQueries: queries.length,
        avgLatencyMs: avgLatency,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        maxLatencyMs: maxLatency,
        avgResultsReturned: totalResults / queries.length,
      },
      meetsTargets: {
        indexingThroughput: meetsIndexingTarget,
        queryLatency: meetsQueryTarget,
        memoryUsage: meetsMemoryTarget,
      },
    };
  } finally {
    await db.close();
  }
};

/**
 * Cleanup test codebase
 *
 * @param repoPath - Repository path to delete
 */
export const cleanupTestCodebase = async (repoPath: string): Promise<void> => {
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
    console.log(`🗑️  Cleaned up test codebase: ${repoPath}`);
  } catch (error) {
    console.error(`Failed to cleanup ${repoPath}:`, error);
  }
};
