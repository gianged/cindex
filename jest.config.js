/**
 * Jest configuration for cindex MCP server tests
 */

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts', // Entry point, tested via integration
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@indexing/(.*)$': '<rootDir>/src/indexing/$1',
    '^@retrieval/(.*)$': '<rootDir>/src/retrieval/$1',
    '^@mcp/(.*)$': '<rootDir>/src/mcp/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    // Mock chalk to avoid ESM issues
    '^chalk$': '<rootDir>/tests/helpers/chalk-mock.js',
    // Mock uuid to avoid ESM issues
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js',
    // Map .js imports to .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(chalk)/)'],
  testTimeout: 30000,
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
};
