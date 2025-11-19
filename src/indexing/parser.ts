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
 * Supports 12 programming languages with full tree-sitter parsing:
 * - TypeScript, JavaScript, Python, Java, Go, Rust
 * - C, C++, C#, PHP, Ruby, Kotlin
 *
 * Swift and other languages use regex fallback parsing.
 */

// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Parser from 'tree-sitter';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import C from 'tree-sitter-c';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import CSharp from 'tree-sitter-c-sharp';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Cpp from 'tree-sitter-cpp';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Go from 'tree-sitter-go';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Java from 'tree-sitter-java';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import JavaScript from 'tree-sitter-javascript';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Kotlin from 'tree-sitter-kotlin';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import PHP from 'tree-sitter-php';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Python from 'tree-sitter-python';
// eslint-disable-next-line @typescript-eslint/naming-convention -- Tree-sitter library exports use PascalCase
import Ruby from 'tree-sitter-ruby';
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
 * Note: Swift has build issues - using fallback parsing
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
  [Language.CSharp]: CSharp,
  [Language.Ruby]: Ruby,
  [Language.PHP]: PHP.php,
  [Language.Kotlin]: Kotlin,
  [Language.Swift]: null, // Build issues with tree-sitter-cli - uses fallback
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
      case Language.Kotlin:
        this.extractKotlinNodes(node, code, nodes, imports, exports);
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
   * Extract nodes from Python syntax tree
   */
  private extractPythonNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    _exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function definitions (but not methods inside classes)
    if (type === 'function_definition') {
      // Check if this function is inside a class (is a method)
      const isMethod = node.parent?.parent?.type === 'class_definition';
      if (!isMethod) {
        const func = this.extractFunction(node, code);
        if (func) {
          nodes.push(func);
        }
      }
    }

    // Extract class definitions with Python-specific method extraction
    if (type === 'class_definition') {
      const cls = this.extractPythonClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract import statements: import module
    if (type === 'import_statement') {
      const imp = this.extractPythonImport(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // Extract from...import statements: from module import symbol
    if (type === 'import_from_statement') {
      const imp = this.extractPythonFromImport(node, code);
      if (imp) {
        imports.push(imp);
      }
    }
  };

  /**
   * Extract Python class with methods
   */
  private extractPythonClass = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      // Extract methods as children
      const children: ParsedNode[] = [];
      const bodyNode = node.childForFieldName('body');

      if (bodyNode) {
        for (const child of bodyNode.children) {
          // In Python, methods are function_definition nodes within the class body
          if (child.type === 'function_definition') {
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
      logger.debug('Failed to extract Python class', { error });
      return null;
    }
  };

  /**
   * Extract Python import statement: import module
   */
  private extractPythonImport = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract module name: import os, import sys
      // Can have multiple: import os, sys, json
      const importMatch = /import\s+([^\n]+)/.exec(text);
      const modules = importMatch ? importMatch[1].split(',').map((m) => m.trim()) : [];

      // For simple imports, we treat each module as a namespace import
      // Store the first module as the source
      const source = modules[0] ?? '';

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: true,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Python import', { error });
      return null;
    }
  };

  /**
   * Extract Python from...import statement: from module import symbol
   */
  private extractPythonFromImport = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract module: from typing import List, Dict
      const moduleMatch = /from\s+([^\s]+)\s+import/.exec(text);
      const source = moduleMatch ? moduleMatch[1].trim() : '';

      // Extract symbols: List, Dict, or * for wildcard
      const symbols: string[] = [];
      const symbolsMatch = /import\s+([^\n]+)/.exec(text);
      if (symbolsMatch) {
        const symbolsText = symbolsMatch[1].trim();
        if (symbolsText === '*') {
          // Wildcard import
          symbols.push('*');
        } else {
          // Named imports: can have aliases like "import foo as bar"
          symbols.push(...symbolsText.split(',').map((s) => s.trim().split(' as ')[0].trim()));
        }
      }

      const isNamespace = symbols.includes('*');

      return {
        symbols,
        source,
        is_default: false,
        is_namespace: isNamespace,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Python from...import', { error });
      return null;
    }
  };

  /**
   * Extract nodes from Java syntax tree
   */
  private extractJavaNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract method declarations
    if (type === 'method_declaration' || type === 'constructor_declaration') {
      const func = this.extractFunction(node, code);
      if (func) {
        func.node_type = type === 'constructor_declaration' ? NodeType.Method : NodeType.Function;
        nodes.push(func);
      }
    }

    // Extract field declarations (class fields/properties)
    if (type === 'field_declaration') {
      const field = this.extractJavaField(node, code);
      if (field) {
        nodes.push(field);
      }
    }

    // Extract class declarations
    if (type === 'class_declaration') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract interface declarations
    if (type === 'interface_declaration') {
      const iface = this.extractInterface(node, code);
      if (iface) {
        nodes.push(iface);
      }
    }

    // Extract enum declarations
    if (type === 'enum_declaration') {
      const enumNode = this.extractEnum(node, code);
      if (enumNode) {
        nodes.push(enumNode);
      }
    }

    // Extract annotation type declarations (@interface)
    if (type === 'annotation_type_declaration') {
      const annotation = this.extractInterface(node, code);
      if (annotation) {
        nodes.push(annotation);
      }
    }

    // Extract import declarations
    if (type === 'import_declaration') {
      const imp = this.extractJavaImport(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // Java doesn't have traditional exports - classes are accessible via packages
    // We track public classes/interfaces/enums as implicit exports
    if (
      (type === 'class_declaration' ||
        type === 'interface_declaration' ||
        type === 'enum_declaration' ||
        type === 'annotation_type_declaration') &&
      this.isJavaPublicMember(node, code)
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = code.slice(nameNode.startIndex, nameNode.endIndex);
        exports.push({
          symbols: [name],
          is_default: false,
          is_reexport: false,
          line_number: node.startPosition.row + 1,
        });
      }
    }
  };

  /**
   * Extract Java field declaration
   */
  private extractJavaField = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      // Field declaration can have multiple declarators
      const declarator = node.children.find((c) => c.type === 'variable_declarator');
      if (!declarator) return null;

      const nameNode = declarator.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<unknown>';

      // Extract type
      const typeNode = node.childForFieldName('type');
      const returnType = typeNode ? code.slice(typeNode.startIndex, typeNode.endIndex) : undefined;

      const docstring = this.extractDocstring(node, code);

      // Check if it's static final (constant)
      const text = code.slice(node.startIndex, node.endIndex);
      const isConstant = text.includes('static') && text.includes('final');

      return {
        node_type: isConstant ? NodeType.Constant : NodeType.Variable,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        return_type: returnType,
        docstring,
      };
    } catch (error) {
      logger.debug('Failed to extract Java field', { error });
      return null;
    }
  };

  /**
   * Extract Java import declaration
   */
  private extractJavaImport = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract import path: "import java.util.List;"
      // or "import static java.lang.Math.PI;"
      const importMatch = /import\s+(?:static\s+)?([^;]+);/.exec(text);
      const source = importMatch ? importMatch[1].trim() : '';

      // Check if it's a wildcard import: import java.util.*;
      const isWildcard = source.endsWith('*');

      return {
        symbols: isWildcard ? ['*'] : [],
        source: isWildcard ? source.slice(0, -2) : source, // Remove .* from wildcard
        is_default: false,
        is_namespace: isWildcard,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Java import', { error });
      return null;
    }
  };

  /**
   * Check if Java member has public access modifier
   */
  private isJavaPublicMember = (node: Parser.SyntaxNode, code: string): boolean => {
    // Check for 'public' modifier in the node's modifiers
    const modifiersNode = node.children.find((c) => c.type === 'modifiers');
    if (modifiersNode) {
      const modifiersText = code.slice(modifiersNode.startIndex, modifiersNode.endIndex);
      return modifiersText.includes('public');
    }

    // Fallback: check in the entire node text
    const text = code.slice(node.startIndex, node.endIndex);
    return /^\s*public\s+/.test(text);
  };

  /**
   * Extract nodes from Go syntax tree
   */
  private extractGoNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function declarations
    if (type === 'function_declaration' || type === 'method_declaration') {
      const func = this.extractFunction(node, code);
      if (func) {
        func.node_type = type === 'method_declaration' ? NodeType.Method : NodeType.Function;
        nodes.push(func);
      }
    }

    // Extract type declarations (structs, interfaces)
    if (type === 'type_declaration') {
      // Go type declarations can contain type_spec or type_spec_list
      const typeSpecs = node.children.filter((c) => c.type === 'type_spec' || c.type === 'type_spec_list');

      for (const spec of typeSpecs) {
        if (spec.type === 'type_spec_list') {
          // Multiple type specs
          const specs = spec.children.filter((c) => c.type === 'type_spec');
          for (const s of specs) {
            this.extractGoTypeSpec(s, code, nodes);
          }
        } else {
          // Single type spec
          this.extractGoTypeSpec(spec, code, nodes);
        }
      }
    }

    // Extract import declarations
    if (type === 'import_declaration') {
      const imps = this.extractGoImports(node, code);
      imports.push(...imps);
    }

    // Go exports: Check if identifier starts with uppercase letter
    if (type === 'function_declaration' || type === 'method_declaration') {
      if (this.isGoExported(node, code)) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = code.slice(nameNode.startIndex, nameNode.endIndex);
          exports.push({
            symbols: [name],
            is_default: false,
            is_reexport: false,
            line_number: node.startPosition.row + 1,
          });
        }
      }
    }

    // For type declarations, check each type spec
    if (type === 'type_declaration') {
      const typeSpecs = node.children.filter((c) => c.type === 'type_spec' || c.type === 'type_spec_list');

      for (const spec of typeSpecs) {
        if (spec.type === 'type_spec_list') {
          const specs = spec.children.filter((c) => c.type === 'type_spec');
          for (const s of specs) {
            this.addGoTypeExport(s, code, exports);
          }
        } else {
          this.addGoTypeExport(spec, code, exports);
        }
      }
    }
  };

  /**
   * Add Go type export if it's exported
   */
  private addGoTypeExport = (node: Parser.SyntaxNode, code: string, exports: ExportInfo[]): void => {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const name = code.slice(nameNode.startIndex, nameNode.endIndex);
      // Check if exported (starts with uppercase)
      if (name.length > 0 && /^[A-Z]/.test(name)) {
        exports.push({
          symbols: [name],
          is_default: false,
          is_reexport: false,
          line_number: node.startPosition.row + 1,
        });
      }
    }
  };

  /**
   * Extract Go type spec (struct or interface)
   */
  private extractGoTypeSpec = (node: Parser.SyntaxNode, code: string, nodes: ParsedNode[]): void => {
    try {
      const typeNode = node.childForFieldName('type');
      if (!typeNode) return;

      if (typeNode.type === 'struct_type') {
        const struct = this.extractClass(node, code);
        if (struct) {
          nodes.push(struct);
        }
      } else if (typeNode.type === 'interface_type') {
        const iface = this.extractInterface(node, code);
        if (iface) {
          nodes.push(iface);
        }
      }
    } catch (error) {
      logger.debug('Failed to extract Go type spec', { error });
    }
  };

  /**
   * Extract Go import declarations
   */
  private extractGoImports = (node: Parser.SyntaxNode, code: string): ImportInfo[] => {
    const imports: ImportInfo[] = [];

    try {
      // Go imports can be single or grouped
      const importSpecs = node.children.filter((c) => c.type === 'import_spec' || c.type === 'import_spec_list');

      for (const spec of importSpecs) {
        if (spec.type === 'import_spec_list') {
          // Grouped imports: import ( ... )
          const specs = spec.children.filter((c) => c.type === 'import_spec');
          for (const s of specs) {
            const imp = this.extractGoImportSpec(s, code);
            if (imp) imports.push(imp);
          }
        } else {
          // Single import
          const imp = this.extractGoImportSpec(spec, code);
          if (imp) imports.push(imp);
        }
      }
    } catch (error) {
      logger.debug('Failed to extract Go imports', { error });
    }

    return imports;
  };

  /**
   * Extract single Go import spec
   */
  private extractGoImportSpec = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract package path from quoted string
      const pathMatch = /"([^"]+)"/.exec(text);
      const source = pathMatch ? pathMatch[1] : '';

      // Check for alias: alias "package/path"
      const hasAlias = /^\w+\s+"/.test(text.trim());

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: !hasAlias,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Go import spec', { error });
      return null;
    }
  };

  /**
   * Check if Go identifier is exported (starts with uppercase letter)
   */
  private isGoExported = (node: Parser.SyntaxNode, code: string): boolean => {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return false;

    const name = code.slice(nameNode.startIndex, nameNode.endIndex);
    // Go exports: identifier starts with uppercase letter
    return name.length > 0 && /^[A-Z]/.test(name);
  };

  /**
   * Extract nodes from Rust syntax tree
   */
  private extractRustNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function declarations
    if (type === 'function_item') {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract struct declarations
    if (type === 'struct_item') {
      const struct = this.extractClass(node, code);
      if (struct) {
        nodes.push(struct);
      }
    }

    // Extract enum declarations
    if (type === 'enum_item') {
      const enumNode = this.extractEnum(node, code);
      if (enumNode) {
        nodes.push(enumNode);
      }
    }

    // Extract trait declarations
    if (type === 'trait_item') {
      const trait = this.extractInterface(node, code);
      if (trait) {
        nodes.push(trait);
      }
    }

    // Extract impl blocks (trait implementations and inherent impls)
    if (type === 'impl_item') {
      const impl = this.extractRustImpl(node, code);
      if (impl) {
        nodes.push(impl);
      }
    }

    // Extract use declarations (imports)
    if (type === 'use_declaration') {
      const imp = this.extractRustUse(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // Rust exports: Check for pub visibility
    if (
      (type === 'function_item' || type === 'struct_item' || type === 'enum_item' || type === 'trait_item') &&
      this.isRustPublic(node, code)
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = code.slice(nameNode.startIndex, nameNode.endIndex);
        exports.push({
          symbols: [name],
          is_default: false,
          is_reexport: false,
          line_number: node.startPosition.row + 1,
        });
      }
    }
  };

  /**
   * Extract Rust impl block
   */
  private extractRustImpl = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      // Get the type being implemented
      const typeNode = node.childForFieldName('type');
      const name = typeNode ? code.slice(typeNode.startIndex, typeNode.endIndex) : '<impl>';

      // Check if it's a trait implementation
      const traitNode = node.childForFieldName('trait');
      const traitName = traitNode ? code.slice(traitNode.startIndex, traitNode.endIndex) : undefined;

      const fullName = traitName ? `impl ${traitName} for ${name}` : `impl ${name}`;

      // Extract methods from impl block
      const children: ParsedNode[] = [];
      const bodyNode = node.childForFieldName('body');

      if (bodyNode) {
        for (const child of bodyNode.children) {
          if (child.type === 'function_item') {
            const method = this.extractFunction(child, code);
            if (method) {
              method.node_type = NodeType.Method;
              children.push(method);
            }
          }
        }
      }

      return {
        node_type: NodeType.Class,
        name: fullName,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        children,
      };
    } catch (error) {
      logger.debug('Failed to extract Rust impl block', { error });
      return null;
    }
  };

  /**
   * Extract Rust use declaration (import)
   */
  private extractRustUse = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract module path: use std::io;
      // Can be: use std::io::*, use std::io::Read, use std::{io, fs}
      const useMatch = /use\s+([^;]+);/.exec(text);
      const path = useMatch ? useMatch[1].trim() : '';

      // Check for wildcard import: use std::io::*
      const isWildcard = path.endsWith('*');

      // Check for grouped imports: use std::{io, fs}
      const isGrouped = path.includes('{');

      // Extract symbols for named imports
      const symbols: string[] = [];
      if (isWildcard) {
        symbols.push('*');
      } else if (isGrouped) {
        const groupMatch = /{([^}]+)}/.exec(path);
        if (groupMatch) {
          symbols.push(...groupMatch[1].split(',').map((s) => s.trim()));
        }
      }

      // Get the source module (remove * or grouped imports)
      let source = path;
      if (isWildcard) {
        source = path.slice(0, -3); // Remove ::*
      } else if (isGrouped) {
        source = path.split('{')[0].replace(/::$/, '');
      }

      return {
        symbols,
        source,
        is_default: false,
        is_namespace: isWildcard,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Rust use declaration', { error });
      return null;
    }
  };

  /**
   * Check if Rust item is public
   */
  private isRustPublic = (node: Parser.SyntaxNode, code: string): boolean => {
    // Check for visibility modifier
    const visibilityNode = node.children.find((c) => c.type === 'visibility_modifier');
    if (visibilityNode) {
      const visText = code.slice(visibilityNode.startIndex, visibilityNode.endIndex);
      return visText.includes('pub');
    }

    // Fallback: check in the entire node text
    const text = code.slice(node.startIndex, node.endIndex);
    return /^\s*pub\s+/.test(text);
  };

  /**
   * Extract nodes from C/C++ syntax tree
   */
  private extractCNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    _exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function definitions
    if (type === 'function_definition') {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract struct declarations (both C and C++)
    if (type === 'struct_specifier') {
      const struct = this.extractClass(node, code);
      if (struct) {
        nodes.push(struct);
      }
    }

    // Extract class declarations (C++ only)
    if (type === 'class_specifier') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract enum declarations
    if (type === 'enum_specifier') {
      const enumNode = this.extractEnum(node, code);
      if (enumNode) {
        nodes.push(enumNode);
      }
    }

    // Extract namespace declarations (C++ only)
    if (type === 'namespace_definition') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<namespace>';

      nodes.push({
        node_type: NodeType.Interface,
        name: `namespace ${name}`,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
      });
    }

    // Extract #include directives
    if (type === 'preproc_include') {
      const imp = this.extractCInclude(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // Extract using declarations (C++)
    if (type === 'using_declaration') {
      const imp = this.extractCPPUsing(node, code);
      if (imp) {
        imports.push(imp);
      }
    }
  };

  /**
   * Extract C/C++ #include directive
   */
  private extractCInclude = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract header file: #include <stdio.h> or #include "myheader.h"
      const includeMatch = /#include\s+[<"]([^>"]+)[>"]/.exec(text);
      const source = includeMatch ? includeMatch[1] : '';

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: true,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract C include', { error });
      return null;
    }
  };

  /**
   * Extract C++ using declaration
   */
  private extractCPPUsing = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract namespace: using namespace std;
      // or specific symbol: using std::cout;
      const usingMatch = /using\s+(?:namespace\s+)?([^;]+);/.exec(text);
      const source = usingMatch ? usingMatch[1].trim() : '';

      const isNamespace = text.includes('namespace');

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: isNamespace,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract C++ using declaration', { error });
      return null;
    }
  };

  /**
   * Extract nodes from Ruby syntax tree
   */
  private extractRubyNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    _exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract method definitions
    if (type === 'method' || type === 'singleton_method') {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract class definitions
    if (type === 'class') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract module definitions
    if (type === 'module') {
      const mod = this.extractInterface(node, code);
      if (mod) {
        nodes.push(mod);
      }
    }

    // Extract require/require_relative statements (imports)
    if (type === 'call' && node.children.length > 0) {
      const methodName = node.children[0];
      const methodText = code.slice(methodName.startIndex, methodName.endIndex);
      if (methodText === 'require' || methodText === 'require_relative') {
        const imp = this.extractRubyRequire(node, code);
        if (imp) {
          imports.push(imp);
        }
      }
    }
  };

  /**
   * Extract Ruby require statement (import)
   */
  private extractRubyRequire = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract required file: require 'json' or require_relative './utils'
      const requireMatch = /require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(text);
      const source = requireMatch ? requireMatch[1] : '';

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: true,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Ruby require', { error });
      return null;
    }
  };

  /**
   * Extract nodes from PHP syntax tree
   */
  private extractPHPNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    _exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function declarations
    if (type === 'function_definition') {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract method declarations
    if (type === 'method_declaration') {
      const method = this.extractFunction(node, code);
      if (method) {
        method.node_type = NodeType.Method;
        nodes.push(method);
      }
    }

    // Extract class declarations
    if (type === 'class_declaration') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract interface declarations
    if (type === 'interface_declaration') {
      const iface = this.extractInterface(node, code);
      if (iface) {
        nodes.push(iface);
      }
    }

    // Extract trait declarations
    if (type === 'trait_declaration') {
      const trait = this.extractInterface(node, code);
      if (trait) {
        nodes.push(trait);
      }
    }

    // Extract namespace use declarations (imports)
    if (type === 'namespace_use_declaration') {
      const imp = this.extractPHPUse(node, code);
      if (imp) {
        imports.push(imp);
      }
    }
  };

  /**
   * Extract PHP use statement (import)
   */
  private extractPHPUse = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract namespace: use App\Models\User;
      const useMatch = /use\s+([^;]+);/.exec(text);
      const source = useMatch ? useMatch[1].trim() : '';

      // Check for alias: use App\Models\User as UserModel;
      const isAlias = text.includes(' as ');

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: !isAlias,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract PHP use statement', { error });
      return null;
    }
  };

  /**
   * Extract nodes from C# syntax tree
   */
  private extractCSharpNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract method declarations
    if (type === 'method_declaration' || type === 'constructor_declaration') {
      const func = this.extractFunction(node, code);
      if (func) {
        func.node_type = type === 'constructor_declaration' ? NodeType.Method : NodeType.Function;
        nodes.push(func);
      }
    }

    // Extract property declarations
    if (type === 'property_declaration') {
      const prop = this.extractProperty(node, code);
      if (prop) {
        nodes.push(prop);
      }
    }

    // Extract class declarations
    if (type === 'class_declaration' || type === 'struct_declaration' || type === 'record_declaration') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract interface declarations
    if (type === 'interface_declaration') {
      const iface = this.extractInterface(node, code);
      if (iface) {
        nodes.push(iface);
      }
    }

    // Extract enum declarations
    if (type === 'enum_declaration') {
      const enumNode = this.extractEnum(node, code);
      if (enumNode) {
        nodes.push(enumNode);
      }
    }

    // Extract using directives (imports)
    if (type === 'using_directive') {
      const imp = this.extractCSharpUsing(node, code);
      if (imp) {
        imports.push(imp);
      }
    }

    // C# doesn't have traditional exports - classes are accessible via namespaces
    // We track public classes/methods as implicit exports
    if (
      (type === 'class_declaration' ||
        type === 'interface_declaration' ||
        type === 'struct_declaration' ||
        type === 'enum_declaration') &&
      this.isPublicMember(node, code)
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = code.slice(nameNode.startIndex, nameNode.endIndex);
        exports.push({
          symbols: [name],
          is_default: false,
          is_reexport: false,
          line_number: node.startPosition.row + 1,
        });
      }
    }
  };

  /**
   * Extract property from C# syntax node
   */
  private extractProperty = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      const typeNode = node.childForFieldName('type');
      const returnType = typeNode ? code.slice(typeNode.startIndex, typeNode.endIndex) : undefined;

      const docstring = this.extractDocstring(node, code);

      return {
        node_type: NodeType.Variable,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        return_type: returnType,
        docstring,
      };
    } catch (error) {
      logger.debug('Failed to extract C# property', { error });
      return null;
    }
  };

  /**
   * Extract enum from C# syntax node
   */
  private extractEnum = (node: Parser.SyntaxNode, code: string): ParsedNode | null => {
    try {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : '<anonymous>';

      const docstring = this.extractDocstring(node, code);

      return {
        node_type: NodeType.Interface,
        name,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        code_text: code.slice(node.startIndex, node.endIndex),
        docstring,
      };
    } catch (error) {
      logger.debug('Failed to extract C# enum', { error });
      return null;
    }
  };

  /**
   * Extract C# using directive (import)
   */
  private extractCSharpUsing = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract namespace: "using System.Collections.Generic;"
      const namespaceMatch = /using\s+([^;]+);/.exec(text);
      const source = namespaceMatch ? namespaceMatch[1].trim() : '';

      // Check for alias: "using Json = System.Text.Json;"
      const isAlias = text.includes('=');

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: !isAlias,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract C# using directive', { error });
      return null;
    }
  };

  /**
   * Check if C# member has public access modifier
   */
  private isPublicMember = (node: Parser.SyntaxNode, code: string): boolean => {
    // Check for 'public' modifier in the node's text
    const text = code.slice(node.startIndex, node.endIndex);
    return /^\s*public\s+/.test(text);
  };

  /**
   * Extract nodes from Kotlin syntax tree
   */
  private extractKotlinNodes = (
    node: Parser.SyntaxNode,
    code: string,
    nodes: ParsedNode[],
    imports: ImportInfo[],
    _exports: ExportInfo[]
  ): void => {
    const type = node.type;

    // Extract function declarations
    if (type === 'function_declaration') {
      const func = this.extractFunction(node, code);
      if (func) {
        nodes.push(func);
      }
    }

    // Extract class declarations
    if (type === 'class_declaration') {
      const cls = this.extractClass(node, code);
      if (cls) {
        nodes.push(cls);
      }
    }

    // Extract interface declarations
    if (type === 'interface_declaration') {
      const iface = this.extractInterface(node, code);
      if (iface) {
        nodes.push(iface);
      }
    }

    // Extract object declarations (Kotlin singleton)
    if (type === 'object_declaration') {
      const obj = this.extractClass(node, code);
      if (obj) {
        nodes.push(obj);
      }
    }

    // Extract import directives
    if (type === 'import_header') {
      const imp = this.extractKotlinImport(node, code);
      if (imp) {
        imports.push(imp);
      }
    }
  };

  /**
   * Extract Kotlin import directive
   */
  private extractKotlinImport = (node: Parser.SyntaxNode, code: string): ImportInfo | null => {
    try {
      const text = code.slice(node.startIndex, node.endIndex);

      // Extract import path: import com.example.app.MainActivity
      const importMatch = /import\s+([^\s]+)/.exec(text);
      const source = importMatch ? importMatch[1].trim() : '';

      // Check for alias: import com.example.app.MainActivity as Main
      const isAlias = text.includes(' as ');

      return {
        symbols: [],
        source,
        is_default: false,
        is_namespace: !isAlias,
        line_number: node.startPosition.row + 1,
      };
    } catch (error) {
      logger.debug('Failed to extract Kotlin import', { error });
      return null;
    }
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
