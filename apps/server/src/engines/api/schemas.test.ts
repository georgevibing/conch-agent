import { describe, expect, it } from 'vitest';

import { browserTools } from '../../browser/tools';
import { googleTools } from '../../google/tools';
import { memoryTools } from '../../memory/tools';
import { slackTools } from '../../slack/tools';
import { vaultTools } from '../../vault/tools';
import { hostComputerTools } from '../host';
import type { HostTool, TurnInput } from '../types';
import { toJsonSchema } from './jsonschema';
import { sanitise, type SchemaFamily } from './schemas';
import { MCP_SCHEMAS } from './schemas.fixtures';
import type { JsonSchema } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const GEMINI_KEYS = new Set([
  'type',
  'description',
  'nullable',
  'enum',
  'format',
  'items',
  'properties',
  'required',
  'anyOf',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
]);
const STRICT_KEYS = new Set(['type', 'description', 'enum', 'items', 'properties', 'required']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

/** Everything Gemini's endpoint (or the strict fallback) is known to refuse, checked at every node. */
function problems(node: unknown, family: 'gemini' | 'strict', path = '$'): string[] {
  if (!isRecord(node)) return [`${path}: not an object`];
  const out: string[] = [];
  const keys = family === 'gemini' ? GEMINI_KEYS : STRICT_KEYS;
  for (const key of Object.keys(node)) if (!keys.has(key)) out.push(`${path}: keeps ${key}`);
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((b, i) => out.push(...problems(b, family, `${path}.anyOf[${i}]`)));
    return out;
  }
  if (typeof node.type !== 'string' || !TYPES.has(node.type))
    out.push(`${path}: type ${String(node.type)}`);
  if (Array.isArray(node.enum)) {
    if (node.type !== 'string') out.push(`${path}: enum on ${String(node.type)}`);
    if (!node.enum.every((v) => typeof v === 'string')) out.push(`${path}: enum not all text`);
  }
  if (node.type === 'array') {
    if (!isRecord(node.items)) out.push(`${path}: array without items`);
    else out.push(...problems(node.items, family, `${path}.items`));
  }
  if ('properties' in node) {
    if (!isRecord(node.properties) || !Object.keys(node.properties).length)
      out.push(`${path}: empty properties`);
    else
      for (const [key, value] of Object.entries(node.properties))
        out.push(...problems(value, family, `${path}.properties.${key}`));
  }
  if (Array.isArray(node.required)) {
    const names = isRecord(node.properties) ? Object.keys(node.properties) : [];
    for (const r of node.required)
      if (!names.includes(r as string)) out.push(`${path}: requires missing ${String(r)}`);
  }
  return out;
}

/** Conch's own tools, built the way a turn builds them; none of them runs here. */
function conchTools(): HostTool[] {
  const stub = new Proxy({}, { get: () => () => undefined }) as never;
  const ctx = {
    conversationId: 'c_1',
    append: () => undefined,
    permissionMode: 'default',
    ask: async () => 'deny',
    signal: new AbortController().signal,
  } as never;
  const turn = { cwd: process.cwd(), signal: new AbortController().signal } as unknown as TurnInput;
  return [
    ...hostComputerTools(turn),
    ...browserTools(stub, ctx),
    ...googleTools(stub, ctx),
    ...slackTools(stub, ctx),
    ...vaultTools(stub, ctx),
    ...memoryTools({
      store: stub,
      conversationId: 'c_1',
      onSaved: () => undefined,
      onForgotten: () => undefined,
    } as never),
  ];
}

describe('tool schemas for each provider family (ADR 0072)', () => {
  const families: SchemaFamily[] = ['permissive', 'gemini', 'anthropic', 'strict'];

  it.each(Object.keys(MCP_SCHEMAS))('gives Gemini only what it reads: %s', (name) => {
    const out = sanitise(MCP_SCHEMAS[name] as JsonSchema, 'gemini');
    expect(problems(out, 'gemini')).toEqual([]);
    // Keys are checked node by node above; property names like `title` are fine.
    expect(JSON.stringify(out)).not.toMatch(
      /"\$(ref|defs|schema)"|additionalProperties|"examples"/,
    );
  });

  it.each(Object.keys(MCP_SCHEMAS))('gives the strict fallback only plain keywords: %s', (name) => {
    expect(problems(sanitise(MCP_SCHEMAS[name] as JsonSchema, 'strict'), 'strict')).toEqual([]);
  });

  it('inlines references, makes a null branch nullable, and keeps what the model should read', () => {
    const out = sanitise(MCP_SCHEMAS.pydanticTask as JsonSchema, 'gemini');
    expect(out).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Default: "medium".',
        },
        labels: {
          type: 'array',
          nullable: true,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, color: { type: 'string', nullable: true } },
            required: ['name'],
          },
        },
        due: { type: 'string', format: 'date-time', nullable: true },
        estimate: { anyOf: [{ type: 'integer' }, { type: 'number' }] },
      },
      required: ['title'],
    });
  });

  it('moves a format Gemini doesn’t know and a default into the description', () => {
    const out = sanitise(MCP_SCHEMAS.fetch as JsonSchema, 'gemini');
    expect(out.properties).toMatchObject({
      url: { type: 'string', description: 'URL to fetch Format: uri.' },
      max_length: { type: 'integer', description: expect.stringContaining('Default: 5000.') },
    });
  });

  it('turns options into text and gives every node a type', () => {
    const out = sanitise(MCP_SCHEMAS.oddities as JsonSchema, 'gemini');
    expect(out.properties).toMatchObject({
      priority: { type: 'string', enum: ['0', '1', '2', '3'] },
      kind: { type: 'string', enum: ['issue'] },
      tags: { type: 'array', items: { type: 'string' } },
      anything: { type: 'string', description: 'Any value' },
      tuple: { type: 'array', items: { type: 'string' } },
      broken: { type: 'object' },
      external: { type: 'object' },
    });
    expect(out.required).toEqual(['priority']);
  });

  it('follows a recursive reference a few levels, then stops', () => {
    const out = JSON.stringify(sanitise(MCP_SCHEMAS.recursiveFilter as JsonSchema, 'gemini'));
    expect(out.length).toBeLessThan(20_000);
    expect(out).toContain('"nullable":true');
  });

  it('leaves an object with no fields without an empty list of them', () => {
    expect(sanitise(MCP_SCHEMAS.githubGetMe as JsonSchema, 'gemini')).toEqual({ type: 'object' });
    expect(sanitise(MCP_SCHEMAS.githubGetMe as JsonSchema, 'permissive')).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('merges a union at the root for Anthropic, without making either field required', () => {
    expect(sanitise(MCP_SCHEMAS.rootUnion as JsonSchema, 'anthropic')).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' } },
    });
  });

  it('leaves everything else as the server sent it for permissive providers', () => {
    const { $schema: _schema, ...rest } = MCP_SCHEMAS.notionCreatePages as JsonSchema;
    expect(sanitise(MCP_SCHEMAS.notionCreatePages as JsonSchema, 'permissive')).toEqual(rest);
  });

  it('reduces a union to its first choice in the strict fallback', () => {
    const out = sanitise(MCP_SCHEMAS.notionCreatePages as JsonSchema, 'strict');
    expect(out.properties).toMatchObject({
      parent: {
        type: 'object',
        properties: { page_id: { type: 'string', description: 'Format: uuid.' } },
      },
    });
  });

  it('stays bounded on a schema built to blow up', () => {
    const defs: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++)
      defs[`D${i}`] = {
        type: 'object',
        properties: { a: { $ref: `#/$defs/D${i + 1}` }, b: { $ref: `#/$defs/D${i + 1}` } },
      };
    const bomb = { type: 'object', properties: { root: { $ref: '#/$defs/D0' } }, $defs: defs };
    for (const family of families) {
      const out = JSON.stringify(sanitise(bomb, family));
      expect(out.length).toBeLessThan(2_000_000);
    }
  });

  describe('Conch’s own tools', () => {
    const tools = conchTools();

    it('builds a good number of them to check', () => {
      expect(tools.length).toBeGreaterThan(30);
    });

    it.each(families)('reads every one of them in the %s dialect', (family) => {
      for (const tool of tools) {
        const out = sanitise(toJsonSchema(tool.input), family);
        expect(out.type).toBe('object');
        if (family === 'gemini' || family === 'strict')
          expect({ tool: tool.name, problems: problems(out, family) }).toEqual({
            tool: tool.name,
            problems: [],
          });
      }
    });
  });
});
