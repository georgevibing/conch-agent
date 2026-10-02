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
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { currentFolder, goBack, PROVE_WITHIN_MS, readState } from './updates/layout';

/** "Start me again": the gateway exits with this to be restarted (EX_TEMPFAIL). */
export const RESTART_CODE = 75;

/** Crashes this close together mean something's really wrong: stop, and say so. */
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 5;
const BACKOFF_MS = [1_000, 3_000, 10_000, 30_000];

/** Supervise when started for real (`pnpm start`), never inside a supervised child or a test. */
export function shouldSupervise(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONCH_SUPERVISE === '1' && env.CONCH_SUPERVISED !== '1';
}

export interface SuperviseDeps {
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
  const crashes: number[] = [];
  let stopping = false;
  let child: ChildProcess | undefined;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopping = true;
      // The child shares the terminal and gets Ctrl+C itself; make sure of SIGTERM.
      if (signal === 'SIGTERM') child?.kill('SIGTERM');
    });
  }

  let reason: 'start' | 'restart' | 'crash' = 'start';
  for (;;) {
    const launch = gatewayLaunch(home);
    // A version swapped in that hasn't answered yet: watch it.
    const pending = readState(home).pending;
    const proving =
      pending && launch.folder && resolve(pending.folder) === resolve(launch.folder)
        ? pending
        : undefined;
    child = start(process.execPath, launch.args, {
      stdio: 'inherit',
      ...(launch.cwd && { cwd: launch.cwd }),
      env: {
        ...process.env,
        CONCH_SUPERVISED: '1',
        CONCH_STARTED_BECAUSE: reason,
        ...(launch.folder && { CONCH_RELEASE_ROOT: launch.folder }),
        // The folder this supervisor runs from: never tidied away under it.
        CONCH_SUPERVISOR_ROOT: resolve(import.meta.dirname, '..', '..', '..'),
      },
    });
    const running = child;
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      running.once('exit', (c, s) => resolve([c, s]));
      running.once('error', () => resolve([1, null]));
    });
    if (proving) {
      const verdict = await prove(exited, deps, () => readState(home).pending === undefined);
      if (verdict !== 'proved' && !stopping) {
        if (verdict === 'silent') {
          running.kill('SIGTERM');
          const forced = setTimeout(() => running.kill('SIGKILL'), 5_000);
          await exited;
          clearTimeout(forced);
        }
        const back = goBack(home, now());
        log(
          `\n  Conch ${back?.version ?? proving.version} didn’t start properly, so Conch went back to ${back?.to ?? proving.from.version}.\n`,
        );
        reason = 'restart';
        continue;
      }
    }
    const [code, signal] = await exited;
    const step = nextStep(code, signal, crashes, now(), stopping);
    if (step.kind === 'exit') {
      if (!stopping && code !== 0)
        log(
          '\n  Conch kept stopping, so it won’t start again by itself. The messages above say why;\n  run `pnpm start` to try again.\n',
        );
      return exit(step.code);
    }
    if (step.crashed) {
      crashes.push(now());
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
