/**
 * Conch, kept running (AGENTS.md agreement 11: relaunch what crashed).
 *
 * `pnpm start` runs this small supervisor, which runs the gateway as a child
 * with the same Node, flags and environment. The gateway can ask to be started
 * again — after an update or a restore — by exiting with `RESTART_CODE`; a
 * gateway that stops unexpectedly is started again with backoff, and the new
 * one says so quietly. The supervisor stays attached to the terminal, so Ctrl+C
 * still stops everything and the logs stay where they were.
 *
 * After a release is swapped in (ADR 0051), the gateway starts from the folder
 * `CONCH_HOME/versions/current` names, read afresh every time. A new version
 * has to prove itself: until it's answering (it says so in
 * `versions/state.json`), stopping or staying silent for too long means it's
 * broken, and the supervisor goes back to the version before by itself.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { serviceChildren } from './recovery/children';
import { serviceLabel, unitName } from './background/files';

import {
  clearRecovery,
  cooldownRemaining,
  needsRecovery,
  recordFailure,
  recoveryCooldown,
  repeatedRestartRequest,
  readRecoveryState,
  recentFailures,
  saveRecoveryState,
  type RecoveryReason,
  type RecoveryResource,
} from './recovery/supervisor-state';
import { watchGateway, type WatchdogOptions } from './recovery/watchdog';

import { currentFolder, goBack, PROVE_WITHIN_MS, readState } from './updates/layout';

/** "Start me again": the gateway exits with this to be restarted (EX_TEMPFAIL). */
export const RESTART_CODE = 75;
export const SUPERVISOR_REVISION = '2';

/** Crashes this close together mean something's really wrong: stop, and say so. */
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 5;
const BACKOFF_MS = [1_000, 3_000, 10_000, 30_000];

/** Supervise when started for real (`pnpm start`), never inside a supervised child or a test. */
export function shouldSupervise(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONCH_SUPERVISE === '1' && env.CONCH_SUPERVISED !== '1';
}

/**
 * Older supervisors started their gateway without IPC. Adopt their next updated
 * child as the current supervisor; its own gateway has IPC and never adopts.
 * The old parent remains a launcher until its next normal stop, on every OS.
 */
export function shouldAdoptSupervisor(
  env: NodeJS.ProcessEnv = process.env,
  hasIpc = typeof process.send === 'function',
): boolean {
  return env.CONCH_SUPERVISE === '1' && env.CONCH_SUPERVISED === '1' && !hasIpc && !env.CONCH_APP;
}

/** Leave the legacy parent's first release probe time to see our completed rollback. */
export function legacyProofWindow(since: number, now: number, stopMs = 15_000): number {
  const reserve = stopMs + 5_000;
  return Math.max(0, Math.min(PROVE_WITHIN_MS - reserve, since + PROVE_WITHIN_MS - now - reserve));
}

export interface SuperviseDeps {
  /** Running in an updated child of a pre-IPC supervisor; consumed on the first launch. */
  adoptLegacy?: boolean;
  spawn?: typeof spawn;
  exit?: (code: number) => never;
  log?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** `CONCH_HOME`, where the version to run is written down. */
  home?: string;
  /** How long a new version has to answer (tests make it short). */
  proveWithinMs?: number;
  /** How often to look whether it has. */
  lookEveryMs?: number;
  watchdog?: Partial<WatchdogOptions>;
}

/**
 * Node's own flags, without the ones that load tsx from a particular folder
 * (`tsx` adds `--require …/tsx/dist/preflight.cjs` and `--import
 * file:///…/loader.mjs`): a version in another folder loads its own.
 */
export function nodeFlags(execArgv: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i] ?? '';
    if (/^(--require|-r|--import|--loader|--experimental-loader)$/.test(arg)) {
      if (/tsx/.test(execArgv[i + 1] ?? '')) {
        i++;
        continue;
      }
    } else if (/^--(require|import|loader|experimental-loader)=.*tsx/.test(arg)) continue;
    kept.push(arg);
  }
  return kept;
}

/** How to start the gateway now: from the version swapped in, or as this supervisor was started. */
export function gatewayLaunch(
  home: string,
  execArgv: string[] = process.execArgv,
  argv: string[] = process.argv,
): { args: string[]; cwd?: string; folder?: string } {
  const folder = currentFolder(home);
  if (!folder) return { args: [...execArgv, ...argv.slice(1)] };
  return {
    args: [...nodeFlags(execArgv), '--import', 'tsx', join('src', 'start.ts')],
    cwd: join(folder, 'apps', 'server'),
    folder,
  };
}

/** What to do when the gateway stops: start it again (and how soon), or stop too. */
export function nextStep(
  code: number | null,
  signal: NodeJS.Signals | null,
  crashes: number[],
  now: number,
  stopping: boolean,
): { kind: 'restart'; delay: number; crashed: boolean } | { kind: 'exit'; code: number } {
  if (stopping) return { kind: 'exit', code: code ?? 0 };
  if (code === RESTART_CODE) return { kind: 'restart', delay: 0, crashed: false };
  if (code === 0) return { kind: 'exit', code: 0 };
  const recent = crashes.filter((at) => now - at < CRASH_WINDOW_MS);
  if (recent.length >= MAX_CRASHES) return { kind: 'exit', code: code ?? 1 };
  const delay = BACKOFF_MS[Math.min(recent.length, BACKOFF_MS.length - 1)] ?? 30_000;
  void signal;
  return { kind: 'restart', delay, crashed: true };
}

export async function supervise(deps: SuperviseDeps = {}): Promise<never> {
  const start = deps.spawn ?? spawn;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const log = deps.log ?? ((message: string) => console.warn(message));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const home = deps.home ?? process.env.CONCH_HOME ?? join(homedir(), '.conch');
  const recovery = readRecoveryState(home);
  // The legacy launcher remains alive until its next normal stop. Keep its code
  // through subsequent release cleanup too, without accumulating ancestor roots.
  const legacyRoot = deps.adoptLegacy
    ? process.env.CONCH_SUPERVISOR_ROOT
    : process.env.CONCH_LEGACY_SUPERVISOR_ROOT;
  const record = (reason: RecoveryReason, resource?: RecoveryResource) => {
    recovery.incidents.push({ at: now(), reason, ...(resource && { resource }) });
    recovery.incidents = recovery.incidents.slice(-40);
    try {
      saveRecoveryState(home, recovery);
    } catch {
      log('Conch could not save its recovery history. Recovery remains active for this session.');
    }
  };
  let stopping = false;
  let child: ChildProcess | undefined;

  let watching: ReturnType<typeof watchGateway> | undefined;
  const signals = new Map<NodeJS.Signals, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const stop = () => {
      stopping = true;
      // The child shares the terminal and gets Ctrl+C itself; make sure of SIGTERM.
      watching?.stop(signal);
    };
    signals.set(signal, stop);
    process.on(signal, stop);
  }

  const inheritedReason = process.env.CONCH_STARTED_BECAUSE;
  let reason: 'start' | 'restart' | 'crash' =
    deps.adoptLegacy && (inheritedReason === 'restart' || inheritedReason === 'crash')
      ? inheritedReason
      : 'start';
  let adopting = deps.adoptLegacy === true;
  try {
    for (;;) {
      if (cooldownRemaining(recovery, now())) {
        log(
          'Conch is giving this computer a moment to recover before starting with less background work.',
        );
        await recoveryCooldown(recovery, { now, sleep, stopping: () => stopping });
        if (stopping) return exit(0);
      }
      const recoveryMode = needsRecovery(recovery, now());
      if (recoveryMode) record('recovery-mode');
      const launch = gatewayLaunch(home);
      // A version swapped in that hasn't answered yet: watch it.
      const pending = readState(home).pending;
      const proving =
        pending && launch.folder && resolve(pending.folder) === resolve(launch.folder)
          ? pending
          : undefined;
      const legacyProof = adopting ? proving : undefined;
      adopting = false;
      if (legacyProof && legacyProofWindow(legacyProof.since, now(), deps.watchdog?.stopMs) === 0) {
        // Do not start a child we cannot stop before the old parent's deadline.
        const back = goBack(home, now());
        log(
          `\n  Conch ${back?.version ?? legacyProof.version} ran out of time to start, so Conch went back to ${back?.to ?? legacyProof.from.version}.\n`,
        );
        reason = 'restart';
        continue;
      }
      const serviceMembers =
        process.env.CONCH_BACKGROUND === '1'
          ? serviceChildren(`${unitName(serviceLabel(home))}.service`)
          : undefined;
      child = start(process.execPath, launch.args, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        detached: process.platform !== 'win32',
        ...(launch.cwd && { cwd: launch.cwd }),
        env: {
          ...process.env,
          CONCH_SUPERVISED: '1',
          CONCH_SUPERVISOR_REVISION: SUPERVISOR_REVISION,
          CONCH_RECOVERY_MODE: recoveryMode ? '1' : '0',
          CONCH_STARTED_BECAUSE: reason,
          ...(launch.folder && { CONCH_RELEASE_ROOT: launch.folder }),
          // The folder this supervisor runs from: never tidied away under it.
          CONCH_SUPERVISOR_ROOT: resolve(import.meta.dirname, '..', '..', '..'),
          ...(legacyRoot && { CONCH_LEGACY_SUPERVISOR_ROOT: legacyRoot }),
        },
      });
      const running = child;
      watching = watchGateway(running, {
        // Rollbacks may predate heartbeats; never restart a healthy old release for a message it cannot send.
        enabled:
          !launch.folder ||
          existsSync(join(launch.folder, 'apps', 'server', 'src', 'recovery', 'gateway.ts')),
        ...deps.watchdog,
        processGroup: process.platform !== 'win32',
        serviceMembers,
        now: deps.now,
        stopping: () => stopping,
        incident: record,
        repaired: () => {
          clearRecovery(recovery);
          record('repaired');
        },
      });
      const watch = watching;
      const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
        running.once('exit', (c, s) => {
          watch.close();
          resolve([c, s]);
        });
        running.once('error', () => {
          if (!running.pid) {
            watch.close();
            resolve([1, null]);
          }
        });
      });
      if (proving) {
        const proofDeps = legacyProof
          ? {
              ...deps,
              proveWithinMs: Math.min(
                deps.proveWithinMs ?? PROVE_WITHIN_MS,
                legacyProofWindow(legacyProof.since, now(), deps.watchdog?.stopMs),
              ),
            }
          : deps;
        const verdict = await prove(exited, proofDeps, () => readState(home).pending === undefined);
        if (verdict !== 'proved' && !stopping) {
          if (verdict === 'silent') {
            watch.stop();
            await exited;
          }
          const back = goBack(home, now());
          log(
            `\n  Conch ${back?.version ?? proving.version} didn’t start properly, so Conch went back to ${back?.to ?? proving.from.version}.\n`,
          );
          reason = 'restart';
          continue;
        }
      }
      const [actualCode, signal] = await exited;
      let code = watch.failed() ? 1 : actualCode;
      if (code === RESTART_CODE && !stopping) {
        if (repeatedRestartRequest(recovery, now())) code = 1;
        record('restart-request');
      }
      // The durable budget owns exhaustion: keep a recovery launch after cooldown.
      const step = nextStep(
        code,
        signal,
        recentFailures(recovery, now()).slice(-4),
        now(),
        stopping,
      );
      if (step.kind === 'exit') {
        if (!stopping && code !== 0)
          log(
            '\n  Conch kept stopping, so it won’t start again by itself. The messages above say why;\n  run `pnpm start` to try again.\n',
          );
        return exit(step.code);
      }
      if (step.crashed) {
        recordFailure(recovery, now());
        record('crash');
        log(
          `\n  Conch stopped unexpectedly. Starting it again${step.delay ? ' in a moment' : ''}…\n`,
        );
        reason = 'crash';
      } else {
        log('\n  Restarting Conch…\n');
        reason = 'restart';
      }
      if (step.delay) await sleep(step.delay);
      if (stopping) return exit(0);
    }
  } finally {
    watching?.close();
    for (const [signal, listener] of signals) process.off(signal, listener);
  }
}

/**
 * Wait for a new version to say it's answering. `'proved'` when it did;
 * `'stopped'` when it stopped first; `'silent'` when it's still running but
 * never answered in time.
 */
async function prove(
  exited: Promise<unknown>,
  deps: SuperviseDeps,
  proved: () => boolean,
): Promise<'proved' | 'stopped' | 'silent'> {
  const within = deps.proveWithinMs ?? PROVE_WITHIN_MS;
  const every = deps.lookEveryMs ?? 500;
  let timer: NodeJS.Timeout | undefined;
  const watching = new Promise<'proved' | 'silent'>((resolveWatch) => {
    const started = Date.now();
    timer = setInterval(() => {
      if (proved()) resolveWatch('proved');
      else if (Date.now() - started > within) resolveWatch('silent');
    }, every);
  });
  try {
    return await Promise.race([
      exited.then((): 'proved' | 'stopped' => (proved() ? 'proved' : 'stopped')),
      watching,
    ]);
  } finally {
    clearInterval(timer);
  }
}
