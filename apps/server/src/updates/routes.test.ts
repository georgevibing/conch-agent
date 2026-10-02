import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UpdatesStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { setRestartHandler } from '../lib/lifecycle';
import { Services } from '../services';

const PASSWORD = 'a long enough sentence for conch';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.CONCH_SUPERVISED;
  await close?.();
  close = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-updates-app-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  // The mock vendor starts in the background.
  await vi.waitUntil(() => Boolean(services.mockVendor?.base), { timeout: 5000 });
  close = async () => {
    services.integrations.stop();
    await services.mockVendor?.stop();
    await app.close();
    await services.updates.settled();
  };
  const signedIn = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
  return { app, services, cookie };
}

describe('restarting Conch over HTTP', () => {
  /** Conch running under `pnpm start`'s supervisor, with the restart it would do recorded. */
  function supervised() {
    const restarted = vi.fn(async () => undefined);
    process.env.CONCH_SUPERVISED = '1';
    setRestartHandler(restarted);
    return restarted;
  }
  const restartVia = (app: Awaited<ReturnType<typeof setup>>['app'], cookie: string) =>
    app.inject({ method: 'POST', url: '/api/gateway/restart', headers: { cookie }, payload: {} });

  it('asks you to confirm it’s you first: a stolen session can’t cut everyone off', async () => {
    const { app, cookie } = await setup();
    const restarted = supervised();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const blocked = await restartVia(app, cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({
      error: 'verify-required',
      message: 'Confirm it’s you to restart Conch.',
    });
    vi.restoreAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(restarted).not.toHaveBeenCalled();
  });

  it('won’t restart while a chat is working, and says so', async () => {
    const { app, services, cookie } = await setup();
    const restarted = supervised();
    vi.spyOn(services.conversations, 'busy').mockReturnValue(true);
    const busy = await restartVia(app, cookie);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({
      error: 'busy',
      message: 'A chat is still working. Wait for it to finish, then restart Conch.',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(restarted).not.toHaveBeenCalled();
  });

  it('restarts right after you’ve confirmed it’s you, when nothing is running', async () => {
    const { app, cookie } = await setup();
    const restarted = supervised();
    const ok = await restartVia(app, cookie);
    expect(ok.statusCode).toBe(202);
    await vi.waitUntil(() => restarted.mock.calls.length > 0, { timeout: 2000 });
  });

  it('says how to restart by hand where it can’t itself', async () => {
    const { app, cookie } = await setup();
    const res = await restartVia(app, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not-restartable');
  });
});

describe('updates over HTTP', () => {
  it('checks freely, and lists the (pretend) programs with what’s newer', async () => {
    const { app, services, cookie } = await setup();
    const first = UpdatesStatus.parse(
      (await app.inject({ url: '/api/updates', headers: { cookie } })).json(),
    );
    // The mock engine never looks at a real checkout.
    expect(first.conch.checkable).toBe(false);
    const checking = await app.inject({
      method: 'POST',
      url: '/api/updates/check',
      headers: { cookie },
      payload: {},
    });
    expect(checking.statusCode).toBe(200);
    await services.updates.check();
    const status = UpdatesStatus.parse(
      (await app.inject({ url: '/api/updates', headers: { cookie } })).json(),
    );
    expect(status.programs.find((p) => p.name === 'Codex')).toMatchObject({
      installed: '0.159.0',
      latest: '0.160.0',
      available: true,
    });
  });

  it('asks you to confirm it’s you before installing anything, or letting it install by itself', async () => {
    const { app, cookie } = await setup();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    for (const url of [
      '/api/updates/conch',
      '/api/updates/programs',
      '/api/updates/programs/mock-codex',
    ]) {
      const blocked = await app.inject({ method: 'POST', url, headers: { cookie }, payload: {} });
      expect(blocked.statusCode, url).toBe(403);
      expect(blocked.json().error).toBe('verify-required');
    }
    const on = await app.inject({
      method: 'PATCH',
      url: '/api/updates/settings',
      headers: { cookie },
      payload: { auto: true },
    });
    expect(on.json().error).toBe('verify-required');
    // Turning it off takes nothing away from you, so it doesn't ask.
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/updates/settings',
      headers: { cookie },
      payload: { auto: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().auto).toBe(false);
    // Less settled releases, every change on main, and going back change what runs: they ask too.
    for (const payload of [{ channel: 'beta' }, { channel: 'alpha' }, { everyChange: true }]) {
      const raised = await app.inject({
        method: 'PATCH',
        url: '/api/updates/settings',
        headers: { cookie },
        payload,
      });
      expect(raised.json().error, JSON.stringify(payload)).toBe('verify-required');
    }
    const back = await app.inject({
      method: 'POST',
      url: '/api/updates/conch/back',
      headers: { cookie },
      payload: {},
    });
    expect(back.json().error).toBe('verify-required');
    // Back to stable, and putting a notice away, take nothing from you.
    for (const payload of [
      { channel: 'stable' },
      { everyChange: false },
      { dismiss: '0.3.0' },
      { dismissNotice: 'releases' },
    ]) {
      const calm = await app.inject({
        method: 'PATCH',
        url: '/api/updates/settings',
        headers: { cookie },
        payload,
      });
      expect(calm.statusCode, JSON.stringify(payload)).toBe(200);
    }
    const nothing = await app.inject({
      method: 'PATCH',
      url: '/api/updates/settings',
      headers: { cookie },
      payload: {},
    });
    expect(nothing.statusCode).toBe(400);
    const junk = await app.inject({
      method: 'PATCH',
      url: '/api/updates/settings',
      headers: { cookie },
      payload: { channel: 'nightly' },
    });
    expect(junk.statusCode).toBe(400);
  });

  it('updates only programs it knows, whatever the address says', async () => {
    const { app, services, cookie } = await setup();
    await services.updates.check();
    for (const id of ['nope', '..%2F..%2Fcalc', 'codex%20%26%20calc']) {
      const unknown = await app.inject({
        method: 'POST',
        url: `/api/updates/programs/${id}`,
        headers: { cookie },
        payload: {},
      });
      expect(unknown.statusCode, id).toBe(404);
    }
    const started = await app.inject({
      method: 'POST',
      url: '/api/updates/programs/mock-codex',
      headers: { cookie },
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    await services.updates.settled();
    const codex = (await services.updates.status()).programs.find((p) => p.id === 'mock-codex');
    expect(codex).toMatchObject({ installed: '0.160.0', available: false });
    // Conch's own update has nothing to update here, and says so.
    const conch = await app.inject({
      method: 'POST',
      url: '/api/updates/conch',
      headers: { cookie },
      payload: {},
    });
    expect(conch.statusCode).toBe(503);
  });
});
