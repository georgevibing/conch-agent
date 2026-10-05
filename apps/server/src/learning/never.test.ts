import type { NeverItem } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Embedder } from '../memory/embed';
import { neverMatch } from './never';

const item = (text: string): NeverItem => ({ id: `nv_${text.length}`, text, at: 1, from: 'undo' });

/** A pretend model for meaning: these pairs mean the same, everything else doesn't. */
function meaning(close: [string, string][], same = 0.5): Embedder {
  const index = new Map<string, number>();
  close.forEach(([a, b], i) => {
    index.set(a, i);
    index.set(b, i);
  });
  return {
    id: 'test',
    source: 'built-in',
    label: 'test',
    floor: 0.3,
    same,
    async embed(texts) {
      return texts.map((t, n) => {
        const v = new Float32Array(64);
        v[index.get(t) ?? 32 + (n % 32)] = 1;
        return v;
      });
    },
  } as Embedder;
}

describe('never learned again (ADR 0088 § 6)', () => {
  it('the same words, or nearly', async () => {
    const list = [item('Likes dark mode')];
    expect(await neverMatch('likes dark mode', list)).toBeDefined();
    expect(await neverMatch('Likes the dark mode', list)).toBeDefined();
    expect(await neverMatch('Drinks tea', list)).toBeUndefined();
  });

  it('never blocks a real change: Berlin to Lisbon', async () => {
    const list = [item('Lives in Berlin')];
    expect(await neverMatch('Lives in Lisbon', list)).toBeUndefined();
    // Even when a model thinks they're close.
    expect(
      await neverMatch('Lives in Lisbon', list, meaning([['Lives in Berlin', 'Lives in Lisbon']])),
    ).toBeUndefined();
  });

  it('meaning confirms a looser match in words', async () => {
    // Stems in common: 0.4, close enough to ask, not enough by themselves.
    const list = [item('Prefers short replies in the morning')];
    const said = 'Prefers short answers';
    const model = meaning([['Prefers short replies in the morning', said]]);
    expect(await neverMatch(said, list)).toBeUndefined();
    expect(await neverMatch(said, list, model)).toBeDefined();
    expect(await neverMatch(said, list, meaning([]))).toBeUndefined();
  });

  it('a model that stops answering leaves it to the words', async () => {
    const broken = {
      ...meaning([]),
      embed: async () => {
        throw new Error('gone');
      },
    } as Embedder;
    expect(
      await neverMatch(
        'Prefers short answers',
        [item('Prefers short replies in the morning')],
        broken,
      ),
    ).toBeUndefined();
    expect(await neverMatch('', [item('x')])).toBeUndefined();
    expect(await neverMatch('x', [])).toBeUndefined();
  });
});
