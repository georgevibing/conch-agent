import { EventEmitter } from 'node:events';

import type { AppToGateway } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { plainUpdateError, Updater, updatesMode, type UpdaterDeps } from './updater';

describe('whether the app can replace itself', () => {
  it('only when the computer lets it', () => {
    const mode = (
      platform: NodeJS.Platform,
      env: NodeJS.ProcessEnv = {},
      signed = false,
      packaged = true,
    ) => updatesMode({ packaged, platform, env, signed });
    expect(mode('win32')).toBe('install');
    expect(mode('win32', { PORTABLE_EXECUTABLE_DIR: 'D:\\Conch' })).toBe('download');
    expect(mode('darwin', {}, true)).toBe('install');
    expect(mode('darwin', {}, false)).toBe('download');
    expect(mode('linux', { APPIMAGE: '/home/me/Conch.AppImage' })).toBe('install');
    expect(mode('linux')).toBe('download');
    expect(mode('win32', {}, true, false)).toBe('download');
  });

  it('says what went wrong in words', () => {
    expect(plainUpdateError('net::ERR_INTERNET_DISCONNECTED')).toMatch(/offline/);
    expect(plainUpdateError('sha512 checksum mismatch, expected abc')).toMatch(/didn’t match/);
    expect(plainUpdateError('ENOSPC: no space left on device')).toMatch(/free space/);
    expect(plainUpdateError('Code signature at URL did not pass validation')).toMatch(/signature/);
    expect(plainUpdateError('something odd')).toBe('The download didn’t finish. Try again.');
  });
});

function fakeUpdater(version: string, fail?: Error) {
  const events = new EventEmitter();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: true,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version } })),
    downloadUpdate: vi.fn(async () => {
      events.emit('download-progress', { percent: 41.6 });
      events.emit('download-progress', { percent: 41.9 });
      events.emit('download-progress', { percent: 100 });
      if (fail) throw fail;
      return [];
    }),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: never) => events.on(event, listener),
    off: (event: string, listener: never) => events.off(event, listener),
  };
  return updater as unknown as NonNullable<UpdaterDeps['updater']> & typeof updater;
}

describe('getting a new version', () => {
  const feed = 'https://github.com/georgevibing/conch-agent/releases/download/v0.3.0';

  it('downloads it, says how far along, stops the gateway, then lets the installer in', async () => {
    const sent: AppToGateway[] = [];
    const order: string[] = [];
    const updater = fakeUpdater('0.3.0');
    updater.quitAndInstall.mockImplementation(() => void order.push('install'));
    await new Updater({
      send: (m) => sent.push(m),
      beforeInstall: async () => void order.push('stop gateway'),
      log: () => undefined,
      updater,
    }).get('0.3.0', feed);
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: feed });
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
    });
    expect(sent).toEqual([
      { type: 'update.progress', version: '0.3.0', percent: 42 },
      { type: 'update.progress', version: '0.3.0', percent: 100 },
      { type: 'update.ready', version: '0.3.0' },
    ]);
    expect(order).toEqual(['stop gateway', 'install']);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('never installs files for a different version than the one asked for', async () => {
    const sent: AppToGateway[] = [];
    const updater = fakeUpdater('0.2.9');
    await new Updater({
      send: (m) => sent.push(m),
      beforeInstall: async () => undefined,
      log: () => undefined,
      updater,
    }).get('0.3.0', feed);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(sent).toEqual([
      {
        type: 'update.failed',
        version: '0.3.0',
        message: 'The download didn’t finish. Try again.',
      },
    ]);
  });

  it('a download that fails keeps this version running and says why', async () => {
    const sent: AppToGateway[] = [];
    const stop = vi.fn(async () => undefined);
    const updater = fakeUpdater('0.3.0', new Error('sha512 checksum mismatch'));
    await new Updater({
      send: (m) => sent.push(m),
      beforeInstall: stop,
      log: () => undefined,
      updater,
    }).get('0.3.0', feed);
    expect(stop).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({
      type: 'update.failed',
      version: '0.3.0',
      message: expect.stringMatching(/didn’t match/),
    });
  });
});

it('lets a Dev package reach its first prerelease, still requiring the exact release selected by the gateway', async () => {
  const updater = fakeUpdater('0.1.0-beta.1');
  await new Updater({
    development: true,
    updater,
    log: () => undefined,
    send: () => undefined,
    beforeInstall: async () => undefined,
  }).get(
    '0.1.0-beta.1',
    'https://github.com/georgevibing/conch-agent/releases/download/v0.1.0-beta.1',
  );
  expect(updater.allowDowngrade).toBe(true);
  expect(updater.quitAndInstall).toHaveBeenCalledOnce();
});

it('refuses a different downloaded version even when leaving a Dev build', async () => {
  const updater = fakeUpdater('0.0.1');
  const sent: AppToGateway[] = [];
  await new Updater({
    development: true,
    updater,
    log: () => undefined,
    send: (message) => sent.push(message),
    beforeInstall: async () => undefined,
  }).get(
    '0.1.0-beta.1',
    'https://github.com/georgevibing/conch-agent/releases/download/v0.1.0-beta.1',
  );
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  expect(sent.at(-1)).toMatchObject({ type: 'update.failed', version: '0.1.0-beta.1' });
});
