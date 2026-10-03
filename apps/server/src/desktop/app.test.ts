import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { desktopApp, type IpcProcess } from './app';

/** A child process's side of an IPC channel, with the parent's side in reach. */
function channel({ connected = true, fails = false } = {}) {
  const events = new EventEmitter();
  const sent: unknown[] = [];
  const proc: IpcProcess & { emit: EventEmitter['emit'] } = {
    connected,
    send: (message, callback) => {
      sent.push(message);
      callback?.(fails ? new Error('channel closed') : null);
      return !fails;
    },
    on: (event: string, listener: never) => events.on(event, listener),
    off: (event: string, listener: never) => events.off(event, listener),
    emit: (event: string, ...args: unknown[]) => events.emit(event, ...args),
  } as IpcProcess & { emit: EventEmitter['emit'] };
  return { proc, sent };
}

describe('the desktop app, from the gateway', () => {
  it('is only there when the app started this gateway with a channel', () => {
    const { proc } = channel();
    expect(desktopApp({}, proc)).toBeUndefined();
    expect(
      desktopApp({ CONCH_APP: '/Applications/Conch.app/Contents/MacOS/Conch' }, proc)?.exe,
    ).toBe('/Applications/Conch.app/Contents/MacOS/Conch');
    // A Conch started from the app's own terminal inherits the variable, not the channel.
    const { send: _send, ...noChannel } = proc;
    expect(desktopApp({ CONCH_APP: '/x/Conch' }, noChannel as IpcProcess)).toBeUndefined();
  });

  it('only replaces itself when it said it can', () => {
    const { proc } = channel();
    expect(
      desktopApp({ CONCH_APP: 'C:\\Conch\\Conch.exe', CONCH_APP_UPDATES: 'install' }, proc)
        ?.updates,
    ).toBe('install');
    for (const value of [undefined, '', 'yes', 'INSTALL'])
      expect(
        desktopApp({ CONCH_APP: 'C:\\Conch\\Conch.exe', CONCH_APP_UPDATES: value }, proc)?.updates,
      ).toBe('download');
  });

  it('sends only what the protocol allows, and says when the app has gone', async () => {
    const { proc, sent } = channel();
    const app = desktopApp({ CONCH_APP: '/x/Conch' }, proc);
    expect(await app?.send({ type: 'listening', url: 'http://127.0.0.1:4317' })).toBe(true);
    // A page elsewhere is never sent to the window.
    expect(
      await app?.send({ type: 'listening', url: 'https://evil.example' as 'http://127.0.0.1:1' }),
    ).toBe(false);
    expect(sent).toEqual([{ type: 'listening', url: 'http://127.0.0.1:4317' }]);

    const gone = desktopApp({ CONCH_APP: '/x/Conch' }, channel({ connected: false }).proc);
    expect(await gone?.send({ type: 'tray', on: true })).toBe(false);
    const broken = desktopApp({ CONCH_APP: '/x/Conch' }, channel({ fails: true }).proc);
    expect(await broken?.send({ type: 'tray', on: true })).toBe(false);
  });

  it('hears only messages that parse', () => {
    const { proc } = channel();
    const app = desktopApp({ CONCH_APP: '/x/Conch' }, proc);
    const heard: unknown[] = [];
    const stop = app?.listen((message) => heard.push(message));
    proc.emit('message', { type: 'update.progress', version: '0.3.0', percent: 40 });
    proc.emit('message', { type: 'update.progress', version: '0.3.0', percent: 400 });
    proc.emit('message', { type: 'run', command: 'rm -rf ~' });
    proc.emit('message', 'update.ready');
    stop?.();
    proc.emit('message', { type: 'update.ready', version: '0.3.0' });
    expect(heard).toEqual([{ type: 'update.progress', version: '0.3.0', percent: 40 }]);
  });

  it('knows when the app went away', () => {
    const { proc } = channel();
    const app = desktopApp({ CONCH_APP: '/x/Conch' }, proc);
    let gone = false;
    app?.onGone(() => (gone = true));
    proc.emit('disconnect');
    expect(gone).toBe(true);
  });
});
