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
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract Python functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Python);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);

      // Check for specific function
      const hasPermission = functions.find((f) => f.name === 'has_permission');
      expect(hasPermission).toBeDefined();

      const calculateComplexity = functions.find(
        (f) => f.name === 'calculate_complexity'
      );
      expect(calculateComplexity).toBeDefined();
    });

    test('should extract Python classes', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Python);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      expect(classes.length).toBeGreaterThan(0);

      // Check for AuthService class
      const authService = classes.find((c) => c.name === 'AuthService');
      expect(authService).toBeDefined();
      expect(authService?.children).toBeDefined();
      expect(authService?.children!.length).toBeGreaterThan(0);
    });

    test('should extract Python imports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Python);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have import os
      const osImport = result.imports.find((i) => i.source === 'os');
      expect(osImport).toBeDefined();
      expect(osImport?.is_namespace).toBe(true);

      // Should have from typing import Optional, List, Dict
      const typingImport = result.imports.find((i) => i.source === 'typing');
      expect(typingImport).toBeDefined();
      expect(typingImport?.symbols).toContain('Optional');
      expect(typingImport?.symbols).toContain('List');
      expect(typingImport?.symbols).toContain('Dict');
    });

    test('should extract Python class methods', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.py');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Python);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      const authService = classes.find((c) => c.name === 'AuthService');

      expect(authService?.children).toBeDefined();

      // Should have login method
      const loginMethod = authService?.children?.find(
        (m) => m.name === 'login'
      );
      expect(loginMethod).toBeDefined();
      expect(loginMethod?.is_async).toBe(true);

      // Should have __init__ method
      const initMethod = authService?.children?.find(
        (m) => m.name === '__init__'
      );
      expect(initMethod).toBeDefined();
    });
  });

  describe('Java parsing', () => {
    test('should parse Java file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract Java functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);

      // Check for specific methods
      const login = functions.find((f) => f.name === 'login');
      expect(login).toBeDefined();

      const hasPermission = functions.find((f) => f.name === 'hasPermission');
      expect(hasPermission).toBeDefined();
    });

    test('should extract Java classes', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      expect(classes.length).toBeGreaterThan(0);

      // Check for AuthService class
      const authService = classes.find((c) => c.name === 'AuthService');
      expect(authService).toBeDefined();

      // Check for PermissionUtils class
      const permissionUtils = classes.find((c) => c.name === 'PermissionUtils');
      expect(permissionUtils).toBeDefined();
    });

    test('should extract Java interfaces and enums', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      const interfaces = result.nodes.filter(
        (n) => n.node_type === NodeType.Interface
      );
      expect(interfaces.length).toBeGreaterThan(0);

      // Should have PermissionChecker interface
      const permissionChecker = interfaces.find(
        (i) => i.name === 'PermissionChecker'
      );
      expect(permissionChecker).toBeDefined();

      // Should have UserRole enum
      const userRole = interfaces.find((i) => i.name === 'UserRole');
      expect(userRole).toBeDefined();
    });

    test('should extract Java imports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have import java.util.List
      const listImport = result.imports.find((i) => i.source === 'java.util.List');
      expect(listImport).toBeDefined();

      // Should have static import
      const piImport = result.imports.find((i) => i.source === 'java.lang.Math.PI');
      expect(piImport).toBeDefined();
    });

    test('should extract Java public classes as exports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.java');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Java);
      const result = parser.parse(code, samplePath);

      expect(result.exports.length).toBeGreaterThan(0);

      // Should export AuthService
      const authServiceExport = result.exports.find((e) =>
        e.symbols.includes('AuthService')
      );
      expect(authServiceExport).toBeDefined();

      // Should export PermissionUtils
      const permissionUtilsExport = result.exports.find((e) =>
        e.symbols.includes('PermissionUtils')
      );
      expect(permissionUtilsExport).toBeDefined();
    });
  });

  describe('Go parsing', () => {
    test('should parse Go file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.go');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Go);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract Go functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.go');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Go);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);

      // Check for specific functions
      const hasPermission = functions.find((f) => f.name === 'HasPermission');
      expect(hasPermission).toBeDefined();

      const newAuthService = functions.find((f) => f.name === 'NewAuthService');
      expect(newAuthService).toBeDefined();
    });

    test('should extract Go structs and interfaces', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.go');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Go);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      const interfaces = result.nodes.filter(
        (n) => n.node_type === NodeType.Interface
      );

      expect(classes.length + interfaces.length).toBeGreaterThan(0);

      // Should have AuthService struct
      const authService = classes.find((c) => c.name === 'AuthService');
      expect(authService).toBeDefined();

      // Should have User struct
      const user = classes.find((c) => c.name === 'User');
      expect(user).toBeDefined();

      // Should have PermissionChecker interface
      const permissionChecker = interfaces.find(
        (i) => i.name === 'PermissionChecker'
      );
      expect(permissionChecker).toBeDefined();
    });

    test('should extract Go imports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.go');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Go);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have database/sql import
      const sqlImport = result.imports.find((i) => i.source === 'database/sql');
      expect(sqlImport).toBeDefined();

      // Should have time import
      const timeImport = result.imports.find((i) => i.source === 'time');
      expect(timeImport).toBeDefined();
    });

    test('should export Go public identifiers', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.go');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Go);
      const result = parser.parse(code, samplePath);

      expect(result.exports.length).toBeGreaterThan(0);

      // Should export AuthService (starts with uppercase)
      const authServiceExport = result.exports.find((e) =>
        e.symbols.includes('AuthService')
      );
      expect(authServiceExport).toBeDefined();

      // Should export HasPermission function
      const hasPermissionExport = result.exports.find((e) =>
        e.symbols.includes('HasPermission')
      );
      expect(hasPermissionExport).toBeDefined();
    });
  });

  describe('Rust parsing', () => {
    test('should parse Rust file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract Rust functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);
    });

    test('should extract Rust structs and enums', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      const interfaces = result.nodes.filter(
        (n) => n.node_type === NodeType.Interface
      );

      expect(classes.length + interfaces.length).toBeGreaterThan(0);

      // Should have User struct
      const user = classes.find((c) => c.name === 'User');
      expect(user).toBeDefined();

      // Should have DefaultAuthService struct
      const authService = classes.find((c) => c.name === 'DefaultAuthService');
      expect(authService).toBeDefined();

      // Should have UserRole enum
      const userRole = interfaces.find((i) => i.name === 'UserRole');
      expect(userRole).toBeDefined();
    });

    test('should extract Rust traits and impl blocks', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      const interfaces = result.nodes.filter(
        (n) => n.node_type === NodeType.Interface
      );
      expect(interfaces.length).toBeGreaterThan(0);

      // Should have AuthService trait
      const authServiceTrait = interfaces.find((i) => i.name === 'AuthService');
      expect(authServiceTrait).toBeDefined();

      // Should have impl blocks
      const impls = result.nodes.filter(
        (n) => n.node_type === NodeType.Class && n.name.startsWith('impl')
      );
      expect(impls.length).toBeGreaterThan(0);
    });

    test('should extract Rust imports', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have std::collections::HashMap import
      const hashmapImport = result.imports.find(
        (i) => i.source === 'std::collections::HashMap'
      );
      expect(hashmapImport).toBeDefined();
    });

    test('should export Rust public items', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.rs');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.Rust);
      const result = parser.parse(code, samplePath);

      expect(result.exports.length).toBeGreaterThan(0);

      // Should export User struct
      const userExport = result.exports.find((e) => e.symbols.includes('User'));
      expect(userExport).toBeDefined();

      // Should export AuthService trait
      const authServiceExport = result.exports.find((e) =>
        e.symbols.includes('AuthService')
      );
      expect(authServiceExport).toBeDefined();
    });
  });

  describe('C/C++ parsing', () => {
    test('should parse C++ file', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      expect(result.success).toBe(true);
      expect(result.used_fallback).toBe(false);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('should extract C++ functions', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      const functions = result.nodes.filter(
        (n) => n.node_type === NodeType.Function
      );
      expect(functions.length).toBeGreaterThan(0);

      // Functions should be extracted (C++ naming can be complex with templates)
      expect(functions.some((f) => f.name.length > 0)).toBe(true);
    });

    test('should extract C++ classes and structs', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      const classes = result.nodes.filter((n) => n.node_type === NodeType.Class);
      expect(classes.length).toBeGreaterThan(0);

      // Should have AuthService class
      const authService = classes.find((c) => c.name === 'AuthService');
      expect(authService).toBeDefined();

      // Should have User struct
      const user = classes.find((c) => c.name === 'User');
      expect(user).toBeDefined();
    });

    test('should extract C++ enums and namespaces', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      const interfaces = result.nodes.filter(
        (n) => n.node_type === NodeType.Interface
      );
      expect(interfaces.length).toBeGreaterThan(0);

      // Should have UserRole enum
      const userRole = interfaces.find((i) => i.name === 'UserRole');
      expect(userRole).toBeDefined();

      // Should have PermissionUtils namespace
      const permissionUtils = interfaces.find((i) =>
        i.name.includes('PermissionUtils')
      );
      expect(permissionUtils).toBeDefined();
    });

    test('should extract C++ includes', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      expect(result.imports.length).toBeGreaterThan(0);

      // Should have iostream include
      const iostreamInclude = result.imports.find((i) => i.source === 'iostream');
      expect(iostreamInclude).toBeDefined();

      // Should have string include
      const stringInclude = result.imports.find((i) => i.source === 'string');
      expect(stringInclude).toBeDefined();

      // Should have local header
      const databaseInclude = result.imports.find((i) => i.source === 'database.h');
      expect(databaseInclude).toBeDefined();
    });

    test('should extract C++ using declarations', async () => {
      const samplePath = path.join(FIXTURES_PATH, 'sample.cpp');
      const code = await fs.readFile(samplePath, 'utf-8');

      const parser = new CodeParser(Language.CPP);
      const result = parser.parse(code, samplePath);

      // Should have using namespace std
      const stdUsing = result.imports.find((i) => i.source === 'std');
      expect(stdUsing).toBeDefined();
      expect(stdUsing?.is_namespace).toBe(true);
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
