/**
 * Result deduplication and prioritization
 * Removes duplicate chunks and prioritizes results based on repository type
 *
 * This file contains two sets of functions:
 * 1. Base pipeline deduplication (deduplicateChunksBase) - for single-repo mode
 * 2. Multi-project deduplication (deduplicateChunks) - for multi-repo mode with repo type awareness
 */
import { type Pool, type QueryResult } from 'pg';

import { type SearchResult } from '@retrieval/vector-search';
import { logger } from '@utils/logger';
import { type CodeChunk, type RepositoryType, type RepoTypeQueryResult } from '@/types/database';
import { type DeduplicationResult, type RelevantChunk } from '@/types/retrieval';

/**
 * ==============================================================================
 * BASE PIPELINE DEDUPLICATION (Single-Repository Mode)
 * ==============================================================================
 */

/**
 * Calculate cosine similarity between two embedding vectors
 *
 * @param vec1 - First embedding vector
 * @param vec2 - Second embedding vector
 * @returns Cosine similarity score (0.0-1.0)
 */
const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vector dimension mismatch: ${String(vec1.length)} vs ${String(vec2.length)}`);
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  return similarity;
};

/**
 * Deduplicate chunks for base pipeline (single-repository mode)
 *
 * Performs pairwise similarity comparison to remove duplicate chunks.
 * Keeps the highest-scoring chunk when duplicates are found.
 *
 * Algorithm:
 * 1. Sort chunks by similarity score (descending)
 * 2. For each chunk, compare with all higher-ranked chunks
 * 3. If similarity > threshold: mark as duplicate
 * 4. Keep track of duplicate mappings for debugging
 *
 * @param chunks - Chunks from Stage 2 (retrieveChunks)
 * @param dedupThreshold - Similarity threshold for duplicates (default: 0.92)
 * @returns Deduplication result with unique chunks and statistics
 */
export const deduplicateChunksBase = (chunks: RelevantChunk[], dedupThreshold = 0.92): DeduplicationResult => {
  const startTime = Date.now();

  if (chunks.length === 0) {
    logger.debug('No chunks to deduplicate');
    return {
      unique_chunks: [],
      duplicates_removed: 0,
      duplicate_map: new Map(),
    };
  }

  logger.debug('Starting chunk deduplication', {
    totalChunks: chunks.length,
    threshold: dedupThreshold,
  });

  // Step 1: Sort chunks by similarity score (descending)
  // This ensures we always keep the highest-scoring chunk
  const sortedChunks = [...chunks].sort((a, b) => b.similarity - a.similarity);

  // Step 2: Deduplicate by pairwise comparison
  const uniqueChunks: RelevantChunk[] = [];
  const duplicateMap = new Map<string, string>();

  for (const currentChunk of sortedChunks) {
    let isDuplicate = false;

    // Compare with all higher-ranked chunks (already in uniqueChunks)
    for (const keptChunk of uniqueChunks) {
      // Skip if either chunk is missing embedding
      if (!currentChunk.embedding || !keptChunk.embedding) {
        continue;
      }

      // Calculate embedding similarity
      const similarity = cosineSimilarity(currentChunk.embedding, keptChunk.embedding);

      if (similarity > dedupThreshold) {
        // Found duplicate: keep keptChunk (higher score), discard currentChunk
        isDuplicate = true;
        duplicateMap.set(currentChunk.chunk_id, keptChunk.chunk_id);

        logger.debug('Duplicate chunk found', {
          duplicate: currentChunk.chunk_id,
          keptChunk: keptChunk.chunk_id,
          similarity: similarity.toFixed(3),
          duplicateSimilarity: currentChunk.similarity.toFixed(3),
          keptSimilarity: keptChunk.similarity.toFixed(3),
        });

        break;
      }
    }

    if (!isDuplicate) {
      uniqueChunks.push(currentChunk);
    }
  }

  const dedupTime = Date.now() - startTime;
  const duplicatesRemoved = chunks.length - uniqueChunks.length;

  logger.info('Chunk deduplication complete', {
    originalChunks: chunks.length,
    uniqueChunks: uniqueChunks.length,
    duplicatesRemoved,
    dedupPercentage: ((duplicatesRemoved / chunks.length) * 100).toFixed(1) + '%',
    threshold: dedupThreshold,
    dedupTime,
  });

  return {
    unique_chunks: uniqueChunks,
    duplicates_removed: duplicatesRemoved,
    duplicate_map: duplicateMap,
  };
};

/**
 * ==============================================================================
 * MULTI-PROJECT DEDUPLICATION (Multi-Repository Mode)
 * ==============================================================================
 */

/**
 * Priority multipliers for different repository types
 * Higher values = higher priority in search results
 */
const REPO_TYPE_PRIORITY: Record<RepositoryType, number> = {
  monolithic: 1.0, // User's main code
  microservice: 1.0, // User's main code
  monorepo: 1.0, // User's main code
  library: 0.9, // User's own libraries
  reference: 0.6, // External frameworks for learning
  documentation: 0.5, // Markdown documentation
};

/**
 * Get repository type for a repo_id
 */
const getRepoType = async (db: Pool, repoId: string): Promise<RepositoryType> => {
  const result: QueryResult<RepoTypeQueryResult> = await db.query<RepoTypeQueryResult>(
    `SELECT repo_type FROM repositories WHERE repo_id = $1`,
    [repoId]
  );

  if (result.rows.length === 0) {
    // Default to monolithic if not found in repositories table
    return 'monolithic';
  }

  const rows = result.rows;
  const [row] = rows;

  return row.repo_type;
};

/**
 * Calculate priority multiplier for a chunk based on its repository type
 */
const calculatePriority = async (
  db: Pool,
  chunk: CodeChunk,
  repoTypeCache: Map<string, RepositoryType>
): Promise<number> => {
  const repoId = chunk.repo_id;

  if (!repoId) {
    // No repo_id means single-repository mode
    return 1.0;
  }

  // Use cache to avoid repeated database queries
  let repoType = repoTypeCache.get(repoId);
  if (!repoType) {
    repoType = await getRepoType(db, repoId);
    repoTypeCache.set(repoId, repoType);
  }

  return REPO_TYPE_PRIORITY[repoType];
};

/**
 * Apply priority multipliers to search results
 * Sorts by: similarity_score * priority_multiplier
 */
export const prioritizeResults = async <T extends CodeChunk>(
  db: Pool,
  results: SearchResult<T>[]
): Promise<SearchResult<T>[]> => {
  const repoTypeCache = new Map<string, RepositoryType>();

  // Calculate priority for each result
  for (const result of results) {
    result.priority = await calculatePriority(db, result.item, repoTypeCache);
  }

  // Sort by weighted score (similarity * priority)
  const prioritized = results.sort((a, b) => {
    const scoreA = a.similarity * a.priority;
    const scoreB = b.similarity * b.priority;
    return scoreB - scoreA; // Descending order
  });

  return prioritized;
};

/**
 * Check if two chunks are duplicates based on embedding similarity
 */
const areDuplicates = (chunk1: CodeChunk, chunk2: CodeChunk, threshold: number): boolean => {
  if (!chunk1.embedding || !chunk2.embedding) {
    return false;
  }

  // Calculate cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < chunk1.embedding.length; i++) {
    dotProduct += chunk1.embedding[i] * chunk2.embedding[i];
    norm1 += chunk1.embedding[i] * chunk1.embedding[i];
    norm2 += chunk2.embedding[i] * chunk2.embedding[i];
  }

  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  return similarity > threshold;
};

/**
 * Deduplicate chunks, handling same-repo vs cross-repo duplicates differently
 */
export const deduplicateChunks = async (
  db: Pool,
  chunks: SearchResult<CodeChunk>[],
  dedupThreshold = 0.92
): Promise<SearchResult<CodeChunk>[]> => {
  if (chunks.length === 0) {
    return [];
  }

  const deduplicated: SearchResult<CodeChunk>[] = [];
  const repoTypeCache = new Map<string, RepositoryType>();

  for (const current of chunks) {
    let isDuplicate = false;

    for (const existing of deduplicated) {
      if (!areDuplicates(current.item, existing.item, dedupThreshold)) {
        continue;
      }

      // Found a duplicate
      const currentRepoId = current.item.repo_id;
      const existingRepoId = existing.item.repo_id;

      if (currentRepoId === existingRepoId) {
        // Same repository: likely true duplicate, keep higher scoring one
        isDuplicate = true;
        break;
      } else {
        // Different repositories: may be intentional duplication
        // Tag the current chunk but don't remove it

        // Get repo types to determine if this is reference vs main code
        const currentRepoType = currentRepoId
          ? (repoTypeCache.get(currentRepoId) ?? (await getRepoType(db, currentRepoId)))
          : 'monolithic';
        const existingRepoType = existingRepoId
          ? (repoTypeCache.get(existingRepoId) ?? (await getRepoType(db, existingRepoId)))
          : 'monolithic';

        if (currentRepoType === 'reference' && existingRepoType !== 'reference') {
          // Current is reference, existing is main code
          // Keep both but mark reference as duplicate
          if (current.item.metadata) {
            current.item.metadata.similar_to_main_code = true;
            current.item.metadata.similar_file = existing.item.file_path;
          } else {
            current.item.metadata = {
              similar_to_main_code: true,
              similar_file: existing.item.file_path,
            };
          }
        } else if (existingRepoType === 'reference' && currentRepoType !== 'reference') {
          // Existing is reference, current is main code
          // Replace reference with main code
          const existingIndex = deduplicated.indexOf(existing);
          deduplicated[existingIndex] = current;
          isDuplicate = true;
          break;
        }

        // For other cross-repo duplicates, keep both
      }
    }

    if (!isDuplicate) {
      deduplicated.push(current);
    }
  }

  return deduplicated;
};

/**
 * Group results by repository type for context assembly
 */
export interface GroupedResults<T> {
  primary_code: SearchResult<T>[]; // monolithic, microservice, monorepo
  libraries: SearchResult<T>[]; // library
  references: SearchResult<T>[]; // reference
  documentation: SearchResult<T>[]; // documentation
}

export const groupByRepoType = async <T extends CodeChunk>(
  db: Pool,
  results: SearchResult<T>[]
): Promise<GroupedResults<T>> => {
  const repoTypeCache = new Map<string, RepositoryType>();

  const grouped: GroupedResults<T> = {
    primary_code: [],
    libraries: [],
    references: [],
    documentation: [],
  };

  for (const result of results) {
    const repoId = result.item.repo_id;

    if (!repoId) {
      // No repo_id means single-repository mode, treat as primary code
      grouped.primary_code.push(result);
      continue;
    }

    // Get repo type
    let repoType = repoTypeCache.get(repoId);
    if (!repoType) {
      repoType = await getRepoType(db, repoId);
      repoTypeCache.set(repoId, repoType);
    }

    // Group by type
    switch (repoType) {
      case 'monolithic':
      case 'microservice':
      case 'monorepo':
        grouped.primary_code.push(result);
        break;
      case 'library':
        grouped.libraries.push(result);
        break;
      case 'reference':
        grouped.references.push(result);
        break;
      case 'documentation':
        grouped.documentation.push(result);
        break;
    }
  }

  return grouped;
};

/**
 * Limit reference and documentation results to prevent context pollution
 */
export const limitSecondaryResults = <T>(
  grouped: GroupedResults<T>,
  maxReferences = 5,
  maxDocumentation = 3
): GroupedResults<T> => {
  return {
    primary_code: grouped.primary_code, // No limit on primary code
    libraries: grouped.libraries, // No limit on user's own libraries
    references: grouped.references.slice(0, maxReferences),
    documentation: grouped.documentation.slice(0, maxDocumentation),
  };
};
