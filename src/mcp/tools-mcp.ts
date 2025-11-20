/**
 * MCP-compliant tool wrappers
 * Converts our tool implementations to MCP SDK format
 */
import { type Pool } from 'pg';

import { type IndexingOrchestrator } from '@indexing/orchestrator';
import { deleteRepositoryTool, formatDeletionOutput, type DeleteRepositoryInput } from '@mcp/delete-repository';
import { findCrossServiceCallsTool, type FindCrossServiceCallsInput } from '@mcp/find-cross-service-calls';
import { findCrossWorkspaceUsagesTool, type FindCrossWorkspaceUsagesInput } from '@mcp/find-cross-workspace-usages';
import { findSymbolTool, type FindSymbolInput } from '@mcp/find-symbol';
import { getFileContextTool, type GetFileContextInput } from '@mcp/get-file-context';
import { getServiceContextTool, type GetServiceContextInput } from '@mcp/get-service-context';
import { getWorkspaceContextTool, type GetWorkspaceContextInput } from '@mcp/get-workspace-context';
import { indexRepositoryTool, type IndexRepositoryInput } from '@mcp/index-repository';
import { listIndexedReposTool, type ListIndexedReposInput } from '@mcp/list-indexed-repos';
import { listServicesTool, type ListServicesInput } from '@mcp/list-services';
import { listWorkspacesTool, type ListWorkspacesInput } from '@mcp/list-workspaces';
import { searchAPIContractsTool, type SearchAPIContractsInput } from '@mcp/search-api-contracts';
import { searchCodebaseTool, type SearchCodebaseInput } from '@mcp/search-codebase';
import { logger } from '@utils/logger';
import { type OllamaClient } from '@utils/ollama';
import { type CindexConfig } from '@/types/config';

/**
 * MCP tool return type
 */
interface MCPToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: unknown;
}

/**
 * search_codebase MCP wrapper
 */
export const searchCodebaseMCP = async (
  db: Pool,
  config: CindexConfig,
  ollama: OllamaClient,
  input: SearchCodebaseInput
): Promise<MCPToolResult> => {
  try {
    const result = await searchCodebaseTool(db, config, ollama, input);

    return {
      content: [
        {
          type: 'text',
          text: result.formatted_result,
        },
      ],
      structuredContent: {
        query: result.raw_result.query,
        query_type: result.raw_result.query_type,
        metadata: result.raw_result.metadata,
        warnings: result.raw_result.warnings,
        total_tokens: result.raw_result.metadata.total_tokens,
        files_retrieved: result.raw_result.metadata.files_retrieved,
        chunks_retrieved: result.raw_result.metadata.chunks_retrieved,
      },
    };
  } catch (error) {
    logger.error('search_codebase tool failed', { error });
    throw error;
  }
};

/**
 * get_file_context MCP wrapper
 */
export const getFileContextMCP = async (db: Pool, input: GetFileContextInput): Promise<MCPToolResult> => {
  try {
    const result = await getFileContextTool(db, input);

    return {
      content: [
        {
          type: 'text',
          text: result.formatted_result,
        },
      ],
      structuredContent: {
        file_path: result.file.file_path,
        language: result.file.language,
        total_lines: result.file.total_lines,
        total_callers: result.total_callers,
        total_callees: result.total_callees,
        total_chunks: result.total_chunks,
      },
    };
  } catch (error) {
    logger.error('get_file_context tool failed', { error });
    throw error;
  }
};

/**
 * find_symbol_definition MCP wrapper
 */
export const findSymbolMCP = async (db: Pool, input: FindSymbolInput): Promise<MCPToolResult> => {
  try {
    const result = await findSymbolTool(db, input);

    return {
      content: [
        {
          type: 'text',
          text: result.formatted_result,
        },
      ],
      structuredContent: {
        symbol_name: input.symbol_name,
        total_definitions: result.symbols.length,
        total_usages: result.total_usages ?? 0,
        symbols: result.symbols.map((s) => ({
          name: s.symbol_name,
          type: s.symbol_type,
          file_path: s.file_path,
          line_number: s.line_number,
          scope: s.scope,
        })),
      },
    };
  } catch (error) {
    logger.error('find_symbol_definition tool failed', { error });
    throw error;
  }
};

/**
 * index_repository MCP wrapper
 */
export const indexRepositoryMCP = async (
  orchestrator: IndexingOrchestrator,
  input: IndexRepositoryInput,
  onProgress?: (progress: {
    stage: string;
    current: number;
    total: number;
    message: string;
    eta_seconds?: number;
  }) => void
): Promise<MCPToolResult> => {
  try {
    const result = await indexRepositoryTool(orchestrator, input, onProgress);

    return {
      content: [
        {
          type: 'text',
          text: result.formatted_result,
        },
      ],
      structuredContent: {
        repo_path: input.repo_path,
        repo_id: input.repo_id,
        files_indexed: result.stats.files_indexed,
        chunks_created: result.stats.chunks_created,
        symbols_extracted: result.stats.symbols_extracted,
        workspaces_detected: result.stats.workspaces_detected,
        services_detected: result.stats.services_detected,
        api_endpoints_found: result.stats.api_endpoints_found,
        indexing_time_ms: result.stats.indexing_time_ms,
      },
    };
  } catch (error) {
    logger.error('index_repository tool failed', { error });
    throw error;
  }
};

/**
 * delete_repository MCP wrapper
 */
export const deleteRepositoryMCP = async (db: Pool, input: DeleteRepositoryInput): Promise<MCPToolResult> => {
  try {
    const result = await deleteRepositoryTool(db, input);
    const formattedResult = formatDeletionOutput(result);

    return {
      content: [
        {
          type: 'text',
          text: formattedResult,
        },
      ],
      structuredContent: {
        deleted: result.deleted,
        repositories: result.repositories,
      },
    };
  } catch (error) {
    logger.error('delete_repository tool failed', { error });
    throw error;
  }
};

/**
 * list_indexed_repos MCP wrapper
 */
export const listIndexedReposMCP = async (db: Pool, input: ListIndexedReposInput): Promise<MCPToolResult> => {
  try {
    const result = await listIndexedReposTool(db, input);

    return {
      content: [
        {
          type: 'text',
          text: result.formatted_result,
        },
      ],
      structuredContent: {
        total_count: result.total_count,
        repositories: result.repositories.map((repo) => ({
          repo_id: repo.repo_id,
          repo_type: repo.repo_type,
          file_count: repo.file_count,
          workspace_count: repo.workspace_count,
          service_count: repo.service_count,
          indexed_at: repo.indexed_at,
        })),
      },
    };
  } catch (error) {
    logger.error('list_indexed_repos tool failed', { error });
    throw error;
  }
};

/**
 * list_workspaces MCP wrapper
 */
export const listWorkspacesMCP = async (db: Pool, input: ListWorkspacesInput): Promise<MCPToolResult> => {
  try {
    const result = await listWorkspacesTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        total_count: result.total_count,
        workspaces: result.workspaces,
      },
    };
  } catch (error) {
    logger.error('list_workspaces tool failed', { error });
    throw error;
  }
};

/**
 * list_services MCP wrapper
 */
export const listServicesMCP = async (db: Pool, input: ListServicesInput): Promise<MCPToolResult> => {
  try {
    const result = await listServicesTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        total_count: result.total_count,
        services: result.services,
      },
    };
  } catch (error) {
    logger.error('list_services tool failed', { error });
    throw error;
  }
};

/**
 * get_workspace_context MCP wrapper
 */
export const getWorkspaceContextMCP = async (db: Pool, input: GetWorkspaceContextInput): Promise<MCPToolResult> => {
  try {
    const result = await getWorkspaceContextTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        workspace: result.context.workspace,
        dependencies_count: result.context.dependencies.length,
        dependents_count: result.context.dependents.length,
        files_count: result.context.files.length,
      },
    };
  } catch (error) {
    logger.error('get_workspace_context tool failed', { error });
    throw error;
  }
};

/**
 * get_service_context MCP wrapper
 */
export const getServiceContextMCP = async (db: Pool, input: GetServiceContextInput): Promise<MCPToolResult> => {
  try {
    const result = await getServiceContextTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        service: result.context.service,
        dependencies_count: result.context.dependencies.length,
        dependents_count: result.context.dependents.length,
        api_endpoints_count: result.context.api_endpoints.length,
        files_count: result.context.files.length,
      },
    };
  } catch (error) {
    logger.error('get_service_context tool failed', { error });
    throw error;
  }
};

/**
 * find_cross_workspace_usages MCP wrapper
 */
export const findCrossWorkspaceUsagesMCP = async (
  db: Pool,
  input: FindCrossWorkspaceUsagesInput
): Promise<MCPToolResult> => {
  try {
    const result = await findCrossWorkspaceUsagesTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        total_usages: result.total_usages,
        usages: result.usages,
      },
    };
  } catch (error) {
    logger.error('find_cross_workspace_usages tool failed', { error });
    throw error;
  }
};

/**
 * find_cross_service_calls MCP wrapper
 */
export const findCrossServiceCallsMCP = async (db: Pool, input: FindCrossServiceCallsInput): Promise<MCPToolResult> => {
  try {
    const result = await findCrossServiceCallsTool(db, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        total_calls: result.total_calls,
        calls: result.calls,
      },
    };
  } catch (error) {
    logger.error('find_cross_service_calls tool failed', { error });
    throw error;
  }
};

/**
 * search_api_contracts MCP wrapper
 */
export const searchAPIContractsMCP = async (
  db: Pool,
  ollama: OllamaClient,
  config: CindexConfig,
  input: SearchAPIContractsInput
): Promise<MCPToolResult> => {
  try {
    const result = await searchAPIContractsTool(db, ollama, config.embedding, input);

    return {
      content: [{ type: 'text', text: result.formatted_result }],
      structuredContent: {
        query: input.query,
        total_results: result.total_results,
        endpoints: result.endpoints,
      },
    };
  } catch (error) {
    logger.error('search_api_contracts tool failed', { error });
    throw error;
  }
};
