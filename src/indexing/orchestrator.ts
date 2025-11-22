/**
 * Main indexing pipeline orchestrator
 *
 * Coordinates all Phase 1-3 stages: file discovery, parsing, chunking,
 * summary generation, embedding generation, symbol extraction, and database persistence.
 * Handles errors gracefully and tracks progress throughout.
 */

import * as fs from 'node:fs/promises';

import { type DatabaseClient } from '@database/client';
import { type DatabaseWriter } from '@database/writer';
import { type CrossServiceAPICallDetector } from '@indexing/api-call-detector';
import { type APIEndpointEmbeddingGenerator } from '@indexing/api-embeddings';
import { type APISpecificationParser } from '@indexing/api-parser';
import { type CodeChunker } from '@indexing/chunker';
import { type EmbeddingGenerator } from '@indexing/embeddings';
import { type FileWalker } from '@indexing/file-walker';
import { type APIImplementationLinker } from '@indexing/implementation-linker';
import { detectFileChanges, processIncrementalChanges } from '@indexing/incremental';
import { determineLargeFileStrategy, extractStructureOnlyMetadata } from '@indexing/large-file-handler';
import { MetadataExtractor } from '@indexing/metadata';
import { type CodeParser } from '@indexing/parser';
import { type FileSummaryGenerator } from '@indexing/summary';
import { type SymbolExtractor } from '@indexing/symbols';
import { logger } from '@utils/logger';
import { PerformanceMonitor } from '@utils/performance';
import { type ProgressTracker } from '@utils/progress';
import { type ImplementationSearchHints } from '@/types/api-parsing';
import {
  type CodeChunk as CodeChunkDB,
  type CodeFile,
  type CrossRepoDependency,
  type Repository,
  type RepositoryMetadata,
  type Service,
  type Workspace,
  type WorkspaceAlias,
  type WorkspaceDependency,
} from '@/types/database';
import {
  ChunkType,
  IndexingStage,
  type ChunkEmbedding,
  type CodeChunkInput,
  type DiscoveredFile,
  type ExportInfo,
  type ExtractedSymbol,
  type FileSummary,
  type ImportInfo,
  type IndexingOptions,
  type IndexingStats,
  type ParseResult,
} from '@/types/indexing';
import { type DetectedService } from '@/types/service';
import { type DetectedWorkspace } from '@/types/workspace';

/**
 * Indexing pipeline orchestrator
 */
export class IndexingOrchestrator {
  private currentRepoPath = '';
  private readonly metadataExtractor: MetadataExtractor;
  private readonly performanceMonitor: PerformanceMonitor;

  constructor(
    private readonly db: DatabaseClient,
    private readonly fileWalker: FileWalker,
    private readonly parser: CodeParser,
    private readonly chunker: CodeChunker,
    private readonly summaryGenerator: FileSummaryGenerator,
    private readonly embeddingGenerator: EmbeddingGenerator,
    private readonly symbolExtractor: SymbolExtractor,
    private readonly dbWriter: DatabaseWriter,
    private readonly progressTracker: ProgressTracker,
    // Optional API parsing components (Phase 3.1)
    private readonly apiParser?: APISpecificationParser,
    private readonly apiLinker?: APIImplementationLinker,
    private readonly apiEmbeddingGenerator?: APIEndpointEmbeddingGenerator,
    private readonly apiCallDetector?: CrossServiceAPICallDetector
  ) {
    this.metadataExtractor = new MetadataExtractor();
    this.performanceMonitor = new PerformanceMonitor({
      enabled: true,
      trackMemory: true,
      logInterval: 50, // Log every 50 files
      alertThresholds: {
        maxDurationMs: 30000, // 30 seconds per file
        maxMemoryMB: 1024, // 1GB
        minThroughput: 5, // 5 items/sec
      },
    });
  }

  /**
   * Run complete indexing pipeline for a repository
   *
   * Executes all indexing stages from file discovery through database persistence.
   * Handles errors gracefully to continue processing remaining files.
   *
   * @param repoPath - Repository root path
   * @param options - Indexing options
   * @returns Final indexing statistics
   */
  public indexRepository = async (repoPath: string, options: IndexingOptions): Promise<IndexingStats> => {
    // Store current repo path for use in persistence
    this.currentRepoPath = repoPath;

    // Start performance monitoring
    this.performanceMonitor.start();

    logger.info('Starting repository indexing', {
      repo: repoPath,
      options,
    });

    try {
      // Stage 0: Persist repository metadata
      // This must happen before file discovery so files can reference the repository
      if (options.repoId) {
        const repository: Omit<Repository, 'id' | 'indexed_at' | 'last_updated'> = {
          repo_id: options.repoId,
          repo_name: options.repoName ?? options.repoId,
          repo_path: repoPath,
          repo_type: options.repoType ?? 'monolithic',
          workspace_config: null, // Populated during workspace detection
          workspace_patterns: null, // Populated during workspace detection
          root_package_json: null, // Populated during workspace detection
          git_remote_url: null, // Could extract from git, but not critical
          metadata: options.metadata as RepositoryMetadata | null,
        };

        await this.persistRepositoryMetadata(repository);
      }

      // Stage 1: File Discovery
      this.progressTracker.setStage(IndexingStage.Discovering);
      const discoveredFiles = await this.fileWalker.discoverFiles();

      logger.info('Files discovered', {
        count: discoveredFiles.length,
      });

      // Stage 1.5: Incremental Indexing (if enabled)
      let filesToProcess = discoveredFiles;
      if (options.incremental) {
        logger.info('Incremental indexing enabled, detecting changes');

        const { changes, stats } = await detectFileChanges(this.db, repoPath, discoveredFiles);

        // Process incremental changes (delete stale data)
        filesToProcess = await processIncrementalChanges(this.db, changes);

        logger.info('Incremental indexing prepared', {
          total_discovered: stats.total_discovered,
          new_files: stats.new_files,
          modified_files: stats.modified_files,
          unchanged_files: stats.unchanged_files,
          deleted_files: stats.deleted_files,
          skip_rate: stats.skip_rate.toFixed(1) + '%',
          files_to_process: filesToProcess.length,
        });
      }

      // Stage 1.6: File Validation & Filtering (large file, binary, generated, minified)
      const validatedFiles: typeof filesToProcess = [];
      const structureOnlyFiles: typeof filesToProcess = [];
      let skippedBinary = 0;
      let skippedGenerated = 0;
      let skippedMinified = 0;

      for (const file of filesToProcess) {
        const strategy = determineLargeFileStrategy(file);

        if (!strategy.shouldIndex) {
          // Skip files based on strategy
          if (strategy.fileType === 'binary') skippedBinary++;
          else if (strategy.fileType === 'generated') skippedGenerated++;
          else if (strategy.fileType === 'minified') skippedMinified++;

          logger.debug('Skipping file', {
            file: file.relative_path,
            reason: strategy.reason,
            fileType: strategy.fileType,
          });
          continue;
        }

        if (strategy.useStructureOnly) {
          // Very large files: structure-only indexing
          structureOnlyFiles.push(file);
          logger.debug('File marked for structure-only indexing', {
            file: file.relative_path,
            lines: file.line_count,
          });
          continue;
        }

        validatedFiles.push(file);
      }

      logger.info('File validation complete', {
        total_files: filesToProcess.length,
        validated_files: validatedFiles.length,
        structure_only_files: structureOnlyFiles.length,
        skipped_binary: skippedBinary,
        skipped_generated: skippedGenerated,
        skipped_minified: skippedMinified,
      });

      filesToProcess = validatedFiles;

      // Initialize progress tracker (including structure-only files)
      this.progressTracker.start(filesToProcess.length + structureOnlyFiles.length);

      // Stage 2-7: Process each file through the pipeline
      for (const file of filesToProcess) {
        try {
          await this.processFile(file);
          this.progressTracker.incrementFiles();
        } catch (error) {
          logger.error('File processing failed', {
            file: file.relative_path,
            error: error instanceof Error ? error.message : String(error),
          });

          this.progressTracker.incrementFailed();
          this.progressTracker.recordError(
            file.relative_path,
            this.progressTracker.getStats().stage,
            error instanceof Error ? error.message : String(error)
          );

          // Continue with next file
        }
      }

      // Stage 2-7 (Structure-Only): Process very large files with structure-only indexing
      for (const file of structureOnlyFiles) {
        try {
          await this.processStructureOnlyFile(file);
          this.progressTracker.incrementFiles();
        } catch (error) {
          logger.error('Structure-only file processing failed', {
            file: file.relative_path,
            error: error instanceof Error ? error.message : String(error),
          });

          this.progressTracker.incrementFailed();
          this.progressTracker.recordError(
            file.relative_path,
            this.progressTracker.getStats().stage,
            error instanceof Error ? error.message : String(error)
          );

          // Continue with next file
        }
      }

      // Get final statistics
      const stats = this.progressTracker.getStats();
      stats.stage = IndexingStage.Complete;

      // Log performance summary
      this.performanceMonitor.logSummary();

      // Log final report
      this.progressTracker.logFinalReport();

      return stats;
    } catch (error) {
      logger.error('Indexing pipeline failed', {
        repo: repoPath,
        error: error instanceof Error ? error.message : String(error),
      });

      const stats = this.progressTracker.getStats();
      stats.stage = IndexingStage.Failed;
      return stats;
    }
  };

  /**
   * Process a single file through all pipeline stages
   *
   * @param file - Discovered file metadata
   */
  private processFile = async (file: DiscoveredFile): Promise<void> => {
    // Read file content
    const content = await fs.readFile(file.absolute_path, 'utf-8');

    // Stage 2: Parse
    this.progressTracker.setStage(IndexingStage.Parsing);
    const parseMetricId = this.performanceMonitor.startStage('parsing', file.relative_path);
    const parseResult = this.parser.parse(content, file.relative_path);
    this.performanceMonitor.endStage(parseMetricId);

    if (!parseResult.success && !parseResult.used_fallback) {
      throw new Error(`Parsing failed: ${parseResult.error ?? 'unknown error'}`);
    }

    // Stage 3: Chunk
    this.progressTracker.setStage(IndexingStage.Chunking);
    const chunkMetricId = this.performanceMonitor.startStage('chunking', file.relative_path);
    const chunkingResult = this.chunker.createChunks(file, parseResult, content);
    this.performanceMonitor.endStage(chunkMetricId, chunkingResult.chunks.length);
    this.progressTracker.incrementChunks(chunkingResult.chunks.length);

    // Stage 4: Generate file summary
    this.progressTracker.setStage(IndexingStage.Summarizing);
    const summaryMetricId = this.performanceMonitor.startStage('summarizing', file.relative_path);
    const firstNLines = content.split('\n').slice(0, 100).join('\n');
    const summary = await this.summaryGenerator.generateSummary(file, firstNLines);
    this.performanceMonitor.endStage(summaryMetricId);
    this.progressTracker.recordSummary(summary.summary_method);

    // Stage 5: Generate embeddings for chunks
    this.progressTracker.setStage(IndexingStage.Embedding);
    const embeddingMetricId = this.performanceMonitor.startStage('embedding', file.relative_path);
    const chunkEmbeddings = await this.embeddingGenerator.generateBatch(chunkingResult.chunks, 5, summary.summary_text);
    this.progressTracker.incrementEmbedded(chunkEmbeddings.filter((e) => e.embedding.length > 0).length);

    // Generate embedding for file summary
    const summaryEmbedding = await this.embeddingGenerator.generateTextEmbedding(
      summary.summary_text,
      `file summary for ${file.relative_path}`
    );
    this.performanceMonitor.endStage(embeddingMetricId, chunkingResult.chunks.length + 1);

    // Stage 6: Extract symbols
    this.progressTracker.setStage(IndexingStage.Symbols);
    const symbolsMetricId = this.performanceMonitor.startStage('symbols', file.relative_path);
    const symbols = await this.symbolExtractor.extractSymbols(parseResult, file);
    this.performanceMonitor.endStage(symbolsMetricId, symbols.length);
    this.progressTracker.incrementSymbols(symbols.length);

    // Stage 7: Persist to database
    this.progressTracker.setStage(IndexingStage.Persisting);
    const persistMetricId = this.performanceMonitor.startStage('persistence', file.relative_path);
    await this.persistFileData(
      file,
      parseResult,
      summary,
      summaryEmbedding,
      chunkingResult.chunks,
      chunkEmbeddings,
      symbols
    );
    this.performanceMonitor.endStage(persistMetricId);
  };

  /**
   * Process very large file with structure-only indexing
   *
   * For files >5000 lines, we extract only structure metadata (imports, exports,
   * top-level declarations) and create a single lightweight chunk representing
   * the file structure. This avoids the overhead of detailed parsing, chunking,
   * and symbol extraction while still making the file discoverable via search.
   *
   * @param file - Discovered file
   */
  private processStructureOnlyFile = async (file: DiscoveredFile): Promise<void> => {
    // Read file content
    const content = await fs.readFile(file.absolute_path, 'utf-8');

    // Extract structure metadata (imports, exports, declarations)
    this.progressTracker.setStage(IndexingStage.Parsing);
    const parseMetricId = this.performanceMonitor.startStage('structure-extraction', file.relative_path);
    const structureMetadata = extractStructureOnlyMetadata(content);
    this.performanceMonitor.endStage(parseMetricId);

    // Generate simple text-based summary (no LLM)
    this.progressTracker.setStage(IndexingStage.Summarizing);
    const summaryMetricId = this.performanceMonitor.startStage('structure-summary', file.relative_path);
    const summaryText = `Large file (${structureMetadata.totalLines.toString()} lines) with structure-only indexing. Exports: ${structureMetadata.exports.join(', ') || 'none'}. Imports: ${structureMetadata.imports.slice(0, 10).join(', ')}${structureMetadata.imports.length > 10 ? '...' : ''}. Top-level declarations: ${structureMetadata.topLevelDeclarations.slice(0, 10).join(', ')}${structureMetadata.topLevelDeclarations.length > 10 ? '...' : ''}.`;
    this.performanceMonitor.endStage(summaryMetricId);
    this.progressTracker.recordSummary('rule-based');

    // Generate embedding for summary
    this.progressTracker.setStage(IndexingStage.Embedding);
    const embeddingMetricId = this.performanceMonitor.startStage('structure-embedding', file.relative_path);
    const summaryEmbedding = await this.embeddingGenerator.generateTextEmbedding(
      summaryText,
      `structure-only summary for ${file.relative_path}`
    );
    this.performanceMonitor.endStage(embeddingMetricId, 1);
    this.progressTracker.incrementEmbedded(1);

    // Create a single structure-only chunk
    const structureChunk: CodeChunkInput = {
      chunk_id: `${file.relative_path}:structure`,
      file_path: file.relative_path,
      language: file.language,
      chunk_content: `// Structure-only indexing\n// File: ${file.relative_path}\n// Lines: ${structureMetadata.totalLines.toString()}\n\nExports: ${structureMetadata.exports.join(', ') || 'none'}\n\nImports:\n${structureMetadata.imports.map((imp) => `  - ${imp}`).join('\n') || '  (none)'}\n\nTop-level declarations:\n${structureMetadata.topLevelDeclarations.map((decl) => `  - ${decl}`).join('\n') || '  (none)'}`,
      chunk_type: ChunkType.StructureOnly,
      start_line: 1,
      end_line: structureMetadata.totalLines,
      token_count: Math.ceil(summaryText.length / 4), // Rough estimate
      created_at: new Date(),
      metadata: {
        indexing_strategy: 'structure-only',
        total_declarations: structureMetadata.topLevelDeclarations.length,
        total_imports: structureMetadata.imports.length,
        total_exports: structureMetadata.exports.length,
      },
      // Multi-project context from discovered file
      repo_id: file.repo_id,
      workspace_id: file.workspace_id,
      package_name: file.package_name,
      service_id: file.service_id,
    };

    const chunkEmbedding: ChunkEmbedding = {
      chunk_id: `${file.relative_path}:structure`,
      embedding: summaryEmbedding,
      embedding_model: this.embeddingGenerator.getModelName(),
      dimension: this.embeddingGenerator.getDimensions(),
      generation_time_ms: 0, // Already measured in embeddingMetricId
      enhanced_text: summaryText,
    };

    this.progressTracker.incrementChunks(1);

    // Skip symbol extraction for structure-only files
    this.progressTracker.setStage(IndexingStage.Symbols);
    // No symbols extracted for structure-only files

    // Persist to database
    this.progressTracker.setStage(IndexingStage.Persisting);
    const persistMetricId = this.performanceMonitor.startStage('structure-persistence', file.relative_path);

    // Build ParseResult for persistence (structure metadata only)
    // Convert string arrays to ImportInfo/ExportInfo arrays
    const imports: ImportInfo[] = structureMetadata.imports.map((source, index) => ({
      symbols: [],
      source,
      is_default: false,
      is_namespace: false,
      line_number: index + 1, // Approximate line numbers
    }));

    const exports: ExportInfo[] = structureMetadata.exports.map((symbol, index) => ({
      symbols: [symbol],
      is_default: false,
      is_reexport: false,
      line_number: index + 1, // Approximate line numbers
    }));

    const parseResult: ParseResult = {
      success: true,
      used_fallback: false,
      imports,
      exports,
      nodes: [],
    };

    const fileSummary: FileSummary = {
      file_path: file.relative_path,
      summary_text: summaryText,
      summary_method: 'rule-based',
      generation_time_ms: 0, // No LLM generation time
    };

    await this.persistFileData(
      file,
      parseResult,
      fileSummary,
      summaryEmbedding,
      [structureChunk],
      [chunkEmbedding],
      []
    );

    this.performanceMonitor.endStage(persistMetricId);

    logger.debug('Structure-only file processed', {
      file: file.relative_path,
      lines: structureMetadata.totalLines,
      exports: structureMetadata.exports.length,
      imports: structureMetadata.imports.length,
      declarations: structureMetadata.topLevelDeclarations.length,
    });
  };

  /**
   * Persist all file data to database
   *
   * @param file - File metadata
   * @param parseResult - Parse result with imports/exports
   * @param summary - File summary
   * @param summaryEmbedding - Summary embedding
   * @param chunks - Code chunks
   * @param embeddings - Chunk embeddings
   * @param symbols - Extracted symbols
   */
  private persistFileData = async (
    file: DiscoveredFile,
    parseResult: ParseResult,
    summary: FileSummary,
    summaryEmbedding: number[],
    chunks: CodeChunkInput[],
    embeddings: ChunkEmbedding[],
    symbols: ExtractedSymbol[]
  ): Promise<void> => {
    // Convert imports to structured format with line numbers
    const structuredImports =
      parseResult.imports.length > 0 ? this.metadataExtractor.convertImportsToStructuredFormat(parseResult) : null;

    // Insert file metadata
    const codeFile: Omit<CodeFile, 'id' | 'indexed_at'> = {
      repo_path: this.currentRepoPath,
      file_path: file.relative_path,
      file_summary: summary.summary_text,
      summary_embedding: summaryEmbedding,
      language: file.language,
      total_lines: file.line_count,
      imports: structuredImports,
      exports: [], // Extract from parseResult if needed (future enhancement)
      file_hash: file.file_hash,
      last_modified: file.modified_time,
      repo_id: file.repo_id ?? null,
      workspace_id: file.workspace_id ?? null,
      package_name: file.package_name ?? null,
      service_id: file.service_id ?? null,
    };

    await this.dbWriter.insertFile(codeFile);

    // Merge chunks with embeddings
    const chunksWithEmbeddings = chunks.map((chunk, index) => ({
      ...chunk,
      repo_path: this.currentRepoPath,
      embedding: embeddings[index]?.embedding ?? [],
      indexed_at: new Date(),
      repo_id: chunk.repo_id ?? null,
      workspace_id: chunk.workspace_id ?? null,
      package_name: chunk.package_name ?? null,
      service_id: chunk.service_id ?? null,
    }));

    // Batch insert chunks
    await this.dbWriter.insertChunks(chunksWithEmbeddings as Omit<CodeChunkDB, 'id'>[]);

    // Convert symbols to database format
    const codeSymbols = symbols.map((symbol) => ({
      repo_path: this.currentRepoPath,
      symbol_name: symbol.symbol_name,
      symbol_type: symbol.symbol_type,
      file_path: symbol.file_path,
      line_number: symbol.line_number,
      definition: symbol.definition,
      embedding: symbol.embedding,
      repo_id: symbol.repo_id ?? null,
      workspace_id: symbol.workspace_id ?? null,
      package_name: symbol.package_name ?? null,
      service_id: symbol.service_id ?? null,
    }));

    // Batch insert symbols
    await this.dbWriter.insertSymbols(codeSymbols);
  };

  /**
   * Persist repository metadata to database
   *
   * Should be called at the start of indexing, before processing files.
   *
   * @param repo - Repository metadata
   */
  public persistRepositoryMetadata = async (
    repo: Omit<Repository, 'id' | 'indexed_at' | 'last_updated'>
  ): Promise<void> => {
    logger.info('Persisting repository metadata', {
      repo_id: repo.repo_id,
      repo_type: repo.repo_type,
    });

    await this.dbWriter.insertRepository(repo);
  };

  /**
   * Persist workspace data for monorepo support
   *
   * Converts detected workspaces to database format and persists.
   * Should be called after workspace detection completes.
   *
   * @param detectedWorkspaces - Workspaces detected by workspace-detector
   * @param repoId - Repository ID
   */
  public persistWorkspaceData = async (detectedWorkspaces: DetectedWorkspace[], repoId: string): Promise<void> => {
    if (detectedWorkspaces.length === 0) {
      logger.debug('No workspaces to persist');
      return;
    }

    logger.info('Persisting workspace data', {
      repo_id: repoId,
      workspace_count: detectedWorkspaces.length,
    });

    // Convert DetectedWorkspace to Workspace database type
    const workspaces: Omit<Workspace, 'id' | 'indexed_at'>[] = detectedWorkspaces.map((ws) => ({
      repo_id: repoId,
      workspace_id: ws.workspace_id,
      package_name: ws.package_name,
      workspace_path: ws.workspace_path,
      package_json_path: ws.package_json.path,
      version: ws.package_json.version,
      dependencies: ws.package_json.dependencies ?? null,
      dev_dependencies: ws.package_json.devDependencies ?? null,
      tsconfig_paths: ws.tsconfig?.compilerOptions?.paths ?? null,
      metadata: {
        main: ws.package_json.main,
        types: ws.package_json.types,
        scripts: ws.package_json.scripts,
        exports: ws.package_json.exports as Record<string, string> | undefined,
      },
    }));

    // Persist workspaces
    await this.dbWriter.insertWorkspaces(workspaces);

    // Collect and persist workspace aliases (from tsconfig paths)
    const aliases: Omit<WorkspaceAlias, 'id'>[] = [];
    for (const ws of detectedWorkspaces) {
      if (ws.tsconfig?.compilerOptions?.paths) {
        for (const [aliasPattern, resolvedPaths] of Object.entries(ws.tsconfig.compilerOptions.paths)) {
          for (const resolvedPath of resolvedPaths) {
            aliases.push({
              repo_id: repoId,
              workspace_id: ws.workspace_id,
              alias_type: 'tsconfig_path',
              alias_pattern: aliasPattern,
              resolved_path: resolvedPath,
              metadata: { source: 'tsconfig.json' },
            });
          }
        }
      }

      // Also add npm workspace aliases (package name → workspace path)
      aliases.push({
        repo_id: repoId,
        workspace_id: ws.workspace_id,
        alias_type: 'npm_workspace',
        alias_pattern: ws.package_name,
        resolved_path: ws.workspace_path,
        metadata: { source: 'package.json' },
      });
    }

    if (aliases.length > 0) {
      await this.dbWriter.insertWorkspaceAliases(aliases);
    }

    // Collect and persist internal workspace dependencies
    const workspaceDeps: Omit<WorkspaceDependency, 'id' | 'indexed_at'>[] = [];
    for (const ws of detectedWorkspaces) {
      for (const internalDep of ws.dependencies.internal) {
        workspaceDeps.push({
          repo_id: repoId,
          source_workspace_id: ws.workspace_id,
          target_workspace_id: internalDep.workspace_id,
          dependency_type: internalDep.type,
          version_specifier: internalDep.version,
          metadata: null,
        });
      }
    }

    if (workspaceDeps.length > 0) {
      await this.dbWriter.insertWorkspaceDependencies(workspaceDeps);
    }

    logger.info('Workspace data persisted', {
      workspaces: workspaces.length,
      aliases: aliases.length,
      dependencies: workspaceDeps.length,
    });
  };

  /**
   * Persist service data for microservice architecture
   *
   * Converts detected services to database format and persists.
   * Should be called after service detection completes.
   *
   * @param detectedServices - Services detected by service-detector
   * @param repoId - Repository ID
   */
  public persistServiceData = async (detectedServices: DetectedService[], repoId: string): Promise<void> => {
    if (detectedServices.length === 0) {
      logger.debug('No services to persist');
      return;
    }

    logger.info('Persisting service data', {
      repo_id: repoId,
      service_count: detectedServices.length,
    });

    // Convert DetectedService to Service database type
    const services: Omit<Service, 'id' | 'indexed_at'>[] = detectedServices.map((svc) => ({
      service_id: svc.service_id,
      service_name: svc.service_name,
      repo_id: repoId,
      service_path: svc.service_path,
      // Map 'worker' to 'other' for database compatibility
      service_type: svc.service_type === 'worker' ? 'other' : svc.service_type,
      api_endpoints:
        svc.api_config?.endpoints.map((ep) => ({
          method: ep.method,
          path: ep.path,
          description: ep.description,
        })) ?? null,
      dependencies:
        svc.dependencies.internal.length > 0
          ? svc.dependencies.internal
              .filter((dep) => ['api', 'event', 'database', 'library'].includes(dep.dependency_type))
              .map((dep) => ({
                service_id: dep.service_id,
                dependency_type: dep.dependency_type as 'api' | 'event' | 'database' | 'library',
              }))
          : null,
      metadata: {
        ...svc.metadata,
        base_path: svc.api_config?.base_path,
        port: svc.api_config?.port,
        protocol: svc.api_config?.protocol,
      },
    }));

    // Persist services
    await this.dbWriter.insertServices(services);

    // Collect and persist cross-repo dependencies (service-to-service)
    const crossRepoDeps: Omit<CrossRepoDependency, 'id' | 'indexed_at'>[] = [];
    for (const svc of detectedServices) {
      for (const internalDep of svc.dependencies.internal) {
        // Only create cross-repo dependency if target is in different repo
        if (internalDep.repo_id && internalDep.repo_id !== repoId) {
          crossRepoDeps.push({
            source_repo_id: repoId,
            target_repo_id: internalDep.repo_id,
            dependency_type: internalDep.dependency_type === 'api' ? 'api' : 'service',
            source_service_id: svc.service_id,
            target_service_id: internalDep.service_id,
            api_contracts: internalDep.endpoints
              ? internalDep.endpoints.map((ep) => ({
                  type: 'rest' as const,
                  endpoints: [{ path: ep }],
                }))
              : null,
            metadata: null,
          });
        }
      }
    }

    if (crossRepoDeps.length > 0) {
      await this.dbWriter.insertCrossRepoDependencies(crossRepoDeps);
    }

    logger.info('Service data persisted', {
      services: services.length,
      cross_repo_dependencies: crossRepoDeps.length,
    });
  };

  /**
   * Parse and index API specifications
   *
   * Discovers, parses, and indexes API specification files (OpenAPI, GraphQL, gRPC).
   * Links endpoints to implementation code and generates embeddings.
   *
   * @param codebasePath - Root path of the codebase
   * @param detectedServices - Services detected by service-detector
   * @param searchHints - Optional hints for implementation linking
   * @returns Number of API specifications processed
   */
  public parseAndIndexAPISpecifications = async (
    codebasePath: string,
    detectedServices: DetectedService[],
    searchHints?: ImplementationSearchHints
  ): Promise<number> => {
    // Check if API parsing components are available
    if (!this.apiParser || !this.apiEmbeddingGenerator) {
      logger.warn('API parsing components not initialized, skipping API specification parsing');
      return 0;
    }

    logger.info('Starting API specification parsing', {
      codebase: codebasePath,
      service_count: detectedServices.length,
    });

    let processedCount = 0;

    // Map service IDs to their API endpoints for quick lookup
    const serviceEndpointMap = new Map<string, string[]>();

    // Discover and parse API specification files
    const apiSpecFiles = await this.discoverAPISpecFiles(codebasePath);

    logger.info('API specification files discovered', {
      count: apiSpecFiles.length,
    });

    for (const specFile of apiSpecFiles) {
      try {
        // Parse API specification
        const parsingResult = await this.apiParser.parseFile(specFile);
        if (!parsingResult || parsingResult.endpoints.length === 0) {
          logger.debug('No endpoints found in spec file', { file: specFile });
          continue;
        }

        logger.info('API specification parsed', {
          file: specFile,
          format: parsingResult.spec_format,
          endpoint_count: parsingResult.endpoints.length,
          errors: parsingResult.parsing_errors.length,
        });

        // Link endpoints to implementation code (if linker available)
        if (this.apiLinker && searchHints) {
          const linkedEndpoints = await this.apiLinker.linkBatch(parsingResult.endpoints, codebasePath, searchHints);

          // Apply linked implementations to endpoints
          for (const endpoint of parsingResult.endpoints) {
            const key = `${endpoint.method} ${endpoint.path}`;
            const implementation = linkedEndpoints.get(key);
            if (implementation) {
              endpoint.implementation = implementation;
            }
          }

          const linkedCount = Array.from(linkedEndpoints.values()).filter((impl) => impl !== null).length;
          logger.info('Endpoint implementations linked', {
            total: parsingResult.endpoints.length,
            linked: linkedCount,
            percentage: ((linkedCount / parsingResult.endpoints.length) * 100).toFixed(1),
          });
        }

        // Generate embeddings for endpoints
        const endpointsWithEmbeddings = await this.apiEmbeddingGenerator.generateBatch(parsingResult.endpoints);

        logger.info('API endpoint embeddings generated', {
          file: specFile,
          endpoint_count: endpointsWithEmbeddings.length,
        });

        // Determine which service owns this spec
        const owningService = this.findServiceForSpecFile(specFile, detectedServices);

        if (owningService) {
          // Update service API endpoints in database
          await this.dbWriter.updateServiceAPIEndpoints(owningService.service_id, parsingResult.endpoints);

          // Store endpoints for cross-service call detection
          serviceEndpointMap.set(
            owningService.service_id,
            parsingResult.endpoints.map((ep) => ep.path)
          );

          logger.info('Service API endpoints updated in database', {
            service_id: owningService.service_id,
            endpoint_count: parsingResult.endpoints.length,
          });
        } else {
          logger.warn('Could not determine owning service for API spec', {
            file: specFile,
          });
        }

        processedCount++;
      } catch (error) {
        logger.error('Failed to process API specification file', {
          file: specFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Detect cross-service API calls (if detector available)
    if (this.apiCallDetector && serviceEndpointMap.size > 0) {
      await this.detectAndPersistCrossServiceCalls(serviceEndpointMap, detectedServices);
    }

    logger.info('API specification parsing complete', {
      processed: processedCount,
      total: apiSpecFiles.length,
    });

    return processedCount;
  };

  /**
   * Discover API specification files in codebase
   */
  private discoverAPISpecFiles = async (codebasePath: string): Promise<string[]> => {
    const specFiles: string[] = [];

    if (!this.apiParser) return specFiles;

    const traverse = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;

          if (entry.isDirectory()) {
            // Skip common ignore directories
            if (!['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) {
              await traverse(fullPath);
            }
          } else if (entry.isFile()) {
            // Check if file is an API spec
            if (this.apiParser?.isAPISpec(fullPath)) {
              specFiles.push(fullPath);
            }
          }
        }
      } catch (error) {
        logger.debug('Error traversing directory', {
          dir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await traverse(codebasePath);

    return specFiles;
  };

  /**
   * Find which service owns a given API spec file
   */
  private findServiceForSpecFile = (specFilePath: string, services: DetectedService[]): DetectedService | undefined => {
    // Find the service whose service_path is a parent of the spec file path
    for (const service of services) {
      if (specFilePath.startsWith(service.service_path)) {
        return service;
      }
    }

    return undefined;
  };

  /**
   * Detect and persist cross-service API calls
   */
  private detectAndPersistCrossServiceCalls = async (
    serviceEndpointMap: Map<string, string[]>,
    services: DetectedService[]
  ): Promise<void> => {
    if (!this.apiCallDetector) return;

    logger.info('Detecting cross-service API calls');

    let totalCallsDetected = 0;

    // For each service, scan its code for API calls
    for (const service of services) {
      const serviceCodeFiles = await this.getServiceCodeFiles(service.service_path);

      for (const filePath of serviceCodeFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const language = this.detectLanguage(filePath);

          const detectedCalls = this.apiCallDetector.detectCalls(filePath, content, language);

          if (detectedCalls.length > 0) {
            logger.debug('API calls detected in file', {
              file: filePath,
              call_count: detectedCalls.length,
            });

            totalCallsDetected += detectedCalls.length;

            // Resolve target services for each call
            for (const call of detectedCalls) {
              const targetService = this.apiCallDetector.resolveTargetService(
                call.target_endpoint ?? '',
                serviceEndpointMap
              );

              if (targetService) {
                logger.debug('Cross-service call resolved', {
                  source_service: service.service_id,
                  target_service: targetService,
                  endpoint: call.target_endpoint,
                });

                // This would be stored in cross_repo_dependencies table
                // Implementation depends on repo_id availability
              }
            }
          }
        } catch (error) {
          logger.debug('Failed to scan file for API calls', {
            file: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.info('Cross-service API call detection complete', {
      total_calls_detected: totalCallsDetected,
    });
  };

  /**
   * Get code files for a service
   */
  private getServiceCodeFiles = async (servicePath: string): Promise<string[]> => {
    const files: string[] = [];

    const traverse = async (dir: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;

          if (entry.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
              await traverse(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = fullPath.split('.').pop();
            if (['ts', 'js', 'tsx', 'jsx', 'py', 'go', 'java', 'rs'].includes(ext ?? '')) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    };

    await traverse(servicePath);

    return files;
  };

  /**
   * Detect programming language from file extension
   */
  private detectLanguage = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();

    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      go: 'go',
      java: 'java',
      rs: 'rust',
    };

    return languageMap[ext ?? ''] ?? 'unknown';
  };
}

/**
 * Create indexing orchestrator instance
 *
 * @param db - Database client for incremental indexing
 * @param fileWalker - File discovery service
 * @param parser - Code parser
 * @param chunker - Code chunker
 * @param summaryGenerator - Summary generator
 * @param embeddingGenerator - Embedding generator
 * @param symbolExtractor - Symbol extractor
 * @param dbWriter - Database writer
 * @param progressTracker - Progress tracker
 * @returns Initialized IndexingOrchestrator
 */
export const createIndexingOrchestrator = (
  db: DatabaseClient,
  fileWalker: FileWalker,
  parser: CodeParser,
  chunker: CodeChunker,
  summaryGenerator: FileSummaryGenerator,
  embeddingGenerator: EmbeddingGenerator,
  symbolExtractor: SymbolExtractor,
  dbWriter: DatabaseWriter,
  progressTracker: ProgressTracker
): IndexingOrchestrator => {
  return new IndexingOrchestrator(
    db,
    fileWalker,
    parser,
    chunker,
    summaryGenerator,
    embeddingGenerator,
    symbolExtractor,
    dbWriter,
    progressTracker
  );
};
