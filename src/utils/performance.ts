/**
 * Performance Monitoring Module
 *
 * Comprehensive performance tracking for indexing and retrieval pipelines.
 * Collects detailed metrics at stage level and provides aggregate statistics.
 *
 * Key Features:
 * - Stage-level timing and throughput metrics
 * - Memory usage tracking per stage
 * - Aggregate statistics and percentiles
 * - Export capabilities for analysis
 * - Real-time monitoring and alerting
 *
 * Performance Targets:
 * - Indexing: 300-600 files/min (accuracy mode), 500-1000 files/min (speed mode)
 * - Query: <800ms (accuracy mode), <500ms (speed mode)
 * - Memory: <1GB heap usage for 100k files
 */

import { logger } from '@utils/logger';

/**
 * Performance metric for a single operation
 */
export interface PerformanceMetric {
  stage: string;
  operation: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  memoryUsedMB?: number;
  throughput?: number; // items/second
  metadata?: Record<string, unknown>;
}

/**
 * Aggregate statistics for a stage
 */
export interface StageStatistics {
  stage: string;
  totalOperations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalMemoryUsedMB: number;
  avgMemoryUsedMB: number;
  avgThroughput: number;
}

/**
 * Overall performance summary
 */
export interface PerformanceSummary {
  totalDurationMs: number;
  totalOperations: number;
  overallThroughput: number; // operations/second
  peakMemoryUsageMB: number;
  avgMemoryUsageMB: number;
  stageStatistics: StageStatistics[];
  bottlenecks: string[]; // Stages that took >20% of total time
}

/**
 * Performance monitoring configuration
 */
export interface PerformanceConfig {
  enabled: boolean;
  trackMemory: boolean;
  logInterval?: number; // Log metrics every N operations
  alertThresholds?: {
    maxDurationMs?: number;
    maxMemoryMB?: number;
    minThroughput?: number;
  };
}

/**
 * Performance monitor class
 *
 * Tracks metrics for indexing and retrieval operations.
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private config: PerformanceConfig;
  private startTime = 0;
  private peakMemoryMB = 0;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enabled: true,
      trackMemory: true,
      logInterval: 100,
      ...config,
    };
  }

  /**
   * Start monitoring
   */
  start = (): void => {
    this.startTime = Date.now();
    this.metrics = [];
    this.peakMemoryMB = 0;

    if (this.config.enabled) {
      logger.debug('Performance monitoring started');
    }
  };

  /**
   * Start timing a stage
   *
   * Returns metric ID for later use with endStage().
   *
   * @param stage - Stage name (e.g., "indexing", "retrieval")
   * @param operation - Operation name (e.g., "embedding", "file-walk")
   * @param metadata - Additional metadata to track
   * @returns Metric ID to pass to endStage(), or -1 if monitoring disabled
   */
  startStage = (stage: string, operation: string, metadata?: Record<string, unknown>): number => {
    if (!this.config.enabled) return -1;

    const metric: PerformanceMetric = {
      stage,
      operation,
      startTime: Date.now(),
      metadata,
    };

    this.metrics.push(metric);
    // Return array index as metric ID
    return this.metrics.length - 1;
  };

  /**
   * End timing a stage and calculate metrics
   *
   * Calculates duration, throughput, and memory usage.
   * Checks alert thresholds and logs periodically.
   *
   * @param metricId - Metric ID from startStage()
   * @param itemsProcessed - Number of items processed (for throughput calculation)
   */
  endStage = (metricId: number, itemsProcessed = 1): void => {
    if (!this.config.enabled || metricId < 0 || metricId >= this.metrics.length) return;

    const metric = this.metrics[metricId];
    metric.endTime = Date.now();
    metric.durationMs = metric.endTime - metric.startTime;

    // Calculate throughput (items per second)
    if (itemsProcessed > 0 && metric.durationMs > 0) {
      metric.throughput = (itemsProcessed / metric.durationMs) * 1000;
    }

    // Track memory usage if enabled
    if (this.config.trackMemory) {
      const memUsage = process.memoryUsage();
      metric.memoryUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Update peak memory
      if (metric.memoryUsedMB > this.peakMemoryMB) {
        this.peakMemoryMB = metric.memoryUsedMB;
      }
    }

    // Check performance thresholds and alert if exceeded
    this.checkThresholds(metric);

    // Log progress at intervals (e.g., every 100 operations)
    if (this.config.logInterval && this.metrics.length % this.config.logInterval === 0) {
      logger.debug('Performance checkpoint', {
        totalOperations: this.metrics.length,
        stage: metric.stage,
        durationMs: metric.durationMs,
        memoryMB: metric.memoryUsedMB,
      });
    }
  };

  /**
   * Track a complete operation (convenience wrapper)
   *
   * Automatically calls startStage/endStage around function execution.
   * On error, marks operation as failed (itemsProcessed=0).
   *
   * @param stage - Stage name
   * @param operation - Operation name
   * @param fn - Async function to execute and measure
   * @param itemsProcessed - Number of items processed (for throughput)
   * @returns Function result
   * @throws Re-throws any error from fn after recording metrics
   */
  trackOperation = async <T>(
    stage: string,
    operation: string,
    fn: () => Promise<T>,
    itemsProcessed = 1
  ): Promise<T> => {
    const metricId = this.startStage(stage, operation);
    try {
      const result = await fn();
      this.endStage(metricId, itemsProcessed);
      return result;
    } catch (error) {
      // Record failed operation (0 items processed)
      this.endStage(metricId, 0);
      throw error;
    }
  };

  /**
   * Check performance thresholds and alert
   *
   * @param metric - Performance metric
   */
  private checkThresholds = (metric: PerformanceMetric): void => {
    const thresholds = this.config.alertThresholds;
    if (!thresholds) return;

    if (thresholds.maxDurationMs && metric.durationMs && metric.durationMs > thresholds.maxDurationMs) {
      logger.warn('Performance threshold exceeded: duration', {
        stage: metric.stage,
        operation: metric.operation,
        durationMs: metric.durationMs,
        thresholdMs: thresholds.maxDurationMs,
      });
    }

    if (thresholds.maxMemoryMB && metric.memoryUsedMB && metric.memoryUsedMB > thresholds.maxMemoryMB) {
      logger.warn('Performance threshold exceeded: memory', {
        stage: metric.stage,
        operation: metric.operation,
        memoryMB: metric.memoryUsedMB,
        thresholdMB: thresholds.maxMemoryMB,
      });
    }

    if (thresholds.minThroughput && metric.throughput && metric.throughput < thresholds.minThroughput) {
      logger.warn('Performance threshold exceeded: throughput', {
        stage: metric.stage,
        operation: metric.operation,
        throughput: metric.throughput.toFixed(2),
        thresholdThroughput: thresholds.minThroughput,
      });
    }
  };

  /**
   * Calculate percentile value from sorted array
   *
   * Uses nearest-rank method (ceil).
   * Example: For p95 with 100 values, returns the 95th value.
   *
   * @param values - Sorted array of values (must be pre-sorted)
   * @param percentile - Percentile (0-100, e.g., 50 for median)
   * @returns Percentile value
   */
  private calculatePercentile = (values: number[], percentile: number): number => {
    if (values.length === 0) return 0;
    // Nearest-rank method: ceil((percentile/100) * N) - 1
    const index = Math.ceil((percentile / 100) * values.length) - 1;
    return values[Math.max(0, index)];
  };

  /**
   * Calculate statistics for a stage
   *
   * @param stage - Stage name
   * @returns Stage statistics
   */
  calculateStageStatistics = (stage: string): StageStatistics => {
    const stageMetrics = this.metrics.filter((m) => m.stage === stage && m.durationMs !== undefined);

    if (stageMetrics.length === 0) {
      return {
        stage,
        totalOperations: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        p50DurationMs: 0,
        p90DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        totalMemoryUsedMB: 0,
        avgMemoryUsedMB: 0,
        avgThroughput: 0,
      };
    }

    const durations = stageMetrics.map((m) => m.durationMs ?? 0).sort((a, b) => a - b);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const memoryUsages = stageMetrics.map((m) => m.memoryUsedMB ?? 0);
    const totalMemory = memoryUsages.reduce((sum, m) => sum + m, 0);
    const throughputs = stageMetrics.filter((m) => m.throughput).map((m) => m.throughput ?? 0);
    const avgThroughput = throughputs.length > 0 ? throughputs.reduce((sum, t) => sum + t, 0) / throughputs.length : 0;

    return {
      stage,
      totalOperations: stageMetrics.length,
      totalDurationMs: totalDuration,
      avgDurationMs: totalDuration / stageMetrics.length,
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      p50DurationMs: this.calculatePercentile(durations, 50),
      p90DurationMs: this.calculatePercentile(durations, 90),
      p95DurationMs: this.calculatePercentile(durations, 95),
      p99DurationMs: this.calculatePercentile(durations, 99),
      totalMemoryUsedMB: totalMemory,
      avgMemoryUsedMB: memoryUsages.length > 0 ? totalMemory / memoryUsages.length : 0,
      avgThroughput,
    };
  };

  /**
   * Generate comprehensive performance summary
   *
   * Calculates:
   * - Overall metrics (duration, throughput, memory)
   * - Per-stage statistics
   * - Bottlenecks (stages consuming >20% of total time)
   *
   * @returns Performance summary with aggregate statistics
   */
  getSummary = (): PerformanceSummary => {
    const totalDurationMs = Date.now() - this.startTime;
    const completedMetrics = this.metrics.filter((m) => m.durationMs !== undefined);
    const stages = [...new Set(this.metrics.map((m) => m.stage))];

    // Calculate per-stage statistics
    const stageStatistics = stages.map((stage) => this.calculateStageStatistics(stage));

    // Identify bottlenecks (stages taking >20% of total time)
    const bottlenecks: string[] = [];
    const threshold = totalDurationMs * 0.2;
    for (const stats of stageStatistics) {
      if (stats.totalDurationMs > threshold) {
        const percentage = ((stats.totalDurationMs / totalDurationMs) * 100).toFixed(1);
        bottlenecks.push(`${stats.stage} (${percentage}%)`);
      }
    }

    // Calculate average memory usage across all operations
    const memoryUsages = completedMetrics.filter((m) => m.memoryUsedMB).map((m) => m.memoryUsedMB ?? 0);
    const avgMemoryUsageMB = memoryUsages.length > 0 ? memoryUsages.reduce((sum, m) => sum + m, 0) / memoryUsages.length : 0;

    return {
      totalDurationMs,
      totalOperations: completedMetrics.length,
      overallThroughput: totalDurationMs > 0 ? (completedMetrics.length / totalDurationMs) * 1000 : 0,
      peakMemoryUsageMB: this.peakMemoryMB,
      avgMemoryUsageMB,
      stageStatistics,
      bottlenecks,
    };
  };

  /**
   * Export metrics for analysis
   *
   * @returns All metrics
   */
  exportMetrics = (): PerformanceMetric[] => {
    return [...this.metrics];
  };

  /**
   * Reset all metrics
   */
  reset = (): void => {
    this.metrics = [];
    this.startTime = 0;
    this.peakMemoryMB = 0;
  };

  /**
   * Log performance summary
   */
  logSummary = (): void => {
    if (!this.config.enabled) return;

    const summary = this.getSummary();

    logger.info('Performance Summary', {
      totalDurationMs: summary.totalDurationMs,
      totalOperations: summary.totalOperations,
      overallThroughput: summary.overallThroughput.toFixed(2) + ' ops/sec',
      peakMemoryUsageMB: summary.peakMemoryUsageMB,
      avgMemoryUsageMB: summary.avgMemoryUsageMB.toFixed(1),
    });

    // Log stage statistics
    for (const stats of summary.stageStatistics) {
      logger.info(`Stage: ${stats.stage}`, {
        operations: stats.totalOperations,
        totalDurationMs: stats.totalDurationMs,
        avgDurationMs: stats.avgDurationMs.toFixed(1),
        p95DurationMs: stats.p95DurationMs.toFixed(1),
        avgThroughput: stats.avgThroughput.toFixed(2) + ' items/sec',
      });
    }

    // Log bottlenecks
    if (summary.bottlenecks.length > 0) {
      logger.warn('Performance Bottlenecks Detected', {
        bottlenecks: summary.bottlenecks,
      });
    }
  };
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor({
  enabled: true,
  trackMemory: true,
  logInterval: 100,
  alertThresholds: {
    maxDurationMs: 60000, // 60 seconds
    maxMemoryMB: 1024, // 1GB
    minThroughput: 5, // 5 items/sec
  },
});
