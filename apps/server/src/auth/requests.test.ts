import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config';
import { Gatekeeper, registerSecurity } from '../security';
import { hereCookieName } from './here';
import { RequestLimiter } from './requests';
import { AccessStore } from './store';

describe('bounded request budgets', () => {
  it('reserves each admission immediately and refills without fixed-window bursts', () => {
    let now = 0;
    const limiter = new RequestLimiter(2, 60, 2, () => now);
    expect(limiter.take('one')).toBe(0);
    expect(limiter.take('one')).toBe(0);
    expect(limiter.take('one')).toBe(1000);
    now = 999;
    expect(limiter.take('one')).toBe(1);
    now = 1000;
    expect(limiter.take('one')).toBe(0);
    expect(limiter.take('one')).toBe(1000);
    now = 500;
    expect(limiter.take('one')).toBe(1000);
    now = 1000;
    expect(limiter.take('one')).toBe(1000);
  });

  it('shares overflow without forgetting blocked clients and reclaims idle capacity', () => {
    let now = 0;
    const limiter = new RequestLimiter(1, 60, 2, () => now);
    expect(limiter.take('one')).toBe(0);
    expect(limiter.take('two')).toBe(0);
    expect(limiter.take('overflow')).toBe(0);
    for (let i = 0; i < 5000; i++) expect(limiter.take(`rotated-${i}`)).toBe(1000);
    expect(limiter.take('one')).toBe(1000);
    now = 60_000;
    expect(limiter.take('new-one')).toBe(0);
    expect(limiter.take('new-two')).toBe(0);
    expect(limiter.take('new-overflow')).toBe(0);
    expect(limiter.take('another')).toBe(1000);
  });
});

let app: FastifyInstance | undefined;
let home: string | undefined;
afterEach(async () => {
  await app?.close();
  if (home) await rm(home, { recursive: true, force: true });
  app = undefined;
  home = undefined;
  vi.restoreAllMocks();
});

async function gateway() {
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  home = await mkdtemp(join(tmpdir(), 'conch-request-limits-'));
  const config = loadConfig({ CONCH_HOME: home, CONCH_ALLOWED_HOSTS: 'conch.example' });
  const gate = new Gatekeeper(config, new AccessStore(home));
  const server = Fastify();
  app = server;
  registerSecurity(server, gate);
  const work = vi.fn(() => ({ ok: true }));
  server.get('/api/state/:id', work);
  server.post('/api/state/:id', work);
  server.get('/api/health', work);
  server.get('/api/auth', work);
  server.post('/api/auth/hello', work);
  server.post('/api/auth/sign-in', work);
  server.get('/oauth/callback', work);
  server.get('/oauth/provider/:flowId', work);
  server.get('/oauth/google/callback', work);
  server.post('/mcp', work);
  server.post('/mcp/hello', work);
  server.post('/mcp/session', work);
  server.get('/assets/app.js', work);
  // Isolate the common guard from the auth store, whose real checks have their
  // own integration tests. Only these two fixed fixture credentials resolve.
  const resolve = vi.spyOn(gate, 'resolve').mockImplementation(async (request) => {
    if (gate.isLocal(request)) return { kind: 'local' };
    const key = request.headers.authorization;
    if (key === 'Bearer one' || key === 'Bearer two') return { kind: 'bearer', keyId: key };
    return 'unauthorized';
  });
  const local = {
    host: 'localhost',
    cookie: `${hereCookieName(config.CONCH_PORT)}=${gate.here.cookie()}`,
  };
  const remote = { host: 'conch.example', authorization: 'Bearer one' };
  return { server, gate, work, resolve, local, remote };
}

describe('the common gateway guard', () => {
  it('budgets the MCP transport before parsing while leaving its authentication to the endpoint', async () => {
    const { server, resolve, work } = await gateway();
    for (let i = 0; i < 300; i++)
      expect((await server.inject({ method: 'POST', url: '/mcp' })).statusCode).toBe(200);
    const blocked = await server.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    expect(work).toHaveBeenCalledTimes(300);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('counts both MCP handshake routes before malformed bodies can reach them', async () => {
    const { server, work } = await gateway();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        server.inject({
          method: 'POST',
          url: i % 2 ? '/mcp/hello' : '/mcp/session',
          headers: { 'content-type': 'application/json' },
          payload: '{',
        }),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 400)).toHaveLength(10);
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(10);
    expect(work).not.toHaveBeenCalled();
  });

  it('caps concurrent public credential work before body parsing or any completion', async () => {
    const { server, work } = await gateway();
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        server.inject({
          method: 'POST',
          url: i % 2 ? '/api/auth/sign-in' : '/api/auth/hello',
          headers: { host: 'conch.example', 'content-type': 'application/json' },
          // Accepted requests fail parsing. They still spent an admission;
          // rejected ones never reach the parser, even though the body is bad.
          payload: '{',
        }),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 400)).toHaveLength(10);
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(20);
    expect(responses.find((r) => r.statusCode === 429)?.headers['retry-after']).toBe('1');
    expect(work).not.toHaveBeenCalled();
  });

  it('caps rotating clients together while preserving proven local recovery', async () => {
    const { server, local } = await gateway();
    for (let i = 0; i < 20; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        headers: { host: 'conch.example', 'x-forwarded-for': `203.0.113.${i}` },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          headers: { host: 'localhost', cookie: 'conch_session=invented' },
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (await server.inject({ method: 'POST', url: '/api/auth/sign-in', headers: local }))
        .statusCode,
    ).toBe(200);
  });

  it('limits OAuth callbacks while preserving their cross-site navigation', async () => {
    const { server, resolve } = await gateway();
    const headers = {
      host: 'conch.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
    };
    for (let i = 0; i < 10; i++)
      expect(
        (
          await server.inject({
            url:
              [
                `/oauth/provider/flow-${i}`,
                `/oauth/callback?state=${i}`,
                `/oauth/google/callback?state=${i}`,
              ][i % 3] ?? '/oauth/callback',
            headers,
          })
        ).statusCode,
      ).toBe(200);
    expect((await server.inject({ url: '/oauth/callback', headers })).statusCode).toBe(429);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('ignores spoofed forwarding addresses from a non-loopback connection', async () => {
    const { server } = await gateway();
    for (let i = 0; i < 11; i++)
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/auth/sign-in',
            remoteAddress: '203.0.113.1',
            headers: { host: 'conch.example', 'x-forwarded-for': `198.51.100.${i}` },
          })
        ).statusCode,
      ).toBe(i < 10 ? 200 : 429);
  });

  it('shares writes across paths and addresses for each authenticated key', async () => {
    const { server, remote, work } = await gateway();
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await server.inject({
            method: 'POST',
            url: `/api/state/${i}?cache=${i}`,
            headers: { ...remote, 'x-forwarded-for': `203.0.113.${i}` },
          })
        ).statusCode,
      ).toBe(200);
    }
    const rejected = await server.inject({
      method: 'POST',
      url: '/api/state/another',
      headers: remote,
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.headers['retry-after']).toBe('1');
    expect(work).toHaveBeenCalledTimes(30);
    expect((await server.inject({ url: '/api/state/read', headers: remote })).statusCode).toBe(200);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/state/other-key',
          headers: { ...remote, authorization: 'Bearer two' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('throttles reads before authentication while leaving assets outside the API budget', async () => {
    const { server, remote, resolve } = await gateway();
    for (let i = 0; i < 300; i++)
      expect((await server.inject({ url: `/api/state/${i}`, headers: remote })).statusCode).toBe(
        200,
      );
    expect((await server.inject({ url: '/api/health', headers: remote })).statusCode).toBe(429);
    expect((await server.inject({ url: '/api/state/more', headers: remote })).statusCode).toBe(429);
    expect(resolve).toHaveBeenCalledTimes(300);
    expect((await server.inject({ url: '/assets/app.js', headers: remote })).statusCode).toBe(200);
    vi.mocked(Date.now).mockReturnValue(1_000_050);
    expect((await server.inject({ url: '/api/auth', headers: remote })).statusCode).toBe(200);
  });

  it('keeps the write allowance on a device when it starts another session', async () => {
    const { server, gate, resolve, remote } = await gateway();
    const first = await gate.store.createSession({ via: 'key', deviceId: 'same-device' });
    const second = await gate.store.createSession({ via: 'key', deviceId: 'same-device' });
    const headers = { ...remote, cookie: 'conch_device=fixture' };
    for (let i = 0; i < 31; i++) {
      resolve.mockResolvedValue({
        kind: 'session',
        session: i % 2 ? first.session : second.session,
      });
      expect(
        (await server.inject({ method: 'POST', url: `/api/state/${i}`, headers })).statusCode,
      ).toBe(i < 30 ? 200 : 429);
    }
  });

  it('does not charge an authenticated write budget for unsigned or cross-origin requests', async () => {
    const { server, remote } = await gateway();
    for (let i = 0; i < 40; i++) {
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/state/write',
            headers: { host: remote.host },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/state/write',
            headers: { ...remote, origin: 'https://another.example' },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (await server.inject({ method: 'POST', url: '/api/state/write', headers: remote }))
        .statusCode,
    ).toBe(200);
  });
});
