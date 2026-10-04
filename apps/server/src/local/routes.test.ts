import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LocalStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { LocalError } from './service';

// Password hashing is deliberately slow (scrypt); shared runners need headroom.
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'purple otters juggle at dawn';
let cleanup: (() => Promise<void>) | undefined;

const STATUS: LocalStatus = {
  ollama: { state: 'running', version: '0.35.0' },
  models: [],
  offers: [],
  machine: { memoryBytes: 16e9 },
};

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-local-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  // The routes are under test, not this computer's Ollama.
  vi.spyOn(services.local, 'status').mockResolvedValue(STATUS);
  const pull = vi.spyOn(services.local, 'pull').mockResolvedValue(STATUS);
  const app = onThisComputer(await buildApp(services), services);
  cleanup = async () => {
    await app.close();
    services.search.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  };
  return { app, services, pull };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

describe('local model routes', () => {
  it('says where things stand', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/local')).json()).toEqual(STATUS);
  });

  it('refuses a model name with a path in it before anything runs', async () => {
    const { app, pull } = await setup();
    for (const model of ['../../etc/passwd', 'a\\b', 'llama 3', '']) {
      const res = await app.inject({ method: 'POST', url: '/api/local/pull', payload: { model } });
      expect(res.statusCode).toBe(400);
    }
    const choose = await app.inject({
      method: 'PUT',
      url: '/api/local/model',
      payload: { model: '../x' },
    });
    expect(choose.statusCode).toBe(400);
    expect(pull).not.toHaveBeenCalled();
  });

  it('asks you to confirm before downloading a model', async () => {
    const { app, pull } = await setup();
    const signedIn = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: PASSWORD },
    });
    const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';

    // Just signed in: that counts as confirming.
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/local/pull',
      headers: { cookie },
      payload: { model: 'llama3.2:3b' },
    });
    expect(fresh.statusCode).toBe(200);
    expect(pull).toHaveBeenCalledWith('llama3.2:3b');

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/local/pull',
      headers: { cookie },
      payload: { model: 'llama3.2:3b' },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error).toBe('verify-required');
    expect(pull).toHaveBeenCalledTimes(1);

    // Stopping a download never asks.
    const pause = await app.inject({
      method: 'POST',
      url: '/api/local/pull/pause',
      headers: { cookie },
    });
    expect(pause.statusCode).toBe(200);
  });

  it('says why a download can’t start', async () => {
    const { app, pull } = await setup();
    pull.mockRejectedValueOnce(new LocalError('Llama 3.2 needs 4.0 GB of free space.'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/local/pull',
      payload: { model: 'llama3.2:3b' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'invalid',
      message: 'Llama 3.2 needs 4.0 GB of free space.',
    });
  });

  it('offers the local model check to Repair everything', async () => {
    const { services } = await setup();
    expect(services.doctor.checks().map((c) => c.id)).toContain('local-model');
  });
});
