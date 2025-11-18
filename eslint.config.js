import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import nodePlugin from 'eslint-plugin-n';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global settings
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Main configuration for source files
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin,
      n: nodePlugin,
    },
    rules: {
      // ===== TypeScript Strict Rules (95% coverage target) =====
      '@typescript-eslint/no-explicit-any': 'warn', // Warn but don't block (allow 5% exceptions)
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-deprecated': 'warn', // TypeScript's native deprecation detection
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
        },
      ],

      // ===== Arrow Function Enforcement =====
      'prefer-arrow-callback': 'error', // Prefer arrow functions for callbacks
      'func-style': ['error', 'expression', { allowArrowFunctions: true }], // Prefer const fn = () => {}

      // ===== Import/Export Conventions =====
      'import/extensions': 'off', // Allow imports without extensions (TypeScript handles this)
      'import/no-unresolved': 'off', // TypeScript handles this better
      'import/order': 'off', // Disabled - Prettier plugin handles import organization
      'import/first': 'error', // All imports at top
      'import/no-duplicates': 'error', // Combine duplicate imports
      'import/newline-after-import': 'error', // Blank line after imports

      // ===== Node.js Built-in Prefix (node:) =====
      'n/prefer-node-protocol': 'error', // Enforce node: prefix (e.g., import fs from 'node:fs')
      'n/no-deprecated-api': 'error', // Detect deprecated Node.js APIs

      // ===== Code Quality =====
      '@typescript-eslint/no-floating-promises': 'error', // Catch unhandled promises
      '@typescript-eslint/await-thenable': 'error', // Only await promises
      '@typescript-eslint/no-misused-promises': 'error', // Prevent promise misuse
      '@typescript-eslint/promise-function-async': 'error', // Functions returning promises should be async
      '@typescript-eslint/require-await': 'warn', // Warn on async functions without await
      '@typescript-eslint/no-unnecessary-condition': 'warn', // Detect redundant conditions
      '@typescript-eslint/strict-boolean-expressions': 'off', // Too strict for practical use
      'no-console': 'off', // console.error is used for logging in MCP servers
      'no-process-exit': 'off', // process.exit is intentional in MCP servers

      // ===== Async/Await Best Practices =====
      '@typescript-eslint/return-await': ['error', 'in-try-catch'], // Return await only in try-catch
      'no-return-await': 'off', // Disable base rule (TS version is better)

      // ===== DRY Principle =====
      'no-duplicate-imports': 'off', // Handled by import/no-duplicates
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',

      // ===== Error Handling =====
      '@typescript-eslint/only-throw-error': 'error', // Only throw Error instances
      'no-empty': ['error', { allowEmptyCatch: false }], // No empty catch blocks

      // ===== Professional Standards (No Emojis) =====
      'no-irregular-whitespace': 'error', // Catch unicode characters
      'no-misleading-character-class': 'error',

      // ===== Consistency =====
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'], // Allow constants
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE', 'PascalCase'],
        },
        {
          selector: 'property',
          format: null, // Allow any format for properties (DB columns, API responses)
        },
        {
          selector: 'objectLiteralProperty',
          format: null, // Allow any format for object keys
        },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'], // Prefer interface over type
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',

      // ===== Performance =====
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },

  // Test files configuration
  {
    files: ['tests/**/*.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    languageOptions: {
      parserOptions: {
        allowDefaultProject: true, // Allow test files not in tsconfig.json
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in tests
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off', // Allow ! operator in tests
      '@typescript-eslint/require-await': 'off', // Allow async without await in tests
      'n/no-unpublished-import': 'off', // Allow dev dependencies
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      '*.config.mjs',
      'esbuild.config.js',
      'tests/fixtures/**', // Ignore test fixtures (intentionally malformed)
      'tests/helpers/**/*.js', // Ignore JS helpers (not in tsconfig)
    ],
  }
);
