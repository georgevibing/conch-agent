import type * as FsPromises from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { LoginState } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import { readStore } from '../../lib/recover';
import { deviceSealer, registerSealer, unregisterSealer } from '../../lib/sealed';
import { ProviderKeys } from '../../providers/keys';
import { SettingsStore } from '../../settings/store';
import { fakeCodexApp } from '../../test/fakeCodexApp';
import { CodexEngine } from './app-engine';
import { CodexHome } from './home';
import { CodexRefusal } from './rpc';

/**
 * Windows keeps a program's open files locked for a moment after it has
 * exited, and Codex keeps several databases open in its run folder. `held`
 * plays that part on every platform: removing a run folder is refused while
 * it's set.
 */
const lock = vi.hoisted(() => ({ held: false, refused: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>();
  const rm: typeof real.rm = async (path, options) => {
    if (lock.held && options?.recursive && /^run-/.test(basename(String(path)))) {
      lock.refused++;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${String(path)}'`), {
        code: 'EBUSY',
      });
    }
    return real.rm(path, options);
  };
  return { ...real, default: { ...real, rm }, rm };
});

const homes: string[] = [];
afterEach(() => {
  lock.held = false;
  lock.refused = 0;
  for (const home of homes.splice(0)) unregisterSealer(home);
});

async function setup(options: Parameters<typeof fakeCodexApp>[0] = {}) {
  const fake = await fakeCodexApp(options);
  const home = await mkdtemp(join(tmpdir(), 'conch-codex-home-'));
  homes.push(home);
  registerSealer(
    home,
    deviceSealer(async () => Buffer.alloc(32, 1)),
  );
  const settings = new SettingsStore(home);
  const engine = new CodexEngine(settings, new ProviderKeys(settings), fake.bin);
  const runs = join(home, 'codex-runtime');
  /** Every file left in a run folder, as `run-…/name`. */
  const left = async () =>
    (
      await Promise.all(
        (await readdir(runs)).map(async (run) =>
          (await readdir(join(runs, run))).map((name) => `${run}/${name}`),
        ),
      )
    ).flat();
  return { engine, home, runs, left, bin: fake.bin };
}

async function login(engine: CodexEngine) {
  const states: LoginState[] = [];
  await new Promise<void>((done) =>
    engine.login('subscription', (state) => {
      states.push(state);
      if (['done', 'failed', 'cancelled'].includes(state.phase)) done();
    }),
  );
  return states;
}

describe('the Codex run folder', () => {
  it('counts a sign-in that worked, even when its folder can’t be removed yet', async () => {
    const { engine, runs, left } = await setup();
    lock.held = true;
    const states = await login(engine);
    expect(states.at(-1)).toMatchObject({ phase: 'done' });
    expect(lock.refused).toBeGreaterThan(0);
    // The sign-in itself never waits in the clear for a later sweep.
    expect((await left()).filter((file) => file.endsWith('auth.json'))).toEqual([]);

    // Still held at the next check: the account is read all the same.
    expect((await engine.detect({ force: true })).state).toBe('ready');
    expect((await left()).filter((file) => file.endsWith('auth.json'))).toEqual([]);

    // Once the files are let go, the next run takes every leftover with it.
    lock.held = false;
    expect((await engine.detect({ force: true })).state).toBe('ready');
    expect(await readdir(runs)).toEqual([]);
  });

  it('starts a run when an older folder is still held', async () => {
    const { engine, runs } = await setup({ signedIn: true });
    // A folder from a Conch that is gone: no such process owns it any more.
    const dead = join(runs, 'run-dead0');
    await mkdir(dead, { recursive: true });
    await writeFile(join(dead, 'owner.json'), '2147483646');
    lock.held = true;
    expect((await engine.detect({ force: true })).state).toBe('ready');
    lock.held = false;
    expect((await engine.detect({ force: true })).state).toBe('ready');
    expect(await readdir(runs)).toEqual([]);
  });

  it('never shows a system error as the reason a sign-in failed', async () => {
    const { engine, home } = await setup();
    // Nothing can be written where the run folders go.
    await writeFile(join(home, 'codex-runtime'), 'not a folder');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const last = (await login(engine)).at(-1);
    // The real reason is kept for whoever reads the gateway's output.
    expect(logged).toHaveBeenCalledWith(
      '[codex] sign-in',
      expect.objectContaining({ code: 'EEXIST' }),
    );
    logged.mockRestore();
    expect(last?.phase).toBe('failed');
    expect(last?.message).toBe(
      'Conch couldn’t set up the sign-in on this computer. Please try again.',
    );
  });
});

describe('the saved Codex sign-in', () => {
  const saved = async (home: string) =>
    (await readStore(join(home, 'codex.secrets.json'), z.object({ auth: z.unknown().optional() })))
      .value.auth;

  it('keeps the sign-in when a run ends without Codex’s file', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    const before = await saved(home);
    expect(before).toBeDefined();

    // Codex tidied its file away, or the run stopped short: not a sign-out.
    await new CodexHome(home).withClient(bin, (rpc) => rpc.request('test/lose', {}));
    expect(await saved(home)).toEqual(before);
    expect((await engine.detect({ force: true })).state).toBe('ready');
  });

  it('forgets it when you disconnect', async () => {
    const { engine, home } = await setup();
    await login(engine);
    await engine.disconnect();
    expect(await saved(home)).toBeUndefined();
    expect((await engine.detect({ force: true })).state).toBe('signed-out');
  });

  it('keeps a renewed sign-in while the run is still going', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    await new CodexHome(home).withClient(bin, async (rpc) => {
      // Codex renews its token mid-turn; Conch could be stopped any moment now
      // (a restart, a crash), so the new one is saved before the run ends.
      await rpc.request('test/renew', {});
      await vi.waitFor(
        async () =>
          expect(await saved(home)).toMatchObject({ tokens: { access_token: 'renewed-token' } }),
        { timeout: 5000, interval: 100 },
      );
    });
  });
});

describe('Codex and Codex CLI side by side', () => {
  const token = async (rpc: { request: (m: string, p: unknown) => Promise<unknown> }) =>
    ((await rpc.request('test/token', {})) as { token: string | null }).token;

  it('runs at once, and a new run never takes a live one’s sign-in away', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    // Codex CLI is the second provider on the same sign-in.
    const agent = new CodexEngine(
      new SettingsStore(home),
      new ProviderKeys(new SettingsStore(home)),
      bin,
      undefined,
      'agent',
    );
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const long = new CodexHome(home).withClient(bin, async (rpc) => {
      await held;
      // Still signed in after the other provider started and finished runs.
      return token(rpc);
    });
    // While that turn goes on, the other provider checks in, more than once, without waiting.
    expect((await agent.detect({ force: true })).state).toBe('ready');
    expect((await engine.detect({ force: true })).state).toBe('ready');
    release();
    expect(await long).toBe('test-only-token');
  });

  it('hands a renewal to every run still going, and an older run never puts back the old one', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    const saved = async () =>
      (
        await readStore(
          join(home, 'codex.secrets.json'),
          z.object({ auth: z.unknown().optional() }),
        )
      ).value.auth;
    let renewed!: () => void;
    const afterRenewal = new Promise<void>((done) => (renewed = done));
    const older = new CodexHome(home).withClient(bin, async (rpc) => {
      await afterRenewal;
      await vi.waitFor(async () => expect(await token(rpc)).toBe('renewed-token'), {
        timeout: 5000,
        interval: 100,
      });
    });
    await new CodexHome(home).withClient(bin, async (rpc) => {
      await rpc.request('test/renew', {});
      await vi.waitFor(
        async () =>
          expect(await saved()).toMatchObject({ tokens: { access_token: 'renewed-token' } }),
        { timeout: 5000, interval: 100 },
      );
    });
    renewed();
    await older;
    expect(await saved()).toMatchObject({ tokens: { access_token: 'renewed-token' } });
  });
});

describe('disconnecting while a turn runs', () => {
  it('stays disconnected, whatever that turn renews afterwards', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const turn = new CodexHome(home).withClient(bin, async (rpc) => {
      await held;
      await rpc.request('test/renew', {});
    });
    await engine.disconnect();
    release();
    await turn;
    const saved = await readStore(
      join(home, 'codex.secrets.json'),
      z.object({ auth: z.unknown().optional() }),
    );
    expect(saved.value.auth).toBeUndefined();
  });
});

describe('a request Codex refuses', () => {
  it('says why, without anything that looks like a credential', async () => {
    const { engine, home, bin } = await setup();
    await login(engine);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error: unknown = await new CodexHome(home)
      .withClient(bin, (rpc) => rpc.request('test/refuse', {}))
      .catch((e: unknown) => e);
    if (!(error instanceof CodexRefusal)) throw new Error('expected a refusal');
    expect(error.method).toBe('test/refuse');
    expect(error.message).toContain('unknown field "x"');
    expect(error.message).not.toMatch(/abc\.def|ABCDEFGHIJKLMNOP/);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[codex] test/refuse refused:'));
    logged.mockRestore();
  });
});
