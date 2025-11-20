/**
 * Type adapters for MCP SDK schema compatibility
 *
 * The MCP SDK (v1.22.0) accepts Zod schemas at runtime, but its TypeScript
 * definitions don't perfectly match Zod v4.1's type system. This module provides
 * a documented workaround for this library incompatibility.
 *
 * Runtime behavior: Works correctly
 * TypeScript types: Incompatible (MCP SDK types don't recognize Zod v4 objects)
 *
 * This is a known limitation of the MCP SDK's type definitions, not a code error.
 */
import { type z } from 'zod';

/**
 * Convert a Zod object schema to MCP SDK input schema format
 *
 * **Type Safety Note**: This function returns the schema as-is but with type assertions
 * to bypass the incompatibility between MCP SDK v1.22.0 and Zod v4.1 type definitions.
 * The MCP SDK accepts these schemas correctly at runtime.
 *
 * Use `@ts-expect-error` at the call site to suppress TypeScript errors while
 * documenting that this is a known library incompatibility, not a code error.
 *
 * @param schema - Zod object schema (e.g., z.object({...}))
 * @returns The same schema, for MCP SDK registration
 */
export const toMcpSchema = <T extends z.ZodObject<z.ZodRawShape>>(schema: T): T => {
  return schema;
};
