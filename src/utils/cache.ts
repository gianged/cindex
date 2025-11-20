/**
 * In-memory LRU cache for embeddings and search results
 *
 * Caches:
 * - Query embeddings (query text → embedding vector)
 * - Search results (query + options → SearchResult)
 * - API endpoints (service IDs → endpoints)
 *
 * Features:
 * - LRU eviction policy
 * - Configurable max size
 * - TTL (time-to-live) support
 * - Cache statistics
 */

import { createHash } from 'node:crypto';

import { logger } from '@utils/logger';

/**
 * Cache entry with TTL
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number; // milliseconds
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

/**
 * LRU Cache implementation
 */
export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTTL: number; // milliseconds

  // Statistics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /**
   * Create LRU cache
   *
   * @param maxSize - Maximum number of entries (default: 1000)
   * @param defaultTTL - Default TTL in milliseconds (default: 5 minutes)
   */
  constructor(maxSize = 1000, defaultTTL = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get value from cache
   *
   * LRU behavior: On cache hit, entry is moved to end of cache (most recently used).
   * Expired entries are automatically deleted on access.
   *
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired (TTL exceeded)
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used) for LRU eviction policy
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   *
   * If cache is full, evicts oldest entry (LRU).
   * Updating an existing key does not trigger eviction.
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - TTL in milliseconds (optional, uses default if not provided)
   */
  set(key: string, value: T, ttl?: number): void {
    // Evict oldest entry if at max size (only for new keys)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKeyIterator = this.cache.keys().next();
      if (!firstKeyIterator.done && firstKeyIterator.value) {
        // Map maintains insertion order, first key is least recently used
        this.cache.delete(firstKeyIterator.value);
        this.evictions++;
      }
    }

    // Add or update entry with current timestamp
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    });
  }

  /**
   * Check if key exists in cache (without updating LRU)
   *
   * @param key - Cache key
   * @returns True if key exists and not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   *
   * @param key - Cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get cache size
   *
   * @returns Number of entries in cache
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Generate deterministic cache key from object
 *
 * Creates SHA256 hash of sorted JSON representation.
 * Sorting keys ensures consistent hashing for objects with same properties in different order.
 *
 * @param obj - Object to hash
 * @returns 16-character cache key (truncated SHA256 hash)
 */
export const generateCacheKey = (obj: unknown): string => {
  // Sort keys for deterministic JSON representation
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  // Use SHA256 hash, truncate to 16 chars for readability
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
};

/**
 * Global cache instances for different use cases
 */

/**
 * Cache for query embeddings
 * - Maps query text to embedding vectors
 * - TTL: 30 minutes (embeddings are deterministic)
 * - Max size: 500 entries
 */
export const queryEmbeddingCache = new LRUCache<number[]>(500, 30 * 60 * 1000);

/**
 * Cache for search results
 * - Maps (query + options) to search results
 * - TTL: 5 minutes (results may change as code is indexed)
 * - Max size: 200 entries
 */
export const searchResultCache = new LRUCache<unknown>(200, 5 * 60 * 1000);

/**
 * Cache for API endpoints
 * - Maps service IDs to endpoint lists
 * - TTL: 10 minutes (API contracts rarely change)
 * - Max size: 100 entries
 */
export const apiEndpointCache = new LRUCache<unknown>(100, 10 * 60 * 1000);

/**
 * Log cache statistics (for debugging/monitoring)
 */
export const logCacheStats = (): void => {
  const embeddingStats = queryEmbeddingCache.getStats();
  const searchStats = searchResultCache.getStats();
  const apiStats = apiEndpointCache.getStats();

  logger.info('Cache statistics', {
    queryEmbeddings: {
      size: embeddingStats.size,
      hitRate: (embeddingStats.hitRate * 100).toFixed(1) + '%',
      hits: embeddingStats.hits,
      misses: embeddingStats.misses,
    },
    searchResults: {
      size: searchStats.size,
      hitRate: (searchStats.hitRate * 100).toFixed(1) + '%',
      hits: searchStats.hits,
      misses: searchStats.misses,
    },
    apiEndpoints: {
      size: apiStats.size,
      hitRate: (apiStats.hitRate * 100).toFixed(1) + '%',
      hits: apiStats.hits,
      misses: apiStats.misses,
    },
  });
};

/**
 * Clear all caches
 */
export const clearAllCaches = (): void => {
  queryEmbeddingCache.clear();
  searchResultCache.clear();
  apiEndpointCache.clear();
  logger.info('All caches cleared');
};
