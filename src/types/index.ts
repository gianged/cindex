/**
 * cindex type definitions - Central export point
 *
 * Comprehensive types for monorepo, microservice, and multi-repository support.
 * This file re-exports all type definitions from specialized type modules.
 *
 * Note: Some types are duplicated across modules (e.g., RelevantFile, SearchContext).
 * Only the most authoritative versions are re-exported to avoid ambiguity.
 */

// Core database types (PostgreSQL schema)
// Note: ServiceType renamed to DatabaseServiceType to avoid conflict with service.ts
export type {
  RepositoryContext,
  CodeChunk,
  ChunkType,
  ChunkMetadata,
  CodeFile,
  CodeSymbol,
  SymbolType,
  Workspace,
  WorkspaceMetadata,
  Service,
  ServiceType as DatabaseServiceType,
  APIEndpoint,
  ServiceDependency,
  ServiceMetadata,
  Repository,
  RepositoryType,
  RepositoryMetadata,
  WorkspaceAlias,
  AliasType,
  AliasMetadata,
  CrossRepoDependency,
  CrossRepoDependencyType,
  APIContract,
  CrossRepoDependencyMetadata,
  WorkspaceDependency,
  WorkspaceDependencyType,
  WorkspaceDependencyMetadata,
} from './database';

// Workspace types (monorepo support)
export type * from './workspace';

// Service types (microservice support)
export type * from './service';

// MCP tool parameter types
export type * from './mcp-tools';

// Configuration types
export type * from './config';
