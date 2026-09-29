import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

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
  const app = await buildApp(services);
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
    expect((await stat(join(home, 'access.json'))).mode & 0o777).toBe(0o600);
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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);
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
  }, 20_000);

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
