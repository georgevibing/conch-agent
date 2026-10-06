import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { classify } from '../backup/manifest';
import { protectedPaths, touchesProtected } from '../lib/protect';
import { recoveryHistoryCheck } from './doctor';
import { saveRecoveryState } from './supervisor-state';

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

it('shows durable recovery in Health without exposing the numeric diagnostics or private content', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-recovery-doctor-'));
  homes.push(home);
  const check = recoveryHistoryCheck(home);
  const options = { repair: false, signal: new AbortController().signal };
  expect(await check.run(options)).toEqual([]);
  saveRecoveryState(home, {
    failures: [1000],
    incidents: [{ at: 1000, reason: 'unresponsive', resource: { gatewayRssBytes: 12345 } }],
  });
  const report = await check.run(options);
  expect(report[0]).toMatchObject({ state: 'info', title: 'Recent recovery' });
  expect(report[0]?.message).toContain('stopped responding');
  expect(JSON.stringify(report)).not.toContain('12345');
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
