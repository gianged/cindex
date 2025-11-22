/**
 * Documentation Chunker Module
 *
 * Parses markdown files into structured chunks for documentation indexing.
 * Designed for standalone documentation tools (index_documentation, search_documentation).
 *
 * Features:
 * - YAML front matter parsing
 * - Section-based chunking with heading hierarchy
 * - Code block extraction with language detection
 * - Table of contents generation
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { type ParsedDocChunk, type ParsedDocFile, type TableOfContentsEntry } from '@/types/documentation';

/**
 * Parse YAML front matter from markdown content
 *
 * @param content - Raw markdown content
 * @returns Parsed front matter and content without it
 */
const parseFrontMatter = (
  content: string
): {
  frontMatter: Record<string, unknown> | null;
  contentWithoutFrontMatter: string;
  frontMatterEndLine: number;
} => {
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = frontMatterRegex.exec(content);

  if (!match) {
    return { frontMatter: null, contentWithoutFrontMatter: content, frontMatterEndLine: 0 };
  }

  const frontMatterText = match[1];
  const contentWithoutFrontMatter = content.slice(match[0].length);
  const frontMatterEndLine = match[0].split('\n').length;

  // Parse simple key: value pairs
  const frontMatter: Record<string, unknown> = {};
  const lines = frontMatterText.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value: unknown = line
        .slice(colonIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');

      // Try to parse arrays and booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep as string
        }
      }

      frontMatter[key] = value;
    }
  }

  return { frontMatter, contentWithoutFrontMatter, frontMatterEndLine };
};

/**
 * Build heading path (breadcrumb) for current heading
 *
 * @param headings - Stack of headings with their levels
 * @param currentHeading - Current heading text
 * @param currentLevel - Current heading level (1-6)
 * @returns Array of heading path from root to current
 */
const buildHeadingPath = (
  headings: { heading: string; level: number }[],
  currentHeading: string,
  currentLevel: number
): string[] => {
  // Filter to only parent headings (lower level numbers)
  const parents = headings.filter((h) => h.level < currentLevel);
  return [...parents.map((h) => h.heading), currentHeading];
};

/**
 * Extract code blocks from a section's content
 *
 * @param content - Section content
 * @param sectionStartLine - Starting line of the section in the file
 * @param headingPath - Heading path for context
 * @returns Array of code block chunks
 */
const extractCodeBlockChunks = (content: string, sectionStartLine: number, headingPath: string[]): ParsedDocChunk[] => {
  const chunks: ParsedDocChunk[] = [];
  const lines = content.split('\n');

  let inCodeBlock = false;
  let currentBlock: {
    language: string;
    code: string[];
    startLine: number;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^```(\w+)?/.exec(line);

    if (fenceMatch && !inCodeBlock) {
      inCodeBlock = true;
      currentBlock = {
        language: fenceMatch[1] || 'text',
        code: [],
        startLine: sectionStartLine + i,
      };
    } else if (line.trim() === '```' && inCodeBlock && currentBlock) {
      inCodeBlock = false;

      chunks.push({
        heading_path: headingPath,
        chunk_type: 'code_block',
        content: currentBlock.code.join('\n'),
        language: currentBlock.language,
        start_line: currentBlock.startLine,
        end_line: sectionStartLine + i,
        metadata: {
          language: currentBlock.language,
        },
      });

      currentBlock = null;
    } else if (inCodeBlock && currentBlock) {
      currentBlock.code.push(line);
    }
  }

  return chunks;
};

/**
 * Parse markdown file into structured document with chunks
 *
 * @param filePath - Absolute path to markdown file
 * @returns Parsed document with chunks ready for indexing
 */
export const parseMarkdownForDocumentation = async (filePath: string): Promise<ParsedDocFile> => {
  const content = await fs.readFile(filePath, 'utf-8');
  const fileHash = createHash('sha256').update(content).digest('hex');

  // Parse front matter
  const { frontMatter, contentWithoutFrontMatter, frontMatterEndLine } = parseFrontMatter(content);

  const lines = contentWithoutFrontMatter.split('\n');
  const chunks: ParsedDocChunk[] = [];
  const toc: TableOfContentsEntry[] = [];
  const headingStack: { heading: string; level: number }[] = [];

  let title: string | null = null;
  let description: string | null = null;

  // Current section accumulator
  let currentSection: {
    heading: string;
    level: number;
    headingPath: string[];
    content: string[];
    startLine: number;
  } | null = null;

  // Process line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const actualLine = frontMatterEndLine + i + 1; // 1-based line number

    const headingMatch = /^(#{1,6})\s+(.+)/.exec(line);

    if (headingMatch) {
      // Save previous section
      if (currentSection && currentSection.content.length > 0) {
        const sectionContent = currentSection.content.join('\n').trim();

        if (sectionContent) {
          // Add section chunk
          chunks.push({
            heading_path: currentSection.headingPath,
            chunk_type: 'section',
            content: sectionContent,
            language: 'markdown',
            start_line: currentSection.startLine,
            end_line: actualLine - 1,
          });

          // Extract code blocks from section
          const codeBlocks = extractCodeBlockChunks(
            currentSection.content.join('\n'),
            currentSection.startLine,
            currentSection.headingPath
          );
          chunks.push(...codeBlocks);
        }
      }

      // Process new heading
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();

      // Update heading stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      const headingPath = buildHeadingPath(headingStack, heading, level);
      headingStack.push({ heading, level });

      // Capture title from first H1
      if (level === 1 && !title) {
        title = heading;
      }

      // Add to TOC
      toc.push({
        heading,
        level,
        line: actualLine,
      });

      // Start new section
      currentSection = {
        heading,
        level,
        headingPath,
        content: [],
        startLine: actualLine + 1,
      };
    } else if (currentSection) {
      currentSection.content.push(line);

      // Capture description from first paragraph after title
      if (!description && currentSection.level === 1 && line.trim() && !line.startsWith('#')) {
        description = line.trim();
      }
    }
  }

  // Save last section
  if (currentSection && currentSection.content.length > 0) {
    const sectionContent = currentSection.content.join('\n').trim();

    if (sectionContent) {
      chunks.push({
        heading_path: currentSection.headingPath,
        chunk_type: 'section',
        content: sectionContent,
        language: 'markdown',
        start_line: currentSection.startLine,
        end_line: frontMatterEndLine + lines.length,
      });

      const codeBlocks = extractCodeBlockChunks(
        currentSection.content.join('\n'),
        currentSection.startLine,
        currentSection.headingPath
      );
      chunks.push(...codeBlocks);
    }
  }

  // Fallback title from filename
  title ??= path.basename(filePath, path.extname(filePath));

  // Get title/description from front matter if available
  if (frontMatter) {
    if (typeof frontMatter.title === 'string') {
      title = frontMatter.title;
    }
    if (typeof frontMatter.description === 'string') {
      description = frontMatter.description;
    }
  }

  return {
    file_path: filePath,
    file_hash: fileHash,
    title,
    description,
    front_matter: frontMatter,
    table_of_contents: toc,
    chunks,
  };
};

/**
 * Check if file is a markdown file
 *
 * @param filePath - File path to check
 * @returns True if markdown file
 */
export const isMarkdownFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.markdown';
};

/**
 * Find all markdown files in a directory
 *
 * @param dirPath - Directory to search
 * @param recursive - Whether to search recursively (default: true)
 * @returns Array of absolute markdown file paths
 */
export const findMarkdownFiles = async (dirPath: string, recursive = true): Promise<string[]> => {
  const markdownFiles: string[] = [];

  const searchDirectory = async (currentPath: string): Promise<void> => {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden dirs and node_modules
          if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await searchDirectory(fullPath);
          }
        } else if (entry.isFile() && isMarkdownFile(entry.name)) {
          markdownFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  };

  await searchDirectory(dirPath);
  return markdownFiles;
};

/**
 * Get file hash for a markdown file
 *
 * @param filePath - File path
 * @returns SHA256 hash of file content
 */
export const getFileHash = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
};

/**
 * Estimate token count for text
 *
 * @param text - Text to estimate
 * @returns Estimated token count (4 chars = 1 token)
 */
export const estimateTokenCount = (text: string): number => {
  return Math.ceil(text.length / 4);
};
