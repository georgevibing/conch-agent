/**
 * The gateway, kept running by the app (ADR 0054). The app is its
 * supervisor, with the same rules as `pnpm start`'s (`supervisor.ts`):
 * exit code 75 starts it again at once (an update, a restore), a crash
 * starts it again with backoff, and repeated failures pause background work
 * and give the computer time to recover before another attempt. The two talk over Node's IPC channel, each message
 * checked against `@conch/protocol`.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

import { AppToGateway, GatewayToApp, type GatewayToApp as FromGateway } from '@conch/protocol';

import {
  readRecoveryState,
  recentFailures,
  clearRecovery,
  cooldownRemaining,
  needsRecovery,
  recordFailure,
  recoveryCooldown,
  repeatedRestartRequest,
  saveRecoveryState,
  type RecoveryState,
  type RecoveryReason,
  type RecoveryResource,
} from '../../server/src/recovery/supervisor-state';
import { watchGateway, type WatchdogOptions } from '../../server/src/recovery/watchdog';
import { nextStep, RESTART_CODE } from '../../server/src/supervisor';

export interface GatewayLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type GatewayState =
  | { kind: 'starting'; message?: string }
  /** Conch answers here: show it. `elsewhere`: another Conch, not ours. */
  | { kind: 'running'; url: string; elsewhere: boolean }
  /** It stopped for good: what happened, in a sentence. */
  | { kind: 'stopped'; message: string }
  /** It quit by itself (Quit Conch on the page): the app quits too. */
  | { kind: 'quit' };

export interface GatewayDeps {
  spawn?: typeof nodeSpawn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Where its output goes (the app's log). */
  log?: (text: string) => void;
  watchdog?: Partial<WatchdogOptions>;
}

/** The last thing it said, for the page when it won't start: a few lines, never a wall. */
function lastWords(output: string[]): string | undefined {
  const lines = output
    .join('')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('{') && !line.startsWith('at '));
  return lines.slice(-3).join(' ') || undefined;
}

export class Gateway extends EventEmitter<{
  state: [GatewayState];
  message: [FromGateway];
}> {
  #child?: ChildProcess;
  #state: GatewayState = { kind: 'starting' };
  #recovery: RecoveryState = { failures: [], incidents: [] };
  #home?: string;
  #cooling?: object;
  #stopping = false;
  #reason: 'start' | 'restart' | 'crash' = 'start';
  /** What it said before it stopped, when it said why (`failed`). */
  #said?: string;
  #output: string[] = [];
  /** Its goodbye, while it's on its way out (`stop`). */
  #goodbye?: Promise<void>;
  /** A restart under way (`restart`), and whether it's still wanted when it's down. */
  #restarting?: Promise<void>;
  #restartWanted = false;

  constructor(
    private readonly launch: () => GatewayLaunch,
    private readonly deps: GatewayDeps = {},
  ) {
    super();
  }

  get state(): GatewayState {
    return this.#state;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  #set(state: GatewayState): void {
    this.#state = state;
    this.emit('state', state);
  }

  /** Start it (or start it again after it stopped for good: Try again). */
  start(): void {
    if (this.#child || this.#cooling) return;
    this.#stopping = false;
    this.#said = undefined;
    this.#output = [];
    const launch = this.launch();
    const home = launch.env.CONCH_HOME ?? join(homedir(), '.conch');
    if (this.#home !== home) {
      this.#home = home;
      this.#recovery = readRecoveryState(home);
    }
    if (!cooldownRemaining(this.#recovery, (this.deps.now ?? Date.now)())) {
      this.#launch(launch);
      return;
    }
    const cooling = (this.#cooling = {});
    this.#set({
      kind: 'starting',
      message:
        'Conch is giving this computer a few minutes to recover. It will start again with less background work.',
    });
    void recoveryCooldown(this.#recovery, {
      now: this.deps.now ?? Date.now,
      sleep: this.deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      stopping: () => this.#stopping || this.#cooling !== cooling,
    }).then(() => {
      if (this.#cooling !== cooling) return;
      this.#cooling = undefined;
      if (!this.#stopping) this.#launch(launch);
    });
  }

  #launch(launch: GatewayLaunch): void {
    const recoveryMode = needsRecovery(this.#recovery, (this.deps.now ?? Date.now)());
    if (recoveryMode) this.#record('recovery-mode');
    const child = (this.deps.spawn ?? nodeSpawn)(launch.command, launch.args, {
      cwd: launch.cwd,
      env: {
        ...launch.env,
        CONCH_STARTED_BECAUSE: this.#reason,
        CONCH_RECOVERY_MODE: recoveryMode ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.#child = child;
    const watch = watchGateway(child, {
      ...this.deps.watchdog,
      processGroup: process.platform !== 'win32',
      now: this.deps.now,
      stopping: () => this.#stopping,
      incident: (reason, resource) => this.#record(reason, resource),
      repaired: () => {
        clearRecovery(this.#recovery);
        this.#record('repaired');
      },
    });
    this.#set({ kind: 'starting' });
    const out = (chunk: Buffer | string) => {
      const text = String(chunk);
      this.#output = [...this.#output, text].slice(-40);
      this.deps.log?.(text);
    };
    child.stdout?.on('data', out);
    child.stderr?.on('data', out);
    child.on('message', (raw: unknown) => {
      const parsed = GatewayToApp.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'listening' || message.type === 'elsewhere')
        this.#set({ kind: 'running', url: message.url, elsewhere: message.type === 'elsewhere' });
      else if (message.type === 'failed') this.#said = message.message;
      this.emit('message', message);
    });
    let exited = false;
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exited) return;
      exited = true;
      watch.close();
      if (this.#child === child) this.#child = undefined;
      void this.#exited(watch.failed() ? 1 : code, signal);
    };
    child.once('exit', done);
    child.on('error', (error) => {
      // Running, it's a message that couldn't go (its channel had closed), not a
      // start that failed: its own 'exit' still comes.
      if (child.pid !== undefined) return;
      out(`${error.message}\n`);
      done(1, null);
    });
  }

  #record(reason: RecoveryReason, resource?: RecoveryResource): void {
    this.#recovery.incidents = [
      ...this.#recovery.incidents,
      { at: (this.deps.now ?? Date.now)(), reason, ...(resource && { resource }) },
    ].slice(-40);
    if (this.#home) {
      try {
        saveRecoveryState(this.#home, this.#recovery);
      } catch {
        this.deps.log?.(
          'Conch could not save its recovery history. Recovery remains active for this session.',
        );
      }
    }
  }

  async #exited(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.#stopping) return;
    // Another Conch answers instead: this one did its job by saying so.
    if (this.#state.kind === 'running' && this.#state.elsewhere && code === 0) return;
    if (this.#said) {
      this.#set({ kind: 'stopped', message: this.#said });
      return;
    }
    const now = (this.deps.now ?? Date.now)();
    if (code === RESTART_CODE) {
      if (repeatedRestartRequest(this.#recovery, now)) code = 1;
      this.#record('restart-request');
    }
    const step = nextStep(code, signal, recentFailures(this.#recovery, now).slice(-4), now, false);
    if (step.kind === 'exit') {
      if (code === 0) {
        this.#set({ kind: 'quit' });
        return;
      }
      this.#set({
        kind: 'stopped',
        message: [
          'Conch kept stopping, so it won’t start again by itself.',
          lastWords(this.#output) && `It said: “${lastWords(this.#output)}”`,
        ]
          .filter(Boolean)
          .join(' '),
      });
      return;
    }
    if (step.crashed) {
      recordFailure(this.#recovery, now);
      this.#record('crash');
      this.#reason = 'crash';
    } else this.#reason = 'restart';
    this.#set({ kind: 'starting' });
    if (step.delay)
      await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(step.delay);
    if (!this.#stopping) this.start();
  }

  /** A fresh attempt; only a healthy Repair may re-enable background work. */
  retry(): void {
    this.#cooling = undefined;
    this.#recovery.failures = [];
    this.#recovery.requestedRestarts = [];
    this.#record('restart-request');
    this.#reason = 'start';
    this.start();
  }

  /** Tell it something (an update's progress). False when it isn't there to hear. */
  send(message: AppToGateway): boolean {
    const child = this.#child;
    const parsed = AppToGateway.safeParse(message);
    if (!child?.connected || !parsed.success) return false;
    try {
      return child.send(parsed.data);
    } catch {
      return false;
    }
  }

  /**
   * Stop it and wait until it has: asked nicely, then told after fifteen
   * seconds. Resolves at once when it isn't running; asked again while it's
   * on its way out, waits for the same goodbye.
   */
  async stop(timeoutMs = 15_000): Promise<void> {
    // Stopping for good (quitting, installing an update) wins over a restart under way.
    this.#restartWanted = false;
    return this.#stop(timeoutMs);
  }

  async #stop(timeoutMs = 15_000): Promise<void> {
    this.#stopping = true;
    this.#cooling = undefined;
    const child = this.#child;
    if (!child || child.exitCode !== null) return;
    this.#goodbye ??= new Promise<void>((resolve) => {
      const forced = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('exit', () => {
        clearTimeout(forced);
        this.#goodbye = undefined;
        resolve();
      });
      // Windows has no SIGTERM: closing the channel is the gateway's cue to stop.
      if (process.platform === 'win32' && child.connected) child.disconnect();
      else child.kill('SIGTERM');
    });
    await this.#goodbye;
  }

  /**
   * Start it again (development: its code changed). Asked again before the
   * one running has stopped, it still starts just once, on the newest code.
   */
  restart(): Promise<void> {
    this.#restartWanted = true;
    this.#restarting ??= this.#stop().then(() => {
      this.#restarting = undefined;
      if (this.#restartWanted) this.retry();
    });
    return this.#restarting;
  }
}

export { RESTART_CODE };
