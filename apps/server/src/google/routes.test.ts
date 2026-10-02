import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleRoutes } from './routes';
import type { GoogleService } from './service';
import type { Gatekeeper } from '../security';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function setup(verified = true) {
  const service = {
    status: vi.fn(async () => ({ configured: true, accounts: [] })),
    configure: vi.fn(async () => undefined),
    importCredentials: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    flowStatus: vi.fn(() => ({ state: 'ready' })),
    start: vi.fn(async () => ({
      url: 'https://accounts.google.com/auth',
      nonce: 'nonce',
      flowId: 'flow',
      mode: 'manual',
    })),
    finish: vi.fn(async () => undefined),
    cancel: vi.fn(),
    check: vi.fn(),
    disconnect: vi.fn(),
  };
  const app = Fastify();
  apps.push(app);
  googleRoutes(
    app,
    service as unknown as GoogleService,
    { verified: () => verified } as unknown as Gatekeeper,
  );
  return { app, service };
}
describe('Google HTTP boundary', () => {
  it('keeps simultaneous sign-ins in separate browser cookies and rejects cookie-name injection', async () => {
    const { app, service } = setup();
    for (const [flowId, nonce] of [
      ['a'.repeat(43), 'first-browser-proof'],
      ['b'.repeat(43), 'second-browser-proof'],
    ] as const) {
      service.start.mockResolvedValueOnce({
        url: 'https://accounts.google.com/auth',
        nonce,
        flowId,
        mode: 'automatic',
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/google/connect',
        payload: {},
      });
      expect(response.headers['set-cookie']).toContain(
        'conch_google_flow_' + flowId + '=' + nonce + ';',
      );
      expect(response.body).not.toContain(nonce);
    }
    const state = 'a'.repeat(43);
    await app.inject({
      url: '/oauth/google/callback?state=' + state + '&code=code',
      headers: {
        cookie:
          'conch_google_flow_' +
          state +
          '=first-browser-proof; conch_google_flow_' +
          'b'.repeat(43) +
          '=second-browser-proof',
      },
    });
    expect(service.finish).toHaveBeenCalledWith(
      state,
      'code',
      'first-browser-proof',
      'http://localhost:80',
    );
    const invalid = await app.inject({ method: 'DELETE', url: '/api/google/flows/bad%3Bcookie' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['set-cookie']).toBeUndefined();
  });
  it('sends manual return addresses only through the verified POST with a browser cookie', async () => {
    const { app, service } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/google/flows/flow/complete',
      payload: { redirectUrl: 'http://127.0.0.1:1/?state=flow&code=private-code' },
      headers: {
        cookie: 'conch_google_flow_flow=browser-proof',
        host: 'conch.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect(service.complete).toHaveBeenCalledWith(
      'flow',
      expect.any(Object),
      'browser-proof',
      'https://conch.example',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('private-code');
    const rejected = await setup(false).app.inject({
      method: 'DELETE',
      url: '/api/google/flows/flow',
    });
    expect(rejected.statusCode).toBe(403);
  });
  it('requires recent verification to configure, consent or disconnect', async () => {
    const { app, service } = setup(false);
    for (const url of [
      '/api/google/configure',
      '/api/google/connect',
      '/api/google/import',
      '/api/google/flows/test/complete',
      '/api/google/accounts/account1',
    ]) {
      const response = await app.inject({
        method: url.includes('/accounts/') ? 'DELETE' : 'POST',
        url,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    }
    expect(service.configure).not.toHaveBeenCalled();
    expect(service.start).not.toHaveBeenCalled();
    expect(service.disconnect).not.toHaveBeenCalled();
  });
  it('keeps local HTTP callback origin and uses only local proxy HTTPS headers', async () => {
    const { app, service } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/google/connect',
      headers: { host: 'localhost:4317' },
      payload: { capabilities: ['mail-read'] },
    });
    expect(service.start).toHaveBeenLastCalledWith(
      { capabilities: ['mail-read'] },
      'http://localhost:4317',
    );
    expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Lax');
    expect(response.headers['set-cookie']).not.toContain('; Secure');
    await app.inject({
      method: 'POST',
      url: '/api/google/connect',
      headers: { host: 'conch.example', 'x-forwarded-proto': 'https' },
      payload: {},
    });
    expect(service.start).toHaveBeenLastCalledWith({}, 'https://conch.example');
  });
  it('strips code/error from callback redirect and never accepts arrays or open redirects', async () => {
    const { app, service } = setup();
    const state = 'a'.repeat(43);
    const response = await app.inject({
      url: `/oauth/google/callback?state=${state}&code=private-code&next=https://attacker.example`,
      headers: { cookie: `conch_google_flow_${state}=browser-proof` },
    });
    expect(service.finish).toHaveBeenCalledWith(
      state,
      'private-code',
      'browser-proof',
      'http://localhost:80',
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/integrations?google=connected');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
    service.finish.mockClear();
    await app.inject({ url: `/oauth/google/callback?state=${state}&state=${state}&code=code` });
    expect(service.finish).not.toHaveBeenCalled();
  });
  it('spends denied consent and returns a fixed message with no upstream details', async () => {
    const { app, service } = setup();
    const state = 'a'.repeat(43);
    const response = await app.inject({
      url: `/oauth/google/callback?state=${state}&error=access_denied`,
    });
    expect(service.cancel).toHaveBeenCalledWith(state, '', 'http://localhost:80', 'access_denied');
    expect(response.headers.location).toBe('/integrations?google=denied');
  });
});
