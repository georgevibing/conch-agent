import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toJsonSchema } from '../api/jsonschema';
import type { HostTool } from '../types';
import {
  checkBridgedArgs,
  checkHostArgs,
  lenientShape,
  normaliseArgs,
  readArgs,
  signature,
  withNotes,
} from './args';

const search: Pick<HostTool, 'name' | 'input'> = {
  name: 'search_mail',
  input: {
    query: z.string().min(1).describe('What to look for'),
    limit: z.number().int().min(1).max(50).optional(),
    unread: z.boolean().optional(),
    order: z.enum(['newest', 'oldest']).default('newest'),
    labels: z.array(z.string()).optional(),
    window: z.object({ from: z.string(), days: z.number().int() }).optional(),
  },
};

const ok = (result: ReturnType<typeof checkHostArgs>) => {
  if (!result.ok) throw new Error(result.message);
  return result;
};

describe('reading arguments', () => {
  it('reads JSON, and mends almost-JSON', () => {
    expect(readArgs('{"query": "tea"}')).toEqual({ args: { query: 'tea' }, notes: [] });
    expect(readArgs("{'query': 'tea',}")).toEqual({ args: { query: 'tea' }, notes: [] });
    expect(readArgs('')).toEqual({ args: {}, notes: [] });
  });

  it('reads arguments that arrived as a JSON string', () => {
    expect(readArgs(JSON.stringify(JSON.stringify({ query: 'tea' })))).toEqual({
      args: { query: 'tea' },
      notes: [],
    });
  });

  it('joins the pieces of one call, and keeps only the first of several', () => {
    expect(readArgs('{"path": "a.txt"}{"content": "hi"}')).toEqual({
      args: { path: 'a.txt', content: 'hi' },
      notes: [],
    });
    expect(readArgs('{"query": "tea"}{"query": "tea"}')).toEqual({
      args: { query: 'tea' },
      notes: [],
    });
    const several = readArgs('{"query": "tea"}{"query": "coffee"}');
    expect(several).toMatchObject({ args: { query: 'tea' } });
    expect('notes' in several && several.notes[0]).toMatch(/only the first was used/);
  });

  it('says where JSON stopped making sense, and what to send instead', () => {
    const read = readArgs('query = tea please');
    expect(read).toHaveProperty('problem');
    expect('problem' in read && read.problem).toMatch(/one JSON object/);
    expect(readArgs('[1, 2]')).toMatchObject({ problem: expect.stringMatching(/not a list/) });
  });
});

describe('normalising arguments against the tool’s own schema', () => {
  it('turns numbers and booleans written as text into what the schema wants', () => {
    const { args } = ok(checkHostArgs(search, { query: 'tea', limit: '5', unread: 'TRUE' }));
    expect(args).toEqual({ query: 'tea', limit: 5, unread: true, order: 'newest' });
  });

  it('reads lists and objects sent as JSON text, and a single value as a list of one', () => {
    const { args } = ok(
      checkHostArgs(search, {
        query: 'tea',
        labels: '["work", "home"]',
        window: '{"from": "2026-10-01", "days": "7"}',
      }),
    );
    expect(args).toMatchObject({
      labels: ['work', 'home'],
      window: { from: '2026-10-01', days: 7 },
    });
    expect(ok(checkHostArgs(search, { query: 'tea', labels: 'work' })).args.labels).toEqual([
      'work',
    ]);
  });

  it('fixes an option written in another case, only when one option matches', () => {
    expect(ok(checkHostArgs(search, { query: 'tea', order: 'Oldest' })).args.order).toBe('oldest');
  });

  it('drops fields the tool doesn’t take and tells the model', () => {
    const result = ok(
      checkHostArgs(search, { query: 'tea', limt: 5, window: { from: 'x', days: 1, tz: 'UTC' } }),
    );
    expect(result.args).not.toHaveProperty('limt');
    expect(result.args.window).toEqual({ from: 'x', days: 1 });
    expect(result.notes).toEqual(['Ignored fields this tool doesn’t take: limt, window.tz.']);
    expect(withNotes('Found 3.', result.notes)).toBe(
      'Found 3.\n\n[Ignored fields this tool doesn’t take: limt, window.tz.]',
    );
  });

  it('unwraps an {"arguments": …} envelope the tool doesn’t take', () => {
    expect(ok(checkHostArgs(search, { arguments: { query: 'tea' } })).args.query).toBe('tea');
    expect(ok(checkHostArgs(search, { input: '{"query": "tea"}' })).args.query).toBe('tea');
  });

  it('reads arguments given as text', () => {
    expect(ok(checkHostArgs(search, "{'query': 'tea', limit: '2'}")).args).toMatchObject({
      limit: 2,
    });
  });
});

describe('precise errors', () => {
  it('names each field, what was wanted, what came, and the valid values', () => {
    const result = checkHostArgs(search, { limit: 'ten', order: 'random', unread: 'maybe' });
    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.message;
    expect(message).toContain(
      'The arguments for search_mail don’t fit. Fix these and call it again:',
    );
    expect(message).toContain('- query: required (text), but it was missing.');
    expect(message).toContain('- limit: expected a number, got the text "ten".');
    expect(message).toContain('- order: must be one of "newest", "oldest"; got the text "random".');
    expect(message).toContain('- unread: expected true or false, got the text "maybe".');
    expect(message).toContain(
      'It takes: {query: string, limit?: integer, unread?: boolean, order?: "newest"|"oldest", labels?: string[], window?: {from: string, days: integer}}',
    );
  });

  it('says the bounds a value broke', () => {
    const result = checkHostArgs(search, { query: 'tea', limit: 500 });
    expect(result.ok ? '' : result.message).toContain(
      '- limit: must be at most 50; got the number 500.',
    );
  });

  it('keeps a tool’s own words for a value in the wrong form', () => {
    const tool = {
      name: 'click',
      input: {
        ref: z.string().regex(/^[a-z0-9]{1,16}$/i, 'Use a ref from the page text, like e12.'),
      },
    };
    const result = checkHostArgs(tool, { ref: 'the blue button' });
    expect(result.ok ? '' : result.message).toMatch(
      /- ref: .*Use a ref from the page text, like e12\./,
    );
  });

  it('includes what was ignored, since it may be a misspelt required field', () => {
    const result = checkHostArgs(search, { qeury: 'tea' });
    expect(result.ok ? '' : result.message).toContain(
      'Ignored a field this tool doesn’t take: qeury.',
    );
  });

  it('writes a short signature for what a tool takes', () => {
    expect(signature(toJsonSchema({ a: z.string(), b: z.array(z.number()).optional() }))).toBe(
      '{a: string, b?: number[]}',
    );
  });
});

describe('an integration’s tool', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      priority: { type: 'integer', enum: [0, 1, 2, 3, 4] },
      done: { type: 'boolean' },
      team: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['title'],
  };

  it('normalises and keeps fields the server may take', () => {
    const result = checkBridgedArgs('linear_create', schema, {
      title: 'Bug',
      priority: '2',
      done: 'false',
      extra: 1,
    });
    expect(result).toEqual({
      ok: true,
      args: { title: 'Bug', priority: 2, done: false, extra: 1 },
      notes: [],
    });
  });

  it('drops unknown fields only when the schema closes the object', () => {
    const closed = { ...schema, additionalProperties: false };
    const result = checkBridgedArgs('linear_create', closed, { title: 'Bug', extra: 1 });
    expect(result).toMatchObject({ ok: true, args: { title: 'Bug' } });
  });

  it('catches the plain mistakes and leaves the rest to the server', () => {
    const result = checkBridgedArgs('linear_create', schema, { priority: 9, done: 'perhaps' });
    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.message;
    expect(message).toContain('- title: required (text), but it was missing.');
    expect(message).toContain('- priority: must be one of 0, 1, 2, 3, 4; got the number 9.');
    expect(message).toContain('- done: expected true or false, got the text "perhaps".');
    // A union isn't judged here.
    expect(checkBridgedArgs('x', schema, { title: 'a', team: 5 }).ok).toBe(true);
  });
});

describe('abuse: forgiving input never widens what a call may do', () => {
  const danger: Pick<HostTool, 'name' | 'input'> = {
    name: 'delete_files',
    input: {
      path: z.string(),
      dryRun: z.boolean(),
      confirm: z.literal(false).optional(),
      mode: z.enum(['trash', 'keep']).optional(),
    },
  };

  it('never reads "false" as true, or a word as a boolean', () => {
    expect(ok(checkHostArgs(danger, { path: 'a', dryRun: 'false' })).args.dryRun).toBe(false);
    for (const word of ['yes', '1', 'no', 'off', '', 'True ish'])
      expect(checkHostArgs(danger, { path: 'a', dryRun: word }).ok).toBe(false);
  });

  it('never lets an unknown field reach the tool, at any depth', () => {
    const result = ok(checkHostArgs(danger, { path: 'a', dryRun: true, force: true, sudo: true }));
    expect(Object.keys(result.args).sort()).toEqual(['dryRun', 'path']);
  });

  it('never touches a prototype through __proto__ or constructor', () => {
    const raw =
      '{"path": "a", "dryRun": true, "__proto__": {"admin": true}, "constructor": {"prototype": {"admin": true}}}';
    const result = ok(checkHostArgs(danger, raw));
    expect(Object.getPrototypeOf(result.args)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
    expect(Object.keys(result.args).sort()).toEqual(['dryRun', 'path']);
  });

  it('never rewrites text, only reads its type', () => {
    expect(ok(checkHostArgs(danger, { path: ' ../../etc/passwd ', dryRun: true })).args.path).toBe(
      ' ../../etc/passwd ',
    );
    // A number for text is the same characters.
    expect(ok(checkHostArgs(danger, { path: 42, dryRun: true })).args.path).toBe('42');
  });

  it('never picks an option when the case matches more than one', () => {
    const tool = { name: 't', input: { level: z.enum(['Admin', 'admin']).optional() } };
    expect(checkHostArgs(tool, { level: 'ADMIN' }).ok).toBe(false);
  });

  it('never guesses an option from a near miss', () => {
    expect(checkHostArgs(danger, { path: 'a', dryRun: true, mode: 'trsh' }).ok).toBe(false);
  });

  it('never reads a hex, infinite or padded-word number', () => {
    const tool = { name: 't', input: { n: z.number() } };
    for (const text of ['0x10', 'Infinity', '1e999', '12abc', ''])
      expect(checkHostArgs(tool, { n: text }).ok).toBe(false);
  });

  it('never unwraps an envelope the tool really takes', () => {
    const tool = { name: 't', input: { input: z.string() } };
    expect(ok(checkHostArgs(tool, { input: '{"x": 1}' })).args).toEqual({ input: '{"x": 1}' });
  });

  it('leaves deep arguments alone rather than recursing without end', () => {
    let deep: Record<string, unknown> = { a: 1 };
    for (let i = 0; i < 5_000; i++) deep = { n: deep };
    const schema = { type: 'object', properties: { n: { type: 'object', properties: {} } } };
    expect(() => normaliseArgs(schema, deep, { dropUnknown: false })).not.toThrow();
  });
});

describe('Claude Code’s in-process tools', () => {
  it('advertises exactly the same schema while accepting anything for Conch to check', () => {
    const lenient = lenientShape(search.input);
    expect(toJsonSchema(lenient)).toEqual(toJsonSchema(search.input));
    expect(z.object(lenient).safeParse({ limit: 'ten' }).success).toBe(true);
  });

  it('keeps a field’s own validation when its schema can’t be copied', () => {
    const node: z.ZodType = z.lazy(() => z.object({ child: node.optional() }));
    const shape = { tree: node };
    expect(lenientShape(shape).tree).toBe(node);
  });
});
