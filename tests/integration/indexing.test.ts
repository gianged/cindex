/**
 * Integration tests for end-to-end indexing pipeline
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FileWalker } from '../../src/indexing/file-walker';
import { CodeParser } from '../../src/indexing/parser';
import { CodeChunker } from '../../src/indexing/chunker';
import { MetadataExtractor } from '../../src/indexing/metadata';
import { WorkspaceDetector } from '../../src/indexing/workspace-detector';
import { ServiceDetector } from '../../src/indexing/service-detector';

const FIXTURES_PATH = path.join(__dirname, '../fixtures');

describe('Indexing Pipeline Integration', () => {
  describe('end-to-end file processing', () => {
    test('should process TypeScript file through full pipeline', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      // 1. File Discovery
      const walker = new FileWalker(path.dirname(samplePath));
      const files = await walker.discoverFiles();
      const file = files.find((f) => f.relative_path.includes('sample.ts'))!;

      expect(file).toBeDefined();
      expect(file.file_hash).toBeDefined();

      // 2. Parsing
      const parser = new CodeParser(file.language);
      const parseResult = parser.parse(code, file.absolute_path);

      expect(parseResult.success).toBe(true);
      expect(parseResult.nodes.length).toBeGreaterThan(0);

      // 3. Chunking
      const chunker = new CodeChunker();
      const chunkResult = chunker.createChunks(file, parseResult, code);

      expect(chunkResult.chunk_count).toBeGreaterThan(0);
      expect(chunkResult.chunks.length).toBe(chunkResult.chunk_count);

      // 4. Metadata Extraction
      const extractor = new MetadataExtractor();
      const metadata = extractor.extractMetadata(parseResult, code);

      expect(metadata.function_names.length).toBeGreaterThan(0);
      expect(metadata.class_names.length).toBeGreaterThan(0);
      expect(metadata.complexity).toBeGreaterThanOrEqual(1);
    });

    test('should process Python file through full pipeline', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      // 1. File Discovery
      const walker = new FileWalker(path.dirname(samplePath));
      const files = await walker.discoverFiles();
      const file = files.find((f) => f.relative_path.includes('sample.py'))!;

      expect(file).toBeDefined();

      // 2. Parsing (may use fallback for Python)
      const parser = new CodeParser(file.language);
      const parseResult = parser.parse(code, file.absolute_path);

      expect(parseResult.success).toBe(true);

      // 3. Chunking
      const chunker = new CodeChunker();
      const chunkResult = chunker.createChunks(file, parseResult, code);

      expect(chunkResult.chunk_count).toBeGreaterThanOrEqual(1);

      // 4. Metadata Extraction
      const extractor = new MetadataExtractor();
      const metadata = extractor.extractMetadata(parseResult, code);

      expect(metadata).toBeDefined();
    });
  });

  describe('gitignore filtering integration', () => {
    test('should correctly filter files with gitignore', async () => {
      const repoPath = path.join(FIXTURES_PATH, 'repo-with-gitignore');

      const walker = new FileWalker(repoPath);
      const files = await walker.discoverFiles();

      // Should find src files
      const srcFile = files.find((f) => f.relative_path.includes('src/index.ts'));
      expect(srcFile).toBeDefined();

      // Should not find node_modules
      const nodeModulesFile = files.find((f) =>
        f.relative_path.includes('node_modules')
      );
      expect(nodeModulesFile).toBeUndefined();
    });
  });

  describe('monorepo integration', () => {
    test('should detect monorepo workspace configuration', async () => {
      const monorepoPath = path.join(FIXTURES_PATH, 'monorepo-sample');

      const detector = new WorkspaceDetector(monorepoPath);
      const workspaceConfig = await detector.detectWorkspaceConfig();

      if (workspaceConfig) {
        expect(workspaceConfig.type).toBeDefined();
        expect(workspaceConfig.patterns.length).toBeGreaterThan(0);
        expect(workspaceConfig.packages.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('microservice integration', () => {
    test('should detect microservice configuration', async () => {
      const microservicePath = path.join(FIXTURES_PATH, 'microservice-sample');

      const detector = new ServiceDetector(microservicePath);
      const serviceConfig = await detector.detectServices();

      expect(serviceConfig).toBeDefined();
      expect(serviceConfig.rootPath).toBe(microservicePath);

      // Should detect docker-compose
      if (serviceConfig.hasDockerCompose) {
        expect(serviceConfig.dockerServices).toBeDefined();
      }
    });
  });
});
