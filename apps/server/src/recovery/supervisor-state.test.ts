import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRecovery,
  needsRecovery,
  recordFailure,
  repeatedRestartRequest,
  readRecoveryState,
  recentFailures,
  recoveryResource,
  saveRecoveryState,
} from './supervisor-state';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function home() {
  const path = mkdtempSync(join(tmpdir(), 'conch-recovery-'));
  homes.push(path);
  return path;
}

describe('private, durable recovery history', () => {
  it('bounds history and excludes unknown fields on read', () => {
    const folder = home();
    saveRecoveryState(folder, {
      failures: Array.from({ length: 100 }, (_, at) => at),
      incidents: Array.from({ length: 100 }, (_, at) => ({ at, reason: 'crash' as const })),
    });
    const saved = readRecoveryState(folder);
    expect(saved.failures).toEqual([94, 95, 96, 97, 98, 99]);
    expect(saved.incidents).toHaveLength(40);
    writeFileSync(
      join(folder, 'recovery/state.json'),
      JSON.stringify({
        failures: [1, -1, 'secret', null],
        incidents: [
          {
            at: 1,
            reason: 'crash',
            command: 'secret',
            resource: { running: 2, token: 'secret', queued: -1 },
          },
          { at: 2, reason: 'secret' },
        ],
      }),
    );
    expect(readRecoveryState(folder)).toMatchObject({
      recoveryMode: true,
      requestedRestarts: [],
      failures: [1],
      incidents: [
        { at: 1, reason: 'crash', resource: { running: 2 } },
        { reason: 'history-damaged' },
      ],
    });
  });
  it('tolerates damaged history and only allows finite numeric resource evidence', () => {
    const folder = home();
    expect(readRecoveryState(folder)).toEqual({ failures: [], incidents: [] });
    saveRecoveryState(folder, { failures: [], incidents: [] });
    writeFileSync(join(folder, 'recovery/state.json'), '{');
    expect(readRecoveryState(folder)).toMatchObject({
      recoveryMode: true,
      failures: [],
      incidents: [{ reason: 'history-damaged' }],
    });
    expect(
      recoveryResource({
        memoryAvailableBytes: 32,
        gatewayRssBytes: Infinity,
        probeMs: NaN,
        token: 'secret',
      }),
    ).toEqual({ memoryAvailableBytes: 32 });
    expect(readFileSync(join(folder, 'recovery/state.json'), 'utf8')).toBe('{');
  });
  it('keeps recovery mode across time and boots until an explicit repair', () => {
    const folder = home();
    const state = { failures: [], incidents: [] };
    recordFailure(state, 1);
    recordFailure(state, 2);
    recordFailure(state, 3);
    saveRecoveryState(folder, state);
    const rebooted = readRecoveryState(folder);
    expect(needsRecovery(rebooted, 10_000_000)).toBe(true);
    clearRecovery(rebooted);
    saveRecoveryState(folder, rebooted);
    expect(needsRecovery(readRecoveryState(folder), 10_000_001)).toBe(false);
  });
  it('persists requested restarts so repeatedly asking to restart cannot bypass backoff', () => {
    const folder = home();
    const state = { failures: [], incidents: [] };
    expect(repeatedRestartRequest(state, 1)).toBe(false);
    expect(repeatedRestartRequest(state, 2)).toBe(false);
    saveRecoveryState(folder, state);
    expect(repeatedRestartRequest(readRecoveryState(folder), 3)).toBe(true);
    expect(repeatedRestartRequest(readRecoveryState(folder), 1_000_000)).toBe(false);
  });

  it('treats oversized, future-version and invalid timestamps as damaged history', () => {
    const folder = home();
    saveRecoveryState(folder, { failures: [], incidents: [] });
    for (const text of [
      'x'.repeat(33_000),
      JSON.stringify({ version: 99, failures: [], incidents: [] }),
      JSON.stringify({ failures: [], incidents: [{ at: 1e100, reason: 'crash' }] }),
    ]) {
      writeFileSync(join(folder, 'recovery/state.json'), text);
      const state = readRecoveryState(folder);
      expect(state.recoveryMode).toBe(true);
      expect(state.incidents.at(-1)?.reason).toBe('history-damaged');
      for (const incident of state.incidents)
        expect(() => new Date(incident.at).toISOString()).not.toThrow();
    }
  });

  it('expires old failures but retains the budget when the clock moves backwards', () => {
    const state = { failures: [10, 600_010], incidents: [] };
    expect(recentFailures(state, 600_010)).toEqual([600_010]);
    expect(recentFailures(state, 0)).toEqual([10, 600_010]);
  });
});
