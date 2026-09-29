import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

it('keeps independent revocable key auth behind a host-preserving HTTPS proxy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-proxy-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_ALLOWED_HOSTS: 'conch.example',
    }),
  );
  const app = await buildApp(services);
  const headers = {
    host: 'conch.example',
    origin: 'https://conch.example',
    'sec-fetch-site': 'same-origin',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '203.0.113.9',
    'x-forwarded-host': 'conch.example',
  };
  try {
    // Even a loopback proxy cannot use the local no-auth exception.
    expect((await app.inject({ url: '/api/state', headers })).statusCode).toBe(401);
    const owner = await services.access.addKey('Owner');
    const disposable = await services.access.addKey('Revocation probe');
    const signIn = async (key: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers,
        payload: { with: 'key', key },
      });
      expect(res.statusCode).toBe(200);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^__Host-conch_session=/);
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
        expect(cookie).toContain(flag);
      expect(cookie).not.toContain('Domain=');
      return { ...headers, cookie: cookie.split(';')[0] ?? '' };
    };
    const signedIn = await signIn(owner.key);
    expect((await app.inject({ url: '/api/state', headers: signedIn })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/settings',
          headers: signedIn,
          payload: { preferences: { permissionMode: 'default' } },
        })
      ).statusCode,
    ).toBe(200);
    for (const origin of ['https://sibling.example', 'https://conch.example:444', 'null']) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/settings',
            headers: { ...signedIn, origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (await app.inject({ url: '/api/state', headers: { ...signedIn, host: 'evil.example' } }))
        .statusCode,
    ).toBe(421);
    expect(
      (
        await app.inject({
          url: '/api/state',
          headers: { ...signedIn, 'sec-fetch-site': 'same-site' },
        })
      ).statusCode,
    ).toBe(403);
    // Rewritten Host fails closed even if the forwarded host claims to match.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers: { ...headers, host: 'localhost:4317' },
          payload: { with: 'key', key: owner.key },
        })
      ).statusCode,
    ).toBe(403);

    const probe = await signIn(disposable.key);
    const ws = await app.injectWS('/ws', { headers: probe, socket: new Socket() });
    try {
      const pong = once(ws, 'message');
      ws.send(JSON.stringify({ type: 'ping' }));
      expect(JSON.parse(String((await pong)[0]))).toEqual({ type: 'pong' });
      const closed = once(ws, 'close');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/access/keys/${disposable.info.id}`,
            headers: signedIn,
          })
        ).statusCode,
      ).toBe(200);
      expect((await closed)[0]).toBe(4401);
    } finally {
      ws.terminate();
    }
    expect((await app.inject({ url: '/api/state', headers: probe })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers,
          payload: { with: 'key', key: disposable.key },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: signedIn }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/api/state', headers: signedIn })).statusCode).toBe(401);
  } finally {
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});
