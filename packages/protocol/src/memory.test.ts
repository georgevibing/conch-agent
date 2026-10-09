import { describe, expect, it } from 'vitest';

import { clipHeadline, MEMORY_HEADLINE_MAX, headlineOf, Memory, needsHeadline } from './memory';

const JOUDA =
  'George tracks his wife Jouda’s job search (started July 2026) in a JSON database at ~/.conch/workspace/jouda-report/data/jouda_job_search.json (README.md alongside explains the fields). When George asks to update it, search her mailbox from last_synced onward, merge into the JSON, and optionally regenerate the PDF.';

describe('clipHeadline', () => {
  it('leaves words that are short enough as they are', () => {
    expect(clipHeadline('Prefers TypeScript examples over Python.')).toBe(
      'Prefers TypeScript examples over Python.',
    );
    expect(clipHeadline('  Lives   in Lisbon ')).toBe('Lives in Lisbon');
  });

  it('takes the first clause of something long, without a path', () => {
    expect(clipHeadline(JOUDA)).toBe('George tracks his wife Jouda’s job search');
  });

  it('cuts a clause too long for a line at a whole word, and says so', () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const clipped = clipHeadline(long);
    expect(clipped.length).toBeLessThanOrEqual(MEMORY_HEADLINE_MAX);
    expect(clipped.endsWith('…')).toBe(true);
    expect(long.startsWith(clipped.slice(0, -1))).toBe(true);
    expect(clipped.slice(0, -1)).not.toMatch(/\s$/);
  });

  it('keeps going past a clause too short to say anything', () => {
    const text = `Rule: ${'push conch-agent fixes straight to main and then watch CI until it is green, every time'}`;
    expect(clipHeadline(text).startsWith('Rule: push')).toBe(true);
  });
});

describe('headlineOf', () => {
  it('prefers the headline a small model wrote', () => {
    expect(
      headlineOf({ content: JOUDA, headline: 'Tracks Jouda’s job search in a JSON file' }),
    ).toBe('Tracks Jouda’s job search in a JSON file');
    expect(headlineOf({ content: JOUDA })).toBe(clipHeadline(JOUDA));
  });

  it('asks for one only when the words are longer than a headline', () => {
    expect(needsHeadline('Lives in Lisbon')).toBe(false);
    expect(needsHeadline(JOUDA)).toBe(true);
  });
});

describe('Memory.headline', () => {
  const base = { id: 'm_1', content: JOUDA, source: 'agent', createdAt: 1, updatedAt: 1 };

  it('is optional and additive', () => {
    expect(Memory.parse(base).headline).toBeUndefined();
    expect(Memory.parse({ ...base, headline: 'Tracks Jouda’s job search' }).headline).toBe(
      'Tracks Jouda’s job search',
    );
  });

  it('drops one it can’t take, never the memory', () => {
    const parsed = Memory.parse({ ...base, headline: 'x'.repeat(MEMORY_HEADLINE_MAX + 1) });
    expect(parsed.content).toBe(JOUDA);
    expect(parsed.headline).toBeUndefined();
  });
});
