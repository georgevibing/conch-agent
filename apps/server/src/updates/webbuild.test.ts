import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Setup, type LatestLookup } from '../setup/needs';
import { ConchCheckout, type Stream } from './conch';
import { updatesCheck } from './doctor';
import { UpdatesService } from './service';
import { freshness, parseStamp, readStamp, type WebFreshness } from './webbuild';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('the web app’s stamp', () => {
  it('reads the commit and the time, and nothing else', () => {
    expect(parseStamp(JSON.stringify({ commit: A, builtAt: '2026-10-08T10:00:00.000Z' }))).toEqual({
      commit: A,
      builtAt: '2026-10-08T10:00:00.000Z',
    });
    // Built without git: when, not what.
    expect(parseStamp('{"builtAt":"2026-10-08T10:00:00.000Z"}')).toEqual({
      builtAt: '2026-10-08T10:00:00.000Z',
    });
    expect(parseStamp(JSON.stringify({ commit: 'main; rm -rf /', builtAt: 7 }))).toEqual({});
    expect(parseStamp('not json')).toBeUndefined();
    expect(parseStamp('[1]')).toBeUndefined();
    expect(parseStamp('null')).toBeUndefined();
  });
});

describe('telling a web app built from other code', () => {
  const stamp = { commit: A, builtAt: 't' };

  it('is stale when it names another commit', () => {
    expect(freshness({ built: true, stamp, head: B })).toEqual({
      state: 'stale',
      why: 'commit',
      head: B,
      built: A,
    });
  });

  it('is stale when it was built before builds were stamped', () => {
    expect(freshness({ built: true, stamp: undefined, head: A })).toEqual({
      state: 'stale',
      why: 'missing',
      head: A,
    });
  });

  it('is fresh at the same commit', () => {
    expect(freshness({ built: true, stamp, head: A })).toEqual({ state: 'fresh' });
  });

  it('leaves it alone when it can’t tell: no git, nothing built, a build made without git', () => {
    expect(freshness({ built: true, stamp, head: undefined })).toEqual({ state: 'unknown' });
    expect(freshness({ built: true, stamp: undefined, head: undefined })).toEqual({
      state: 'unknown',
    });
    expect(freshness({ built: false, stamp: undefined, head: A })).toEqual({ state: 'unknown' });
    expect(freshness({ built: true, stamp: { builtAt: 't' }, head: A })).toEqual({
      state: 'unknown',
    });
  });
});

// ── Building it again, with a pretend pnpm ────────────────────────────────

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: 'pipe' }).trim();

/**
 * A checkout whose web app was built at `built` (a commit; `null`: before
 * stamps; omitted: never built), and a pnpm that builds it at HEAD, or fails,
 * or waits until it's let go.
 */
async function checkout({ built }: { built?: string | null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'conch-web-'));
  dirs.push(root);
  git(root, 'init', '--quiet', '-b', 'main');
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'feat: the first version');
  const head = git(root, 'rev-parse', 'HEAD');
  const dist = join(root, 'apps', 'web', 'dist');
  if (built !== undefined) {
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<p>old</p>');
    if (built)
      await writeFile(join(dist, 'build.json'), JSON.stringify({ commit: built, builtAt: 'old' }));
  }
  const runs: string[] = [];
  const args: string[][] = [];
  let fail = false;
  let hold: Promise<void> | undefined;
  let letGo = () => {};
  const stream: Stream = async (_program, given, { cwd }) => {
    const step = given.includes('build') ? 'build' : 'install';
    runs.push(step);
    args.push(given);
    if (hold) await hold;
    if (fail) return { code: 1, tail: 'ERR_PNPM something broke' };
    if (step === 'build') {
      // Where `vite build --outDir` would write, as `--emptyOutDir` leaves it.
      const at = given.indexOf('--outDir');
      const out = join(cwd, 'apps/web', at === -1 ? 'dist' : (given[at + 1] ?? 'dist'));
      await mkdir(out, { recursive: true });
      await writeFile(join(out, 'index.html'), '<p>new</p>');
      await writeFile(
        join(out, 'build.json'),
        JSON.stringify({ commit: git(cwd, 'rev-parse', 'HEAD'), builtAt: 'new' }),
      );
    }
    return { code: 0, tail: '' };
  };
  const conch = new ConchCheckout(root, {
    pnpm: async () => ({ command: process.execPath, prefix: [] }),
    stream,
  });
  return {
    root,
    head,
    dist,
    conch,
    runs,
    args,
    failing: () => (fail = true),
    holding: () => {
      hold = new Promise((resolve) => (letGo = resolve));
      return () => letGo();
    },
  };
}

const lookup: LatestLookup = {
  npm: async () => undefined,
  winget: async () => undefined,
  brew: async () => undefined,
  pypi: async () => undefined,
  github: async () => undefined,
};

async function gateway(conch: ConchCheckout, { freshWeb = true }: { freshWeb?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-web-home-'));
  dirs.push(home);
  const healed: string[] = [];
  const seen: (string | undefined)[] = [];
  const specs = new Map();
  const service = new UpdatesService({
    home,
    setup: new Setup(specs, { platform: 'linux' }),
    specs,
    lookup,
    conch,
    freshWeb,
    version: '0.2.0',
    bootId: 'boot-1',
    emit: (status) => seen.push(status.webBuilt),
    heal: (message) => healed.push(message),
    busy: () => false,
    landed: async () => undefined,
    restartable: () => true,
    restart: () => true,
    schedule: false,
    restartDelayMs: 0,
  });
  return { service, home, healed, seen };
}

describe('a web app older than the code that was pulled', () => {
  it('is built again in the background when the gateway starts, and pages hear of it', async () => {
    const web = await checkout({ built: B });
    const { service, healed, seen } = await gateway(web.conch);
    expect((await service.status()).webBuilt).toBe('old');
    service.start();
    await vi.waitFor(() =>
      expect(healed).toEqual([
        'Rebuilt the app to match the code that was pulled. Open pages offer to reload.',
      ]),
    );
    service.stop();
    // Built, not installed: the gateway that's running keeps its parts.
    expect(web.runs).toEqual(['build']);
    expect(readStamp(web.dist)?.commit).toBe(web.head);
    expect(seen.at(-1)).toBe('new');
    expect((await service.status()).webBuilt).toBe('new');
  });

  it('builds one stamped before builds said what they were built from', async () => {
    const web = await checkout({ built: null });
    const { service, healed } = await gateway(web.conch);
    expect(await service.freshenWeb()).toBe('rebuilt');
    expect(healed).toEqual(['Rebuilt the app to match Conch’s code. Open pages offer to reload.']);
  });

  it('leaves one built from the code that’s here, or nothing built, alone', async () => {
    const fresh = await checkout();
    await mkdir(fresh.dist, { recursive: true });
    await writeFile(join(fresh.dist, 'index.html'), '<p>here</p>');
    await writeFile(join(fresh.dist, 'build.json'), JSON.stringify({ commit: fresh.head }));
    expect(await (await gateway(fresh.conch)).service.freshenWeb()).toBe('fresh');
    const none = await checkout();
    expect(await (await gateway(none.conch)).service.freshenWeb()).toBe('unknown');
    expect([...fresh.runs, ...none.runs]).toEqual([]);
  });

  it('never builds for a dev server, the desktop app or a release folder', async () => {
    const web = await checkout({ built: B });
    const { service, healed } = await gateway(web.conch, { freshWeb: false });
    service.start();
    expect(await service.freshenWeb()).toBe('unknown');
    service.stop();
    expect(web.runs).toEqual([]);
    expect(healed).toEqual([]);
    expect((await service.status()).webBuilt).toBeUndefined();
  });

  it('keeps the old one, and says nothing as fixed, when building doesn’t work', async () => {
    const web = await checkout({ built: B });
    web.failing();
    const { service, healed } = await gateway(web.conch);
    expect(await service.freshenWeb()).toBe('failed');
    expect(healed).toEqual([]);
    expect(await readFile(join(web.dist, 'index.html'), 'utf8')).toBe('<p>old</p>');
  });

  it('builds once however many ask, and an update waits for it', async () => {
    const web = await checkout({ built: B });
    const release = web.holding();
    const { service } = await gateway(web.conch);
    const first = service.freshenWeb();
    const second = service.freshenWeb();
    await vi.waitFor(() => expect(web.runs).toEqual(['build']));
    expect(web.conch.webBuilding).toBe(true);
    const updating = web.conch.update(() => undefined);
    release();
    expect(await first).toBe('rebuilt');
    expect(await second).toBe('rebuilt');
    // Built from the code that's here by then: nothing more to build (and nowhere to update from).
    expect(await updating).toMatchObject({ kind: 'refused' });
    expect(web.runs).toEqual(['build']);
  });
});

describe('swapping the new web app in', () => {
  it('builds beside the one serving, which stays whole until two renames swap them', async () => {
    const web = await checkout({ built: B });
    const release = web.holding();
    const building = web.conch.buildWeb();
    await vi.waitFor(() => expect(web.runs).toEqual(['build']));
    expect(web.args[0]).toEqual([
      '--filter',
      '@conch/web',
      'build',
      '--outDir',
      'dist.next',
      '--emptyOutDir',
    ]);
    // While it builds, the app serving is untouched.
    expect(await readFile(join(web.dist, 'index.html'), 'utf8')).toBe('<p>old</p>');
    release();
    expect(await building).toMatchObject({ ok: true });
    expect(await readFile(join(web.dist, 'index.html'), 'utf8')).toBe('<p>new</p>');
    expect(readStamp(web.dist)?.commit).toBe(web.head);
    // The one replaced stays for its old parts, until the next start.
    expect(await readFile(join(web.conch.distOld, 'index.html'), 'utf8')).toBe('<p>old</p>');
    expect(existsSync(web.conch.distNext)).toBe(false);
  });

  it('leaves the app serving as it was when the build fails', async () => {
    const web = await checkout({ built: B });
    web.failing();
    expect(await web.conch.buildWeb()).toEqual({ ok: false, why: 'build' });
    expect(await readFile(join(web.dist, 'index.html'), 'utf8')).toBe('<p>old</p>');
    expect(existsSync(web.conch.distNext)).toBe(false);
    expect(existsSync(web.conch.distOld)).toBe(false);
  });

  it('clears what the last run left beside the app when the gateway starts', async () => {
    const web = await checkout({ built: null });
    // Built from the code that's here: nothing to build again.
    await writeFile(join(web.dist, 'build.json'), JSON.stringify({ commit: web.head }));
    await mkdir(web.conch.distNext, { recursive: true });
    await writeFile(join(web.conch.distNext, 'index.html'), '<p>half</p>');
    await mkdir(web.conch.distOld, { recursive: true });
    const { service } = await gateway(web.conch);
    service.start();
    await vi.waitFor(() => expect(existsSync(web.conch.distOld)).toBe(false));
    service.stop();
    expect(existsSync(web.conch.distNext)).toBe(false);
    expect(await readFile(join(web.dist, 'index.html'), 'utf8')).toBe('<p>old</p>');
    expect(web.runs).toEqual([]);
  });
});

describe('Repair everything’s look at the web app', () => {
  const look = { repair: false, signal: new AbortController().signal };
  const repair = { repair: true, signal: new AbortController().signal };

  it('reports an accepted repair while its first freshness read is still pending', async () => {
    const web = await checkout({ built: B });
    const { service } = await gateway(web.conch);
    const before = await web.conch.webFreshness();
    let release!: (value: WebFreshness) => void;
    vi.spyOn(web.conch, 'webFreshness').mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const refreshing = service.freshenWeb();
    const pending = await service.web();
    release(before);
    expect(await refreshing).toBe('rebuilt');
    expect(pending?.building).toBe(true);
    expect((await service.web())?.building).toBe(false);
  });

  it('offers to rebuild one older than its code, and rebuilds it on Repair', async () => {
    const web = await checkout({ built: B });
    const release = web.holding();
    const { service, home, healed } = await gateway(web.conch);
    const doctor = updatesCheck(service, home);
    expect(await doctor.run(look)).toContainEqual(
      expect.objectContaining({
        id: 'updates:web',
        state: 'warning',
        repairable: true,
        message:
          'Conch’s app is older than its code, so some of what’s new isn’t showing. Repair rebuilds it.',
      }),
    );
    // It doesn't wait out a build: Conch is seeing to it.
    expect(await doctor.run(repair)).toContainEqual(
      expect.objectContaining({ id: 'updates:web', state: 'info' }),
    );
    expect(await doctor.run(look)).toContainEqual(
      expect.objectContaining({
        id: 'updates:web',
        state: 'info',
        message: 'Conch is rebuilding its app to match its code. Open pages offer to reload.',
      }),
    );
    release();
    await vi.waitFor(() => expect(healed).toHaveLength(1));
    expect((await doctor.run(look)).find((item) => item.id === 'updates:web')).toBeUndefined();
  });

  it('shows what to run when rebuilding it didn’t work', async () => {
    const web = await checkout({ built: B });
    web.failing();
    const { service, home } = await gateway(web.conch);
    await service.freshenWeb();
    const item = (await updatesCheck(service, home).run(look)).find((i) => i.id === 'updates:web');
    expect(item).toMatchObject({
      state: 'warning',
      action: {
        kind: 'command',
        label: 'Rebuild it',
        command: expect.stringContaining('pnpm --filter @conch/web build'),
      },
    });
  });

  it('says nothing about a copy that doesn’t keep its own web app', async () => {
    const web = await checkout({ built: B });
    const { service, home } = await gateway(web.conch, { freshWeb: false });
    const items = await updatesCheck(service, home).run(look);
    expect(items.find((i) => i.id === 'updates:web')).toBeUndefined();
  });
});
