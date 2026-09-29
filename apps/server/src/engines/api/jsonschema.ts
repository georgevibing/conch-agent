/**
 * Conch's own tools, in the shape a model API understands.
 *
 * A `HostTool` describes its arguments as a Zod raw shape, which is what an MCP
 * server wants. A plain model API wants JSON Schema. Zod 4 converts for us
 * (`z.toJSONSchema`), so there's no dependency here and no second definition of
 * the same types to keep in step.
 */
import { z } from 'zod';

import type { HostTool } from '../types';
import type { JsonSchema, ToolSpec } from './types';

/** Function names both providers accept: letters, digits, underscore, dash. */
const NAME_OK = /^[A-Za-z0-9_-]{1,64}$/;

/** An object schema with no properties — valid, and says "takes no arguments". */
const EMPTY: JsonSchema = { type: 'object', properties: {} };

/**
 * JSON Schema for one tool's arguments.
 *
 * `io: 'input'` matters: a field with a default is optional for the caller even
 * though it's always present afterwards. `unrepresentable: 'any'` keeps a type
 * Zod can't express in JSON Schema (a `Date`, say) from throwing the whole turn
 * away — it becomes "anything", and the tool still works.
 */
export function toJsonSchema(shape: z.ZodRawShape): JsonSchema {
  let schema: JsonSchema;
  try {
    schema = z.toJSONSchema(z.object(shape), {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchema;
  } catch {
    // A shape no converter can express is still a usable tool: it just can't
    // be described. Better a tool with no arguments than a turn that dies.
    return { ...EMPTY };
  }
  // `$schema` is metadata about the document, not about the arguments. Some
  // providers reject unknown top-level keys, so it goes.
  delete schema['$schema'];
  if (schema['type'] !== 'object') return { ...EMPTY };
  schema['properties'] ??= {};
  return schema;
}

/**
 * A wire-safe function name. Conch's own tools keep the `mcp__conch__` prefix
 * native engines use, so the UI hides them the same way; an integration tool
 * whose name is too long or has an odd character gets a shortened, still-unique
 * one, because the model can only call names the provider accepts.
 */
export function wireName(name: string, taken: ReadonlySet<string>): string {
  let candidate = NAME_OK.test(name) ? name : name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (!candidate) candidate = 'tool';
  let n = 2;
  while (taken.has(candidate)) {
    const suffix = `_${n++}`;
    candidate = `${candidate.slice(0, 64 - suffix.length)}${suffix}`;
  }
  return candidate;
}

/** Conch's memory and routine tools, as function tools. */
export function hostToolSpec(tool: HostTool, name: string): ToolSpec {
  return { name, description: tool.description, schema: toJsonSchema(tool.input) };
}

/**
 * An integration's schema, straight from the MCP server — untrusted, so it's
 * only used when it really is a JSON Schema object.
 */
export function bridgedSchema(inputSchema: Record<string, unknown>): JsonSchema {
  if (inputSchema['type'] !== 'object') return { ...EMPTY };
  const schema: JsonSchema = { ...inputSchema };
  delete schema['$schema'];
  schema['properties'] ??= {};
  return schema;
}
