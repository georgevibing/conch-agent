import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UpdatesStatus } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { desktopApp, type IpcProcess } from '../desktop/app';
import { releaseBody } from '../release/notes';
import { Setup } from '../setup/needs';
import { AppReleases, feedFile } from './app';
import { UpdatesService } from './service';

const REPO = { owner: 'georgevibing', repo: 'conch-agent' };
const BASE = 'https://github.com/georgevibing/conch-agent/releases';

/** A release as GitHub's API lists it. */
function release(
  version: string,
  {
    files = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'],
    draft = false,
    notes = { headsUp: [], new: [`Something new in ${version}`], better: [], fixed: [] },
  }: {
    files?: string[];
    draft?: boolean;
    notes?: { headsUp: string[]; new: string[]; better: string[]; fixed: string[] };
  } = {},
) {
  return {
    tag_name: `v${version}`,
    draft,
    prerelease: version.includes('-'),
    html_url: `${BASE}/tag/v${version}`,
    published_at: '2026-10-01T09:00:00Z',
    body: releaseBody(notes),
    assets: files.map((name) => ({
      name,
      browser_download_url: `${BASE}/download/v${version}/${name}`,
    })),
  };
}

function github(list: unknown, status = 200) {
  const asked: string[] = [];
  const fake = (async (url: string | URL) => {
    asked.push(String(url));
    return new Response(JSON.stringify(list), { status });
  }) as typeof fetch;
  return { fake, asked };
}

/** The app's side of the channel: it answers an update the way it's told to. */
function appChannel(answer: 'ready' | 'fail' | 'silent' | 'gone' = 'ready') {
  const events = new EventEmitter();
  const sent: unknown[] = [];
  const proc = {
    connected: answer !== 'gone',
    send: (message: unknown, callback?: (error: Error | null) => void) => {
      sent.push(message);
      callback?.(null);
      const version = (message as { version?: string }).version;
      setTimeout(() => {
        if (answer === 'silent' || !version) return;
        events.emit('message', { type: 'update.progress', version, percent: 50 });
        events.emit(
          'message',
          answer === 'ready'
            ? { type: 'update.ready', version }
            : { type: 'update.failed', version, message: 'The download was interrupted.' },
        );
      }, 5);
      return true;
    },
    on: (event: string, listener: never) => events.on(event, listener),
    off: (event: string, listener: never) => events.off(event, listener),
  } as unknown as IpcProcess;
  return { proc, sent };
}

describe('finding the app’s releases', () => {
  it('names the file each computer needs before a release is offered', () => {
    expect(feedFile('win32', 'x64')).toBe('latest.yml');
    expect(feedFile('darwin', 'arm64')).toBe('latest-mac.yml');
    expect(feedFile('linux', 'x64')).toBe('latest-linux.yml');
    expect(feedFile('linux', 'arm64')).toBe('latest-linux-arm64.yml');
    expect(feedFile('freebsd', 'x64')).toBeUndefined();
  });

  it('offers the newest release in the channel, built for this computer, with its notes', async () => {
    const { fake, asked } = github([
      release('0.5.0-alpha.1'),
      release('0.4.0-beta.2'),
      release('0.3.1', { files: ['latest-mac.yml'] }), // not built for Windows yet
      release('0.3.0'),
      release('0.9.0', { draft: true }),
      { tag_name: 'nightly', assets: [] },
      release('0.2.0'),
    ]);
    const { proc } = appChannel();
    const app = desktopApp({ CONCH_APP: 'C:\\Conch\\Conch.exe' }, proc);
    if (!app) throw new Error('no app');
    const releases = new AppReleases({
      app,
      repository: REPO,
      version: '0.2.0',
      platform: 'win32',
      arch: 'x64',
      fetch: fake,
    });
    expect(asked).toEqual([]);
    const stable = await releases.check({ channel: 'stable' });
    expect(asked[0]).toBe(
      'https://api.github.com/repos/georgevibing/conch-agent/releases?per_page=30',
    );
    expect(stable.offers.map((o) => o.version)).toEqual(['0.3.0']);
    expect(stable.offers[0]).toMatchObject({
      feed: `${BASE}/download/v0.3.0`,
      page: `${BASE}/tag/v0.3.0`,
      notes: { version: '0.3.0', channel: 'stable', new: ['Something new in 0.3.0'] },
    });
    expect((await releases.check({ channel: 'beta' })).offers.map((o) => o.version)).toEqual([
      '0.4.0-beta.2',
      '0.3.0',
    ]);
    expect((await releases.check({ channel: 'alpha' })).offers[0]?.version).toBe('0.5.0-alpha.1');
    // One that didn't install here waits for a newer one.
    expect((await releases.check({ channel: 'stable', failed: ['0.3.0'] })).offers).toEqual([]);
  });

  it('never takes a page address from elsewhere', async () => {
    const odd = { ...release('0.3.0'), html_url: 'https://evil.example/conch' };
    const { proc } = appChannel();
    const app = desktopApp({ CONCH_APP: '/x/Conch' }, proc);
    if (!app) throw new Error('no app');
    const found = await new AppReleases({
      app,
      repository: REPO,
      version: '0.2.0',
      platform: 'linux',
      arch: 'x64',
      fetch: github([odd]).fake,
    }).check({ channel: 'stable' });
    expect(found.offers[0]?.page).toBe(`${BASE}/tag/v0.3.0`);
  });

  it('says so quietly when GitHub can’t be reached or asks it to wait', async () => {
    const { proc } = appChannel();
    const app = desktopApp({ CONCH_APP: '/x/Conch' }, proc);
    if (!app) throw new Error('no app');
    const make = (fetch: typeof globalThis.fetch) =>
      new AppReleases({ app, repository: REPO, version: '0.2.0', platform: 'darwin', fetch });
    const offline = await make((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch).check({ channel: 'stable' });
    expect(offline).toEqual({
      offers: [],
      problem: 'Conch couldn’t reach GitHub to look for updates.',
    });
    const limited = await make(github({ message: 'rate limited' }, 403).fake).check({
      channel: 'stable',
    });
    expect(limited.problem).toMatch(/asked Conch to wait/);
  });
});

describe('installing a release', () => {
  async function setup(answer: 'ready' | 'fail' | 'silent' | 'gone', updates = 'install') {
    const home = await mkdtemp(join(tmpdir(), 'conch-app-updates-'));
    homes.push(home);
    const { proc, sent } = appChannel(answer);
    const app = desktopApp({ CONCH_APP: 'C:\\Conch\\Conch.exe', CONCH_APP_UPDATES: updates }, proc);
    if (!app) throw new Error('no app');
    const seen: UpdatesStatus[] = [];
    let version = '0.2.0';
    const make = () =>
      new UpdatesService({
        home,
        setup: new Setup(new Map(), { platform: 'win32' }),
        specs: new Map(),
        lookup: {
          npm: async () => undefined,
          winget: async () => undefined,
          brew: async () => undefined,
          pypi: async () => undefined,
          github: async () => undefined,
        },
        app: new AppReleases({
          app,
          repository: REPO,
          version,
          platform: 'win32',
          arch: 'x64',
          fetch: github([release('0.3.0'), release('0.2.0')]).fake,
        }),
        version,
        bootId: 'boot-1',
        emit: (status) => seen.push(status),
        heal: () => undefined,
        busy: () => false,
        landed: async () => undefined,
        restartable: () => true,
        restart: () => true,
        schedule: false,
      });
    return { make, sent, seen, setVersion: (v: string) => (version = v) };
  }

  it('shows the release with its notes, and Update downloads and installs it', async () => {
    const { make, sent, seen } = await setup('ready');
    const service = make();
    await service.check();
    const before = (await service.status()).conch;
    expect(before).toMatchObject({
      checkable: true,
      source: 'releases',
      latest: { version: '0.3.0', channel: 'stable' },
      announce: true,
      behind: 1,
    });
    expect(before.blocked).toBeUndefined();
    expect(before.releases[0]?.new).toEqual(['Something new in 0.3.0']);

    await service.updateConch();
    await expect.poll(async () => (await service.status()).conch.running?.phase).toBe('restart');
    expect(sent).toEqual([{ type: 'update', version: '0.3.0', feed: `${BASE}/download/v0.3.0` }]);
    // The download's progress reached the page on the way.
    expect(
      seen.some((s) => s.conch.running?.phase === 'fetch' && s.conch.running.percent === 50),
    ).toBe(true);
    expect((await service.status()).conch.outcome).toMatchObject({
      kind: 'updated',
      message: 'Conch was updated to 0.3.0.',
    });
  });

  it('after the installer: the new version says it’s up to date, the old one that it didn’t take', async () => {
    const took = await setup('ready');
    let service = took.make();
    await service.check();
    await service.updateConch();
    await expect.poll(async () => (await service.status()).conch.running?.phase).toBe('restart');
    took.setVersion('0.3.0');
    service = took.make();
    service.start();
    await expect.poll(async () => (await service.status()).conch.latest).toBeUndefined();
    expect((await service.status()).conch.outcome?.kind).toBe('updated');
    service.stop();

    const didnt = await setup('ready');
    service = didnt.make();
    await service.check();
    await service.updateConch();
    await expect.poll(async () => (await service.status()).conch.running?.phase).toBe('restart');
    service = didnt.make(); // still 0.2.0: the installer was cancelled
    service.start();
    await expect.poll(async () => (await service.status()).conch.outcome?.kind).toBe('failed');
    expect((await service.status()).conch.outcome?.message).toMatch(
      /didn’t install, so you still have 0.2.0/,
    );
    expect((await service.status()).conch.latest?.version).toBe('0.3.0');
    service.stop();
  });

  it('a failed download says why, in a sentence, and can be tried again', async () => {
    const { make } = await setup('fail');
    const service = make();
    await service.check();
    await service.updateConch();
    await expect.poll(async () => (await service.status()).conch.outcome?.kind).toBe('failed');
    const conch = (await service.status()).conch;
    expect(conch.outcome?.message).toBe(
      'Conch couldn’t update itself: The download was interrupted.',
    );
    expect(conch.running).toBeUndefined();
    expect(conch.latest?.version).toBe('0.3.0');
  });

  it('an app that can’t replace itself offers its page instead', async () => {
    const { make, sent } = await setup('ready', 'download');
    const service = make();
    await service.check();
    const conch = (await service.status()).conch;
    expect(conch.blocked).toEqual({
      reason: expect.stringMatching(/Download it/),
      download: `${BASE}/tag/v0.3.0`,
    });
    await expect(service.updateConch()).rejects.toThrow(/Download it/);
    expect(sent).toEqual([]);
  });
});

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0))
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

it('does not let an unpublished desktop base version hide its first release', async () => {
  const { fake } = github([release('0.1.0'), release('0.1.0-beta.1')]);
  const { proc } = appChannel();
  const app = desktopApp({ CONCH_APP: 'C:\\Conch\\Conch.exe' }, proc);
  if (!app) throw new Error('no app');
  const releases = new AppReleases({
    app,
    repository: REPO,
    version: '0.1.0',
    development: true,
    platform: 'win32',
    fetch: fake,
  });
  expect((await releases.check({ channel: 'stable' })).offers.map((o) => o.version)).toEqual([
    '0.1.0',
  ]);
  expect((await releases.check({ channel: 'beta' })).offers.map((o) => o.version)).toEqual([
    '0.1.0',
    '0.1.0-beta.1',
  ]);
});
