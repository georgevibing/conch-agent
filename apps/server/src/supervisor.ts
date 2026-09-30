/**
 * Conch, kept running (AGENTS.md agreement 11: relaunch what crashed).
 *
 * `pnpm start` runs this small supervisor, which runs the gateway as a child
 * with the same Node, flags and environment. The gateway can ask to be started
 * again — after an update or a restore — by exiting with `RESTART_CODE`; a
 * gateway that stops unexpectedly is started again with backoff, and the new
 * one says so quietly. The supervisor stays attached to the terminal, so Ctrl+C
 * still stops everything and the logs stay where they were.
 */
import { spawn, type ChildProcess } from 'node:child_process';

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
    child = start(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, CONCH_SUPERVISED: '1', CONCH_STARTED_BECAUSE: reason },
    });
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      child?.once('exit', (c, s) => resolve([c, s]));
      child?.once('error', () => resolve([1, null]));
    });
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
