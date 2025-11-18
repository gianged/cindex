/**
 * Metadata Extractor: Import/Export/Symbol Analysis
 *
 * Extracts comprehensive metadata from code chunks:
 * - Import statements (with workspace classification for monorepos)
 * - Export statements
 * - Symbol definitions (functions, classes, variables, types)
 * - Cyclomatic complexity
 * - Dependency analysis
 * - API endpoint patterns (for microservices)
 */

import { NodeType, type APIEndpointInfo, type ChunkMetadata, type ParseResult } from '@/types/indexing';

/**
 * Workspace import patterns for monorepo detection
 */
const WORKSPACE_IMPORT_PATTERNS = [
  /^@workspace\//,
  /^@[a-z0-9-]+\//, // Scoped packages (@myorg/package)
  /^@\//, // TypeScript path alias
  /^~\//, // Alternative path alias
];

/**
 * Metadata extractor for code analysis
 */
export class MetadataExtractor {
  /**
   * Extract comprehensive metadata from parsed code
   *
   * @param parseResult - Parse result with nodes, imports, exports
   * @param code - Raw code content
   * @returns Chunk metadata with symbols, imports, exports, complexity
   */
  public extractMetadata = (parseResult: ParseResult, code: string): ChunkMetadata => {
    // Extract function names
    const functionNames = this.extractFunctionNames(parseResult);

    // Extract class names
    const classNames = this.extractClassNames(parseResult);

    // Extract imported symbols
    const importedSymbols = this.extractImportedSymbols(parseResult);

    // Extract exported symbols
    const exportedSymbols = this.extractExportedSymbols(parseResult);

    // Extract dependencies (module paths from imports)
    const dependencies = this.extractDependencies(parseResult);

    // Calculate total cyclomatic complexity
    const complexity = this.calculateTotalComplexity(parseResult);

    // Detect async/await usage
    const hasAsync = code.includes('async') || code.includes('await');

    // Detect loops
    const hasLoops = this.detectLoops(code);

    // Detect conditionals
    const hasConditionals = this.detectConditionals(code);

    // Check for internal workspace imports (monorepo)
    const isInternalImport = this.detectInternalImports(parseResult);

    // Extract API endpoints (microservices)
    const apiEndpoints = this.extractAPIEndpoints(code);

    const metadata: ChunkMetadata = {
      function_names: functionNames,
      class_names: classNames,
      imported_symbols: importedSymbols,
      exported_symbols: exportedSymbols,
      dependencies,
      complexity,
      has_async: hasAsync,
      has_loops: hasLoops,
      has_conditionals: hasConditionals,
    };

    // Add optional fields
    if (isInternalImport !== null) {
      metadata.is_internal_import = isInternalImport;
    }

    if (apiEndpoints.length > 0) {
      metadata.api_endpoints = apiEndpoints;
    }

    return metadata;
  };

  /**
   * Extract function names from parse result
   */
  private extractFunctionNames = (parseResult: ParseResult): string[] => {
    return parseResult.nodes
      .filter((node) => node.node_type === NodeType.Function || node.node_type === NodeType.Method)
      .map((node) => node.name)
      .filter((name) => name !== '<anonymous>');
  };

  /**
   * Extract class names from parse result
   */
  private extractClassNames = (parseResult: ParseResult): string[] => {
    return parseResult.nodes
      .filter((node) => node.node_type === NodeType.Class)
      .map((node) => node.name)
      .filter((name) => name !== '<anonymous>');
  };

  /**
   * Extract imported symbols from parse result
   */
  private extractImportedSymbols = (parseResult: ParseResult): string[] => {
    const symbols: string[] = [];

    for (const imp of parseResult.imports) {
      if (imp.is_namespace && imp.namespace_alias) {
        symbols.push(imp.namespace_alias);
      } else {
        symbols.push(...imp.symbols);
      }
    }

    return symbols;
  };

  /**
   * Extract exported symbols from parse result
   */
  private extractExportedSymbols = (parseResult: ParseResult): string[] => {
    const symbols: string[] = [];

    for (const exp of parseResult.exports) {
      symbols.push(...exp.symbols);
    }

    return symbols;
  };

  /**
   * Extract dependencies (imported module paths)
   */
  private extractDependencies = (parseResult: ParseResult): string[] => {
    return parseResult.imports.map((imp) => imp.source).filter((source) => source !== '');
  };

  /**
   * Calculate total cyclomatic complexity for all functions
   */
  private calculateTotalComplexity = (parseResult: ParseResult): number => {
    let totalComplexity = 0;

    for (const node of parseResult.nodes) {
      if (node.complexity) {
        totalComplexity += node.complexity;
      }
    }

    return totalComplexity || 1; // Minimum complexity is 1
  };

  /**
   * Detect loop statements in code
   */
  private detectLoops = (code: string): boolean => {
    const loopPatterns = [
      /\bfor\s*\(/,
      /\bwhile\s*\(/,
      /\bdo\s*{/,
      /\.forEach\(/,
      /\.map\(/,
      /\.filter\(/,
      /\.reduce\(/,
    ];

    return loopPatterns.some((pattern) => pattern.test(code));
  };

  /**
   * Detect conditional statements in code
   */
  private detectConditionals = (code: string): boolean => {
    const conditionalPatterns = [/\bif\s*\(/, /\belse\b/, /\bswitch\s*\(/, /\?\s*.*\s*:/];

    return conditionalPatterns.some((pattern) => pattern.test(code));
  };

  /**
   * Detect internal workspace imports (monorepo)
   *
   * Returns null if no imports, true if any internal imports, false if all external
   */
  private detectInternalImports = (parseResult: ParseResult): boolean | null => {
    if (parseResult.imports.length === 0) {
      return null;
    }

    for (const imp of parseResult.imports) {
      // Check if import matches workspace patterns
      if (WORKSPACE_IMPORT_PATTERNS.some((pattern) => pattern.test(imp.source))) {
        return true;
      }

      // Check for relative imports (internal to project)
      if (imp.source.startsWith('./') || imp.source.startsWith('../')) {
        return true;
      }
    }

    return false;
  };

  /**
   * Extract API endpoint patterns from code (microservices)
   *
   * Detects:
   * - Express routes: app.get('/api/users', ...)
   * - NestJS decorators: @Get('/users')
   * - GraphQL resolvers: @Query() or @Mutation()
   * - gRPC service definitions: service UserService { rpc GetUser ... }
   */
  private extractAPIEndpoints = (code: string): APIEndpointInfo[] => {
    const endpoints: APIEndpointInfo[] = [];

    // Express.js routes
    const expressPatterns = [
      { method: 'GET', regex: /app\.get\s*\(\s*['"]([^'"]+)['"]/g },
      { method: 'POST', regex: /app\.post\s*\(\s*['"]([^'"]+)['"]/g },
      { method: 'PUT', regex: /app\.put\s*\(\s*['"]([^'"]+)['"]/g },
      { method: 'DELETE', regex: /app\.delete\s*\(\s*['"]([^'"]+)['"]/g },
      { method: 'PATCH', regex: /app\.patch\s*\(\s*['"]([^'"]+)['"]/g },
    ];

    for (const { method, regex } of expressPatterns) {
      let match;
      while ((match = regex.exec(code)) !== null) {
        const path = match[1];
        const lineNumber = code.substring(0, match.index).split('\n').length;

        endpoints.push({
          method,
          path,
          line_number: lineNumber,
          api_type: 'rest',
        });
      }
    }

    // NestJS decorators
    const nestJSPatterns = [
      { method: 'GET', regex: /@Get\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
      { method: 'POST', regex: /@Post\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
      { method: 'PUT', regex: /@Put\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
      { method: 'DELETE', regex: /@Delete\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
      { method: 'PATCH', regex: /@Patch\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
    ];

    for (const { method, regex } of nestJSPatterns) {
      let match;
      while ((match = regex.exec(code)) !== null) {
        const path = match[1];
        const lineNumber = code.substring(0, match.index).split('\n').length;

        endpoints.push({
          method,
          path,
          line_number: lineNumber,
          api_type: 'rest',
        });
      }
    }

    // GraphQL resolvers
    const graphqlQueryRegex = /@Query\s*\(\s*(?:['"]([^'"]+)['"])?\s*\)/g;
    const graphqlMutationRegex = /@Mutation\s*\(\s*(?:['"]([^'"]+)['"])?\s*\)/g;

    let match;
    while ((match = graphqlQueryRegex.exec(code)) !== null) {
      const operationName = match[1] || '<unnamed>';
      const lineNumber = code.substring(0, match.index).split('\n').length;

      endpoints.push({
        method: 'QUERY',
        path: operationName,
        line_number: lineNumber,
        api_type: 'graphql',
      });
    }

    while ((match = graphqlMutationRegex.exec(code)) !== null) {
      const operationName = match[1] || '<unnamed>';
      const lineNumber = code.substring(0, match.index).split('\n').length;

      endpoints.push({
        method: 'MUTATION',
        path: operationName,
        line_number: lineNumber,
        api_type: 'graphql',
      });
    }

    // gRPC service definitions
    const grpcServiceRegex = /service\s+(\w+)\s*{/g;
    const grpcRpcRegex = /rpc\s+(\w+)/g;

    while ((match = grpcServiceRegex.exec(code)) !== null) {
      const serviceName = match[1];
      const lineNumber = code.substring(0, match.index).split('\n').length;

      // Find all rpc methods in this service
      const serviceBlock = code.substring(match.index, match.index + 500); // Approximate
      let rpcMatch;
      while ((rpcMatch = grpcRpcRegex.exec(serviceBlock)) !== null) {
        const rpcName = rpcMatch[1];

        endpoints.push({
          method: 'RPC',
          path: `${serviceName}.${rpcName}`,
          line_number: lineNumber,
          api_type: 'grpc',
        });
      }
    }

    return endpoints;
  };
}

/**
 * Extract metadata from parsed code (convenience function)
 *
 * @param parseResult - Parse result with nodes, imports, exports
 * @param code - Raw code content
 * @returns Chunk metadata
 */
export const extractMetadata = (parseResult: ParseResult, code: string): ChunkMetadata => {
  const extractor = new MetadataExtractor();
  return extractor.extractMetadata(parseResult, code);
};

/**
 * Classify import as internal or external (monorepo helper)
 *
 * @param importPath - Import source path
 * @returns true if internal workspace import, false if external
 */
export const classifyImport = (importPath: string): boolean => {
  // Check workspace patterns
  if (WORKSPACE_IMPORT_PATTERNS.some((pattern) => pattern.test(importPath))) {
    return true;
  }

  // Relative imports are internal
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return true;
  }

  // Everything else is external (node_modules)
  return false;
};

/**
 * Calculate cyclomatic complexity from code (standalone function)
 *
 * Complexity = decision points + 1
 * Decision points: if, else, while, for, case, &&, ||, ?, catch
 */
export const calculateComplexity = (code: string): number => {
  let complexity = 1;

  const patterns = [
    /\bif\s*\(/g,
    /\belse\b/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcase\s+/g,
    /&&/g,
    /\|\|/g,
    /\?/g,
    /\bcatch\s*\(/g,
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
};
