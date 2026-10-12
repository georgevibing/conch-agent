import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { classify } from '../backup/manifest';
import { protectedPaths, touchesProtected } from '../lib/protect';
import { RECENT_MS, recoveryHistoryCheck, when } from './doctor';
import { saveRecoveryState } from './supervisor-state';

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

it('shows durable recovery in Health without exposing the numeric diagnostics or private content', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-recovery-doctor-'));
  homes.push(home);
  const check = recoveryHistoryCheck(home, () => 1000 + 60_000);
  const options = { repair: false, signal: new AbortController().signal };
  expect(await check.run(options)).toEqual([]);
  saveRecoveryState(home, {
    failures: [1000],
    incidents: [{ at: 1000, reason: 'crash', resource: { gatewayRssBytes: 12345 } }],
  });
  const report = await check.run(options);
  // History, not a problem: nothing to do about it, so never worth a look.
  expect(report).toHaveLength(1);
  expect(report[0]).toMatchObject({ state: 'ok', title: 'Recent recovery' });
  expect(report[0]?.message).toContain('stopped unexpectedly');
  expect(report[0]?.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  expect(report[0]?.message).toContain(when(1000, 61_000));
  expect(JSON.stringify(report)).not.toContain('12345');
  // A week on, it's old news.
  expect(await recoveryHistoryCheck(home, () => 1000 + RECENT_MS + 1).run(options)).toEqual([]);
});

const look = { repair: false, signal: new AbortController().signal };
const HOUR = 60 * 60 * 1000;

async function frozenHome(evidence: Record<string, unknown>[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'conch-recovery-doctor-'));
  homes.push(home);
  await mkdir(join(home, 'recovery/evidence'), { recursive: true });
  for (const one of evidence)
    await writeFile(
      join(home, `recovery/evidence/frozen-${String(one.at)}.json`),
      JSON.stringify({ version: 1, ...one }),
    );
  return home;
}

it('says how often Conch froze this week, and where it was stuck the last time', async () => {
  const now = new Date(2026, 9, 7, 22, 0).getTime();
  const last = new Date(2026, 9, 7, 21, 5).getTime();
  const home = await frozenHome([
    // The last freeze's own evidence, written a moment after it.
    {
      at: last + 1_500,
      where: 'javascript',
      frames: [
        {
          name: 'scan',
          file: 'node_modules/.pnpm/glob@10/node_modules/glob/dist/walk.js',
          line: 9,
        },
        { name: 'readIndex', file: 'apps/server/src/memory/index.ts', line: 120 },
        // Not an allowlisted name, so never read back (`stackOnly`).
        { name: '(anonymous)', file: 'apps/server/src/memory/routes.ts', line: 44 },
        // Outside the release: never read back.
        { name: 'leak', file: '/Users/someone/secret.ts', line: 1 },
        { name: 'handle', file: 'apps/server/src/app.ts', line: 7 },
      ],
    },
    // An older freeze's: never said as the last one's.
    { at: now - 3 * HOUR, where: 'outside-javascript', frames: [] },
  ]);
  saveRecoveryState(home, {
    failures: [],
    incidents: [
      // A week and more ago: not counted.
      { at: now - RECENT_MS - HOUR, reason: 'unresponsive' },
      { at: now - 3 * HOUR, reason: 'unresponsive' },
      { at: last, reason: 'unresponsive', resource: { gatewayRssBytes: 12345 } },
    ],
  });
  const report = await recoveryHistoryCheck(home, () => now).run(look);
  // News, never a problem: Conch already started again.
  expect(report).toEqual([
    {
      id: 'recovery-freezes',
      group: 'This computer',
      title: 'Stopped answering',
      state: 'info',
      message:
        'Conch stopped answering twice in the past week and started again on its own, last at 9:05 PM. It was stuck in readIndex (apps/server/src/memory/index.ts:120), called from handle (apps/server/src/app.ts:7).',
    },
  ]);
  expect(JSON.stringify(report)).not.toMatch(/12345|secret/);
});

it('says a freeze outside Conch’s own code, and says nothing it doesn’t know', async () => {
  const now = new Date(2026, 9, 7, 22, 0).getTime();
  const at = new Date(2026, 9, 6, 8, 30).getTime();
  const waiting = await frozenHome([{ at, where: 'outside-javascript', frames: [] }]);
  saveRecoveryState(waiting, {
    failures: [],
    incidents: [
      { at, reason: 'unresponsive' },
      { at: at + HOUR, reason: 'restart-request' },
    ],
  });
  const report = await recoveryHistoryCheck(waiting, () => now).run(look);
  expect(report.map((item) => item.message)).toEqual([
    'Conch stopped answering once in the past week and started again on its own yesterday at 8:30 AM. It was waiting on this computer rather than running its own code.',
    // What happened after is still said, as before.
    'Conch restarted when asked yesterday at 9:30 AM.',
  ]);

  // No evidence (it was slow, not frozen, or the record is damaged): just the count.
  const bare = await frozenHome([]);
  await writeFile(join(bare, 'recovery/evidence/frozen-1.json'), 'damaged');
  saveRecoveryState(bare, { failures: [], incidents: [{ at, reason: 'unresponsive' }] });
  expect((await recoveryHistoryCheck(bare, () => now).run(look))[0]?.message).toBe(
    'Conch stopped answering once in the past week and started again on its own yesterday at 8:30 AM.',
  );
});

it('says when in words people use', () => {
  const now = new Date(2026, 9, 7, 22, 0).getTime();
  expect(when(new Date(2026, 9, 7, 21, 5).getTime(), now)).toBe('at 9:05 PM');
  expect(when(new Date(2026, 9, 6, 21, 5).getTime(), now)).toBe('yesterday at 9:05 PM');
  expect(when(new Date(2026, 9, 2, 21, 5).getTime(), now)).toBe('on October 2');
});

it('keeps damaged recovery state safe and explains it without throwing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-recovery-doctor-'));
  homes.push(home);
  await mkdir(join(home, 'recovery'));
  await writeFile(join(home, 'recovery/state.json'), 'damaged');
  const result = await recoveryHistoryCheck(home).run({
    repair: false,
    signal: new AbortController().signal,
  });
  expect(result[0]?.message).toContain('paused background work');
  expect(touchesProtected({ path: join(home, 'recovery/state.json') }, protectedPaths(home))).toBe(
    true,
  );
  expect(classify('recovery/state.json')?.class).toBe('derived');
});
