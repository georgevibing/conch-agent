/**
 * The shell and calendar patterns that were exponential (CodeQL js/redos,
 * October 2026), read by index now: held to the old expressions on every short
 * input and on random ones (fast-check), and timed on the near misses that
 * used to hang.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TIME_ZONE } from '../google/writes';
import { commandParts, stripTimeout } from './risk';

const OLD_TIMEOUT =
  /^timeout(?:\s+-(?:s|k)\s*\S+|\s+--(?:signal|kill-after)=\S+|\s+-[\w-]+)*\s+\d+(?:\.\d+)?[smhd]?\s+/i;
const oldTimeout = (text: string) => text.replace(OLD_TIMEOUT, '');

const OLD_TIME_ZONE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9_+-]+)*$/;

/** Every string up to `max` long over `alphabet`. */
function* strings(alphabet: readonly string[], max: number): Generator<string> {
  let level = [''];
  yield '';
  for (let n = 1; n <= max; n++) {
    level = level.flatMap((s) => alphabet.map((ch) => s + ch));
    yield* level;
  }
}

/** The words `timeout` can be followed by, the tricky ones most of all. */
const TIMEOUT_WORDS = [
  '-k',
  '-s',
  '-K',
  '-k-',
  '-kill',
  '-sKILL',
  '-v',
  '--foreground',
  '--signal=KILL',
  '--kill-after=5',
  '--signal=',
  '--SIGNAL=9',
  '-',
  '5',
  '1.5m',
  '10S',
  '2x',
  '.5',
  'KILL',
  'rm',
  '-rf',
  '~',
];
const SPACES = [' ', '  ', '\t', '\n', ' '];

const timeoutLine = fc
  .tuple(
    fc.constantFrom('timeout', 'TIMEOUT', 'timeoutx', 'time'),
    fc.array(fc.tuple(fc.constantFrom(...SPACES), fc.constantFrom(...TIMEOUT_WORDS)), {
      maxLength: 9,
    }),
    fc.constantFrom('', ' ', '\t\n'),
  )
  .map(([head, words, tail]) => head + words.map(([s, w]) => s + w).join('') + tail);

describe('timeout’s words, read by index', () => {
  it('take off what the old expression took off, on every short line', () => {
    const words = ['-k', '-k-', '-s', '--signal=X', '5', 'x', '-v'];
    let lines = ['timeout'];
    for (let n = 0; n < 5; n++) {
      for (const line of lines)
        for (const tail of ['', ' ', ' cmd']) {
          const text = line + tail;
          expect(stripTimeout(text), JSON.stringify(text)).toBe(oldTimeout(text));
        }
      lines = lines.flatMap((l) => words.flatMap((w) => [`${l} ${w}`, `${l}\t ${w}`]));
    }
  });

  it('take off what the old expression took off, on random lines (property)', () => {
    fc.assert(
      fc.property(timeoutLine, (text) => {
        expect(stripTimeout(text)).toBe(oldTimeout(text));
      }),
      { numRuns: 5000 },
    );
  });

  it('are quick on a long run of `-k-` with no duration, which used to hang', () => {
    const began = Date.now();
    const text = `timeout${' -k-'.repeat(50_000)} x`;
    expect(stripTimeout(text)).toBe(text);
    const line = `timeout${' -k-'.repeat(5_000)} x`;
    expect(commandParts(line)).toEqual([line]);
    expect(Date.now() - began).toBeLessThan(2000);
  });

  it('still see the command inside', () => {
    expect(stripTimeout('timeout -k 5 -s KILL 60 rm -rf ~')).toBe('rm -rf ~');
    expect(stripTimeout('timeout --signal=TERM 1.5m  cargo test')).toBe('cargo test');
    expect(stripTimeout('timeout 5')).toBe('timeout 5');
  });
});

describe('a time zone’s shape', () => {
  it('is the same names as before, on every short string', () => {
    for (const s of strings(['A', 'b', '1', '_', '+', '-', '/', '!'], 6))
      expect(TIME_ZONE.test(s), JSON.stringify(s)).toBe(OLD_TIME_ZONE.test(s));
  });

  it('is the same names as before, on random strings (property)', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom('A', 'z', '0', '_', '+', '-', '/', '.', ' '),
          maxLength: 18,
        }),
        (s) => {
          expect(TIME_ZONE.test(s)).toBe(OLD_TIME_ZONE.test(s));
        },
      ),
      { numRuns: 5000 },
    );
    for (const zone of ['Europe/Berlin', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', 'UTC'])
      expect(TIME_ZONE.test(zone)).toBe(true);
  });

  it('is quick on a long near miss, which used to hang', () => {
    const began = Date.now();
    expect(TIME_ZONE.test(`A${'++'.repeat(50_000)}!`)).toBe(false);
    expect(TIME_ZONE.test(`A${'/-'.repeat(50_000)}/`)).toBe(false);
    expect(Date.now() - began).toBeLessThan(1000);
  });
});
