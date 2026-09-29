import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

// Password hashing is deliberately slow (scrypt); shared runners need headroom.
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'purple otters juggle at dawn';
let cleanup: (() => Promise<void>) | undefined;

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-browser-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = await buildApp(services);
  cleanup = async () => {
    await app.close();
    services.search?.index.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  };
  return { app, services };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0] ?? '';
};

describe('browser routes', () => {
  it('reports status and saves settings', async () => {
    const { app } = await setup();
    const status = BrowserStatus.parse((await app.inject('/api/browser')).json());
    expect(status.settings).toMatchObject({ enabled: true, allowLocal: false, autoOpen: true });
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/browser/settings',
      payload: { declineCookies: false },
    });
    expect(BrowserStatus.parse(saved.json()).settings.declineCookies).toBe(false);
  });

  it('needs a recent password to open this computer to the browser', async () => {
    const { app } = await setup();
    const set = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const cookie = cookieOf(set);
    // Ten minutes on, the sign-in is no longer "recent".
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    const blocked = await app.inject({
      method: 'PATCH',
      url: '/api/browser/settings',
      headers: { cookie },
      payload: { allowLocal: true },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('verify-required');
    // Turning it back off never needs that.
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/browser/settings',
      headers: { cookie },
      payload: { allowLocal: false },
    });
    expect(off.statusCode).toBe(200);
  });

  it('keeps the live view to this site, signed-in people and real chats', async () => {
    const { app } = await setup();
    const upgrade = { upgrade: 'websocket', connection: 'upgrade' };
    const foreign = await app.inject({
      url: '/api/browser/live?conversationId=c1',
      headers: { host: 'localhost:4317', origin: 'http://localhost:3000', ...upgrade },
    });
    expect(foreign.statusCode).toBe(403);
    // Another device, not signed in.
    await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const stranger = await app.inject({
      url: '/api/browser/live?conversationId=c1',
      remoteAddress: '192.168.1.20',
      headers: { host: 'localhost:4317', ...upgrade },
    });
    expect([401, 421]).toContain(stranger.statusCode);
  });

  it('refuses a live view for a chat that doesn’t exist', async () => {
    const { app } = await setup();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const ws = new WebSocket(
      `ws://localhost:${address.port}/api/browser/live?conversationId=nope_123`,
    );
    const code = await new Promise<number>((resolve) =>
      ws.addEventListener('close', (e) => resolve(e.code)),
    );
    expect(code).toBe(1008);
  });

  it('only serves thumbnails by id, never a path', async () => {
    const { app } = await setup();
    for (const url of [
      '/api/browser/shots/c1/..%2F..%2Fbrowser.json',
      '/api/browser/shots/..%2F..%2F/abcdefgh1234',
      '/api/browser/shots/c1/abcdefgh1234',
    ]) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
  });

  it('hands back only a tab that exists', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/browser/c1/control',
      payload: { to: 'agent' },
    });
    expect(res.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/browser/c1/control',
      payload: { to: 'root' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
