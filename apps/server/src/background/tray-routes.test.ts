import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

// Password hashing is deliberately slow (scrypt); shared runners need headroom.
vi.setConfig({ testTimeout: 20_000 });

let home: string;
let services: Services;
let app: Awaited<ReturnType<typeof buildApp>>;
let token: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-tray-routes-'));
  services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  app = await buildApp(services);
  token = await services.tray.token();
});
afterAll(async () => {
  await app.close();
  services.search.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

const ask = (url: string, headers: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET') =>
  app.inject({ method, url, headers: { host: 'localhost:4317', ...headers } });

describe('the menu bar helper’s door', () => {
  it('opens for its token, from this computer, and says only counts', async () => {
    const res = await ask('/api/tray/status', { 'x-conch-tray': token });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual([
      'alwaysOn',
      'approvals',
      'devices',
      'name',
      'url',
    ]);
  });

  it('stays shut without it, with the wrong one, through a proxy, or from elsewhere', async () => {
    const wrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (const [headers, remoteAddress] of [
      [{}, '127.0.0.1'],
      [{ 'x-conch-tray': wrong }, '127.0.0.1'],
      [{ 'x-conch-tray': '' }, '127.0.0.1'],
      [{ 'x-conch-tray': `${token}x` }, '127.0.0.1'],
      [{ 'x-conch-tray': token, 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1'],
      [{ 'x-conch-tray': token, host: 'conch.example' }, '192.168.1.20'],
    ] as const) {
      for (const [method, url] of [
        ['GET', '/api/tray/status'],
        ['POST', '/api/tray/quit'],
        ['POST', '/api/tray/hide'],
      ] as const) {
        const res = await app.inject({
          method,
          url,
          remoteAddress,
          headers: { host: 'localhost:4317', ...headers },
        });
        expect(
          res.statusCode,
          `${method} ${url} ${JSON.stringify(headers)}`,
        ).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).not.toBe(200);
      }
    }
  });

  it('opens nothing else: its token isn’t a sign-in', async () => {
    const proxied = { 'x-conch-tray': token, 'x-forwarded-for': '203.0.113.9' };
    expect((await ask('/api/state', proxied)).statusCode).toBe(401);
    expect((await ask('/api/background', proxied)).statusCode).toBe(401);
  });

  it('Hide from the menu bar turns it off for good, until you turn it on', async () => {
    expect((await ask('/api/tray/hide', { 'x-conch-tray': token }, 'POST')).statusCode).toBe(200);
    expect((await services.settings.get()).preferences.menuBar).toBe(false);
  });
});

describe('a little computer', () => {
  it('keeping Conch running after logout needs a recent password; turning it off never does', async () => {
    const set = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      headers: { host: 'localhost:4317' },
      payload: { username: 'ada', password: 'purple otters juggle at dawn' },
    });
    expect(set.statusCode, set.body).toBe(200);
    const raw = set.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0] ?? '';
    // Ten minutes on, the sign-in is no longer "recent".
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    const put = (on: boolean) =>
      app.inject({
        method: 'PUT',
        url: '/api/background/after-logout',
        headers: { host: 'localhost:4317', cookie },
        payload: { on },
      });
    const blocked = await put(true);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('verify-required');
    expect((await put(false)).statusCode).toBe(200);
    vi.restoreAllMocks();
  });
});
