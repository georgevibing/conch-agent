import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Gatekeeper } from '../security';
import { Services } from '../services';
import { chat } from '../test/session';
import { NOT_HERE, onThisComputer } from '../test/here';
import { registerTelemetryRoutes } from './routes';
import { TelemetryService } from './service';

vi.setConfig({ testTimeout: 30_000 });

let home: string;
let services: Services;
let app: Awaited<ReturnType<typeof buildApp>>;
/** A collector that takes the connection and never answers. */
let silent: Server;
let silentUrl: string;
let arrived = 0;

beforeAll(async () => {
  process.env.CONCH_MOCK_SPEED = '0.02';
  home = await mkdtemp(join(tmpdir(), 'conch-dashboards-routes-'));
  services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  vi.spyOn(services.processes, 'readResources').mockResolvedValue({
    at: Date.now(),
    totalBytes: 8 * 1024 ** 3,
    availableBytes: 6 * 1024 ** 3,
    cpuCount: 4,
    loadPerCpu: 0,
    memoryPressure: 0,
    level: 'healthy',
    concurrency: 3,
    reason: 'The test computer has room to work.',
  });
  app = onThisComputer(await buildApp(services), services);
  await app.ready();
  await services.recovery.start(async () => (await app.inject('/api/health')).statusCode === 200);
  silent = createServer(() => {
    arrived++;
  });
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  silentUrl = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
});

afterAll(async () => {
  silent.closeAllConnections();
  silent.close();
  await app.close();
  services.search.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

const scrape = (headers: Record<string, string> = {}) =>
  app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { host: 'localhost:4317', [NOT_HERE]: '1', ...headers },
  });

describe('GET /metrics', () => {
  it('isn’t there until a person turns it on', async () => {
    const res = await scrape();
    expect(res.statusCode).toBe(404);
  });

  it('needs the scrape token, shown once and kept only as a hash', async () => {
    const on = await app.inject({
      method: 'PUT',
      url: '/api/dashboards',
      payload: { prometheus: { on: true } },
    });
    expect(on.statusCode).toBe(200);
    expect((await scrape()).statusCode).toBe(401);
    expect((await scrape()).headers['www-authenticate']).toBe('Bearer realm="conch"');
    const made = await app.inject({
      method: 'POST',
      url: '/api/dashboards/token',
      headers: { host: 'localhost:4317' },
    });
    const { token, config } = made.json() as { token: string; config: string };
    expect(token).toMatch(/^conch_scrape_[A-Za-z0-9_-]{43}$/);
    expect(config).toContain(`credentials: ${token}`);
    expect(config).toContain("targets: ['localhost:4317']");
    const page = await scrape({ authorization: `Bearer ${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.body).toContain('target_info{service_name="conch"');
    const open = await scrape({
      authorization: `Bearer ${token}`,
      accept: 'application/openmetrics-text;version=1.0.0',
    });
    expect(open.headers['content-type']).toContain('application/openmetrics-text');
    expect(open.body.endsWith('# EOF\n')).toBe(true);
    // The file keeps a hash, never the token.
    const { readFile } = await import('node:fs/promises');
    const kept = await readFile(join(home, 'telemetry.secrets.json'), 'utf8');
    expect(kept).not.toContain(token);
    // A new one retires the old.
    const again = (await app.inject({ method: 'POST', url: '/api/dashboards/token' })).json() as {
      token: string;
    };
    expect((await scrape({ authorization: `Bearer ${token}` })).statusCode).toBe(401);
    expect((await scrape({ authorization: `Bearer ${again.token}` })).statusCode).toBe(200);
  });

  it('counts wrong tokens like wrong passwords', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await scrape({
          authorization: `Bearer conch_scrape_${'x'.repeat(43)}`,
          'x-forwarded-for': '203.0.113.9',
        })
      ).statusCode;
    expect(last).toBe(429);
  });

  it('refuses another site’s page, whatever it carries', async () => {
    const res = await scrape({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' });
    expect(res.statusCode).toBe(403);
  });

  it('“this computer only” lets in programs here, never through a proxy', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/dashboards',
      payload: { prometheus: { on: true, access: 'this-computer' } },
    });
    expect((await scrape()).statusCode).toBe(200);
    expect((await scrape({ 'x-forwarded-for': '203.0.113.7' })).statusCode).toBe(403);
    expect((await scrape({ host: 'conch.example.com' })).statusCode).not.toBe(200);
    await app.inject({
      method: 'PUT',
      url: '/api/dashboards',
      payload: { prometheus: { access: 'token' } },
    });
  });
});

describe('a turn while the dashboard doesn’t answer', () => {
  it('finishes as quickly as ever, and Prometheus counts it', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/dashboards',
      payload: {
        otlp: {
          on: true,
          destination: 'custom',
          endpoint: silentUrl,
          signals: { metrics: true, traces: true, logs: true },
        },
      },
    });
    expect(put.statusCode).toBe(200);
    const started = performance.now();
    await chat(services, 'hello there');
    await chat(services, 'and again');
    const took = performance.now() - started;
    void services.telemetry.tick();
    // The collector has the requests, and hasn't answered one.
    await vi.waitFor(() => expect(arrived).toBeGreaterThan(0));
    expect(took).toBeLessThan(10_000);
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/dashboards/token' })
    ).json() as { token: string };
    const page = (await scrape({ authorization: `Bearer ${token}` })).body;
    expect(page).toMatch(
      /conch_turns_total\{conch_provider="mock",[^}]*conch_origin="chat"[^}]*\} 2/,
    );
    expect(page).toMatch(
      /conch_tokens_total\{conch_provider="mock",[^}]*conch_token_type="input"\} \d+/,
    );
    const status = (await app.inject('/api/dashboards')).json() as {
      otlp: { targets: Record<string, string> };
    };
    expect(status.otlp.targets.traces).toBe(`${silentUrl}/v1/traces`);
  });
});

describe('changing where numbers go', () => {
  it('needs a recent sign-in from another device, and nothing to turn things off', async () => {
    const app = Fastify();
    const telemetry = new TelemetryService({ home, version: '1', manual: true });
    const gate = { isSecure: () => false, clientKey: () => 'x' } as unknown as Gatekeeper;
    registerTelemetryRoutes(app, telemetry, gate, async () => false);
    for (const payload of [
      { content: true },
      { otlp: { endpoint: 'https://evil.example' } },
      { otlp: { destination: 'honeycomb' } },
      { key: { key: 'k' } },
      { prometheus: { on: true } },
    ]) {
      const res = await app.inject({ method: 'PUT', url: '/api/dashboards', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
      expect(res.json()).toMatchObject({ error: 'verify-required' });
    }
    expect((await app.inject({ method: 'POST', url: '/api/dashboards/token' })).statusCode).toBe(
      403,
    );
    const off = await app.inject({
      method: 'PUT',
      url: '/api/dashboards',
      payload: { content: false, otlp: { on: false } },
    });
    expect(off.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/dashboards', payload: { nonsense: 1 } }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });
});
