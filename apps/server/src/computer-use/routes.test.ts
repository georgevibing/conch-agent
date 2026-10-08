import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ComputerUseStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { protectedPaths } from '../lib/protect';
import { Services } from '../services';
import { NOT_HERE, onThisComputer } from '../test/here';
import { computerUseCheck } from './routes';

vi.setConfig({ testTimeout: 20_000 });

let cleanup: (() => Promise<void>) | undefined;

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-computer-use-'));
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
  return { app, services, home };
}

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('/api/computer-use', () => {
  it('is off until a person turns it on', async () => {
    const { app } = await setup();
    const status = ComputerUseStatus.parse((await app.inject('/api/computer-use')).json());
    expect(status).toMatchObject({ enabled: false, here: true, platform: 'mac' });
    expect(status.keptAway).toContain('Password managers');
  });

  it('turns on from this computer, and off again', async () => {
    const { app, services } = await setup();
    const on = await app.inject({
      method: 'PATCH',
      url: '/api/computer-use',
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ enabled: true });
    expect(services.computerUse.ready).toBe(true);
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/computer-use',
      payload: { enabled: false },
    });
    expect(off.json()).toMatchObject({ enabled: false });
  });

  it('is only for someone signed in, and refuses anything else in the body', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/computer-use',
      headers: { [NOT_HERE]: '1' },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(401);
    const odd = await app.inject({
      method: 'PATCH',
      url: '/api/computer-use',
      payload: { enabled: true, apps: [{ id: 'x', name: 'x' }] },
    });
    expect(odd.statusCode).toBe(400);
  });

  it('opens a switch’s System Settings page', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/computer-use/access',
      payload: { kind: 'screen' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('has no picture to give when nothing’s running, and Stop is harmless', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/computer-use/shot/abcdef12')).statusCode).toBe(404);
    expect((await app.inject('/api/computer-use/shot/..%2f..')).statusCode).toBe(404);
    const stop = await app.inject({ method: 'POST', url: '/api/computer-use/stop', payload: {} });
    expect(stop.json()).toEqual({ stopped: false });
  });

  it('keeps its file away from the assistant’s own file tools', async () => {
    const { home } = await setup();
    expect(protectedPaths(home)).toContain(join(home, 'computer-use.json'));
  });

  it('tells Repair everything only once it’s on', async () => {
    const { services } = await setup();
    const signal = new AbortController().signal;
    const check = computerUseCheck(services.computerUse);
    expect(await check.run({ repair: false, signal })).toEqual([]);
    await services.computerUse.setEnabled(true);
    expect(await check.run({ repair: false, signal })).toMatchObject([{ state: 'ok' }]);
  });
});
