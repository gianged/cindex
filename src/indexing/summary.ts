/**
 * File summary generation using LLM (Ollama) with rule-based fallback
 *
 * Generates concise file summaries either through an LLM or by extracting
 * metadata using rule-based heuristics. Supports batch processing with
 * concurrency control.
 */

import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type SummaryConfig } from '@/types/config';
import { type DiscoveredFile, type FileSummary } from '@/types/indexing';

/**
 * File summary generator with LLM and rule-based fallback
 */
export class FileSummaryGenerator {
  constructor(
    private readonly ollamaClient: OllamaClient,
    private readonly config: SummaryConfig
  ) {}

  /**
   * Generate summary for a single file
   *
   * Attempts LLM generation first if enabled, falls back to rule-based if LLM fails
   * or if method is set to 'rule-based'.
   *
   * @param file - Discovered file metadata
   * @param fileContent - File content (first N lines for LLM)
   * @returns File summary with generation method
   */
  public generateSummary = async (file: DiscoveredFile, fileContent: string): Promise<FileSummary> => {
    logger.debug('Generating file summary', {
      file: file.relative_path,
      method: this.config.method,
    });

    // Try LLM first if enabled
    if (this.config.method === 'llm' && this.config.model) {
      try {
        return await this.generateLLMSummary(file, fileContent);
      } catch (error) {
        logger.warn('LLM summary generation failed, using fallback', {
          file: file.relative_path,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to rule-based
      }
    }

    // Use rule-based fallback
    return this.generateRuleBasedSummary(file, fileContent);
  };

  /**
   * Batch generate summaries for multiple files
   *
   * Processes files in batches with concurrency control to avoid overwhelming
   * the LLM service.
   *
   * @param files - Array of file metadata and content pairs
   * @param concurrency - Maximum concurrent LLM requests (default: 3)
   * @returns Array of file summaries
   */
  public generateBatch = async (
    files: { file: DiscoveredFile; content: string }[],
    concurrency = 3
  ): Promise<FileSummary[]> => {
    logger.info('Generating batch file summaries', {
      total: files.length,
      concurrency,
      method: this.config.method,
    });

    const results: FileSummary[] = new Array<FileSummary>(files.length);
    const errors: number[] = [];

    // Process in batches with limited concurrency
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, Math.min(i + concurrency, files.length));

      const promises = batch.map(async ({ file, content }, batchIndex) => {
        const index = i + batchIndex;
        try {
          results[index] = await this.generateSummary(file, content);
        } catch (error) {
          logger.error('File summary generation failed', {
            file: file.relative_path,
            error: error instanceof Error ? error.message : String(error),
          });
          errors.push(index);
        }
      });

      await Promise.all(promises);

      // Log progress
      logger.debug('Summary batch progress', {
        completed: Math.min(i + concurrency, files.length),
        total: files.length,
      });
    }

    // Report errors
    if (errors.length > 0) {
      logger.warn(`Failed to generate ${String(errors.length)} file summaries`, {
        failedIndices: errors,
      });
    }

    return results;
  };

  /**
   * Generate summary using LLM
   *
   * Constructs a prompt asking for a concise summary starting with "This file..."
   * and validates the response format.
   *
   * @param file - File metadata
   * @param content - File content (truncated to max_lines)
   * @returns LLM-generated file summary
   */
  private generateLLMSummary = async (file: DiscoveredFile, content: string): Promise<FileSummary> => {
    const startTime = Date.now();

    // Truncate content to configured max lines
    const lines = content.split('\n').slice(0, this.config.max_lines);
    const truncatedContent = lines.join('\n');

    // Construct prompt
    const prompt = this.buildLLMPrompt(file, truncatedContent);

    // Generate summary via Ollama
    const summaryText = await this.ollamaClient.generateSummary(this.config.model, prompt, this.config.context_window);

    // Validate and clean summary
    const cleanedSummary = this.validateAndCleanSummary(summaryText);

    const generationTime = Date.now() - startTime;

    logger.debug('LLM summary generated', {
      file: file.relative_path,
      length: cleanedSummary.length,
      time_ms: generationTime,
    });

    return {
      file_path: file.relative_path,
      summary_text: cleanedSummary,
      summary_method: 'llm',
      model_used: this.config.model,
      generation_time_ms: generationTime,
    };
  };

  /**
   * Generate summary using rule-based extraction
   *
   * Extracts JSDoc/docstrings and exported symbols to build a descriptive summary
   * without relying on an LLM.
   *
   * @param file - File metadata
   * @param content - File content
   * @returns Rule-based file summary
   */
  private generateRuleBasedSummary = (file: DiscoveredFile, content: string): FileSummary => {
    const startTime = Date.now();

    let summaryText: string;

    // Extract docstring/JSDoc from beginning of file
    const docstring = this.extractDocstring(content, file.language);

    if (docstring) {
      // Use docstring as summary
      summaryText = `This file ${docstring}`;
    } else {
      // Fall back to code structure analysis
      summaryText = this.buildStructureSummary(content, file.language);
    }

    // Ensure proper format and length
    summaryText = this.validateAndCleanSummary(summaryText);

    const generationTime = Date.now() - startTime;

    logger.debug('Rule-based summary generated', {
      file: file.relative_path,
      length: summaryText.length,
      time_ms: generationTime,
    });

    return {
      file_path: file.relative_path,
      summary_text: summaryText,
      summary_method: 'rule-based',
      generation_time_ms: generationTime,
    };
  };

  /**
   * Build LLM prompt for file summarization
   *
   * @param file - File metadata
   * @param content - Truncated file content
   * @returns Formatted prompt for LLM
   */
  private buildLLMPrompt = (file: DiscoveredFile, content: string): string => {
    return `Summarize this ${file.language} file in 1-2 sentences starting with "This file".
Keep the summary concise (50-200 characters) and focus on the primary purpose.

File: ${file.relative_path}

Code:
${content}

Summary (start with "This file"):`;
  };

  /**
   * Extract docstring or JSDoc comment from beginning of file
   *
   * @param content - File content
   * @param language - Programming language
   * @returns Extracted docstring or null
   */
  private extractDocstring = (content: string, language: string): string | null => {
    // Extract first block comment or docstring
    let docPattern: RegExp;

    if (language === 'python') {
      // Python docstring: """...""" or '''...'''
      docPattern = /^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/;
    } else {
      // JSDoc or block comment: /** ... */ or /* ... */
      docPattern = /^\s*\/\*\*?([\s\S]*?)\*\//;
    }

    const match = content.match(docPattern);
    if (!match) return null;

    // Extract and clean comment content
    const commentText = match[1] || match[2] || '';
    const cleaned = commentText
      .split('\n')
      .map((line) => line.trim().replace(/^\*\s?/, '')) // Remove leading * from JSDoc
      .filter((line) => line.length > 0)
      .join(' ')
      .trim();

    return cleaned.length > 0 && cleaned.length <= 200 ? cleaned : null;
  };

  /**
   * Build summary from code structure analysis
   *
   * Counts functions, classes, and constructs a descriptive summary.
   *
   * @param content - File content
   * @param language - Programming language
   * @returns Structure-based summary
   */
  private buildStructureSummary = (content: string, language: string): string => {
    // Count functions and classes
    const functionCount = this.countPattern(content, this.getFunctionPattern(language));
    const classCount = this.countPattern(content, this.getClassPattern(language));

    // Build descriptive summary
    const parts: string[] = [];

    if (functionCount > 0) {
      parts.push(`${String(functionCount)} ${functionCount === 1 ? 'function' : 'functions'}`);
    }

    if (classCount > 0) {
      parts.push(`${String(classCount)} ${classCount === 1 ? 'class' : 'classes'}`);
    }

    if (parts.length === 0) {
      return `This file contains ${language} code.`;
    }

    return `This file contains ${parts.join(' and ')}.`;
  };

  /**
   * Count pattern matches in content
   *
   * @param content - File content
   * @param pattern - Regular expression pattern
   * @returns Number of matches
   */
  private countPattern = (content: string, pattern: RegExp): number => {
    const matches = content.match(pattern);
    return matches ? matches.length : 0;
  };

  /**
   * Get function detection pattern for language
   *
   * @param language - Programming language
   * @returns Regular expression for function detection
   */
  private getFunctionPattern = (language: string): RegExp => {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return /(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\(|export\s+(?:async\s+)?function\s+\w+)/g;
      case 'python':
        return /def\s+\w+\s*\(/g;
      case 'java':
      case 'csharp':
        return /(?:public|private|protected|static)\s+[\w<>[\],\s]+\s+\w+\s*\(/g;
      case 'go':
        return /func\s+(?:\([^)]*\)\s+)?\w+\s*\(/g;
      case 'rust':
        return /fn\s+\w+\s*[<(]/g;
      default:
        return /function\s+\w+/g;
    }
  };

  /**
   * Get class detection pattern for language
   *
   * @param language - Programming language
   * @returns Regular expression for class detection
   */
  private getClassPattern = (language: string): RegExp => {
    switch (language) {
      case 'typescript':
      case 'javascript':
      case 'java':
      case 'csharp':
      case 'php':
        return /class\s+\w+/g;
      case 'python':
        return /class\s+\w+\s*[:(]/g;
      case 'rust':
        return /(?:struct|enum|trait)\s+\w+/g;
      default:
        return /class\s+\w+/g;
    }
  };

  /**
   * Validate and clean summary text
   *
   * Ensures summary starts with "This file", is within length bounds (50-200 chars),
   * and has proper formatting.
   *
   * @param text - Raw summary text
   * @returns Cleaned and validated summary
   */
  private validateAndCleanSummary = (text: string): string => {
    // Clean whitespace
    let cleaned = text.trim().replace(/\s+/g, ' ');

    // Ensure starts with "This file"
    if (!cleaned.startsWith('This file')) {
      // Try to salvage if it starts with lowercase variant
      if (cleaned.toLowerCase().startsWith('this file')) {
        cleaned = 'T' + cleaned.slice(1);
      } else {
        // Prepend "This file"
        cleaned = `This file ${cleaned}`;
      }
    }

    // Ensure ends with period
    if (!cleaned.endsWith('.')) {
      cleaned += '.';
    }

    // Truncate if too long
    if (cleaned.length > 200) {
      cleaned = cleaned.slice(0, 197) + '...';
    }

    // Ensure minimum length
    if (cleaned.length < 50) {
      // Pad with generic ending if too short
      while (cleaned.length < 50) {
        cleaned = cleaned.slice(0, -1) + ' for code organization.';
      }
    }

    return cleaned;
  };
}

/**
 * Create file summary generator instance
 *
 * @param ollamaClient - Ollama client for LLM operations
 * @param config - Summary generation configuration
 * @returns Initialized FileSummaryGenerator
 */
export const createFileSummaryGenerator = (ollamaClient: OllamaClient, config: SummaryConfig): FileSummaryGenerator => {
  return new FileSummaryGenerator(ollamaClient, config);
};
