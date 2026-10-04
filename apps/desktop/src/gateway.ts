/**
 * The gateway, kept running by the app (ADR 0054). The app is its
 * supervisor, with the same rules as `pnpm start`'s (`supervisor.ts`):
 * exit code 75 starts it again at once (an update, a restore), a crash
 * starts it again with backoff, and five crashes in ten minutes stop with a
 * page that says why. The two talk over Node's IPC channel, each message
 * checked against `@conch/protocol`.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { AppToGateway, GatewayToApp, type GatewayToApp as FromGateway } from '@conch/protocol';

import { nextStep, RESTART_CODE } from '../../server/src/supervisor';

export interface GatewayLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type GatewayState =
  | { kind: 'starting' }
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
  #crashes: number[] = [];
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
    if (this.#child) return;
    this.#stopping = false;
    this.#said = undefined;
    this.#output = [];
    const launch = this.launch();
    const child = (this.deps.spawn ?? nodeSpawn)(launch.command, launch.args, {
      cwd: launch.cwd,
      env: { ...launch.env, CONCH_STARTED_BECAUSE: this.#reason },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    this.#child = child;
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
      if (this.#child === child) this.#child = undefined;
      void this.#exited(code, signal);
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

  async #exited(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.#stopping) return;
    // Another Conch answers instead: this one did its job by saying so.
    if (this.#state.kind === 'running' && this.#state.elsewhere && code === 0) return;
    if (this.#said) {
      this.#set({ kind: 'stopped', message: this.#said });
      return;
    }
    const now = (this.deps.now ?? Date.now)();
    const step = nextStep(code, signal, this.#crashes, now, false);
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
      this.#crashes.push(now);
      this.#reason = 'crash';
    } else this.#reason = 'restart';
    this.#set({ kind: 'starting' });
    if (step.delay)
      await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(step.delay);
    if (!this.#stopping) this.start();
  }

  /** Try again after it stopped for good: a fresh count of crashes. */
  retry(): void {
    this.#crashes = [];
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
   * Stop it and wait until it has: asked nicely, then told after five
   * seconds. Resolves at once when it isn't running; asked again while it's
   * on its way out, waits for the same goodbye.
   */
  async stop(timeoutMs = 5_000): Promise<void> {
    // Stopping for good (quitting, installing an update) wins over a restart under way.
    this.#restartWanted = false;
    return this.#stop(timeoutMs);
  }

  async #stop(timeoutMs = 5_000): Promise<void> {
    this.#stopping = true;
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
