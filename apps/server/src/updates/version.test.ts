import { describe, expect, it } from 'vitest';

import { firstLook, lookDue, MINUTE, nextLook, overnight, DAY, HOUR } from './schedule';
import { compareVersions, isNewer, parseVersion, shortVersion } from './version';
import { humanise, whatsNew } from './whatsnew';

describe('reading versions', () => {
  it('finds the version however a program prints it', () => {
    expect(parseVersion('2.1.284 (Claude Code)')).toBe('2.1.284');
    expect(parseVersion('codex-cli 0.46.0')).toBe('0.46.0');
    expect(parseVersion('uv 0.8.3 (7e2a3c9 2025-07-24)')).toBe('0.8.3');
    expect(parseVersion('Docker version 27.3.1, build ce12230')).toBe('27.3.1');
    expect(parseVersion('v24.21.0')).toBe('24.21.0');
    expect(parseVersion('1.0.0-beta.2+build.5')).toBe('1.0.0-beta.2');
    expect(parseVersion('winget 1.29.380.0')).toBe('1.29.380.0');
    expect(parseVersion('a dev build')).toBeUndefined();
  });

  it('compares part by part, and a pre-release comes before its release', () => {
    expect(compareVersions('0.160.0', '0.159.2')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });

  it('only calls it an update when the newest one is really newer', () => {
    expect(isNewer('0.160.0', '0.159.0')).toBe(true);
    expect(isNewer('0.159.0', '0.159.0')).toBe(false);
    // A copy ahead of the registry (a preview build) is not "behind".
    expect(isNewer('0.159.0', '0.160.0-alpha.1')).toBe(false);
    expect(isNewer(undefined, '1.0.0')).toBe(false);
  });

  it('shortens a round version for sentences', () => {
    expect(shortVersion('0.160.0')).toBe('0.160');
    expect(shortVersion('2.1.284')).toBe('2.1.284');
    expect(shortVersion('1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });
});

describe('what’s new, in plain words', () => {
  it('turns commit subjects into sentences, and leaves housekeeping out', () => {
    expect(humanise('feat(web): attach files to a message (#412)')).toBe(
      'Attach files to a message',
    );
    expect(humanise('fix!: never lose a draft.')).toBe('Never lose a draft');
    expect(humanise('perf(search): `FTS5` answers in half the time')).toBe(
      'FTS5 answers in half the time',
    );
    expect(humanise('A plain subject line')).toBe('A plain subject line');
    for (const noise of [
      'chore: bump deps',
      'test(e2e): wait for it',
      'docs: ADR 0019',
      'ci: cache pnpm',
      'build(deps): bump vite',
      'refactor: tidy',
      "Merge branch 'feat/x'",
      'fixup! feat: x',
    ])
      expect(humanise(noise)).toBeUndefined();
  });

  it('keeps each change once, newest first', () => {
    expect(whatsNew(['feat: one', 'chore: x', 'fix: One', 'feat: two'])).toEqual(['One', 'Two']);
  });
});

describe('when Conch looks', () => {
  const start = Date.UTC(2026, 8, 30, 10);

  it('never looks in the first minute after starting, then spreads out', () => {
    expect(firstLook(start, () => 0)).toBe(start + MINUTE);
    expect(firstLook(start, () => 0.999)).toBeLessThan(start + 11 * MINUTE);
    const earliest = firstLook(start, () => 0.5);
    expect(lookDue(start + 30_000, earliest, undefined)).toBe(false);
    expect(lookDue(earliest, earliest, undefined)).toBe(true);
  });

  it('looks again about a day later, never on the dot', () => {
    expect(nextLook(start, () => 0)).toBe(start + DAY - HOUR);
    expect(nextLook(start, () => 1)).toBe(start + DAY + HOUR);
    const next = nextLook(start, () => 0.5);
    expect(lookDue(next - 1, start, next)).toBe(false);
    expect(lookDue(next, start, next)).toBe(true);
    // A restart doesn't bring the next look forward.
    expect(
      lookDue(
        start + 2 * MINUTE,
        firstLook(start, () => 0),
        next,
      ),
    ).toBe(false);
  });

  it('installs by itself only at night', () => {
    const at = (hour: number) => new Date(2026, 8, 30, hour, 15).getTime();
    expect(overnight(at(1))).toBe(false);
    expect(overnight(at(2))).toBe(true);
    expect(overnight(at(4))).toBe(true);
    expect(overnight(at(5))).toBe(false);
    expect(overnight(at(14))).toBe(false);
  });
});
