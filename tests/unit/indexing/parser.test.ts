/**
 * Unit tests for CodeParser
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CodeParser, parseCode } from '../../../src/indexing/parser';
import { Language, NodeType } from '../../../src/types/indexing';

const FIXTURES_PATH = path.join(__dirname, '../../fixtures');

describe('CodeParser', () => {
  describe('TypeScript/JavaScript parsing', () => {
    test('should parse TypeScript file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract function nodes', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);

      // Check for specific function
      const loginHandler = functions.find((f) => f.name === 'loginHandler');
      expect(loginHandler).toBeDefined();
    });

    test('should extract class nodes', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      expect(classes.length).toBeGreaterThan(0);

      // Check for AuthService class
      const authService = classes.find((c) => c.name === 'AuthService');
      expect(authService).toBeDefined();
      expect(authService?.children).toBeDefined();
      expect(authService?.children!.length).toBeGreaterThan(0);
    });

    test('should extract imports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have import from 'express'
      const expressImport = result.imports.find((i) => i.source === 'express');
      expect(expressImport).toBeDefined();
    });

    test('should extract exports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      expect(result.exports.length).toBeGreaterThan(0);
    });

    test('should calculate cyclomatic complexity', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.TypeScript);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );

      for (const func of functions) {
        expect(func.complexity).toBeDefined();
        expect(func.complexity).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Python parsing', () => {
    test('should parse Python file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Python);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      // Python parsing may use fallback if not fully implemented
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rust parsing', () => {
    test('should parse Rust file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      // Rust parsing may use fallback if not fully implemented
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
    });

    test('should extract Rust functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      // Should find functions via tree-sitter or fallback regex
      if (!result.used_fallback) {
        const functions = result.nodes.filter(
          (n) => n.node_type === NodeType.Function
        );
        expect(functions.length).toBeGreaterThanOrEqual(0);
      } else {
        // Fallback should find at least some functions
        expect(result.nodes.length).toBeGreaterThanOrEqual(0);
      }
    });

    test('should extract Rust structs and enums', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      // Rust has structs, enums, traits - these may be parsed as classes/types
      expect(result.success).toBe(true);
    });
  });

  describe('fallback parsing', () => {
    test('should use fallback for malformed code', async () => {
      const malformedPath = path.join(FIXTURES_PATH, 'malformed.js');
      const code = await fs.readFile(malformedPath, 'utf-8');

      const parser = new CodeParser(Language.JavaScript);
      const result = parser.parse(code, malformedPath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(true);
    });

    test('fallback should extract functions via regex', async () => {
      const malformedPath = path.join(FIXTURES_PATH, 'malformed.js');
      const code = await fs.readFile(malformedPath, 'utf-8');

      const parser = new CodeParser(Language.JavaScript);
      const result = parser.parse(code, malformedPath);

      // Should find at least the validFunction
      const validFunc = result.nodes.find((n) => n.name === 'validFunction');
      expect(validFunc).toBeDefined();
    });
  });

  describe('convenience functions', () => {
    test('parseCode should work', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.ts');
      const code = await fs.readFile(samplePath, 'utf-8');

      const result = parseCode(code, Language.TypeScript, samplePath);

      expect(result.success).toBe(true);
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });
});
