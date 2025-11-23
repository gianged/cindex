/**
 * Progress tracking for indexing pipeline
 *
 * Tracks progress through all indexing stages, calculates ETA, collects statistics,
 * and provides real-time progress updates during repository indexing.
 */

import { logger } from '@utils/logger';
import { IndexingStage, type IndexingStats } from '@/types/indexing';

/**
 * Progress tracker for indexing operations
 */
export class ProgressTracker {
  private stats: IndexingStats;
  private startTime = 0;
  private lastLogTime = 0;
  private readonly logIntervalMs = 5000; // Log progress every 5 seconds

  constructor() {
    this.stats = this.createInitialStats();
  }

  /**
   * Start tracking progress
   *
   * Initializes the tracker with total file count and records start time.
   *
   * @param totalFiles - Total number of files to process
   */
  public start = (totalFiles: number): void => {
    this.startTime = Date.now();
    this.lastLogTime = this.startTime;
    this.stats.files_total = totalFiles;
    this.stats.stage = IndexingStage.Discovering;

    logger.info('Indexing started', {
      total_files: totalFiles,
    });

    this.logProgress();
  };

  /**
   * Update current indexing stage
   *
   * @param stage - New indexing stage
   */
  public setStage = (stage: IndexingStage): void => {
    this.stats.stage = stage;

    // Log stage transitions
    logger.debug('Stage changed', { stage });
  };

  /**
   * Increment processed files counter
   *
   * Logs progress at intervals to avoid excessive logging.
   */
  public incrementFiles = (): void => {
    this.stats.files_processed++;

    // Log progress periodically (every 5 seconds or every 10% of files)
    const now = Date.now();
    const timeSinceLastLog = now - this.lastLogTime;
    const percentComplete = (this.stats.files_processed / this.stats.files_total) * 100;
    const shouldLog =
      timeSinceLastLog >= this.logIntervalMs || percentComplete % 10 < (1 / this.stats.files_total) * 100;

    if (shouldLog) {
      this.logProgress();
      this.lastLogTime = now;
    }
  };

  /**
   * Increment failed files counter
   */
  public incrementFailed = (): void => {
    this.stats.files_failed++;
  };

  /**
   * Increment chunks counter
   *
   * @param count - Number of chunks to add
   */
  public incrementChunks = (count: number): void => {
    this.stats.chunks_total += count;
  };

  /**
   * Increment embedded chunks counter
   *
   * @param count - Number of embedded chunks to add
   */
  public incrementEmbedded = (count: number): void => {
    this.stats.chunks_embedded += count;
  };

  /**
   * Increment symbols extracted counter
   *
   * @param count - Number of symbols to add
   */
  public incrementSymbols = (count: number): void => {
    this.stats.symbols_extracted += count;
  };

  /**
   * Record summary generation method
   *
   * @param method - Summary generation method used
   */
  public recordSummary = (method: 'llm' | 'rule-based'): void => {
    if (method === 'llm') {
      this.stats.summaries_llm++;
    } else {
      this.stats.summaries_fallback++;
    }
  };

  /**
   * Record an error
   *
   * @param filePath - File path where error occurred
   * @param stage - Stage where error occurred
   * @param error - Error message
   */
  public recordError = (filePath: string, stage: IndexingStage, error: string): void => {
    this.stats.errors.push({
      file_path: filePath,
      stage,
      error,
    });
  };

  /**
   * Get current statistics
   *
   * Calculates total time and average time per file before returning.
   *
   * @returns Current indexing statistics
   */
  public getStats = (): IndexingStats => {
    const now = Date.now();
    this.stats.total_time_ms = now - this.startTime;

    if (this.stats.files_processed > 0) {
      this.stats.avg_file_time_ms = this.stats.total_time_ms / this.stats.files_processed;
    }

    // Populate alias fields for MCP tool compatibility
    this.stats.files_indexed = this.stats.files_processed;
    this.stats.chunks_created = this.stats.chunks_embedded;
    this.stats.indexing_time_ms = this.stats.total_time_ms;

    return { ...this.stats };
  };

  /**
   * Log progress update
   *
   * Formats and logs progress with percentage complete and ETA.
   * Format: "[Stage] X/Y (Z%) - ETA: Nm Ss"
   */
  private logProgress = (): void => {
    const percentage = this.calculatePercentage();
    const eta = this.calculateETA();

    const message = `[${this.stats.stage}] ${String(this.stats.files_processed)}/${String(this.stats.files_total)} (${String(percentage)}%) - ETA: ${eta}`;

    logger.info(message, {
      stage: this.stats.stage,
      processed: this.stats.files_processed,
      total: this.stats.files_total,
      percentage,
      eta_formatted: eta,
      chunks_embedded: this.stats.chunks_embedded,
      symbols_extracted: this.stats.symbols_extracted,
    });
  };

  /**
   * Calculate completion percentage
   *
   * @returns Percentage complete (0-100)
   */
  private calculatePercentage = (): number => {
    if (this.stats.files_total === 0) return 0;

    return Math.round((this.stats.files_processed / this.stats.files_total) * 100);
  };

  /**
   * Calculate estimated time remaining (ETA)
   *
   * Uses average time per file to estimate remaining time.
   *
   * @returns Formatted ETA string (e.g., "2m 35s")
   */
  private calculateETA = (): string => {
    if (this.stats.files_processed === 0) {
      return 'calculating...';
    }

    const elapsed = Date.now() - this.startTime;
    const avgTimePerFile = elapsed / this.stats.files_processed;
    const remaining = this.stats.files_total - this.stats.files_processed;
    const etaMs = remaining * avgTimePerFile;

    return this.formatDuration(etaMs);
  };

  /**
   * Format duration in milliseconds to human-readable string
   *
   * @param ms - Duration in milliseconds
   * @returns Formatted duration (e.g., "2m 35s", "45s", "1h 5m")
   */
  private formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${String(hours)}h ${String(remainingMinutes)}m`;
    }

    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${String(minutes)}m ${String(remainingSeconds)}s`;
    }

    return `${String(seconds)}s`;
  };

  /**
   * Create initial statistics object
   *
   * @returns Initial empty stats
   */
  private createInitialStats = (): IndexingStats => {
    return {
      // Legacy property names
      files_total: 0,
      files_processed: 0,
      files_failed: 0,
      chunks_total: 0,
      chunks_embedded: 0,
      symbols_extracted: 0,
      total_time_ms: 0,
      avg_file_time_ms: 0,
      summaries_llm: 0,
      summaries_fallback: 0,
      stage: IndexingStage.Starting,
      errors: [],

      // Required aliases for MCP tools
      files_indexed: 0,
      chunks_created: 0,
      indexing_time_ms: 0,
    };
  };

  /**
   * Log final indexing report
   *
   * Called when indexing is complete to display comprehensive statistics.
   */
  public logFinalReport = (): void => {
    const stats = this.getStats();

    // Calculate rates
    const filesPerMin = (stats.files_processed / stats.total_time_ms) * 60000;
    const chunksPerMin = (stats.chunks_embedded / stats.total_time_ms) * 60000;

    // Calculate percentages
    const llmPercentage = stats.files_processed > 0 ? (stats.summaries_llm / stats.files_processed) * 100 : 0;
    const fallbackPercentage = stats.files_processed > 0 ? (stats.summaries_fallback / stats.files_processed) * 100 : 0;

    logger.info('Indexing complete', {
      summary: {
        files: `${String(stats.files_processed)}/${String(stats.files_total)}`,
        failed: stats.files_failed,
        success_rate: `${String(Math.round(((stats.files_processed - stats.files_failed) / stats.files_processed) * 100))}%`,
      },
      chunks: {
        total: stats.chunks_total,
        embedded: stats.chunks_embedded,
      },
      symbols: {
        extracted: stats.symbols_extracted,
      },
      summaries: {
        llm: `${String(stats.summaries_llm)} (${String(Math.round(llmPercentage))}%)`,
        fallback: `${String(stats.summaries_fallback)} (${String(Math.round(fallbackPercentage))}%)`,
      },
      performance: {
        files_per_min: Math.round(filesPerMin),
        chunks_per_min: Math.round(chunksPerMin),
        avg_file_time_ms: Math.round(stats.avg_file_time_ms),
        total_time: this.formatDuration(stats.total_time_ms),
      },
      errors: {
        count: stats.errors.length,
        sample: stats.errors.slice(0, 5),
      },
    });
  };
}

/**
 * Create progress tracker instance
 *
 * @returns Initialized ProgressTracker
 */
export const createProgressTracker = (): ProgressTracker => {
  return new ProgressTracker();
};
