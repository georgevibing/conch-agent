import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';

vi.setConfig({ testTimeout: 30_000 });

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

/** The gateway checks every `:id` in a URL; a voice id (`piper:en_US-amy-medium`) has a colon. */
it('reaches a natural voice by its id, colon and all', async () => {
  const home = await mkdtemp(join(tmpdir(), 'conch-voice-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  const getVoice = vi.spyOn(services.speech, 'getVoice');
  getVoice.mockResolvedValue({ piper: 'missing', voices: [], cloud: [] });
  const res = await app.inject({
    method: 'POST',
    url: '/api/voice/speech/piper%3Aen_US-amy-medium',
  });
  expect(res.statusCode).toBe(200);
  expect(getVoice).toHaveBeenCalledWith('piper:en_US-amy-medium');
});
