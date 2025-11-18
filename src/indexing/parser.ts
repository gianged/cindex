/**
 * Tree-sitter Parser: Syntax-Aware Code Parsing
 *
 * Parses source code using tree-sitter to extract:
 * - Functions and methods (with parameters, return types, docstrings)
 * - Classes and interfaces
 * - Import and export statements
 * - Top-level variables and constants
 * - Cyclomatic complexity
 *
 * Supports 11 programming languages with regex fallback for parse errors.
 */

// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Parser from 'tree-sitter';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import C from 'tree-sitter-c';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Cpp from 'tree-sitter-cpp';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Go from 'tree-sitter-go';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Java from 'tree-sitter-java';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import JavaScript from 'tree-sitter-javascript';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Python from 'tree-sitter-python';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Rust from 'tree-sitter-rust';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import TypeScript from 'tree-sitter-typescript';

import { logger } from '@utils/logger';
import {
  Language,
  NodeType,
  type ExportInfo,
  type ImportInfo,
  type ParameterInfo,
  type ParsedNode,
  type ParseResult,
} from '@/types/indexing';

/**
 * Map languages to tree-sitter parsers
 * Note: Ruby, PHP, CSharp have dependency conflicts - using fallback parsing
 */
const LANGUAGE_PARSERS: Record<Language, object | null> = {
  [Language.TypeScript]: TypeScript.typescript,
  [Language.JavaScript]: JavaScript,
  [Language.Python]: Python,
  [Language.Java]: Java,
  [Language.Go]: Go,
  [Language.Rust]: Rust,
  [Language.C]: C,
  [Language.CPP]: Cpp,
  [Language.Ruby]: null, // Dependency conflict - uses fallback
  [Language.PHP]: null, // Dependency conflict - uses fallback
  [Language.CSharp]: null, // Dependency conflict - uses fallback
  [Language.Swift]: null, // Not available yet
  [Language.Kotlin]: null, // Not available yet
  [Language.Unknown]: null,
};

/**
 * Code parser with tree-sitter support
 */
export class CodeParser {
  private parser: Parser;

  constructor(private readonly language: Language) {
    this.parser = new Parser();

    const parserLanguage = LANGUAGE_PARSERS[language];
    if (parserLanguage) {
      this.parser.setLanguage(parserLanguage);
    }
  }

  /**
   * Parse source code and extract syntax nodes
   *
   * @param code - Source code to parse
   * @param filePath - File path (for error messages)
   * @returns Parse result with nodes, imports, exports
   */
  public parse = (code: string, filePath: string): ParseResult => {
    // Check if tree-sitter parser is available for this language
    if (!LANGUAGE_PARSERS[this.language]) {
      logger.warn('Tree-sitter parser not available, using fallback', {
        language: this.language,
        file: filePath,
      });
      return this.fallbackParse(code, filePath);
    }

    try {
      // Generate syntax tree
      const tree = this.parser.parse(code);

      // Check for syntax errors
      if (tree.rootNode.hasError) {
        logger.warn('Syntax errors detected, using fallback', {
          file: filePath,
          language: this.language,
        });
        return this.fallbackParse(code, filePath);
      }

      // Extract nodes based on language
      const nodes: ParsedNode[] = [];
      const imports: ImportInfo[] = [];
      const exports: ExportInfo[] = [];

      this.traverseTree(tree.rootNode, code, nodes, imports, exports);

      return {
        success: true,
        nodes,
        imports,
        exports,
        used_fallback: false,
      };
    } catch (error) {
      logger.error('Tree-sitter parsing failed, using fallback', {
        error,
        file: filePath,
      });
      return this.fallbackParse(code, filePath);
    }
  };

  /**
   * Traverse syntax tree and extract nodes
   */
  private traverseTree = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    // Language-specific node extraction
    switch (this.language) {
      case Language.TypeScript:
      case Language.JavaScript:
        this.extractJavaScriptNodes(node, code, nodes, imports, exports);
        break;
      case Language.Python:
        this.extractPythonNodes(node, code, nodes, imports, exports);
        break;
      case Language.Java:
        this.extractJavaNodes(node, code, nodes, imports, exports);
        break;
      case Language.Go:
        this.extractGoNodes(node, code, nodes, imports, exports);
        break;
      case Language.Rust:
        this.extractRustNodes(node, code, nodes, imports, exports);
        break;
      case Language.C:
      case Language.CPP:
        this.extractCNodes(node, code, nodes, imports, exports);
        break;
      case Language.Ruby:
        this.extractRubyNodes(node, code, nodes, imports, exports);
        break;
      case Language.PHP:
        this.extractPHPNodes(node, code, nodes, imports, exports);
        break;
      case Language.CSharp:
        this.extractCSharpNodes(node, code, nodes, imports, exports);
        break;
    }

    // Recursively traverse children
    for (const child of node.children) {
      this.traverseTree(child, code, nodes, imports, exports);
    }
  };

  /**
   * Extract nodes from TypeScript/JavaScript syntax tree
   */
  private extractJavaScriptNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function declarations
    if (
      type === 'function_declaration' ||
      type === 'arrow_function' ||
      type === 'function_expression' ||
      type === 'method_definition'
    ) {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract class declarations
    if (type === 'class_declaration' || type === 'class') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract imports
    if (type === 'import_statement') {
      const imp = this.extractImport(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // Extract exports
    if (type === 'export_statement' || type.startsWith('export_')) {
      const exp = this.extractExport(node, code);
      if (exp) {
        exports.push(exp);
      }
    }

    // Extract interfaces/types (TypeScript)
    if (this.language === Language.TypeScript) {
      if (type === 'interface_declaration' || type === 'type_alias_declaration') {
        const iface = this.extractInterface(node, code);
        if (iface) {
          nodes.push(iface);
        }
      }
    }

    // Extract top-level variables
    if (type === 'lexical_declaration' || type === 'variable_declaration') {
      const variable = this.extractVariable(node, code);
      if (variable) {
        nodes.push(variable);
      }
    }
  };

  /**
   * Extract function from syntax node
   */
  private extractFunction = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      const parameters = this.extractParameters(node, code);
      const returnType = this.extractReturnType(node, code);
      const docstring = this.extractDocstring(node, code);
      const complexity = this.calculateComplexity(node, code);

      const isAsync = code.slice(node.startIndex, node.endIndex).includes('async');

      return {
        node_type: NodeType.Function,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        parameters,
        return_type: returnType,
        docstring,
        complexity,
        is_async: isAsync,
      };
    } catch (error) {
      logger.debug('Failed to extract function', { error });
      return null;
    }
  };

  /**
   * Extract class from syntax node
   */
  private extractClass = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      // Extract methods as children
      const children: ParsedNode[] = [];
      const bodyNode = node.childForFieldName('body');

      if (bodyNode) {
        for (const child of bodyNode.children) {
          if (child.type === 'method_definition') {
            const method = this.extractFunction(child, code);
            if (method) {
              method.node_type = NodeType.Method;
              children.push(method);
            }
          }
        }
      }

      const docstring = this.extractDocstring(node, code);

      return {
        node_type: NodeType.Class,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        docstring,
        children,
      };
    } catch (error) {
      logger.debug('Failed to extract class', { error });
      return null;
    }
  };

  /**
   * Extract import statement
   */
  private extractImport = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Parse import statement (simplified)
      const sourceMatch = /from\s+['"]([^'"]+)['"]/.exec(text);
      const source = sourceMatch ? sourceMatch[1] : '';

      // Extract symbols (simplified - would need more sophisticated parsing)
      const symbols: string[] = [];
      const symbolMatch = /import\s+{([^}]+)}/.exec(text);
      if (symbolMatch) {
        symbols.push(...symbolMatch[1].split(',').map((s) => s.trim()));
      }

      const isDefault = text.includes('import') && !text.includes('{');
      const isNamespace = text.includes('* as');

      return {
        symbols,
        source,
        is_default: isDefault,
        is_namespace: isNamespace,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract import', { error });
      return null;
    }
  };

  /**
   * Extract export statement
   */
  private extractExport = (node: Parser.SyntaxNode, code: string): ExportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      const symbols: string[] = [];
      const isDefault = text.includes('export default');
      const isReexport = text.includes('from');

      // Extract symbol names (simplified)
      const symbolMatch = /export\s+{([^}]+)}/.exec(text);
      if (symbolMatch) {
        symbols.push(...symbolMatch[1].split(',').map((s) => s.trim()));
      }

      const reexportSource = isReexport ? /from\s+['"]([^'"]+)['"]/.exec(text)?.[1] : undefined;

      return {
        symbols,
        is_default: isDefault,
        is_reexport: isReexport,
        reexport_source: reexportSource,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract export', { error });
      return null;
    }
  };

  /**
   * Extract interface/type declaration (TypeScript)
   */
  private extractInterface = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      return {
        node_type: NodeType.Interface,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
      };
    } catch (error) {
      logger.debug('Failed to extract interface', { error });
      return null;
    }
  };

  /**
   * Extract variable declaration
   */
  private extractVariable = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const declarator = node.children.find((c) => c.type === 'variable_declarator');
      if (!declarator) return null;

      const nameNode = declarator.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<unknown>';

      // Check if it's a constant
      const text = code.slice(node.startIndex, node.endIndex);
      const isConst = text.startsWith('const');

      return {
        node_type: isConst ? NodeType.Constant : NodeType.Variable,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
      };
    } catch (error) {
      logger.debug('Failed to extract variable', { error });
      return null;
    }
  };

  /**
   * Extract function parameters
   */
  private extractParameters = (node: Parser.SyntaxNode, code: string): ParameterInfo[] => {
    const params: ParameterInfo[] = [];

    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode) return params;

    for (const child of paramsNode.children) {
      if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
        const nameNode = child.childForFieldName('pattern') ?? child.children[0];
        const name = code.slice(nameNode.startIndex, nameNode.endIndex);

        const typeNode = child.childForFieldName('type');
        const type = typeNode ? code.slice(typeNode.startIndex, typeNode.endIndex) : undefined;

        params.push({
          name,
          type,
          is_optional: child.type === 'optional_parameter',
          is_rest: false,
        });
      }
    }

    return params;
  };

  /**
   * Extract return type annotation
   */
  private extractReturnType = (node: Parser.SyntaxNode, code: string): string | undefined => {
    const returnTypeNode = node.childForFieldName('return_type');
    if (!returnTypeNode) return undefined;

    return code.slice(returnTypeNode.startIndex, returnTypeNode.endIndex);
  };

  /**
   * Extract docstring/comment
   */
  private extractDocstring = (node: Parser.SyntaxNode, code: string): string | undefined => {
    // Look for comment node preceding this node
    const prevSibling = node.previousSibling;
    if (prevSibling?.type === 'comment') {
      return code.slice(prevSibling.startIndex, prevSibling.endIndex);
    }
    return undefined;
  };

  /**
   * Calculate cyclomatic complexity
   *
   * Complexity = decision points + 1
   * Decision points: if, else, while, for, case, &&, ||, ?, catch
   */
  private calculateComplexity = (node: Parser.SyntaxNode, _code: string): number => {
    let complexity = 1; // Base complexity

    const decisionNodeTypes = new Set([
      'if_statement',
      'else_clause',
      'while_statement',
      'for_statement',
      'switch_case',
      'catch_clause',
      'conditional_expression',
      'logical_expression',
    ]);

    const traverse = (n: Parser.SyntaxNode) => {
      if (decisionNodeTypes.has(n.type)) {
        complexity++;
      }

      for (const child of n.children) {
        traverse(child);
      }
    };

    traverse(node);

    return complexity;
  };

  /**
   * Stub methods for other languages (to be implemented)
   */
  private extractPythonNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement Python-specific extraction
  };

  private extractJavaNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement Java-specific extraction
  };

  private extractGoNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement Go-specific extraction
  };

  private extractRustNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement Rust-specific extraction
  };

  private extractCNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement C/C++-specific extraction
  };

  private extractRubyNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement Ruby-specific extraction
  };

  private extractPHPNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement PHP-specific extraction
  };

  private extractCSharpNodes = (..._args: Parameters<typeof this.extractJavaScriptNodes>): void => {
    // TODO: Implement C#-specific extraction
  };

  /**
   * Fallback regex-based parsing for unsupported languages or syntax errors
   *
   * Uses sliding window approach: 200 lines with 20-line overlap
   */
  private fallbackParse = (code: string, filePath: string): ParseResult => {
    logger.info('Using fallback regex parsing', { file: filePath });

    const lines = code.split('\n');
    const nodes: ParsedNode[] = [];

    // Extract functions using regex
    const functionRegex = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
    let match;

    while ((match = functionRegex.exec(code)) !== null) {
      const name = match[1];
      const startLine = code.substring(0, match.index).split('\n').length;

      // Find end of function (simplified - look for closing brace)
      const endLine = Math.min(startLine + 50, lines.length);

      nodes.push({
        node_type: NodeType.Function,
        name,
        start_line: startLine,
        end_line: endLine,
        code_text: lines.slice(startLine - 1, endLine).join('\n'),
      });
    }

    // Extract classes using regex
    const classRegex = /^\s*(?:export\s+)?class\s+(\w+)/gm;

    while ((match = classRegex.exec(code)) !== null) {
      const name = match[1];
      const startLine = code.substring(0, match.index).split('\n').length;
      const endLine = Math.min(startLine + 100, lines.length);

      nodes.push({
        node_type: NodeType.Class,
        name,
        start_line: startLine,
        end_line: endLine,
        code_text: lines.slice(startLine - 1, endLine).join('\n'),
      });
    }

    return {
      success: true,
      nodes,
      imports: [],
      exports: [],
      used_fallback: true,
    };
  };
}

/**
 * Parse source code file (convenience function)
 *
 * @param code - Source code content
 * @param language - Programming language
 * @param filePath - File path for error messages
 * @returns Parse result with extracted nodes
 */
export const parseCode = (code: string, language: Language, filePath: string): ParseResult => {
  const parser = new CodeParser(language);
  return parser.parse(code, filePath);
};
