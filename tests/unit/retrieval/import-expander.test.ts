/**
 * Unit tests for import-expander.ts
 *
 * Tests import path normalization, alias resolution, and extension inference.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { jest } from '@jest/globals';
import { type PathLike } from 'node:fs';

import { WorkspaceType, type WorkspaceConfig } from '@indexing/workspace-detector';

// Mock fs.access for extension inference tests
jest.mock('node:fs/promises');

describe('Import Expander - Import Path Normalization', () => {
  const mockFsAccess = fs.access as jest.MockedFunction<typeof fs.access>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isInternalImport', () => {
    // We need to test this indirectly through normalizeImportPath behavior
    // since isInternalImport is not exported

    it('should treat node: prefixed imports as external', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');
      const result = await normalizeImportPath('node:fs', '/workspace/src/index.ts', null);

      expect(result).toBe('node:fs'); // External imports returned unchanged
    });

    it('should treat URLs as external', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      const httpResult = await normalizeImportPath('http://example.com/file.js', '/workspace/src/index.ts', null);
      expect(httpResult).toBe('http://example.com/file.js');

      const httpsResult = await normalizeImportPath('https://example.com/file.js', '/workspace/src/index.ts', null);
      expect(httpsResult).toBe('https://example.com/file.js');
    });

    it('should treat npm packages as external', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');
      const result = await normalizeImportPath('lodash', '/workspace/src/index.ts', null);

      expect(result).toBe('lodash'); // External imports returned unchanged
    });

    it('should treat relative imports as internal', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      // Mock fs.access to simulate file existence
      mockFsAccess.mockResolvedValue(undefined);

      const result = await normalizeImportPath('./utils/helper', '/workspace/src/index.ts', null);

      // Should resolve to absolute path
      expect(result).toContain('workspace/src/utils/helper');
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('normalizeImportPath - Without workspace config', () => {
    it('should resolve relative imports (./)', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      // Mock fs.access to find .ts extension
      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const currentFile = '/workspace/src/services/user.ts';
      const result = await normalizeImportPath('./logger', currentFile, null);

      expect(result).toBe('/workspace/src/services/logger.ts');
    });

    it('should resolve relative imports (../)', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const currentFile = '/workspace/src/services/user.ts';
      const result = await normalizeImportPath('../utils/logger', currentFile, null);

      expect(result).toBe('/workspace/src/utils/logger.ts');
    });

    it('should return external imports unchanged when no workspace config', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      const result = await normalizeImportPath('@workspace/utils', '/workspace/src/index.ts', null);

      // Without workspace config, @workspace/* is treated as external
      expect(result).toBe('@workspace/utils');
    });
  });

  describe('normalizeImportPath - With workspace config', () => {
    const mockWorkspaceConfig: WorkspaceConfig = {
      type: WorkspaceType.PNPM,
      rootPath: '/workspace',
      patterns: ['packages/*'],
      packages: [
        {
          name: '@workspace/shared',
          path: '/workspace/packages/shared',
          relativePath: 'packages/shared',
        },
        {
          name: '@workspace/utils',
          path: '/workspace/packages/utils',
          relativePath: 'packages/utils',
        },
      ],
      tsconfigPaths: {
        '@/*': ['src/*'],
        '@utils/*': ['src/utils/*'],
      },
    };

    it('should resolve workspace aliases (@workspace/*)', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('/index.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('@workspace/utils', '/workspace/src/index.ts', mockWorkspaceConfig);

      expect(result).toBe('/workspace/packages/utils/index.ts');
    });

    it('should resolve workspace aliases with subpaths', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath(
        '@workspace/utils/logger',
        '/workspace/src/index.ts',
        mockWorkspaceConfig
      );

      expect(result).toBe('/workspace/packages/utils/logger.ts');
    });

    it('should resolve TypeScript path aliases (@/*)', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('@/components/Button', '/workspace/src/index.ts', mockWorkspaceConfig);

      expect(result).toBe('/workspace/src/components/Button.ts');
    });

    it('should resolve TypeScript path aliases (@utils/*)', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('@utils/logger', '/workspace/src/index.ts', mockWorkspaceConfig);

      expect(result).toBe('/workspace/src/utils/logger.ts');
    });

    it('should still handle relative imports with workspace config', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('./helper', '/workspace/src/utils/logger.ts', mockWorkspaceConfig);

      expect(result).toBe('/workspace/src/utils/helper.ts');
    });
  });

  describe('addFileExtension - Extension inference', () => {
    it('should infer .ts extension', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        if (filePath.toString().endsWith('.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('./logger', '/workspace/src/index.ts', null);

      expect(result).toMatch(/\.ts$/);
    });

    it('should infer .tsx extension when .ts not found', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        const filePathStr = filePath.toString();
        if (filePathStr.endsWith('.tsx')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('./Button', '/workspace/src/index.ts', null);

      expect(result).toMatch(/\.tsx$/);
    });

    it('should infer .js extension when .ts/.tsx not found', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        const filePathStr = filePath.toString();
        if (filePathStr.endsWith('.js')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('./legacy', '/workspace/src/index.ts', null);

      expect(result).toMatch(/\.js$/);
    });

    it('should infer /index.ts for directory imports', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        const filePathStr = filePath.toString();
        if (filePathStr.endsWith('/index.ts')) {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('./utils', '/workspace/src/index.ts', null);

      expect(result).toMatch(/\/index\.ts$/);
    });

    it('should return original path when no extension matches', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      // All fs.access calls fail (file not found)
      mockFsAccess.mockRejectedValue(new Error('ENOENT'));

      const result = await normalizeImportPath('./missing', '/workspace/src/index.ts', null);

      // Should return resolved path without extension
      expect(result).toBe('/workspace/src/missing');
    });

    it('should keep existing extension unchanged', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      const result = await normalizeImportPath('./logger.ts', '/workspace/src/index.ts', null);

      expect(result).toBe('/workspace/src/logger.ts');
      expect(mockFsAccess).not.toHaveBeenCalled(); // No extension inference needed
    });
  });

  describe('normalizeImportPath - Edge cases', () => {
    it('should handle scoped npm packages as external', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      // Note: @types/* or @scope/* without workspace config are external
      const result = await normalizeImportPath('@types/node', '/workspace/src/index.ts', null);

      expect(result).toBe('@types/node');
    });

    it('should handle absolute paths', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        const filePathStr = filePath.toString();
        if (filePathStr === '/workspace/src/utils/logger.ts') {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath('/workspace/src/utils/logger', '/workspace/src/index.ts', null);

      // Absolute paths treated as internal
      expect(result).toBe('/workspace/src/utils/logger.ts');
    });

    it('should handle complex relative paths', async () => {
      const { normalizeImportPath } = await import('@retrieval/import-expander');

      mockFsAccess.mockImplementation(async (filePath: PathLike) => {
        const filePathStr = filePath.toString();
        if (filePathStr === '/workspace/packages/shared/utils/helper.ts') {
          return Promise.resolve(undefined);
        }
        throw new Error('ENOENT');
      });

      const result = await normalizeImportPath(
        '../../../shared/utils/helper',
        '/workspace/packages/app/src/components/Button.ts',
        null
      );

      expect(result).toBe('/workspace/packages/shared/utils/helper.ts');
    });
  });
});
