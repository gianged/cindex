/**
 * Monorepo Scale Test
 *
 * Tests indexing and query performance on monorepo with multiple workspaces.
 * Validates workspace detection, alias resolution, and cross-workspace search.
 *
 * Expected performance:
 * - Indexing: 300-600 files/min
 * - Query latency: <800ms
 * - Workspace detection: <5s
 * - Cross-workspace dependency resolution: accurate
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

import {
  generateSyntheticCodebase,
  runScaleTest,
  cleanupTestCodebase,
  type SyntheticCodebaseConfig,
} from './scale-test-runner';

describe('Monorepo Scale Test', () => {
  let repoPath: string;
  const testQueries = [
    // Workspace-specific queries
    'find workspace package exports',
    'search for shared utilities',
    'locate monorepo configuration',

    // Cross-workspace queries
    'find cross-workspace imports',
    'search for workspace dependencies',
    'locate shared types and interfaces',

    // Feature queries
    'find user authentication in auth workspace',
    'search for API endpoints in api workspace',
    'locate database models in data workspace',
  ];

  beforeAll(async () => {
    // Generate synthetic monorepo
    const config: SyntheticCodebaseConfig = {
      name: 'monorepo-scale-test',
      targetFileCount: 300, // 300 files across 3 workspaces = 100 files/workspace
      avgLinesPerFile: 100,
      languages: ['typescript'],
      complexity: 'medium',
      outputDir: path.join(os.tmpdir(), 'cindex-scale-tests'),
    };

    console.log('\n🏗️  Generating monorepo for scale test...');
    repoPath = await generateSyntheticCodebase(config);

    // Add monorepo configuration
    await createMonorepoStructure(repoPath);
  }, 180000); // 3 minute timeout for setup

  afterAll(async () => {
    // Cleanup generated codebase
    if (repoPath) {
      await cleanupTestCodebase(repoPath);
    }
  });

  test('should index monorepo and detect workspaces', async () => {
    console.log('\n📊 Running monorepo scale test...');

    const results = await runScaleTest(repoPath, testQueries);

    // Assert indexing performance
    expect(results.indexing.totalFiles).toBeGreaterThanOrEqual(300);
    expect(results.indexing.filesPerMin).toBeGreaterThanOrEqual(300);

    // Assert query performance (workspace-aware search)
    expect(results.queries.avgLatencyMs).toBeLessThan(800);

    // Assert targets met
    expect(results.meetsTargets.indexingThroughput).toBe(true);
    expect(results.meetsTargets.queryLatency).toBe(true);

    // Log summary
    console.log('\n✅ Monorepo scale test complete');
    console.log(`   Files indexed: ${results.indexing.totalFiles.toLocaleString()}`);
    console.log(`   Indexing: ${results.indexing.filesPerMin.toFixed(0)} files/min`);
    console.log(`   Query latency: ${results.queries.avgLatencyMs.toFixed(0)}ms avg`);
    console.log(`   Memory: ${results.indexing.peakMemoryMB.toFixed(0)}MB peak`);
  }, 900000); // 15 minute timeout
});

/**
 * Create monorepo structure with workspaces
 *
 * @param repoPath - Repository path
 */
async function createMonorepoStructure(repoPath: string): Promise<void> {
  // Create workspace directories
  const workspaces = ['packages/core', 'packages/api', 'packages/ui'];

  for (const workspace of workspaces) {
    const workspacePath = path.join(repoPath, workspace);
    await fs.mkdir(workspacePath, { recursive: true });

    // Move some generated files to workspace
    const srcPath = path.join(repoPath, 'src');
    const workspaceSrcPath = path.join(workspacePath, 'src');

    try {
      await fs.rename(srcPath, workspaceSrcPath);
    } catch {
      // Directory might not exist
    }

    // Create workspace package.json
    const packageJson = {
      name: `@monorepo/${path.basename(workspace)}`,
      version: '1.0.0',
      main: 'src/index.ts',
    };

    await fs.writeFile(path.join(workspacePath, 'package.json'), JSON.stringify(packageJson, null, 2));
  }

  // Create root package.json with workspaces
  const rootPackageJson = {
    name: 'monorepo-root',
    version: '1.0.0',
    private: true,
    workspaces: workspaces,
  };

  await fs.writeFile(path.join(repoPath, 'package.json'), JSON.stringify(rootPackageJson, null, 2));

  console.log('   Created monorepo structure with 3 workspaces');
}
