/**
 * Type adapters for MCP SDK schema compatibility
 *
 * The MCP SDK (v1.22.0) accepts Zod schemas at runtime and handles conversion internally.
 * This module provides a pass-through function with type assertions to bypass TypeScript
 * incompatibilities between MCP SDK types and Zod schema types.
 *
 * Runtime behavior: MCP SDK handles Zod schemas natively
 * TypeScript types: Incompatible (requires @ts-expect-error at call sites)
 */
import { type z } from 'zod';

/**
 * Pass through Zod schema for MCP SDK registration
 *
 * The MCP SDK accepts Zod schemas at runtime and handles them natively.
 * This function provides a type-safe wrapper around the Zod schema.
 *
 * @param schema - Zod object schema (e.g., z.object({...}))
 * @returns The schema for MCP SDK registration
 */
export const toMcpSchema = <T extends z.ZodObject<z.ZodRawShape>>(schema: T): T => {
  return schema;
};
