import { describe, expect, it } from 'vitest';

import { repairJson } from './repair';

const value = (text: string) => repairJson(text)?.value;

describe('mending almost-JSON arguments', () => {
  it('leaves valid JSON exactly as it is, with nothing mended', () => {
    expect(repairJson('{"a": [1, "x", null, true]}')).toEqual({
      value: { a: [1, 'x', null, true] },
      rest: [],
      fixes: [],
    });
  });

  it.each([
    ['a trailing comma', '{"query": "tea", "limit": 3,}', { query: 'tea', limit: 3 }],
    ['a trailing comma in a list', '{"tags": ["a", "b",]}', { tags: ['a', 'b'] }],
    ['single quotes', "{'query': 'tea for two'}", { query: 'tea for two' }],
    ['an escaped quote inside single quotes', "{'q': 'it\\'s'}", { q: "it's" }],
    ['keys without quotes', '{query: "tea", limit: 2}', { query: 'tea', limit: 2 }],
    ['Python literals', '{"a": True, "b": False, "c": None}', { a: true, b: false, c: null }],
    ['an unclosed brace', '{"query": "tea", "limit": 2', { query: 'tea', limit: 2 }],
    ['an unclosed string and brace', '{"query": "tea', { query: 'tea' }],
    ['nested unclosed', '{"a": {"b": [1, 2', { a: { b: [1, 2] } }],
    ['a missing comma', '{"a": 1 "b": 2}', { a: 1, b: 2 }],
    ['a raw line break in a string', '{"text": "one\ntwo"}', { text: 'one\ntwo' }],
    ['comments', '{"a": 1, // the count\n "b": 2 /* more */}', { a: 1, b: 2 }],
    ['a key without a value', '{"a": 1, "b":}', { a: 1, b: null }],
  ])('mends %s', (_what, text, expected) => {
    expect(value(text)).toEqual(expected);
    expect(repairJson(text)?.fixes.length).toBeGreaterThan(0);
  });

  it('reads the JSON inside a markdown fence', () => {
    expect(value('```json\n{"query": "tea"}\n```')).toEqual({ query: 'tea' });
    expect(value('Here you go:\n```\n{"query": "tea",}\n```\nDone.')).toEqual({ query: 'tea' });
    expect(value('```json\n{"query": "tea"')).toEqual({ query: 'tea' });
  });

  it('skips words before the arguments and after them', () => {
    const read = repairJson('Sure! {"query": "tea"} Let me know.');
    expect(read?.value).toEqual({ query: 'tea' });
    expect(read?.fixes).toContain('words before the arguments');
  });

  it('reads objects run together as several values', () => {
    expect(repairJson('{"a": 1}{"b": 2}')).toMatchObject({ value: { a: 1 }, rest: [{ b: 2 }] });
    expect(repairJson('{"a": 1}\n{"a": 2}')).toMatchObject({ value: { a: 1 }, rest: [{ a: 2 }] });
    expect(repairJson('{"a": 1},{"a": 2}')).toMatchObject({ value: { a: 1 }, rest: [{ a: 2 }] });
  });

  it('gives up on what isn’t JSON at all', () => {
    expect(repairJson('')).toBeUndefined();
    expect(repairJson('just some words')).toBeUndefined();
    expect(repairJson('{@}')).toBeUndefined();
  });

  describe('abuse', () => {
    it('keeps __proto__ an ordinary key, never a prototype', () => {
      const read = repairJson("{'__proto__': {'polluted': true}, a: 1,}");
      const out = read?.value as Record<string, unknown>;
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(Object.hasOwn(out, '__proto__')).toBe(true);
    });

    it('refuses nesting deeper than any tool takes, without overflowing the stack', () => {
      const deep = '['.repeat(100_000);
      expect(() => repairJson(deep)).not.toThrow();
      expect(repairJson(deep)).toBeUndefined();
    });

    it('refuses text far longer than any arguments', () => {
      expect(repairJson(`{"a": "${'x'.repeat(1_100_000)}"`)).toBeUndefined();
    });

    it('never evaluates anything', () => {
      expect(value('{"a": process.exit(1)}')).toBeUndefined();
      expect(value('{"a": NaN}')).toEqual({ a: 'NaN' });
      expect(value('{"a": 1e999')).toBeUndefined();
    });

    it('reads a bounded number of values run together', () => {
      const read = repairJson('{}'.repeat(10_000));
      expect(read?.rest.length).toBeLessThan(20);
    });
  });
});
