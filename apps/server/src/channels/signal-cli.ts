/**
 * signal-cli, as Conch runs it (ADR 0043): one `signal-cli jsonRpc` process
 * for every linked Signal account, speaking JSON-RPC over its own stdin and
 * stdout. Nothing listens on a port, so no other program on this computer
 * can reach your Signal through it.
 *
 * Its files live in `~/.conch/signal` (`--config`), apart from any
 * signal-cli you use yourself. It starts when a Signal channel or a link
 * needs it, is started again with backoff when it stops, and says plainly
 * when Java or signal-cli itself is missing (a need, ADR 0016).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { agentEnv, launch } from '../lib/proc';
import { Backoff, pause } from './types';

/** What a running signal-cli looks like from here; tests and the mock engine pretend. */
export interface SignalProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  onExit(listener: (code: number | null) => void): void;
}

/** Start signal-cli, or say what's missing. */
export type SignalSpawn = (
  configDir: string,
) => Promise<SignalProcess | { need: string; message: string }>;

export class SignalRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SignalReceive {
  account?: string;
  envelope?: Record<string, unknown>;
  exception?: { message?: string; type?: string };
}

export type DaemonState =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'running' }
  | { state: 'down'; message: string; retryAt?: number; need?: string };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** A start that ends this fast, this many times in a row, is a start that fails. */
const QUICK_EXIT_MS = 15_000;

/**
 * The JSON-RPC client and the process it runs. Requests wait for the process
 * to be up (or fail in words when it can't be); `receive` notifications go
 * to whoever listens for that account.
 */
export class SignalDaemon {
  #process?: SignalProcess;
  #starting?: Promise<void>;
  #pending = new Map<string, Pending>();
  #next = 1;
  #listeners = new Map<string, Set<(receive: SignalReceive) => void>>();
  #stateListeners = new Set<(state: DaemonState) => void>();
  #state: DaemonState = { state: 'stopped' };
  #stop = new AbortController();
  #backoff = new Backoff();
  #stderr = '';

  constructor(
    private readonly deps: {
      /** `~/.conch/signal`. */
      dir: string;
      spawn: SignalSpawn;
      log?: (message: string) => void;
    },
  ) {}

  get dir() {
    return this.deps.dir;
  }

  get state(): DaemonState {
    return this.#state;
  }

  /** Where signal-cli keeps the files people send. */
  get attachments() {
    return join(this.deps.dir, 'attachments');
  }

  onState(listener: (state: DaemonState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Messages for one account. Listening keeps the process running. */
  onReceive(account: string, listener: (receive: SignalReceive) => void): () => void {
    const set = this.#listeners.get(account) ?? new Set();
    set.add(listener);
    this.#listeners.set(account, set);
    void this.ensure().catch(() => undefined);
    return () => {
      set.delete(listener);
      if (!set.size) this.#listeners.delete(account);
    };
  }

  /** Running, or a plain reason why not. */
  async ensure(): Promise<void> {
    if (this.#process) return;
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    await this.ensure();
    const process = this.#process;
    if (!process) throw new SignalRpcError(-32000, this.#downMessage());
    const id = String(this.#next++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new SignalRpcError(-32001, 'signal-cli took too long to answer.'));
      }, options.timeoutMs ?? 30_000);
      timer.unref?.();
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  stop() {
    this.#stop.abort();
    this.#process?.kill();
    this.#process = undefined;
    this.#fail('Conch is stopping.');
    this.#set({ state: 'stopped' });
  }

  #downMessage() {
    return this.#state.state === 'down' ? this.#state.message : 'signal-cli isn’t running.';
  }

  #set(state: DaemonState) {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  #fail(message: string) {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new SignalRpcError(-32000, message));
      this.#pending.delete(id);
    }
  }

  async #start(): Promise<void> {
    if (this.#stop.signal.aborted) throw new SignalRpcError(-32000, 'Conch is stopping.');
    this.#set({ state: 'starting' });
    await mkdir(this.deps.dir, { recursive: true, mode: 0o700 }).catch(() => undefined);
    const started = await this.deps.spawn(this.deps.dir).catch((error: unknown) => ({
      need: undefined,
      message: `signal-cli couldn’t start (${error instanceof Error ? error.message : String(error)}).`,
    }));
    if (!('stdin' in started)) {
      this.#set({
        state: 'down',
        message: started.message,
        ...(started.need && { need: started.need }),
      });
      throw new SignalRpcError(-32000, started.message);
    }
    const process = started;
    const startedAt = Date.now();
    this.#process = process;
    this.#stderr = '';
    let buffer = '';
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) this.#line(line);
      }
    });
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk: string) => {
      // Kept only to explain a failed start; it never leaves this process.
      this.#stderr = (this.#stderr + chunk).slice(-4000);
    });
    process.stdin.on('error', () => undefined);
    process.onExit((code) => {
      if (this.#process !== process) return;
      this.#process = undefined;
      const quick = Date.now() - startedAt < QUICK_EXIT_MS;
      const why = explainExit(this.#stderr, code);
      this.#fail(why.message);
      if (this.#stop.signal.aborted) return;
      if (!quick) this.#backoff.reset();
      // Nobody needs it: let it rest until someone does.
      if (!this.#listeners.size) {
        this.#set({ state: 'down', message: why.message, ...(why.need && { need: why.need }) });
        return;
      }
      const wait = this.#backoff.next();
      this.#set({
        state: 'down',
        message: why.message,
        retryAt: Date.now() + wait,
        ...(why.need && { need: why.need }),
      });
      void pause(wait, this.#stop.signal).then((go) => {
        if (go && this.#listeners.size) void this.ensure().catch(() => undefined);
      });
    });
    this.#set({ state: 'running' });
  }

  #line(line: string) {
    let message: {
      id?: string | number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.#pending.get(String(message.id));
      if (!pending) return;
      this.#pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(
          new SignalRpcError(
            message.error.code ?? -1,
            message.error.message ?? 'signal-cli said no.',
          ),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.method !== 'receive' || typeof message.params !== 'object' || !message.params)
      return;
    const receive = message.params as SignalReceive;
    const account = receive.account;
    const targets = account ? this.#listeners.get(account) : undefined;
    for (const listener of targets ?? []) listener(receive);
  }
}

/** Why signal-cli stopped, in words, and what to install when that's why. */
export function explainExit(
  stderr: string,
  code: number | null,
): { message: string; need?: string } {
  if (
    /Unable to locate a Java Runtime|JAVA_HOME|java: (command )?not found|No Java runtime/i.test(
      stderr,
    )
  )
    return { message: 'Signal needs Java, which isn’t on this computer yet.', need: 'java' };
  if (/UnsupportedClassVersionError|has been compiled by a more recent version/i.test(stderr))
    return { message: 'Signal needs a newer Java (25 or later).', need: 'java' };
  if (/Config file is in use by another instance|already in use/i.test(stderr))
    return {
      message:
        'Another signal-cli is using Conch’s Signal files. Conch stops its own copy by itself; if this stays, restart Conch.',
    };
  return {
    message:
      code === null
        ? 'signal-cli stopped. Conch starts it again by itself.'
        : `signal-cli stopped (exit ${code}). Conch starts it again by itself.`,
  };
}

/**
 * How to start the signal-cli at `path`. On Windows its release has only a
 * batch file, which Conch never runs (a shell would read the arguments);
 * the batch file says which Java classes to start, and Java starts them.
 */
export function signalCliCommand(
  path: string,
  java: string | undefined,
): { command: string; prefix: string[] } | { need: string; message: string } {
  if (!/\.bat$/i.test(path)) return launch(path);
  if (!java)
    return { need: 'java', message: 'Signal needs Java, which isn’t on this computer yet.' };
  const script = readFileSync(path, 'utf8');
  const home = dirname(dirname(path));
  const classpath = /^set CLASSPATH=(.+)$/im
    .exec(script)?.[1]
    ?.trim()
    .replaceAll('%APP_HOME%', home);
  const options = /^set DEFAULT_JVM_OPTS=(.*)$/im.exec(script)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!classpath)
    return { need: 'signal-cli', message: 'That signal-cli looks damaged. Install it again.' };
  return {
    command: java,
    prefix: [
      ...(options ? options.split(/\s+/) : []),
      '-classpath',
      classpath,
      'org.asamk.signal.Main',
    ],
  };
}

/**
 * The real thing: `signal-cli --config ~/.conch/signal -o json jsonRpc`,
 * found where it was installed (ADR 0016). It gets the same environment as
 * every program Conch runs (without Conch's own settings), plus `JAVA_HOME`
 * when Conch found a Java it can use and none was set.
 */
export function signalCliSpawn(find: {
  signalCli: () => Promise<string | undefined>;
  java: () => Promise<string | undefined>;
  javaHome: (java: string) => string;
}): SignalSpawn {
  return async (configDir) => {
    const path = await find.signalCli();
    if (!path)
      return {
        need: 'signal-cli',
        message: 'Signal needs signal-cli, which isn’t on this computer yet.',
      };
    const java = await find.java();
    const how = signalCliCommand(path, java);
    if ('need' in how) return how;
    const child = nodeSpawn(
      how.command,
      [
        ...how.prefix,
        '--config',
        configDir,
        '-o',
        'json',
        'jsonRpc',
        '--ignore-stories',
        '--ignore-stickers',
        '--receive-mode',
        'on-start',
      ],
      {
        env: agentEnv(java && !process.env.JAVA_HOME ? { JAVA_HOME: find.javaHome(java) } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      kill: () => child.kill(),
      onExit: (listener) => {
        child.once('error', () => listener(null));
        child.once('exit', (code) => listener(code));
      },
    };
  };
}
