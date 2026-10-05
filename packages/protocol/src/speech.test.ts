import { describe, expect, it } from 'vitest';

import { sentences } from './speech';

describe('spoken sentences', () => {
  it('keeps sentence punctuation and closing quotes together', () => {
    expect(sentences('“Ready?!” Yes… (All done.) Last line')).toEqual([
      '“Ready?!”',
      'Yes…',
      '(All done.)',
      'Last line',
    ]);
    expect(sentences('')).toEqual([]);
    expect(sentences('...')).toEqual(['...']);
  });

  it('finishes long whitespace runs at punctuation and end of input', () => {
    const spaces = ' '.repeat(1_000_000);
    const began = Date.now();
    expect(sentences(spaces)).toEqual([]);
    expect(sentences(`${spaces}!`)).toEqual(['!']);
    expect(sentences(`${spaces}\n`)).toEqual([]);
    expect(sentences(`${spaces}." Next`)).toEqual(['."', 'Next']);
    expect(Date.now() - began).toBeLessThan(1000);
  });
});
