/**
 * Implementation linking logic
 *
 * Links API specifications to actual handler code using pattern matching
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { logger } from '@utils/logger';
import {
  type EndpointImplementation,
  type ImplementationLinker,
  type ImplementationSearchHints,
  type ParsedAPIEndpoint,
} from '@/types/api-parsing';

/**
 * Implementation linker
 *
 * Matches API endpoints to handler code using multiple strategies
 */
export class APIImplementationLinker implements ImplementationLinker {
  /**
   * Link single endpoint to implementation
   */
  public linkImplementation = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    // Try multiple strategies in order of confidence
    const strategies = [
      this.linkByOperationId,
      this.linkByDecorator,
      this.linkByRouteDefinition,
      this.linkByFilePath,
      this.linkByFunctionName,
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy(endpoint, codebasePath, searchHints);
        if (result && result.confidence >= 0.5) {
          logger.debug('Implementation linked', {
            endpoint: `${endpoint.method} ${endpoint.path}`,
            file: result.file_path,
            match_type: result.match_type,
            confidence: result.confidence,
          });
          return result;
        }
      } catch (error) {
        // Continue to next strategy
        logger.debug('Linking strategy failed', {
          strategy: strategy.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.debug('No implementation found for endpoint', {
      endpoint: `${endpoint.method} ${endpoint.path}`,
    });

    return null;
  };

  /**
   * Link multiple endpoints in batch
   */
  public linkBatch = async (
    endpoints: ParsedAPIEndpoint[],
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<Map<string, EndpointImplementation | null>> => {
    const results = new Map<string, EndpointImplementation | null>();

    for (const endpoint of endpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      const implementation = await this.linkImplementation(endpoint, codebasePath, searchHints);
      results.set(key, implementation);
    }

    return results;
  };

  /**
   * Strategy 1: Link by operationId in OpenAPI spec
   */
  private linkByOperationId = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    if (!endpoint.operation_id) return null;

    // Search for function/method with matching name
    const searchDirs = searchHints?.controller_dirs ?? ['src', 'app', 'controllers', 'handlers', 'routes'];

    for (const dir of searchDirs) {
      const dirPath = path.join(codebasePath, dir);
      try {
        const match = await this.searchFunctionByName(dirPath, endpoint.operation_id);
        if (match) {
          return {
            ...match,
            match_type: 'operation_id',
            confidence: 0.95, // High confidence - explicit operationId match
          };
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return null;
  };

  /**
   * Strategy 2: Link by decorator/annotation (NestJS, Spring Boot, FastAPI)
   */
  private linkByDecorator = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    const framework = searchHints?.framework ?? 'unknown';

    // Framework-specific decorator patterns
    const decoratorPatterns = this.getDecoratorPatterns(framework, endpoint.method, endpoint.path);

    const searchDirs = searchHints?.controller_dirs ?? ['src', 'app', 'controllers', 'api'];

    for (const dir of searchDirs) {
      const dirPath = path.join(codebasePath, dir);
      try {
        const match = await this.searchByPattern(dirPath, decoratorPatterns);
        if (match) {
          return {
            ...match,
            match_type: 'decorator',
            confidence: 0.85, // High confidence - explicit decorator match
          };
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return null;
  };

  /**
   * Strategy 3: Link by route definition (Express, Fastify)
   */
  private linkByRouteDefinition = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    const framework = searchHints?.framework ?? 'unknown';

    // Framework-specific route patterns
    const routePatterns = this.getRoutePatterns(framework, endpoint.method, endpoint.path);

    const searchDirs = searchHints?.controller_dirs ?? ['src', 'app', 'routes', 'api'];

    for (const dir of searchDirs) {
      const dirPath = path.join(codebasePath, dir);
      try {
        const match = await this.searchByPattern(dirPath, routePatterns);
        if (match) {
          return {
            ...match,
            match_type: 'route_definition',
            confidence: 0.8, // Good confidence - route definition match
          };
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return null;
  };

  /**
   * Strategy 4: Link by file path pattern
   */
  private linkByFilePath = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    // Convert endpoint path to potential file paths
    // e.g., /api/users/{id} → users.controller.ts, users-controller.ts, user.ts
    const pathSegments = endpoint.path.split('/').filter((s) => s && !s.startsWith('{'));
    if (pathSegments.length === 0) return null;

    const resourceName = pathSegments[pathSegments.length - 1]; // Last segment

    // Common file name patterns
    const filePatterns = [
      `${resourceName}.controller`,
      `${resourceName}-controller`,
      `${resourceName}.handler`,
      `${resourceName}-handler`,
      `${resourceName}.routes`,
      `${resourceName}-routes`,
      resourceName,
    ];

    const searchDirs = searchHints?.controller_dirs ?? ['src', 'app', 'controllers', 'handlers', 'routes', 'api'];

    for (const dir of searchDirs) {
      const dirPath = path.join(codebasePath, dir);
      try {
        for (const pattern of filePatterns) {
          const match = await this.findFileByPattern(dirPath, pattern);
          if (match) {
            // Found potential file - search for method handler
            const methodMatch = await this.findMethodInFile(match.file_path, endpoint.method, endpoint.path);

            if (methodMatch) {
              return {
                file_path: match.file_path,
                line_start: methodMatch.line_start,
                line_end: methodMatch.line_end,
                function_name: methodMatch.function_name,
                match_type: 'file_path',
                confidence: 0.7, // Moderate confidence - file path match
              };
            }
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return null;
  };

  /**
   * Strategy 5: Link by function name (fallback)
   */
  private linkByFunctionName = async (
    endpoint: ParsedAPIEndpoint,
    codebasePath: string,
    searchHints?: ImplementationSearchHints
  ): Promise<EndpointImplementation | null> => {
    // Generate potential function names from endpoint
    // e.g., GET /api/users → getUsers, getUsersHandler, handleGetUsers
    const pathSegments = endpoint.path.split('/').filter((s) => s && !s.startsWith('{'));
    if (pathSegments.length === 0) return null;

    const resourceName = pathSegments[pathSegments.length - 1];
    const method = endpoint.method.toLowerCase();

    const functionNames = [
      `${method}${this.capitalize(resourceName)}`,
      `${method}${this.capitalize(resourceName)}Handler`,
      `handle${this.capitalize(method)}${this.capitalize(resourceName)}`,
      `${resourceName}${this.capitalize(method)}`,
    ];

    const searchDirs = searchHints?.controller_dirs ?? ['src', 'app'];

    for (const dir of searchDirs) {
      const dirPath = path.join(codebasePath, dir);
      try {
        for (const funcName of functionNames) {
          const match = await this.searchFunctionByName(dirPath, funcName);
          if (match) {
            return {
              ...match,
              match_type: 'function_name',
              confidence: 0.6, // Lower confidence - function name heuristic
            };
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    return null;
  };

  /**
   * Get decorator patterns for framework
   */
  private getDecoratorPatterns = (framework: string, method: string, path: string): RegExp[] => {
    const escapedPath = this.escapeRegex(path).replace(/\{[^}]+\}/g, '[^"\']+'); // Replace {id} with regex

    switch (framework) {
      case 'nestjs':
        return [
          new RegExp(`@${this.capitalize(method.toLowerCase())}\\(['"\`]${escapedPath}['"\`]\\)`, 'i'),
          new RegExp(`@HttpCode\\(\\d+\\)[^}]*@${this.capitalize(method.toLowerCase())}`, 'i'),
        ];

      case 'fastapi':
      case 'django':
        return [
          new RegExp(`@app\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]\\)`, 'i'),
          new RegExp(`@router\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]\\)`, 'i'),
        ];

      case 'spring':
        return [
          new RegExp(`@${this.capitalize(method.toLowerCase())}Mapping\\(['"\`]${escapedPath}['"\`]\\)`, 'i'),
          new RegExp(`@RequestMapping.*method\\s*=\\s*RequestMethod\\.${method.toUpperCase()}`, 'i'),
        ];

      default:
        return [new RegExp(`@${this.capitalize(method.toLowerCase())}\\(['"\`]${escapedPath}['"\`]\\)`, 'i')];
    }
  };

  /**
   * Get route definition patterns for framework
   */
  private getRoutePatterns = (framework: string, method: string, path: string): RegExp[] => {
    const escapedPath = this.escapeRegex(path).replace(/\{[^}]+\}/g, '[^"\']+');

    switch (framework) {
      case 'express':
      case 'fastify':
        return [
          new RegExp(`\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]`, 'i'),
          new RegExp(`router\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]`, 'i'),
          new RegExp(`app\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]`, 'i'),
        ];

      default:
        return [new RegExp(`\\.${method.toLowerCase()}\\(['"\`]${escapedPath}['"\`]`, 'i')];
    }
  };

  /**
   * Search files by pattern
   */
  private searchByPattern = async (
    dirPath: string,
    patterns: RegExp[]
  ): Promise<Omit<EndpointImplementation, 'match_type' | 'confidence'> | null> => {
    const files = await this.getAllFiles(dirPath);

    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            // Found match - extract function/method
            const functionInfo = this.extractFunctionInfo(lines, i);
            return {
              file_path: file,
              line_start: i + 1,
              line_end: functionInfo.line_end,
              function_name: functionInfo.function_name,
            };
          }
        }
      }
    }

    return null;
  };

  /**
   * Search for function by name
   */
  private searchFunctionByName = async (
    dirPath: string,
    functionName: string
  ): Promise<Omit<EndpointImplementation, 'match_type' | 'confidence'> | null> => {
    const files = await this.getAllFiles(dirPath);

    const patterns = [
      new RegExp(`(?:function|const|let|var|async)\\s+${functionName}\\s*[=\\(]`, 'i'),
      new RegExp(`${functionName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`, 'i'),
      new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*{`, 'i'), // Method definition
    ];

    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            const functionInfo = this.extractFunctionInfo(lines, i);
            return {
              file_path: file,
              line_start: i + 1,
              line_end: functionInfo.line_end,
              function_name: functionName,
            };
          }
        }
      }
    }

    return null;
  };

  /**
   * Find file by pattern
   */
  private findFileByPattern = async (dirPath: string, pattern: string): Promise<{ file_path: string } | null> => {
    const files = await this.getAllFiles(dirPath);

    for (const file of files) {
      const fileName = path.basename(file, path.extname(file));
      if (fileName.includes(pattern)) {
        return { file_path: file };
      }
    }

    return null;
  };

  /**
   * Find method handler in file
   */
  private findMethodInFile = async (
    filePath: string,
    method: string,
    _endpointPath: string
  ): Promise<{ line_start: number; line_end: number; function_name?: string } | null> => {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Search for method handler (simple heuristic)
    const methodLower = method.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(methodLower) || line.includes(method)) {
        const functionInfo = this.extractFunctionInfo(lines, i);
        return {
          line_start: i + 1,
          line_end: functionInfo.line_end,
          function_name: functionInfo.function_name,
        };
      }
    }

    return null;
  };

  /**
   * Extract function information from lines
   */
  private extractFunctionInfo = (lines: string[], startLine: number): { line_end: number; function_name?: string } => {
    // Simple brace matching to find function end
    let braceCount = 0;
    let inFunction = false;
    let functionName: string | undefined;

    // Extract function name from start line
    const functionMatch = /(?:function|const|let)\s+(\w+)|(\w+)\s*=\s*(?:async\s*)?\(/.exec(lines[startLine]);
    if (functionMatch) {
      functionName = functionMatch[1] || functionMatch[2];
    }

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inFunction = true;
        } else if (char === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            return { line_end: i + 1, function_name: functionName };
          }
        }
      }

      // Prevent infinite search
      if (i - startLine > 200) {
        return { line_end: startLine + 50, function_name: functionName };
      }
    }

    return { line_end: startLine + 50, function_name: functionName };
  };

  /**
   * Get all files recursively
   */
  private getAllFiles = async (dirPath: string): Promise<string[]> => {
    const files: string[] = [];

    const traverse = async (currentPath: string) => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            // Skip node_modules, .git, etc.
            if (!['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
              await traverse(fullPath);
            }
          } else if (entry.isFile()) {
            // Only include code files
            const ext = path.extname(entry.name);
            if (['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs'].includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Directory not accessible, skip
      }
    };

    await traverse(dirPath);
    return files;
  };

  /**
   * Capitalize first letter
   */
  private capitalize = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  /**
   * Escape regex special characters
   */
  private escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };
}

/**
 * Create implementation linker instance
 */
export const createImplementationLinker = (): APIImplementationLinker => {
  return new APIImplementationLinker();
};
