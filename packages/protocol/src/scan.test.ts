import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { notDone } from './activity-describe/words';
import { fromBase64 } from './dashboards';
import { clipHeadline } from './memory';
import { afterSpace, isSpaceChar, trimEndWhere } from './scan';
import { withoutRecommended } from './switching';

/**
 * The linear scans that replaced slow regular expressions (CodeQL
 * js/polynomial-redos, October 2026): each held to the expression it stands
 * for, on every short string over the characters that matter and on random
 * ones (fast-check), and timed on the long near misses that made the
 * expression slow.
 */

/** Every string up to `max` long over `alphabet`. */
function* strings(alphabet: readonly string[], max: number): Generator<string> {
  let level = [''];
  yield '';
  for (let n = 1; n <= max; n++) {
    const next: string[] = [];
    for (const s of level) for (const ch of alphabet) next.push(s + ch);
    yield* next;
    level = next;
  }
}

/** Strings mostly of the characters an expression turns on, with any others now and then. */
const near = (alphabet: readonly string[]) =>
  fc.string({
    unit: fc.oneof(
      { weight: 9, arbitrary: fc.constantFrom(...alphabet) },
      { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 1, unit: 'binary' }) },
    ),
    maxLength: 40,
  });

/** The old expressions, kept here as the reference. */
const OLD = {
  bearer: (s: string) => /^Bearer\s+(.+)$/i.exec(s)?.[1],
  couldnt: (s: string) => /^Couldn[’']t\s+(.+)$/.exec(s)?.[1],
  headline: (s: string) => s.replace(/[\s,.;:–—-]+$/u, ''),
  padding: (s: string) => s.replace(/=+$/, ''),
  recommended: (s: string) => s.replace(/\s*\(recommended\)\s*$/i, '').trim(),
};

const headlineEnd = (ch: string) => isSpaceChar(ch) || ',.;:–—-'.includes(ch);

describe('linear scans agree with the expressions they replaced', () => {
  const spaces = [' ', '\t', '\n', '\r', ' ', ' ', '﻿'];

  it('afterSpace is `/^prefix\\s+(.+)$/`, on every short string', () => {
    for (const tail of strings([...spaces.slice(0, 5), 'x', '.'], 6)) {
      for (const head of ['Bearer', 'bEaReR', 'Bear', 'Bearerx', '']) {
        const text = head + tail;
        expect(afterSpace(text, 'Bearer', true), JSON.stringify(text)).toBe(OLD.bearer(text));
      }
      for (const head of ['Couldn’t', "Couldn't", 'couldn’t', 'Couldnt']) {
        const text = head + tail;
        expect(afterSpace(text, ['Couldn’t', "Couldn't"]), JSON.stringify(text)).toBe(
          OLD.couldnt(text),
        );
      }
    }
  });

  it('afterSpace is `/^prefix\\s+(.+)$/`, on random strings (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Bearer', 'BEARER', 'Bear'),
        near([...spaces, 'a', 'Z']),
        (h, t) => {
          expect(afterSpace(h + t, 'Bearer', true)).toBe(OLD.bearer(h + t));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('trimEndWhere is `/[…]+$/` (headlines, base64 padding), on random strings (property)', () => {
    fc.assert(
      fc.property(near([' ', '\t', ',', '.', ';', ':', '–', '—', '-', 'a', '　']), (s) => {
        expect(trimEndWhere(s, headlineEnd)).toBe(OLD.headline(s));
      }),
      { numRuns: 3000 },
    );
    fc.assert(
      fc.property(near(['=', 'A', '-', '_']), (s) => {
        expect(trimEndWhere(s, (ch) => ch === '=')).toBe(OLD.padding(s));
      }),
      { numRuns: 2000 },
    );
  });

  it('withoutRecommended is the old `(recommended)` strip, on every short ending', () => {
    for (const around of strings([' ', '\t', 'x'], 4))
      for (const word of ['(recommended)', '(Recommended)', '(RECOMMENDED)', 'recommended)', '']) {
        const label = `Opus${around}${word}${around.split('').reverse().join('')}`;
        expect(withoutRecommended(label), JSON.stringify(label)).toBe(OLD.recommended(label));
      }
    fc.assert(
      fc.property(near([' ', '\t', 'x', '(recommended)', '(RECOMMENDED)', 'İ']), (s) => {
        expect(withoutRecommended(s)).toBe(OLD.recommended(s));
      }),
      { numRuns: 2000 },
    );
  });

  it('notDone still says what didn’t happen', () => {
    expect(notDone({ doing: 'x', done: 'x', tried: 'Couldn’t send the email' })).toBe(
      'Didn’t send the email',
    );
    expect(notDone({ doing: 'x', done: 'x', tried: "Couldn't  run tests" })).toBe(
      'Didn’t run tests',
    );
  });
});

describe('linear scans stay fast on what made the expressions slow', () => {
  const quick = (run: () => unknown) => {
    const began = Date.now();
    run();
    expect(Date.now() - began).toBeLessThan(1000);
  };

  it('a header or a failure of spaces that ends in a line break', () => {
    const spaces = ' \t'.repeat(100_000);
    quick(() => expect(afterSpace(`Bearer ${spaces}\n`, 'Bearer', true)).toBeUndefined());
    quick(() =>
      expect(notDone({ doing: 'x', done: 'Done', tried: `Couldn’t ${spaces}\n` })).toBe(
        'Didn’t go ahead: done',
      ),
    );
  });

  it('a headline of punctuation with a word after it', () => {
    quick(() => expect(clipHeadline(`${',\t'.repeat(100_000)}x`).length).toBeLessThanOrEqual(80));
  });

  it('base64 with a long run of padding in the middle', () => {
    quick(() => expect(fromBase64(`${'='.repeat(200_000)}A`)).toBeUndefined());
  });

  it('a model name of spaces', () => {
    quick(() =>
      expect(withoutRecommended(`Opus${' '.repeat(200_000)}x`)).toBe(`Opus${' '.repeat(200_000)}x`),
    );
  });

  it('never throws, whatever the text (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        afterSpace(s, ['Couldn’t', "Couldn't"]);
        trimEndWhere(s, headlineEnd);
        clipHeadline(s);
        fromBase64(s);
        withoutRecommended(s);
      }),
      { numRuns: 1000 },
    );
  });
});
