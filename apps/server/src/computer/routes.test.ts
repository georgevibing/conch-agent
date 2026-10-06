import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ComputerStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { NOT_HERE, onThisComputer } from '../test/here';

vi.setConfig({ testTimeout: 20_000 });

let cleanup: (() => Promise<void>) | undefined;

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-computer-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  cleanup = async () => {
    services.computer.stop();
    await app.close();
    services.search.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  };
  return { app, services };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

describe('GET /api/computer', () => {
  it('shows this computer, read for real, in the protocol’s shape', async () => {
    const { app, services } = await setup();
    const res = await app.inject('/api/computer');
    expect(res.statusCode).toBe(200);
    const status = ComputerStatus.parse(res.json());
    expect(status.info.cores).toBeGreaterThan(0);
    expect(status.samples.length).toBeGreaterThanOrEqual(1);
    expect(services.computer.running).toBe(true);
  });

  it('says nothing that names the computer, its people or what it runs', async () => {
    const { app } = await setup();
    const text = (await app.inject('/api/computer')).body;
    const { hostname, userInfo } = await import('node:os');
    expect(text).not.toContain(hostname());
    expect(text).not.toContain(userInfo().username);
    expect(text).not.toMatch(/"(command|args|pid|address|interface)"/);
  });

  it('is only for someone signed in', async () => {
    const { app, services } = await setup();
    const res = await app.inject({ url: '/api/computer', headers: { [NOT_HERE]: '1' } });
    expect(res.statusCode).toBe(401);
    // And asking without signing in doesn't start anything.
    expect(services.computer.running).toBe(false);
  });
});
