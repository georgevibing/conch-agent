import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VIDEO_PLAYER_ORIGINS } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { NOT_HERE, onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { AccessStore } from './store';

// The launcher installed on the test machine must not change this fixture.
vi.mock('../cli/command', () => ({ cliName: () => 'pnpm conch' }));

// Password hashing is deliberately slow (scrypt, N=2^17); shared CI runners need headroom.
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'purple otters juggle at dawn';
const REMOTE = { remoteAddress: '192.168.1.20', host: 'conch.example' };

async function setup(env: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-auth-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    CONCH_ALLOWED_HOSTS: 'conch.example',
    ...env,
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  return { app, services, home };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

type App = Awaited<ReturnType<typeof setup>>['app'];

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  const value = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return value.split(';')[0] ?? '';
};

async function remote(
  app: App,
  url: string,
  init: { method?: string; cookie?: string; payload?: object; authorization?: string } = {},
) {
  return app.inject({
    method: (init.method ?? 'GET') as 'GET',
    url,
    remoteAddress: REMOTE.remoteAddress,
    headers: {
      host: REMOTE.host,
      ...(init.cookie && { cookie: init.cookie }),
      ...(init.authorization && { authorization: init.authorization }),
    },
    ...(init.payload && { payload: init.payload }),
  });
}

async function withPassword(app: App) {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}

describe('with sign-in off', () => {
  it('lets this computer in and refuses everyone else', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/state')).statusCode).toBe(200);
    expect((await app.inject('/api/auth')).json()).toEqual({
      method: 'none',
      signedIn: true,
      setupRequired: false,
      here: 'proven',
      secure: true,
    });
    const other = await remote(app, '/api/state');
    expect(other.statusCode).toBe(401);
    expect(other.json().error).toBe('setup-required');
  });

  it('does not trust a loopback socket that a proxy relayed', async () => {
    const { app } = await setup();
    const proxied = await app.inject({
      url: '/api/state',
      headers: { host: 'conch.example', 'x-forwarded-for': '203.0.113.9' },
    });
    expect(proxied.statusCode).toBe(401);
    const vite = await app.inject({
      url: '/api/state',
      headers: { host: 'localhost:5173', 'x-forwarded-for': '192.168.1.3' },
    });
    expect(vite.statusCode).toBe(401);
  });
});

/**
 * "This computer", proven (ADR 0063). Looking local isn't enough: nginx's
 * `proxy_pass http://127.0.0.1:4317;` sends `Host: 127.0.0.1:4317` and no
 * forwarding header, and another account on this computer connects from
 * loopback too. Only the key (a program) or the cookie made with it (a
 * browser opened from Conch) makes a request "this computer".
 */
describe('this computer, proven', () => {
  /** What arrives through nginx's defaults, or from another account here: looks local, no proof. */
  const hidden = (app: App, url: string, init: { method?: string; cookie?: string } = {}) =>
    app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url,
      headers: {
        host: '127.0.0.1:4317',
        [NOT_HERE]: '1',
        ...(init.cookie && { cookie: init.cookie }),
      },
    });

  /** A launcher with the key asks for a link; the browser redeems its code. */
  async function openedFromConch(app: App, page = '/') {
    const link = await app.inject({ method: 'POST', url: '/api/here/link', payload: { page } });
    expect(link.statusCode).toBe(200);
    const { code, url } = link.json() as { code: string; url: string };
    const redeemed = await app.inject({
      method: 'POST',
      url: '/api/here',
      headers: { [NOT_HERE]: '1' },
      payload: { code },
    });
    expect(redeemed.statusCode).toBe(200);
    return { cookie: cookieOf(redeemed), code, url };
  }

  it('turns away a proxy that hides itself, and another account on this computer', async () => {
    const { app } = await setup();
    const state = await hidden(app, '/api/state');
    expect(state.statusCode).toBe(401);
    expect(state.json().error).toBe('here-required');
    expect(state.json().message).toMatch(/open Conch from your apps/);
    for (const [method, url] of [
      ['GET', '/api/conversations'],
      ['POST', '/api/terminal'],
      ['GET', '/api/access'],
      ['GET', '/ws'],
    ] as const)
      expect((await hidden(app, url, { method })).statusCode).toBe(401);
    expect((await hidden(app, '/api/auth')).json()).toMatchObject({
      signedIn: false,
      setupRequired: false,
      hereRequired: true,
      here: 'unproven',
    });
  });

  it('lets in a browser opened from Conch, with a cookie for this port only', async () => {
    const { app } = await setup();
    const { cookie, url } = await openedFromConch(app, '/?open=devices');
    expect(url).toMatch(/^http:\/\/localhost:\d+\/\?open=devices#here=[A-Za-z0-9_-]{43}$/);
    expect(cookie).toMatch(/^conch_here_\d+=v1\./);
    expect((await hidden(app, '/api/state', { cookie })).statusCode).toBe(200);
    expect((await hidden(app, '/api/auth', { cookie })).json()).toMatchObject({
      signedIn: true,
      here: 'proven',
    });
    // Another Conch's port, or a cookie someone changed, proves nothing.
    const [, value = ''] = cookie.split('=');
    expect((await hidden(app, '/api/state', { cookie: `conch_here_1=${value}` })).statusCode).toBe(
      401,
    );
    // Flip the first signature character: replacing its suffix with 'AA'
    // occasionally left a randomly generated signature unchanged.
    const signature = cookie.lastIndexOf('.') + 1;
    const changed = `${cookie.slice(0, signature)}${cookie[signature] === 'A' ? 'B' : 'A'}${cookie.slice(signature + 1)}`;
    expect((await hidden(app, '/api/state', { cookie: changed })).statusCode).toBe(401);
  });

  it('sets the cookie HttpOnly, SameSite=Strict, for 400 days', async () => {
    const { app } = await setup();
    const link = (await app.inject({ method: 'POST', url: '/api/here/link' })).json() as {
      code: string;
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/here',
      headers: { [NOT_HERE]: '1' },
      payload: { code: link.code },
    });
    const line = String(res.headers['set-cookie']);
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=Strict/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=34560000/);
  });

  it('uses a code once, and never through a proxy or from elsewhere', async () => {
    const { app } = await setup();
    const make = async () =>
      ((await app.inject({ method: 'POST', url: '/api/here/link' })).json() as { code: string })
        .code;
    const code = await make();
    const once = await app.inject({ method: 'POST', url: '/api/here', payload: { code } });
    expect(once.statusCode).toBe(200);
    const twice = await app.inject({ method: 'POST', url: '/api/here', payload: { code } });
    expect(twice.statusCode).toBe(401);
    expect(twice.json().message).toMatch(/expired or was already used/);

    const proxied = await app.inject({
      method: 'POST',
      url: '/api/here',
      headers: { host: 'conch.example', 'x-forwarded-for': '203.0.113.9' },
      payload: { code: await make() },
    });
    expect(proxied.statusCode).toBe(403);
    const elsewhere = await remote(app, '/api/here', {
      method: 'POST',
      payload: { code: await make() },
    });
    expect(elsewhere.statusCode).toBe(403);
    const madeUp = await app.inject({
      method: 'POST',
      url: '/api/here',
      payload: { code: 'A'.repeat(43) },
    });
    expect(madeUp.statusCode).toBe(401);
  });

  it('hands out more links only to this computer, proven, and only to a page of Conch', async () => {
    const { app } = await setup();
    const ask = (headers: Record<string, string>, payload: object = {}, remoteAddress?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/here/link',
        headers,
        payload,
        ...(remoteAddress && { remoteAddress }),
      });
    expect((await ask({ [NOT_HERE]: '1' })).statusCode).toBe(401);
    expect((await ask({ host: 'conch.example' }, {}, REMOTE.remoteAddress)).statusCode).toBe(401);
    expect((await ask({ 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(401);
    for (const page of ['//evil.example', 'https://evil.example', '/\\evil.example'])
      expect((await ask({}, { page })).statusCode).toBe(400);
    expect((await ask({}, { page: '/?open=updates' })).statusCode).toBe(200);
  });

  it('never takes the key itself: nothing sent can be replayed to mint more', async () => {
    const { app, services } = await setup();
    const key = services.here.key();
    for (const headers of [
      { 'x-conch-here': key },
      { authorization: `Bearer ${key}` },
      { cookie: `conch_here_4317=${key}` },
    ]) {
      const res = await app.inject({ url: '/api/state', headers: { ...headers, [NOT_HERE]: '1' } });
      expect(res.statusCode, JSON.stringify(Object.keys(headers))).toBe(401);
    }
    const link = await app.inject({
      method: 'POST',
      url: '/api/here/link',
      headers: { 'x-conch-here': key, [NOT_HERE]: '1' },
    });
    expect(link.statusCode).toBe(401);
  });

  it('trusts the cookie only on a request that looks local', async () => {
    const { app } = await setup();
    const proxied = await app.inject({
      url: '/api/state',
      headers: { host: 'conch.example', 'x-forwarded-for': '203.0.113.9' },
    });
    expect(proxied.statusCode).toBe(401);
    const fromAfar = await app.inject({
      url: '/api/state',
      remoteAddress: REMOTE.remoteAddress,
      headers: { host: REMOTE.host },
    });
    expect(fromAfar.statusCode).toBe(401);
  });

  it('gives a launcher in shell or VBScript just the private file to open', async () => {
    const { app, home } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/here/link',
      headers: { accept: 'text/plain' },
      payload: { page: '/?open=background', file: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    const file = res.body;
    expect(file.startsWith(join(home, 'here', 'open'))).toBe(true);
    const html = await readFile(file, 'utf8');
    expect(html).toMatch(/url=http:\/\/localhost:\d+\/\?open=background#here=[A-Za-z0-9_-]{43}/);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('forgets every browser on this computer when the key is made again', async () => {
    const { app, services } = await setup();
    const { cookie } = await openedFromConch(app);
    expect((await hidden(app, '/api/state', { cookie })).statusCode).toBe(200);
    services.here.rotate();
    expect((await hidden(app, '/api/state', { cookie })).statusCode).toBe(401);
  });

  it('with a password, a browser without proof signs in like any other device', async () => {
    const { app } = await setup();
    await withPassword(app);
    // Signed out, it gets the sign-in page, not "open from your apps".
    const auth = (await hidden(app, '/api/auth')).json();
    expect(auth).toMatchObject({ signedIn: false, here: 'unproven' });
    expect(auth).not.toHaveProperty('hereRequired');
    expect((await hidden(app, '/api/state')).json().error).toBe('unauthorized');
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { host: '127.0.0.1:4317', [NOT_HERE]: '1' },
      payload: { with: 'password', username: 'ada', password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = cookieOf(signIn);
    // Signed in, but not this computer (devices.test.ts has what that keeps it from).
    const access = (await hidden(app, '/api/access', { cookie })).json();
    expect(access.approval.here).toBe(false);
  });
});

describe('password sign-in', () => {
  it('sets up a password and keeps this browser signed in', async () => {
    const { app, home } = await setup();
    const weak = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: 'passwordpassword' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().message).toMatch(/common/);

    const cookie = await withPassword(app);
    expect(cookie).toMatch(/^conch_session=/);
    // Now even this computer has to sign in.
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(200);

    // Only an scrypt hash is stored, owner-only.
    const file = await readFile(join(home, 'access.json'), 'utf8');
    expect(file).not.toContain(PASSWORD);
    expect(file).toMatch(/"passwordHash": "scrypt\$131072\$8\$1\$/);
    // Windows has no POSIX modes; the user profile's permissions do this job there.
    if (process.platform !== 'win32') {
      expect((await stat(join(home, 'access.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('signs in from another device with a hardened cookie, and signs out', async () => {
    const { app } = await setup();
    await withPassword(app);
    const res = await remote(app, '/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'password', username: 'Ada', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ method: 'password', signedIn: true, secure: false });
    const header = String(res.headers['set-cookie']);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    const cookie = cookieOf(res);
    expect((await remote(app, '/api/state', { cookie })).statusCode).toBe(200);

    const out = await remote(app, '/api/auth/sign-out', { method: 'POST', cookie });
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await remote(app, '/api/state', { cookie })).statusCode).toBe(401);
  });

  it('uses a __Host- Secure cookie behind an HTTPS proxy like tailscale serve', async () => {
    const { app } = await setup();
    await withPassword(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: {
        host: 'conch.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '100.64.0.7',
      },
      payload: { with: 'password', username: 'ada', password: PASSWORD },
    });
    expect(res.json().secure).toBe(true);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^__Host-conch_session=/);
    expect(header).toContain('Secure');
  });

  it('gives the same answer for a wrong username or password, then slows down', async () => {
    const { app } = await setup();
    await withPassword(app);
    const attempt = (username: string, password: string) =>
      remote(app, '/api/auth/sign-in', {
        method: 'POST',
        payload: { with: 'password', username, password },
      });
    const badUser = await attempt('eve', PASSWORD);
    const badPass = await attempt('ada', 'not the password at all');
    expect(badUser.statusCode).toBe(401);
    expect(badUser.json()).toEqual(badPass.json());
    for (let i = 0; i < 3; i++) await attempt('ada', 'nope nope nope nope');
    const limited = await attempt('ada', PASSWORD);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // The owner, on this computer, isn't locked out.
    const local = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { with: 'password', username: 'ada', password: PASSWORD },
    });
    expect(local.statusCode).toBe(200);
  });

  it('signs every other device out when the password changes', async () => {
    const { app } = await setup();
    const mine = await withPassword(app);
    const phone = cookieOf(
      await remote(app, '/api/auth/sign-in', {
        method: 'POST',
        payload: { with: 'password', username: 'ada', password: PASSWORD },
      }),
    );
    const changed = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      headers: { cookie: mine },
      payload: { username: 'ada', password: 'a brand new sentence for conch' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await remote(app, '/api/state', { cookie: phone })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/state', headers: { cookie: mine } })).statusCode).toBe(
      200,
    );
  });

  it('asks you to confirm it’s you before sensitive changes', async () => {
    const { app } = await setup();
    const cookie = await withPassword(app);
    const later = Date.now() + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/access/pairing',
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('verify-required');
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/access/verify',
      headers: { cookie },
      payload: { secret: 'wrong wrong wrong' },
    });
    expect(wrong.statusCode).toBe(401);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/access/verify',
      headers: { cookie },
      payload: { secret: PASSWORD },
    });
    expect(verified.json().verified).toBe(true);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/access/pairing',
      headers: { cookie },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('access keys', () => {
  it('shows a key once, stores only its hash, and revokes it', async () => {
    const { app, home } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/access/keys',
      payload: { name: 'Laptop' },
    });
    const { key, info } = created.json();
    expect(key).toMatch(/^conch_[A-Za-z0-9_-]{43}$/);
    const cookie = cookieOf(created);

    const settings = await app.inject({ url: '/api/access', headers: { cookie } });
    expect(JSON.stringify(settings.json())).not.toContain(key);
    expect(await readFile(join(home, 'access.json'), 'utf8')).not.toContain(key);

    const bearer = `Bearer ${key}`;
    expect((await remote(app, '/api/state', { authorization: bearer })).statusCode).toBe(200);
    const signIn = await remote(app, '/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'key', key },
    });
    const phone = cookieOf(signIn);
    expect(signIn.statusCode).toBe(200);

    await app.inject({ method: 'DELETE', url: `/api/access/keys/${info.id}`, headers: { cookie } });
    expect((await remote(app, '/api/state', { authorization: bearer })).statusCode).toBe(401);
    // Devices that signed in with it are signed out too.
    expect((await remote(app, '/api/state', { cookie: phone })).statusCode).toBe(401);
  });
});

describe('pairing links', () => {
  it('sign a new device in once, then stop working', async () => {
    const { app } = await setup();
    const cookie = await withPassword(app);
    const { code } = (
      await app.inject({ method: 'POST', url: '/api/access/pairing', headers: { cookie } })
    ).json();
    const first = await remote(app, '/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'pairing', code },
    });
    expect(first.statusCode).toBe(200);
    const again = await remote(app, '/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'pairing', code },
    });
    expect(again.statusCode).toBe(401);
    const sessions = (await app.inject({ url: '/api/access', headers: { cookie } })).json()
      .sessions;
    expect(sessions.map((s: { via: string }) => s.via).sort()).toEqual(['pairing', 'setup']);
  });
});

describe('a damaged access.json', () => {
  /** The store re-reads the file when it changes, checking at most twice a second. */
  const noticed = () => new Promise((resolve) => setTimeout(resolve, 600));
  const damage = (home: string, text = '{"method": "password", "passwordHa') =>
    writeFile(join(home, 'access.json'), text);
  const kept = async (home: string) =>
    (await readdir(home)).filter((n) => n.startsWith('access.broken-'));

  it('locks sign-in instead of opening it, even for this computer', async () => {
    const { app, home, services } = await setup();
    const cookie = await withPassword(app);
    await damage(home);
    await noticed();

    // Never read as "no sign-in": this computer would walk straight in.
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401);
    expect((await remote(app, '/api/state')).json().error).toBe('unauthorized');
    expect((await app.inject('/api/auth')).json()).toMatchObject({
      signedIn: false,
      setupRequired: false,
      locked: true,
    });
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { with: 'password', username: 'ada', password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(401);

    // The damaged file stays (a restart stays locked) and a copy is kept, noted once.
    expect(await readFile(join(home, 'access.json'), 'utf8')).toContain('passwordHa');
    expect(await kept(home)).toHaveLength(1);
    await vi.waitFor(async () =>
      expect((await services.healed.list()).map((n) => n.area)).toEqual(['access']),
    );

    // Nothing but a fresh start may write over it.
    await expect(services.access.createPairing()).rejects.toMatchObject({ code: 'locked' });
    expect(await readFile(join(home, 'access.json'), 'utf8')).toContain('passwordHa');
  });

  it('stays locked after a restart, and `pnpm conch reset` is the way back in', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-auth-'));
    await damage(home, '');
    const first = await setup({ CONCH_HOME: home });
    expect((await first.app.inject('/api/state')).statusCode).toBe(401);
    await first.app.close();

    const { app } = await setup({ CONCH_HOME: home });
    expect((await app.inject('/api/auth')).json().locked).toBe(true);
    expect((await app.inject('/api/access')).statusCode).toBe(401);

    // What `pnpm conch reset` does, from this computer's terminal.
    const cli = new AccessStore(home);
    expect(await cli.locked()).toBe(true);
    await cli.disable();
    await noticed();
    expect((await app.inject('/api/state')).statusCode).toBe(200);
    expect((await app.inject('/api/auth')).json()).not.toHaveProperty('locked');
    expect(await kept(home)).toHaveLength(1);
  });

  it('never fills in a missing method as “no sign-in”', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-auth-'));
    await damage(home, JSON.stringify({ username: 'ada', passwordHash: 'scrypt$x', keys: 'oops' }));
    const { app } = await setup({ CONCH_HOME: home });
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    expect((await app.inject('/api/auth')).json()).toMatchObject({ locked: true });
  });

  it('only drops signed-in devices it can’t read, and keeps who may sign in', async () => {
    const { app, home, services } = await setup();
    const cookie = await withPassword(app);
    const file = JSON.parse(await readFile(join(home, 'access.json'), 'utf8'));
    file.sessions.push({ id: 's_bad', hash: 42 });
    await writeFile(join(home, 'access.json'), JSON.stringify(file));
    await noticed();
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    expect(await services.access.locked()).toBe(false);
    expect(await kept(home)).toHaveLength(1);
    await vi.waitFor(async () =>
      expect((await services.healed.list())[0]?.message).toMatch(/sign in again/),
    );
  });

  it('still lets in whoever holds the CONCH_TOKEN that started Conch', async () => {
    const token = 'env-token-0123456789abcdef';
    const home = await mkdtemp(join(tmpdir(), 'conch-auth-'));
    await damage(home);
    const { app } = await setup({ CONCH_HOME: home, CONCH_TOKEN: token });
    expect((await app.inject('/api/state')).statusCode).toBe(401);
    const bearer = await app.inject({
      url: '/api/state',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(200);
  });

  it('shows up in the security checkup with the one command that fixes it', async () => {
    const token = 'env-token-0123456789abcdef';
    const home = await mkdtemp(join(tmpdir(), 'conch-auth-'));
    await damage(home);
    const { app } = await setup({ CONCH_HOME: home, CONCH_TOKEN: token });
    const { checkup } = (
      await app.inject({ url: '/api/access', headers: { authorization: `Bearer ${token}` } })
    ).json();
    expect(checkup[0]).toMatchObject({
      id: 'sign-in',
      level: 'danger',
      title: 'Sign-in is locked',
      command: 'pnpm conch reset',
    });
  });
});

describe('browser guards', () => {
  it('refuses other sites, other localhost ports and form-style bodies', async () => {
    const { app } = await setup();
    const otherPort = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { host: 'localhost:4317', origin: 'http://localhost:3000' },
      payload: {},
    });
    expect(otherPort.statusCode).toBe(403);
    const ws = await app.inject({
      url: '/ws',
      headers: {
        host: 'localhost:4317',
        origin: 'http://localhost:3000',
        upgrade: 'websocket',
        connection: 'upgrade',
      },
    });
    expect(ws.statusCode).toBe(403);
    const crossSite = await app.inject({
      url: '/api/state',
      headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' },
    });
    expect(crossSite.statusCode).toBe(403);
    const plain = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { 'content-type': 'text/plain' },
      payload: '{"content":"x"}',
    });
    expect(plain.statusCode).toBe(415);
    const nullOrigin = await app.inject({
      method: 'POST',
      url: '/api/memories',
      headers: { origin: 'null' },
      payload: { content: 'x' },
    });
    expect(nullOrigin.statusCode).toBe(403);
  });

  it('cannot be tricked past sign-in with an odd-looking path', async () => {
    const { app } = await setup();
    await withPassword(app);
    for (const url of ['/%61pi/state', '//api/state', '/api//state', '/API/state', '/api/./state'])
      expect((await app.inject(url)).statusCode, url).not.toBe(200);
  });

  it('sends strict security headers', async () => {
    const { app } = await setup();
    const res = await app.inject('/api/health');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("img-src 'self' data: blob:");
    // Frames: our own pages and exactly two video players, nothing else (ADR 0060 §7).
    const frames = /(?:^|;\s*)frame-src ([^;]*)/.exec(
      String(res.headers['content-security-policy']),
    );
    expect(frames?.[1]?.split(/\s+/)).toEqual([
      "'self'",
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
    ]);
    expect(res.headers['content-security-policy']).not.toMatch(/child-src|frame-src[^;]*\*/);
    // The same two the web app builds players for, and no more.
    expect(frames?.[1]?.split(/\s+/).slice(1)).toEqual([...VIDEO_PLAYER_ORIGINS]);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('security checkup', () => {
  it('flags unencrypted network access and full-trust defaults', async () => {
    const { app } = await setup({ CONCH_HOST: '0.0.0.0', CONCH_ALLOW_REMOTE: '1' });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { preferences: { permissionMode: 'bypassPermissions' } },
    });
    const cookie = await withPassword(app);
    const phone = cookieOf(
      await remote(app, '/api/auth/sign-in', {
        method: 'POST',
        payload: { with: 'password', username: 'ada', password: PASSWORD },
      }),
    );
    const { checkup, exposure } = (await remote(app, '/api/access', { cookie: phone })).json();
    expect(exposure).toBe('network');
    const ids = checkup.map((c: { id: string; level: string }) => `${c.id}:${c.level}`);
    expect(ids).toContain('encryption:danger');
    expect(ids).toContain('full-trust:warn');
    expect(ids).toContain('sign-in:ok');
    expect(cookie).toBeTruthy();
  });

  it('warns when the work folder brings its own Claude Code rules', async () => {
    const { app, services } = await setup();
    const dir = join(await services.settings.workspace(), '.claude');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        hooks: { PreToolUse: [], Stop: [{}] },
        permissions: { allow: ['Bash(*)'] },
      }),
    );
    const { checkup } = (await app.inject('/api/access')).json();
    const item = checkup.find((c: { id: string }) => c.id === 'workspace-rules');
    expect(item.level).toBe('warn');
    expect(item.detail).toContain('tools allowed without asking');
  });
});
