/**
 * Symbol extraction and embedding generation
 *
 * Extracts symbols (functions, classes, variables, types) from parsed code
 * and generates embeddings for each symbol definition. Detects symbol scope
 * (exported vs internal) for improved search relevance.
 */

import { randomUUID } from 'node:crypto';

import { type EmbeddingGenerator } from '@indexing/embeddings';
import { logger } from '@utils/logger';
import {
  NodeType,
  type DiscoveredFile,
  type ExtractedSymbol,
  type ParsedNode,
  type ParseResult,
} from '@/types/indexing';

/**
 * Symbol extractor with embedding generation
 */
export class SymbolExtractor {
  constructor(private readonly embeddingGenerator: EmbeddingGenerator) {}

  /**
   * Extract all symbols from parsed code result
   *
   * Processes all parsed nodes to extract function, class, variable, and type symbols.
   * Generates embeddings for each symbol definition and detects scope.
   *
   * @param parseResult - Tree-sitter parse result
   * @param file - File metadata with repository context
   * @returns Array of extracted symbols with embeddings
   */
  public extractSymbols = async (parseResult: ParseResult, file: DiscoveredFile): Promise<ExtractedSymbol[]> => {
    logger.debug('Extracting symbols', {
      file: file.relative_path,
      node_count: parseResult.nodes.length,
    });

    const symbols: ExtractedSymbol[] = [];

    // Get list of exported symbol names for scope detection
    const exportedSymbols: string[] = parseResult.exports.flatMap((exp) => exp.symbols);

    // Process each parsed node
    for (const node of parseResult.nodes) {
      try {
        const symbol = await this.extractSymbolFromNode(node, file, exportedSymbols);
        if (symbol) {
          symbols.push(symbol);
        }
      } catch (error) {
        logger.warn('Symbol extraction failed for node', {
          file: file.relative_path,
          node: node.name,
          type: node.node_type,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next symbol
      }
    }

    logger.debug('Symbols extracted', {
      file: file.relative_path,
      count: symbols.length,
    });

    return symbols;
  };

  /**
   * Extract symbol from a single parsed node
   *
   * @param node - Parsed syntax node
   * @param file - File metadata
   * @param exportedSymbols - List of exported symbol names
   * @returns Extracted symbol or null if not applicable
   */
  private extractSymbolFromNode = async (
    node: ParsedNode,
    file: DiscoveredFile,
    exportedSymbols: string[]
  ): Promise<ExtractedSymbol | null> => {
    // Only extract certain node types as symbols
    const symbolTypes: NodeType[] = [
      NodeType.Function,
      NodeType.Class,
      NodeType.Variable,
      NodeType.Type,
      NodeType.Interface,
    ];

    if (!symbolTypes.includes(node.node_type)) {
      return null;
    }

    // Build symbol definition text
    const definition = this.buildDefinitionText(node);

    // Detect symbol scope
    const scope = this.detectScope(node.name, exportedSymbols);

    // Generate embedding for symbol definition
    const embedding = await this.embeddingGenerator.generateTextEmbedding(
      definition,
      `symbol ${node.name} in ${file.relative_path}`
    );

    // Map node type to symbol type
    const symbolType = this.mapNodeTypeToSymbolType(node.node_type);

    // Create extracted symbol
    const symbol: ExtractedSymbol = {
      symbol_id: randomUUID(),
      symbol_name: node.name,
      symbol_type: symbolType,
      file_path: file.relative_path,
      line_number: node.start_line,
      definition,
      embedding,
      scope,
      // Include repository context if available
      repo_id: file.repo_id,
      workspace_id: file.workspace_id,
      package_name: file.package_name,
      service_id: file.service_id,
    };

    return symbol;
  };

  /**
   * Build symbol definition text for embedding
   *
   * Constructs a concise representation of the symbol that captures its signature
   * and purpose for effective semantic search.
   *
   * @param node - Parsed node
   * @returns Symbol definition text
   */
  private buildDefinitionText = (node: ParsedNode): string => {
    switch (node.node_type) {
      case NodeType.Function:
        return this.buildFunctionDefinition(node);

      case NodeType.Class:
        return this.buildClassDefinition(node);

      case NodeType.Variable:
        return this.buildVariableDefinition(node);

      case NodeType.Type:
      case NodeType.Interface:
        return this.buildTypeDefinition(node);

      default:
        // Fallback: use code text
        return node.code_text.slice(0, 500);
    }
  };

  /**
   * Build function definition text
   *
   * Format: "function name(params): returnType - docstring"
   *
   * @param node - Function node
   * @returns Function definition
   */
  private buildFunctionDefinition = (node: ParsedNode): string => {
    const parts: string[] = [];

    // Function signature
    const params = node.parameters?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ') ?? '';
    const returnType = node.return_type ?? 'void';

    parts.push(`function ${node.name}(${params}): ${returnType}`);

    // Include docstring if available
    if (node.docstring) {
      const cleanDocstring = node.docstring.slice(0, 200);
      parts.push(`- ${cleanDocstring}`);
    }

    return parts.join(' ');
  };

  /**
   * Build class definition text
   *
   * Format: "class Name { methods: method1, method2, ... } - docstring"
   *
   * @param node - Class node
   * @returns Class definition
   */
  private buildClassDefinition = (node: ParsedNode): string => {
    const parts: string[] = [];

    // Class name
    parts.push(`class ${node.name}`);

    // Include methods if available
    if (node.children && node.children.length > 0) {
      const methods = node.children.filter((child) => child.node_type === NodeType.Function).map((m) => m.name);

      if (methods.length > 0) {
        parts.push(`{ methods: ${methods.join(', ')} }`);
      }
    }

    // Include docstring if available
    if (node.docstring) {
      const cleanDocstring = node.docstring.slice(0, 200);
      parts.push(`- ${cleanDocstring}`);
    }

    return parts.join(' ');
  };

  /**
   * Build variable definition text
   *
   * Format: "const NAME: type = value"
   *
   * @param node - Variable node
   * @returns Variable definition
   */
  private buildVariableDefinition = (node: ParsedNode): string => {
    const type = node.return_type ?? 'unknown';

    // Extract first line of code text as definition
    const firstLine = node.code_text.split('\n')[0]?.trim() || '';

    if (firstLine.length > 0 && firstLine.length < 200) {
      return firstLine;
    }

    return `const ${node.name}: ${type}`;
  };

  /**
   * Build type/interface definition text
   *
   * Format: "type Name = { ... }" or "interface Name { ... }"
   *
   * @param node - Type or interface node
   * @returns Type definition
   */
  private buildTypeDefinition = (node: ParsedNode): string => {
    // Use code text directly for types (usually concise)
    const codeText = node.code_text.trim();

    // Truncate if too long
    if (codeText.length > 500) {
      return codeText.slice(0, 497) + '...';
    }

    return codeText;
  };

  /**
   * Detect if symbol is exported or internal
   *
   * @param symbolName - Symbol name to check
   * @param exportedSymbols - List of exported symbol names
   * @returns Symbol scope
   */
  private detectScope = (symbolName: string, exportedSymbols: string[]): 'exported' | 'internal' => {
    return exportedSymbols.includes(symbolName) ? 'exported' : 'internal';
  };

  /**
   * Map node type to symbol type
   *
   * @param nodeType - Parsed node type
   * @returns Symbol type
   */
  private mapNodeTypeToSymbolType = (nodeType: NodeType): ExtractedSymbol['symbol_type'] => {
    switch (nodeType) {
      case NodeType.Function:
        return 'function';
      case NodeType.Class:
        return 'class';
      case NodeType.Variable:
        // Check if it's a constant (all caps or const declaration)
        return 'variable';
      case NodeType.Type:
        return 'type';
      case NodeType.Interface:
        return 'interface';
      default:
        return 'variable';
    }
  };
}

/**
 * Create symbol extractor instance
 *
 * @param embeddingGenerator - Embedding generator for symbol embeddings
 * @returns Initialized SymbolExtractor
 */
export const createSymbolExtractor = (embeddingGenerator: EmbeddingGenerator): SymbolExtractor => {
  return new SymbolExtractor(embeddingGenerator);
};
