/**
 * Integration tests for DatabaseWriter multi-project persistence functions
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createDatabaseClient, type DatabaseClient } from '@database/client';
import { createDatabaseWriter, type DatabaseWriter } from '@database/writer';

import { dropTestDatabase, getTestDbConfig, setupTestDatabase } from '../helpers/db-setup';

describe('DatabaseWriter Multi-Project Integration', () => {
  let dbClient: DatabaseClient;
  let dbWriter: DatabaseWriter;

  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();

    // Create client and connect
    const config = getTestDbConfig();
    dbClient = createDatabaseClient(config);
    await dbClient.connect();

    // Create writer
    dbWriter = createDatabaseWriter(dbClient);
  });

  afterAll(async () => {
    // Cleanup
    if (dbClient.connected) {
      await dbClient.close();
    }
    await dropTestDatabase();
  });

  describe('Repository Persistence', () => {
    it('should insert repository metadata', async () => {
      await dbWriter.insertRepository({
        repo_id: 'test-repo-1',
        repo_name: 'Test Repository',
        repo_path: '/test/repo',
        repo_type: 'monorepo',
        workspace_config: 'pnpm-workspace.yaml',
        workspace_patterns: ['packages/*', 'apps/*'],
        root_package_json: '/test/repo/package.json',
        git_remote_url: 'https://github.com/test/repo.git',
        metadata: { tool: 'pnpm', branch: 'main' },
      });

      // Verify insertion
      const result = await dbClient.query('SELECT * FROM repositories WHERE repo_id = $1', ['test-repo-1']);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.repo_name).toBe('Test Repository');
      expect(result.rows[0]?.repo_type).toBe('monorepo');
    });

    it('should update repository on conflict', async () => {
      // Insert again with different name
      await dbWriter.insertRepository({
        repo_id: 'test-repo-1',
        repo_name: 'Updated Repository',
        repo_path: '/test/repo',
        repo_type: 'monolithic',
        workspace_config: null,
        workspace_patterns: null,
        root_package_json: null,
        git_remote_url: null,
        metadata: null,
      });

      // Verify update
      const result = await dbClient.query('SELECT * FROM repositories WHERE repo_id = $1', ['test-repo-1']);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.repo_name).toBe('Updated Repository');
      expect(result.rows[0]?.repo_type).toBe('monolithic');
    });
  });

  describe('Workspace Persistence', () => {
    it('should insert workspaces in batch', async () => {
      const workspaces = [
        {
          repo_id: 'test-repo-1',
          workspace_id: 'workspace-1',
          package_name: '@test/workspace-1',
          workspace_path: 'packages/workspace-1',
          package_json_path: 'packages/workspace-1/package.json',
          version: '1.0.0',
          dependencies: { react: '^18.0.0' },
          dev_dependencies: { typescript: '^5.0.0' },
          tsconfig_paths: { '@/*': ['src/*'] },
          metadata: { main: 'dist/index.js' },
        },
        {
          repo_id: 'test-repo-1',
          workspace_id: 'workspace-2',
          package_name: '@test/workspace-2',
          workspace_path: 'packages/workspace-2',
          package_json_path: 'packages/workspace-2/package.json',
          version: '1.0.0',
          dependencies: null,
          dev_dependencies: null,
          tsconfig_paths: null,
          metadata: null,
        },
      ];

      const result = await dbWriter.insertWorkspaces(workspaces);
      expect(result.inserted).toBe(2);
      expect(result.failed).toBe(0);

      // Verify insertions
      const queryResult = await dbClient.query('SELECT * FROM workspaces WHERE repo_id = $1', ['test-repo-1']);
      expect(queryResult.rows.length).toBe(2);
    });

    it('should insert workspace aliases', async () => {
      const aliases = [
        {
          repo_id: 'test-repo-1',
          workspace_id: 'workspace-1',
          alias_type: 'tsconfig_path' as const,
          alias_pattern: '@/*',
          resolved_path: 'src/*',
          metadata: { source: 'tsconfig.json' },
        },
        {
          repo_id: 'test-repo-1',
          workspace_id: 'workspace-1',
          alias_type: 'npm_workspace' as const,
          alias_pattern: '@test/workspace-1',
          resolved_path: 'packages/workspace-1',
          metadata: { source: 'package.json' },
        },
      ];

      const result = await dbWriter.insertWorkspaceAliases(aliases);
      expect(result.inserted).toBe(2);
      expect(result.failed).toBe(0);

      // Verify insertions
      const queryResult = await dbClient.query('SELECT * FROM workspace_aliases WHERE repo_id = $1', ['test-repo-1']);
      expect(queryResult.rows.length).toBe(2);
    });

    it('should insert workspace dependencies', async () => {
      const dependencies = [
        {
          repo_id: 'test-repo-1',
          source_workspace_id: 'workspace-2',
          target_workspace_id: 'workspace-1',
          dependency_type: 'runtime' as const,
          version_specifier: '^1.0.0',
          metadata: null,
        },
      ];

      const result = await dbWriter.insertWorkspaceDependencies(dependencies);
      expect(result.inserted).toBe(1);
      expect(result.failed).toBe(0);

      // Verify insertion
      const queryResult = await dbClient.query('SELECT * FROM workspace_dependencies WHERE repo_id = $1', [
        'test-repo-1',
      ]);
      expect(queryResult.rows.length).toBe(1);
      expect(queryResult.rows[0]?.source_workspace_id).toBe('workspace-2');
      expect(queryResult.rows[0]?.target_workspace_id).toBe('workspace-1');
    });
  });

  describe('Service Persistence', () => {
    it('should insert services in batch', async () => {
      const services = [
        {
          service_id: 'auth-service',
          service_name: 'Authentication Service',
          repo_id: 'test-repo-1',
          service_path: 'services/auth',
          service_type: 'rest' as const,
          api_endpoints: [{ method: 'POST', path: '/api/auth/login', description: 'User login' }],
          dependencies: [{ service_id: 'user-service', dependency_type: 'api' as const }],
          metadata: { port: 3000, framework: 'express' },
        },
        {
          service_id: 'user-service',
          service_name: 'User Service',
          repo_id: 'test-repo-1',
          service_path: 'services/user',
          service_type: 'graphql' as const,
          api_endpoints: null,
          dependencies: null,
          metadata: null,
        },
      ];

      const result = await dbWriter.insertServices(services);
      expect(result.inserted).toBe(2);
      expect(result.failed).toBe(0);

      // Verify insertions
      const queryResult = await dbClient.query('SELECT * FROM services WHERE repo_id = $1', ['test-repo-1']);
      expect(queryResult.rows.length).toBe(2);
    });

    it('should insert cross-repo dependencies', async () => {
      // First insert another repository
      await dbWriter.insertRepository({
        repo_id: 'test-repo-2',
        repo_name: 'Test Repository 2',
        repo_path: '/test/repo2',
        repo_type: 'microservice',
        workspace_config: null,
        workspace_patterns: null,
        root_package_json: null,
        git_remote_url: null,
        metadata: null,
      });

      const crossRepoDeps = [
        {
          source_repo_id: 'test-repo-1',
          target_repo_id: 'test-repo-2',
          dependency_type: 'api' as const,
          source_service_id: 'auth-service',
          target_service_id: 'payment-service',
          api_contracts: [{ type: 'rest' as const, endpoints: [{ path: '/api/payment' }] }],
          metadata: null,
        },
      ];

      const result = await dbWriter.insertCrossRepoDependencies(crossRepoDeps);
      expect(result.inserted).toBe(1);
      expect(result.failed).toBe(0);

      // Verify insertion
      const queryResult = await dbClient.query(
        'SELECT * FROM cross_repo_dependencies WHERE source_repo_id = $1',
        ['test-repo-1']
      );
      expect(queryResult.rows.length).toBe(1);
      expect(queryResult.rows[0]?.target_repo_id).toBe('test-repo-2');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid repository data', async () => {
      // Try to insert with missing required fields (should fail with database constraint)
      await expect(
        dbClient.query('INSERT INTO repositories (repo_id) VALUES ($1)', ['invalid-repo'])
      ).rejects.toThrow();
    });

    it('should handle duplicate workspace_id', async () => {
      const workspaces = [
        {
          repo_id: 'test-repo-1',
          workspace_id: 'duplicate-workspace',
          package_name: '@test/duplicate-1',
          workspace_path: 'packages/duplicate-1',
          package_json_path: null,
          version: null,
          dependencies: null,
          dev_dependencies: null,
          tsconfig_paths: null,
          metadata: null,
        },
      ];

      // Insert once
      await dbWriter.insertWorkspaces(workspaces);

      // Insert again with different package_name (should update)
      workspaces[0].package_name = '@test/duplicate-updated';
      const result = await dbWriter.insertWorkspaces(workspaces);
      expect(result.inserted).toBe(1);
      expect(result.failed).toBe(0);

      // Verify it was updated, not duplicated
      const queryResult = await dbClient.query('SELECT * FROM workspaces WHERE workspace_id = $1', [
        'duplicate-workspace',
      ]);
      expect(queryResult.rows.length).toBe(1);
      expect(queryResult.rows[0]?.package_name).toBe('@test/duplicate-updated');
    });
  });
});
