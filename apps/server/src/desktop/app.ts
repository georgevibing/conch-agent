/**
 * The desktop app that started this gateway, if one did (ADR 0054).
 *
 * The app runs the gateway as a child with an IPC channel and says what it is
 * in the environment (`CONCH_APP`, `CONCH_APP_UPDATES`). Messages go both ways
 * over that channel only, checked against `@conch/protocol` on both sides: a
 * message that doesn't parse is dropped, never acted on.
 */
import { randomUUID } from 'node:crypto';

import {
  AppToGateway,
  AppUpdates,
  GatewayToApp,
  type AppToGateway as FromApp,
  type GatewayToApp as ToApp,
} from '@conch/protocol';

/** The part of `process` the channel uses, so tests can stand in for it. */
export interface IpcProcess {
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  connected?: boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
}

export class DesktopApp {
  constructor(
    /** The app's own program: what Always on starts at login. */
    readonly exe: string,
    /** Whether it can replace itself with a new version, or the person downloads it. */
    readonly updates: AppUpdates,
    private readonly proc: IpcProcess,
  ) {}

  /** Tell the app something. Resolves once it's sent (false: the app has gone). */
  send(message: ToApp): Promise<boolean> {
    const parsed = GatewayToApp.safeParse(message);
    const send = this.proc.send?.bind(this.proc);
    if (!parsed.success || !send || this.proc.connected === false) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        send(parsed.data, (error) => resolve(!error));
      } catch {
        resolve(false);
      }
    });
  }

  /** What the app says, checked. Returns a function that stops listening. */
  listen(handler: (message: FromApp) => void): () => void {
    const listener = (raw: unknown) => {
      const parsed = AppToGateway.safeParse(raw);
      if (parsed.success) handler(parsed.data);
    };
    this.proc.on('message', listener);
    return () => void this.proc.off('message', listener);
  }

  /**
   * The system's Open dialog, over the app's own window: what a person in the
   * app expects, rather than one an AppleScript raises in front of it.
   * Resolves the path, or undefined when cancelled; rejects when the app
   * couldn't show it (the caller falls back to the gateway's own dialog).
   */
  pick(
    options: { prompt: string; kind?: 'file' | 'folder'; extensions?: string[] },
    timeoutMs = 10 * 60_000,
  ): Promise<string | undefined> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const stop = this.listen((message) => {
        if (message.type !== 'picked' || message.id !== id) return;
        finish();
        if (message.failed) reject(new Error('The app couldn’t show the Open dialog.'));
        else resolve(message.path);
      });
      const timer = setTimeout(() => {
        finish();
        resolve(undefined);
      }, timeoutMs);
      timer.unref?.();
      const finish = () => {
        clearTimeout(timer);
        stop();
      };
      void this.send({
        type: 'pick',
        id,
        prompt: options.prompt.slice(0, 200),
        kind: options.kind ?? 'file',
        extensions: (options.extensions ?? []).filter((e) => /^[A-Za-z0-9]{1,10}$/.test(e)),
      }).then((sent) => {
        if (sent) return;
        finish();
        reject(new Error('The app has gone.'));
      });
    });
  }

  /** The app went away (it crashed, or it was killed): the gateway shouldn't outlive it. */
  onGone(handler: () => void): void {
    this.proc.on('disconnect', handler);
  }
}

/**
 * The app, when this gateway was started by one: `CONCH_APP` names it and an
 * IPC channel is open. Undefined for every other way of running Conch.
 */
export function desktopApp(
  env: NodeJS.ProcessEnv = process.env,
  proc: IpcProcess = process as unknown as IpcProcess,
): DesktopApp | undefined {
  const exe = env.CONCH_APP?.trim();
  if (!exe || typeof proc.send !== 'function') return undefined;
  const updates = AppUpdates.safeParse(env.CONCH_APP_UPDATES);
  return new DesktopApp(exe, updates.success ? updates.data : 'download', proc);
}

let current: DesktopApp | undefined | null = null;

/** This process's app, looked up once. */
export function theApp(): DesktopApp | undefined {
  if (current === null) current = desktopApp();
  return current;
}
