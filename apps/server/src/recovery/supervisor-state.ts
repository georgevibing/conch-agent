/** Small, private diagnostics: never persist commands, credentials or chat content. */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FAILURE_WINDOW_MS = 10 * 60_000;
export const RECOVERY_AFTER = 3;
export const COOLDOWN_AFTER = 6;
const reasons = [
  'crash',
  'unresponsive',
  'reduced-workload',
  'responsive',
  'recovery-mode',
  'repaired',
  'restart-request',
  'history-damaged',
] as const;
export type RecoveryReason = (typeof reasons)[number];
const resourceFields = [
  'memoryAvailableBytes',
  'memoryTotalBytes',
  'loadPerCpu',
  'running',
  'queued',
  'gatewayRssBytes',
  'probeMs',
] as const;
export type RecoveryResource = Partial<Record<(typeof resourceFields)[number], number>>;
export function recoveryResource(value: unknown): RecoveryResource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const safe: RecoveryResource = {};
  for (const field of resourceFields) {
    const number = (value as Record<string, unknown>)[field];
    if (
      typeof number === 'number' &&
      Number.isFinite(number) &&
      number >= 0 &&
      number <= Number.MAX_SAFE_INTEGER
    )
      safe[field] = number;
  }
  return Object.keys(safe).length ? safe : undefined;
}
export interface RecoveryState {
  recoveryMode?: boolean;
  requestedRestarts?: number[];
  failures: number[];
  incidents: { at: number; reason: RecoveryReason; resource?: RecoveryResource }[];
}
function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}
function damagedHistory(): RecoveryState {
  return {
    recoveryMode: true,
    requestedRestarts: [],
    failures: [],
    incidents: [{ at: Date.now(), reason: 'history-damaged' }],
  };
}
export function readRecoveryState(home: string): RecoveryState {
  try {
    const file = join(home, 'recovery', 'state.json');
    if (statSync(file).size > 32_768) return damagedHistory();
    const text = readFileSync(file, 'utf8');
    if (text.length > 32_768) return damagedHistory();
    const raw = JSON.parse(text) as Partial<RecoveryState> & { version?: unknown };
    if (!raw || !Array.isArray(raw.failures) || !Array.isArray(raw.incidents))
      return damagedHistory();
    const requested = raw.requestedRestarts ?? [];
    let damaged =
      (raw.version !== undefined && raw.version !== 1) ||
      (raw.recoveryMode !== undefined && typeof raw.recoveryMode !== 'boolean') ||
      !Array.isArray(requested) ||
      !raw.failures.every(validTimestamp);
    const requests = Array.isArray(requested)
      ? requested.filter(validTimestamp).slice(-COOLDOWN_AFTER)
      : [];
    if (Array.isArray(requested) && !requested.every(validTimestamp)) damaged = true;
    const incidents = raw.incidents
      .filter((entry) => {
        const valid = entry && validTimestamp(entry.at) && reasons.includes(entry.reason);
        if (!valid) damaged = true;
        return valid;
      })
      .slice(-40)
      .map(({ at, reason, resource }) => ({
        at,
        reason,
        ...(recoveryResource(resource) && { resource: recoveryResource(resource) }),
      }));
    if (damaged) incidents.push({ at: Date.now(), reason: 'history-damaged' });
    return {
      recoveryMode: damaged || raw.recoveryMode === true,
      requestedRestarts: requests,
      failures: raw.failures.filter(validTimestamp).slice(-COOLDOWN_AFTER),
      incidents: incidents.slice(-40),
    };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { failures: [], incidents: [] }
      : damagedHistory();
  }
}
export function recentFailures(state: RecoveryState, now: number): number[] {
  // A clock moving backwards must not silently reset the restart budget.
  return state.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
}
export function saveRecoveryState(home: string, state: RecoveryState): void {
  const folder = join(home, 'recovery');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temporary = join(folder, `state.${process.pid}.tmp`);
  writeFileSync(
    temporary,
    JSON.stringify({
      version: 1,
      recoveryMode: state.recoveryMode === true,
      requestedRestarts: (state.requestedRestarts ?? []).slice(-COOLDOWN_AFTER),
      failures: state.failures.slice(-COOLDOWN_AFTER),
      incidents: state.incidents.slice(-40),
    }),
    { mode: 0o600 },
  );
  renameSync(temporary, join(folder, 'state.json'));
}

/** Updates and restores remain immediate; repeated requests cannot evade crash backoff. */
export function repeatedRestartRequest(state: RecoveryState, now: number): boolean {
  const recent = (state.requestedRestarts ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  state.requestedRestarts = [...recent, now].slice(-COOLDOWN_AFTER);
  return recent.length >= 2;
}
export function recordFailure(state: RecoveryState, now: number): void {
  state.failures = [...recentFailures(state, now), now].slice(-COOLDOWN_AFTER);
  if (state.failures.length >= RECOVERY_AFTER) state.recoveryMode = true;
}
export function clearRecovery(state: RecoveryState): void {
  state.failures = [];
  state.requestedRestarts = [];
  state.recoveryMode = false;
}
/** Persist the latch separately from the rolling budget: time alone never re-admits work. */
export function needsRecovery(state: RecoveryState, now: number): boolean {
  if (recentFailures(state, now).length >= RECOVERY_AFTER) state.recoveryMode = true;
  return state.recoveryMode === true;
}
export function cooldownRemaining(state: RecoveryState, now: number): number {
  const recent = recentFailures(state, now);
  if (recent.length < COOLDOWN_AFTER) return 0;
  return Math.max(
    1_000,
    Math.min(FAILURE_WINDOW_MS, FAILURE_WINDOW_MS - (now - (recent[0] ?? now))),
  );
}
/** Short waits make stop responsive without another timer or cancellation abstraction. */
export async function recoveryCooldown(
  state: RecoveryState,
  options: {
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    stopping: () => boolean;
  },
): Promise<void> {
  const remaining = cooldownRemaining(state, options.now());
  for (let waited = 0; waited < remaining && !options.stopping(); waited += 1_000)
    await options.sleep(Math.min(1_000, remaining - waited));
}
