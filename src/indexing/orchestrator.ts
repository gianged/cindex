/**
 * Main indexing pipeline orchestrator
 *
 * Coordinates all Phase 1-3 stages: file discovery, parsing, chunking,
 * summary generation, embedding generation, symbol extraction, and database persistence.
 * Handles errors gracefully and tracks progress throughout.
 */

import * as fs from 'node:fs/promises';

import { type DatabaseWriter } from '@database/writer';
import { type CrossServiceAPICallDetector } from '@indexing/api-call-detector';
import { type APIEndpointEmbeddingGenerator } from '@indexing/api-embeddings';
import { type APISpecificationParser } from '@indexing/api-parser';
import { type CodeChunker } from '@indexing/chunker';
import { type EmbeddingGenerator } from '@indexing/embeddings';
import { type FileWalker } from '@indexing/file-walker';
import { type APIImplementationLinker } from '@indexing/implementation-linker';
import { MetadataExtractor } from '@indexing/metadata';
import { type CodeParser } from '@indexing/parser';
import { type FileSummaryGenerator } from '@indexing/summary';
import { type SymbolExtractor } from '@indexing/symbols';
import { logger } from '@utils/logger';
import { type ProgressTracker } from '@utils/progress';
import { type ImplementationSearchHints } from '@/types/api-parsing';
import {
  type CodeChunk as CodeChunkDB,
  type CodeFile,
  type CrossRepoDependency,
  type Repository,
  type Service,
  type Workspace,
  type WorkspaceAlias,
  type WorkspaceDependency,
} from '@/types/database';
import {
  IndexingStage,
  type ChunkEmbedding,
  type CodeChunkInput,
  type DiscoveredFile,
  type ExtractedSymbol,
  type FileSummary,
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

  constructor(
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

    logger.info('Starting repository indexing', {
      repo: repoPath,
      options,
    });

    try {
      // Stage 1: File Discovery
      this.progressTracker.setStage(IndexingStage.Discovering);
      const files = await this.fileWalker.discoverFiles();

      logger.info('Files discovered', {
        count: files.length,
      });

      // Initialize progress tracker
      this.progressTracker.start(files.length);

      // Stage 2-7: Process each file through the pipeline
      for (const file of files) {
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

      // Get final statistics
      const stats = this.progressTracker.getStats();
      stats.stage = IndexingStage.Complete;

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
    const parseResult = this.parser.parse(content, file.relative_path);

    if (!parseResult.success && !parseResult.used_fallback) {
      throw new Error(`Parsing failed: ${parseResult.error ?? 'unknown error'}`);
    }

    // Stage 3: Chunk
    this.progressTracker.setStage(IndexingStage.Chunking);
    const chunkingResult = this.chunker.createChunks(file, parseResult, content);
    this.progressTracker.incrementChunks(chunkingResult.chunks.length);

    // Stage 4: Generate file summary
    this.progressTracker.setStage(IndexingStage.Summarizing);
    const firstNLines = content.split('\n').slice(0, 100).join('\n');
    const summary = await this.summaryGenerator.generateSummary(file, firstNLines);
    this.progressTracker.recordSummary(summary.summary_method);

    // Stage 5: Generate embeddings for chunks
    this.progressTracker.setStage(IndexingStage.Embedding);
    const chunkEmbeddings = await this.embeddingGenerator.generateBatch(chunkingResult.chunks);
    this.progressTracker.incrementEmbedded(chunkEmbeddings.filter((e) => e.embedding.length > 0).length);

    // Generate embedding for file summary
    const summaryEmbedding = await this.embeddingGenerator.generateTextEmbedding(
      summary.summary_text,
      `file summary for ${file.relative_path}`
    );

    // Stage 6: Extract symbols
    this.progressTracker.setStage(IndexingStage.Symbols);
    const symbols = await this.symbolExtractor.extractSymbols(parseResult, file);
    this.progressTracker.incrementSymbols(symbols.length);

    // Stage 7: Persist to database
    this.progressTracker.setStage(IndexingStage.Persisting);
    await this.persistFileData(
      file,
      parseResult,
      summary,
      summaryEmbedding,
      chunkingResult.chunks,
      chunkEmbeddings,
      symbols
    );
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
