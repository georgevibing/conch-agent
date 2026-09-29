import { describe, expect, it } from 'vitest';

import { excerpt, findRanges, flatten, foldText, parseQuery } from './search';

describe('search text helpers', () => {
  it('folds case and accents without changing length', () => {
    const text = 'Crème Brûlée İstanbul ÅSA';
    const folded = foldText(text);
    expect(folded).toHaveLength(text.length);
    expect(folded).toContain('creme brulee');
    expect(folded).toContain('asa');
  });

  it('parses words and quoted phrases, dropping redundant terms', () => {
    expect(parseQuery('  Quick "brown  fox" quick qu ')).toEqual(['brown fox', 'quick']);
    expect(parseQuery('"unterminated phrase')).toEqual(['unterminated phrase']);
    expect(parseQuery('   ')).toEqual([]);
  });

  it('finds and merges ranges', () => {
    const text = foldText('Deploy the deployment, then deploy again');
    expect(findRanges(text, ['deploy'])).toEqual([
      [0, 6],
      [11, 17],
      [28, 34],
    ]);
    expect(findRanges('abcd', ['abc', 'bcd'])).toEqual([[0, 4]]);
  });

  it('flattens whitespace and keeps ranges on the same characters', () => {
    const src = '  one\n\n  two   three';
    const out = flatten(src, [
      [9, 12],
      [15, 20],
    ]);
    expect(out.text).toBe('one two three');
    expect(out.ranges.map(([s, e]) => out.text.slice(s, e))).toEqual(['two', 'three']);
  });

  it('excerpts around the densest cluster of matches', () => {
    const src = `${'lorem ipsum dolor '.repeat(20)}the needle is here, needle again ${'sit amet '.repeat(30)}`;
    const folded = foldText(src);
    const out = excerpt(src, findRanges(folded, ['needle']), 80);
    expect(out.text.startsWith('…')).toBe(true);
    expect(out.text.endsWith('…')).toBe(true);
    expect(out.ranges).toHaveLength(2);
    for (const [s, e] of out.ranges) expect(out.text.slice(s, e)).toBe('needle');
    expect(out.text.length).toBeLessThanOrEqual(82);
  });

  it('returns short text whole', () => {
    const out = excerpt('Hello  world', [[7, 12]]);
    expect(out).toMatchObject({ text: 'Hello world', ranges: [[6, 11]], clippedStart: false });
  });
});
