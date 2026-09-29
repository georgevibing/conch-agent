import { describe, expect, it } from 'vitest';

import { buildApp } from './app';
import { loadConfig } from './config';

describe('gateway', () => {
  it('reports health', async () => {
    const app = buildApp({ CONCH_LOG_LEVEL: 'fatal' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, protocolVersion: 1 });
  });

  it('refuses non-loopback hosts unless explicitly allowed', () => {
    expect(() => loadConfig({ CONCH_HOST: '0.0.0.0' })).toThrow(/CONCH_ALLOW_REMOTE/);
    expect(loadConfig({ CONCH_HOST: '0.0.0.0', CONCH_ALLOW_REMOTE: '1' }).CONCH_ALLOW_REMOTE).toBe(
      true,
    );
  });
});
