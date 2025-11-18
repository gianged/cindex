/**
 * Markdown Indexer for documentation files
 * Parses markdown files and extracts code blocks for semantic search
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { logger } from '@utils/logger';
import type { ChunkType } from '@/types/indexing';

/**
 * Markdown code block
 */
export interface MarkdownCodeBlock {
  language: string; // Language tag from fence (e.g., 'typescript', 'python')
  code: string; // Code content
  startLine: number; // Starting line in markdown file
  endLine: number; // Ending line in markdown file
  context?: string; // Surrounding text/heading for context
}

/**
 * Markdown section (heading + content)
 */
export interface MarkdownSection {
  heading: string; // Section heading text
  level: number; // Heading level (1-6)
  content: string; // Section content
  startLine: number;
  endLine: number;
  codeBlocks: MarkdownCodeBlock[];
}

/**
 * Parsed markdown file
 */
export interface MarkdownDocument {
  filePath: string;
  title?: string; // H1 heading or filename
  sections: MarkdownSection[];
  allCodeBlocks: MarkdownCodeBlock[];
  metadata?: Record<string, string>; // Front matter if present
}

/**
 * Parse result for markdown files
 * Different from code ParseResult as markdown has a different structure
 */
export interface MarkdownParseResult {
  language: string;
  chunks: {
    type: ChunkType;
    name: string;
    content: string;
    startLine: number;
    endLine: number;
    language: string;
    metadata?: Record<string, unknown>;
  }[];
  imports: string[];
  exports: string[];
}

/**
 * Parse front matter from markdown file (YAML-style)
 *
 * @param content - Markdown content
 * @returns Front matter object and content without front matter
 */
const parseFrontMatter = (content: string): { metadata: Record<string, string> | undefined; content: string } => {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = frontMatterRegex.exec(content);

  if (!match) {
    return { metadata: undefined, content };
  }

  const frontMatter = match[1];
  const contentWithoutFrontMatter = content.slice(match[0].length);

  // Parse simple key: value pairs
  const metadata: Record<string, string> = {};
  const lines = frontMatter.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line
        .slice(colonIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      metadata[key] = value;
    }
  }

  return { metadata, content: contentWithoutFrontMatter };
};

/**
 * Extract code blocks from markdown content
 *
 * @param content - Markdown content
 * @returns Array of code blocks
 */
const extractCodeBlocks = (content: string): MarkdownCodeBlock[] => {
  const blocks: MarkdownCodeBlock[] = [];
  const lines = content.split('\n');

  let inCodeBlock = false;
  let currentBlock: {
    language: string;
    code: string[];
    startLine: number;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for code fence start
    const fenceMatch = /^```(\w+)?/.exec(line);

    if (fenceMatch && !inCodeBlock) {
      // Start of code block
      inCodeBlock = true;
      currentBlock = {
        language: fenceMatch[1] || 'text',
        code: [],
        startLine: i + 1,
      };
    } else if (line.trim() === '```' && inCodeBlock && currentBlock) {
      // End of code block
      inCodeBlock = false;

      blocks.push({
        language: currentBlock.language,
        code: currentBlock.code.join('\n'),
        startLine: currentBlock.startLine,
        endLine: i + 1,
      });

      currentBlock = null;
    } else if (inCodeBlock && currentBlock) {
      // Inside code block
      currentBlock.code.push(line);
    }
  }

  return blocks;
};

/**
 * Extract sections from markdown content
 *
 * @param content - Markdown content
 * @returns Array of sections
 */
const extractSections = (content: string): MarkdownSection[] => {
  const sections: MarkdownSection[] = [];
  const lines = content.split('\n');

  let currentSection: {
    heading: string;
    level: number;
    content: string[];
    startLine: number;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for heading
    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);

    if (headingMatch) {
      // Save previous section if exists
      if (currentSection) {
        const sectionContent = currentSection.content.join('\n');
        sections.push({
          heading: currentSection.heading,
          level: currentSection.level,
          content: sectionContent,
          startLine: currentSection.startLine,
          endLine: i,
          codeBlocks: extractCodeBlocks(sectionContent),
        });
      }

      // Start new section
      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: [],
        startLine: i + 1,
      };
    } else if (currentSection) {
      // Add to current section
      currentSection.content.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    const sectionContent = currentSection.content.join('\n');
    sections.push({
      heading: currentSection.heading,
      level: currentSection.level,
      content: sectionContent,
      startLine: currentSection.startLine,
      endLine: lines.length,
      codeBlocks: extractCodeBlocks(sectionContent),
    });
  }

  return sections;
};

/**
 * Parse markdown file
 *
 * @param filePath - Absolute path to markdown file
 * @returns Parsed markdown document
 */
export const parseMarkdownFile = async (filePath: string): Promise<MarkdownDocument> => {
  const content = await fs.readFile(filePath, 'utf-8');

  // Parse front matter
  const { metadata, content: contentWithoutFrontMatter } = parseFrontMatter(content);

  // Extract sections
  const sections = extractSections(contentWithoutFrontMatter);

  // Get title from first H1 or filename
  const firstH1 = sections.find((s) => s.level === 1);
  const title = firstH1?.heading ?? path.basename(filePath, '.md');

  // Collect all code blocks
  const allCodeBlocks = sections.flatMap((s) => s.codeBlocks);

  return {
    filePath,
    title,
    sections,
    allCodeBlocks,
    metadata,
  };
};

/**
 * Convert markdown document to parse result format
 * This allows markdown to be indexed like code files
 *
 * @param doc - Parsed markdown document
 * @returns Parse result compatible with chunker
 */
export const convertToParseResult = (doc: MarkdownDocument): MarkdownParseResult => {
  const chunks: {
    type: ChunkType;
    name: string;
    content: string;
    startLine: number;
    endLine: number;
    language: string;
    metadata?: Record<string, unknown>;
  }[] = [];

  // Create chunk for each section
  for (const section of doc.sections) {
    chunks.push({
      type: 'class' as ChunkType, // Use 'class' for sections
      name: section.heading,
      content: section.content,
      startLine: section.startLine,
      endLine: section.endLine,
      language: 'markdown',
      metadata: {
        section_level: section.level,
        has_code_blocks: section.codeBlocks.length > 0,
      },
    });

    // Create separate chunks for code blocks within sections
    for (const codeBlock of section.codeBlocks) {
      chunks.push({
        type: 'function' as ChunkType, // Use 'function' for code blocks
        name: `${section.heading} (${codeBlock.language} code)`,
        content: codeBlock.code,
        startLine: codeBlock.startLine,
        endLine: codeBlock.endLine,
        language: codeBlock.language,
        metadata: {
          parent_section: section.heading,
          is_code_block: true,
        },
      });
    }
  }

  return {
    language: 'markdown',
    chunks,
    imports: [], // Markdown has no imports
    exports: [], // Markdown has no exports
  };
};

/**
 * Index markdown files in a directory
 *
 * @param dirPath - Directory containing markdown files
 * @param recursive - Whether to search recursively
 * @returns Array of parsed markdown documents
 */
export const indexMarkdownFiles = async (dirPath: string, recursive = true): Promise<MarkdownDocument[]> => {
  const documents: MarkdownDocument[] = [];

  const indexDirectory = async (currentPath: string): Promise<void> => {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await indexDirectory(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const doc = await parseMarkdownFile(fullPath);
            documents.push(doc);
            logger.info('Indexed markdown file', {
              file: entry.name,
              sections: doc.sections.length,
              codeBlocks: doc.allCodeBlocks.length,
            });
          } catch (error) {
            logger.warn('Failed to parse markdown file', {
              file: entry.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to read directory', {
        path: currentPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await indexDirectory(dirPath);

  logger.info('Markdown indexing complete', {
    totalDocs: documents.length,
    totalSections: documents.reduce((sum, doc) => sum + doc.sections.length, 0),
    totalCodeBlocks: documents.reduce((sum, doc) => sum + doc.allCodeBlocks.length, 0),
  });

  return documents;
};

/**
 * Generate summary for markdown document
 *
 * @param doc - Parsed markdown document
 * @returns Human-readable summary
 */
export const generateMarkdownSummary = (doc: MarkdownDocument): string => {
  const parts: string[] = [];

  // Title
  if (doc.title) {
    parts.push(`# ${doc.title}`);
  }

  // Metadata if present
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    parts.push(
      `Metadata: ${Object.entries(doc.metadata)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    );
  }

  // Table of contents (section headings)
  if (doc.sections.length > 0) {
    parts.push('\nSections:');
    for (const section of doc.sections) {
      const indent = '  '.repeat(section.level - 1);
      parts.push(`${indent}- ${section.heading}`);
    }
  }

  // Code blocks summary
  if (doc.allCodeBlocks.length > 0) {
    const languageCounts = doc.allCodeBlocks.reduce<Record<string, number>>((acc, block) => {
      acc[block.language] = (acc[block.language] ?? 0) + 1;
      return acc;
    }, {});

    parts.push('\nCode blocks:');
    for (const [lang, count] of Object.entries(languageCounts)) {
      parts.push(`  - ${lang}: ${String(count)} blocks`);
    }
  }

  return parts.join('\n');
};

/**
 * Find markdown files to index
 *
 * @param rootPath - Root directory to search
 * @returns Array of markdown file paths
 */
export const findMarkdownFiles = async (rootPath: string): Promise<string[]> => {
  const markdownFiles: string[] = [];

  const searchDirectory = async (currentPath: string): Promise<void> => {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await searchDirectory(fullPath);
          }
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
          markdownFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore errors (permissions, etc.)
    }
  };

  await searchDirectory(rootPath);

  return markdownFiles;
};
