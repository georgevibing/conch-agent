import { MemoryKind } from '@conch/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { HostTool } from '../types';
import { bridgedSchema, hostToolSpec, toJsonSchema, wireName } from './jsonschema';

describe('tool arguments as JSON Schema', () => {
  it('converts the shapes Conch’s own tools use', () => {
    const schema = toJsonSchema({
      content: z.string().min(1).max(500).describe('One durable fact'),
      kind: MemoryKind.optional(),
      count: z.number().int().min(1).max(31),
      enabled: z.boolean(),
      note: z.string().optional(),
    });

    expect(schema).toEqual({
      type: 'object',
      properties: {
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'One durable fact',
        },
        kind: { type: 'string', enum: ['fact', 'preference', 'project', 'person'] },
        count: { type: 'integer', minimum: 1, maximum: 31 },
        enabled: { type: 'boolean' },
        note: { type: 'string' },
      },
      required: ['content', 'count', 'enabled'],
    });
  });

  it('treats a field with a default as optional for the caller', () => {
    const schema = toJsonSchema({ kind: MemoryKind.default('fact') });
    expect(schema['required']).toBeUndefined();
  });

  it('keeps the document metadata out', () => {
    expect(toJsonSchema({ a: z.string() })['$schema']).toBeUndefined();
  });

  it('always describes an object, even for a tool with no arguments', () => {
    expect(toJsonSchema({})).toEqual({ type: 'object', properties: {} });
  });

  it('survives a type JSON Schema can’t express', () => {
    const schema = toJsonSchema({ when: z.date() });
    expect(schema['type']).toBe('object');
    expect(schema['properties']).toHaveProperty('when');
  });

  it('names a host tool the way native engines do', () => {
    const tool: HostTool = {
      name: 'remember',
      description: 'Save one durable fact.',
      input: { content: z.string() },
      run: async () => 'Saved.',
    };
    expect(hostToolSpec(tool, 'mcp__conch__remember')).toEqual({
      name: 'mcp__conch__remember',
      description: 'Save one durable fact.',
      schema: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
    });
  });
});

describe('wire-safe tool names', () => {
  it('leaves an acceptable name alone', () => {
    expect(wireName('mcp__notion__search', new Set())).toBe('mcp__notion__search');
  });

  it('replaces characters providers reject and keeps the length legal', () => {
    const name = wireName(`mcp__home.assistant__${'x'.repeat(80)}`, new Set());
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(name.startsWith('mcp__home_assistant__')).toBe(true);
  });

  it('never hands out the same name twice', () => {
    const taken = new Set(['search']);
    const name = wireName('search', taken);
    expect(name).toBe('search_2');
  });
});

describe('an integration’s own schema', () => {
  it('is used as-is when it really is an object schema', () => {
    expect(
      bridgedSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      }),
    ).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });

  it('falls back to "no arguments" for anything else', () => {
    expect(bridgedSchema({ type: 'string' })).toEqual({ type: 'object', properties: {} });
  });
});
