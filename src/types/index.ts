/**
 * cindex type definitions
 * Comprehensive types for monorepo, microservice, and multi-repo support
 */

// Core database types (rename ServiceType to avoid conflict)
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

// Service types (microservice support) - ServiceType from here is the canonical one
export type * from './service';

// MCP tool parameter types
export type * from './mcp-tools';

// Configuration types
export type * from './config';
