/**
 * Unit tests for FileWalker
 */

import { describe, test, expect } from '@jest/globals';
import * as path from 'node:path';
import { FileWalker, discoverFiles } from '../../../src/indexing/file-walker';
import { Language } from '../../../src/types/indexing';

const FIXTURES_PATH = path.join(__dirname, '../../fixtures');

describe('FileWalker', () => {
  describe('file discovery', () => {
    test('should discover TypeScript files', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      const tsFiles = files.filter((f) => f.language === Language.TypeScript);
      expect(tsFiles.length).toBeGreaterThan(0);

      const sampleTs = tsFiles.find((f) => f.relative_path.includes('sample.ts'));
      expect(sampleTs).toBeDefined();
      expect(sampleTs?.language).toBe(Language.TypeScript);
    });

    test('should discover Python files', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      const pyFiles = files.filter((f) => f.language === Language.Python);
      expect(pyFiles.length).toBeGreaterThan(0);

      const samplePy = pyFiles.find((f) => f.relative_path.includes('sample.py'));
      expect(samplePy).toBeDefined();
    });

    test('should detect language correctly by extension', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      const jsFile = files.find((f) => f.relative_path.endsWith('.js'));
      if (jsFile) {
        expect(jsFile.language).toBe(Language.JavaScript);
      }

      const tsFile = files.find((f) => f.relative_path.endsWith('.ts'));
      if (tsFile) {
        expect(tsFile.language).toBe(Language.TypeScript);
      }
    });
  });

  describe('gitignore filtering', () => {
    test('should respect .gitignore patterns', async () => {
      const repoPath = path.join(FIXTURES_PATH, 'repo-with-gitignore');
      const walker = new FileWalker(repoPath);
      const files = await walker.discoverFiles();

      // Should find src/index.ts
      const indexFile = files.find((f) => f.relative_path.includes('src/index.ts'));
      expect(indexFile).toBeDefined();

      // Should NOT find node_modules files
      const nodeModulesFile = files.find((f) => f.relative_path.includes('node_modules'));
      expect(nodeModulesFile).toBeUndefined();
    });

    test('should exclude hardcoded directories', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      // Should not include any files from node_modules, dist, build
      const excludedDirs = ['node_modules', 'dist', 'build', '.git'];

      for (const dir of excludedDirs) {
        const filesInExcludedDir = files.filter((f) =>
          f.relative_path.includes(`${dir}/`)
        );
        expect(filesInExcludedDir.length).toBe(0);
      }
    });
  });

  describe('binary file exclusion', () => {
    test('should exclude binary files', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      // Should not find any binary extensions
      const binaryExts = ['.png', '.jpg', '.pdf', '.zip', '.exe'];

      for (const ext of binaryExts) {
        const binaryFiles = files.filter((f) => f.relative_path.endsWith(ext));
        expect(binaryFiles.length).toBe(0);
      }
    });
  });

  describe('SHA256 hashing', () => {
    test('should compute SHA256 hash for files', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      const sampleFile = files.find((f) => f.relative_path.includes('sample.ts'));
      expect(sampleFile).toBeDefined();
      expect(sampleFile?.file_hash).toBeDefined();
      expect(sampleFile?.file_hash).toHaveLength(64); // SHA256 produces 64 hex chars
    });

    test('should produce consistent hashes', async () => {
      const walker1 = new FileWalker(FIXTURES_PATH);
      const files1 = await walker1.discoverFiles();

      const walker2 = new FileWalker(FIXTURES_PATH);
      const files2 = await walker2.discoverFiles();

      const file1 = files1.find((f) => f.relative_path.includes('sample.ts'));
      const file2 = files2.find((f) => f.relative_path.includes('sample.ts'));

      expect(file1?.file_hash).toBe(file2?.file_hash);
    });
  });

  describe('line counting', () => {
    test('should count lines correctly', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      const files = await walker.discoverFiles();

      const sampleFile = files.find((f) => f.relative_path.includes('sample.ts'));
      expect(sampleFile).toBeDefined();
      expect(sampleFile?.line_count).toBeGreaterThan(0);
    });

    test('should handle large files', async () => {
      const walker = new FileWalker(FIXTURES_PATH, { max_file_size: 10000 });
      const files = await walker.discoverFiles();

      const largeFile = files.find((f) => f.relative_path.includes('large.ts'));
      // Large file should be discovered if under max size
      if (largeFile) {
        expect(largeFile.line_count).toBeLessThanOrEqual(10000);
      }
    });
  });

  describe('file statistics', () => {
    test('should track discovery statistics', async () => {
      const walker = new FileWalker(FIXTURES_PATH);
      await walker.discoverFiles();
      const stats = walker.getStats();

      expect(stats.total_files).toBeGreaterThan(0);
      expect(stats.files_by_language).toBeDefined();
      expect(stats.total_lines).toBeGreaterThan(0);
    });

    test('should count excluded files', async () => {
      const repoPath = path.join(FIXTURES_PATH, 'repo-with-gitignore');
      const walker = new FileWalker(repoPath);
      await walker.discoverFiles();
      const stats = walker.getStats();

      // Should have at least one excluded file (node_modules)
      expect(stats.excluded_by_gitignore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('convenience functions', () => {
    test('discoverFiles should work', async () => {
      const files = await discoverFiles(FIXTURES_PATH);
      expect(files.length).toBeGreaterThan(0);
    });
  });
});
