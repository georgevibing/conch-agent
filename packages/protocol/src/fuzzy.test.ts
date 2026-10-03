import { describe, expect, it } from 'vitest';

import { fuzzyFilter, fuzzyMatch } from './fuzzy';

const hl = (text: string, q: string) =>
  fuzzyMatch(text, q)?.ranges.map(([s, e]) => text.slice(s, e));

describe('fuzzyMatch', () => {
  it('prefers word-start substrings and highlights them', () => {
    expect(hl('Airplane plan', 'plan')).toEqual(['plan']);
    expect(fuzzyMatch('Airplane plan', 'plan')?.ranges).toEqual([[9, 13]]);
  });

  it('matches acronyms and subsequences, any token order', () => {
    expect(hl('Plan my week', 'pmw')).toEqual(['P', 'm', 'w']);
    expect(fuzzyMatch('Plan my week', 'week plan')).not.toBeNull();
    expect(fuzzyMatch('Plan my week', 'xyz')).toBeNull();
  });

  it('ignores case and accents', () => {
    expect(hl('Café in Zürich', 'zurich')).toEqual(['Zürich']);
  });

  it('rejects scattered subsequences', () => {
    expect(fuzzyMatch('a long title about basically nothing important', 'atn')).toBeNull();
  });

  it('ranks better matches first', () => {
    const titles = ['Unplanned outage', 'Plan my week', 'Trip planning', 'Weekly review'];
    expect(fuzzyFilter(titles, 'plan', (t) => t).map((r) => r.item)).toEqual([
      'Plan my week',
      'Trip planning',
      'Unplanned outage',
    ]);
  });
});
