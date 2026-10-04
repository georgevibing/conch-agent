import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { NOT_HERE, onThisComputer } from '../test/here';
import type { AddressStatus } from './service';

/**
 * Who may change where Conch can be reached (ADR 0064): the owner in a
 * browser on a device that's let in, after confirming it's them, or this
 * computer (its terminal, with the key). Never a script's access key, never
 * a device still waiting, never a guess at the hello link.
 */

vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'purple otters juggle at dawn';
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-address-routes-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    CONCH_ALLOWED_HOSTS: 'conch.example',
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  const checking: AddressStatus = { state: 'checking', name: 'conch.example.com' };
  const set = vi.spyOn(services.address, 'set').mockResolvedValue(checking);
  vi.spyOn(services.address, 'renew').mockResolvedValue(checking);
  return { app, services, set };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** Somewhere else, through a proxy on this computer that says it relayed HTTPS. */
const remote = (app: App, cookie?: string, extra: Record<string, string> = {}) => ({
  put: (url: string, payload: object) =>
    app.inject({
      method: 'PUT',
      url,
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'conch.example',
        'x-forwarded-for': '203.0.113.20',
        'x-forwarded-proto': 'https',
        [NOT_HERE]: '1',
        ...(cookie && { cookie }),
        ...extra,
      },
      payload,
    }),
});

describe('your address, from Settings', () => {
  it('lets this computer set it, after confirming it’s you', async () => {
    const { app, set } = await setup();
    const owner = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    expect(owner.statusCode).toBe(200);
    // Choosing a password signed this browser in; it stays signed in, and just confirmed it's you.
    const raw = owner.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((line) => line.split(';')[0])
      .join('; ');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/address',
      headers: { cookie },
      payload: { name: 'https://Conch.Example.com/' },
    });
    expect(res.statusCode).toBe(200);
    expect(set).toHaveBeenCalledWith('conch.example.com', 'conch');

    // Through a tunnel of your own: a name inside your network is fine there.
    const proxied = await app.inject({
      method: 'PUT',
      url: '/api/address',
      headers: { cookie },
      payload: { name: 'conch.home.lan', via: 'proxy' },
    });
    expect(proxied.statusCode).toBe(200);
    expect(set).toHaveBeenLastCalledWith('conch.home.lan', 'proxy');
  });

  it('never lets a script’s access key change where Conch can be reached', async () => {
    const { app, services, set } = await setup();
    const { key } = await services.access.addKey('Script');
    const res = await remote(app, undefined, { authorization: `Bearer ${key}` }).put(
      '/api/address',
      { name: 'evil.example.com' },
    );
    expect(res.statusCode).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses a name that isn’t an address, in words', async () => {
    const { app, set } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/address',
      payload: { name: '192.168.1.5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad-name');
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps renewing (Let’s Encrypt’s limits) to the owner too', async () => {
    const { app, services } = await setup();
    const { key } = await services.access.addKey('Script');
    const res = await app.inject({
      method: 'POST',
      url: '/api/address/renew',
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'conch.example',
        'x-forwarded-for': '203.0.113.20',
        'x-forwarded-proto': 'https',
        [NOT_HERE]: '1',
        authorization: `Bearer ${key}`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(services.address.renew).not.toHaveBeenCalled();
  });
});

describe('your address, from the terminal', () => {
  it('has no door on the port: conch setup writes the file instead (ADR 0063)', async () => {
    const { app, set } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/here/address',
      payload: { name: 'conch.example.com' },
    });
    expect(res.statusCode).toBe(404);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('the hello link, checked from outside', () => {
  it('never tells a guess this computer’s account name', async () => {
    const { app, services } = await setup();
    const { code } = await services.access.createHello();
    const ask = (body: object) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/hello',
        remoteAddress: '127.0.0.1',
        headers: {
          host: 'conch.example',
          'x-forwarded-for': '203.0.113.20',
          'x-forwarded-proto': 'https',
          [NOT_HERE]: '1',
        },
        payload: body,
      });
    expect((await ask({ code: 'a-guess' })).json()).toMatchObject({
      ok: false,
      suggestedUsername: '',
    });
    expect((await ask({ code })).json().suggestedUsername).not.toBe('');
  });
});

describe('the way-in check, through a proxy of your own', () => {
  const ask = (app: App, nonce: string, host = 'conch.example') =>
    app.inject({ method: 'GET', url: `/.well-known/conch-check/${nonce}`, headers: { host } });

  it('answers a check Conch is making, with no sign-in, and nothing else', async () => {
    const { app, services } = await setup();
    // Sign-in is on: the check still answers, because it's not under /api and says nothing.
    await services.access.setPassword('ada', PASSWORD);
    services.address.checks.set('n0nce', 'the-token');
    const res = await ask(app, 'n0nce');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('the-token');
    expect((await ask(app, 'another')).statusCode).toBe(404);
    expect((await ask(app, '..%2F..%2Fapi%2Fstate')).statusCode).toBe(404);
  });

  it('gives the token only under the name being checked', async () => {
    const { app, services } = await setup();
    vi.spyOn(services.address, 'status').mockReturnValue({
      state: 'checking',
      name: 'conch.example',
      via: 'proxy',
    });
    services.address.checks.set('n0nce', 'the-token');
    expect((await ask(app, 'n0nce', 'conch.example:443')).body).toBe('the-token');
    // nginx's default sends its upstream's address: allowed, but not the name.
    expect((await ask(app, 'n0nce', '127.0.0.1:4317')).body).toBe('wrong-host');
  });

  it('still only to a name Conch answers to', async () => {
    const { app, services } = await setup();
    services.address.checks.set('n0nce', 'the-token');
    expect((await ask(app, 'n0nce', 'evil.example')).statusCode).toBe(421);
  });
});
