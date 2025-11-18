/**
 * esbuild configuration for cindex MCP server
 * Production-ready bundling with external dependencies
 */

import * as esbuild from 'esbuild';

/**
 * Base configuration shared between build and dev modes
 */
const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/index.js',
  sourcemap: true,
  format: 'esm',

  // External dependencies (not bundled, loaded at runtime)
  external: [
    '@modelcontextprotocol/sdk',
    'pg',
    'pgvector',
    'tree-sitter',
    'tree-sitter-*',
    'chalk',
    'ora',
    'ignore',
    'dotenv',
  ],

  // Log level
  logLevel: 'info',
};

/**
 * Build for production
 */
const build = async () => {
  try {
    await esbuild.build({
      ...baseConfig,
      minify: false, // Keep readable for debugging
    });
    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
};

/**
 * Build with watch mode for development
 */
const dev = async () => {
  try {
    const ctx = await esbuild.context({
      ...baseConfig,
      minify: false,
    });

    await ctx.watch();
    console.log('Watching for changes...');
  } catch (error) {
    console.error('Dev mode failed:', error);
    process.exit(1);
  }
};

// Run based on command line argument
const mode = process.argv[2];

if (mode === 'build') {
  build();
} else if (mode === 'dev') {
  dev();
} else {
  console.error('Usage: node esbuild.config.js [build|dev]');
  process.exit(1);
}
