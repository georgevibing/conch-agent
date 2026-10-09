import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleRoutes } from './routes';
import type { GoogleApps } from './apps';
import type { GoogleService } from './service';
import type { Gatekeeper } from '../security';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function setup(verified = true) {
  const gmailLogin = vi.fn(async () => ({
    address: 'ada@gmail.com',
    password: 'abcdefghijklmnop',
  }));
  const shown = vi.fn(async () => undefined);
  const service = {
    connectPassword: vi.fn(async () => ({ configured: false, accounts: [] })),
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
    owns: vi.fn(
      (_state: string, nonce: string) =>
        nonce === 'browser-proof' || nonce.endsWith('-browser-proof'),
    ),
    refuse: vi.fn(),
    park: vi.fn(() => true),
    claim: vi.fn(async () => undefined),
    check: vi.fn(),
    disconnect: vi.fn(),
    raises: vi.fn(async (_id: string, body: { level?: string }) => body.level === 'write'),
    setAccess: vi.fn(async (): Promise<unknown> => ({ configured: true, accounts: [] })),
  };
  const app = Fastify();
  apps.push(app);
  googleRoutes(
    app,
    service as unknown as GoogleService,
    { verified: () => verified } as unknown as Gatekeeper,
    { gmailLogin, apps: { show: shown } as unknown as GoogleApps },
  );
  return { app, service, gmailLogin, shown };
}
describe('Gmail with an app password over HTTP (ADR 0048)', () => {
  it('needs a recently verified session to keep or reuse a password, or to use an account for an app', async () => {
    const { app, service, shown } = setup(false);
    for (const [url, payload] of [
      ['/api/google/mail/password', { address: 'ada@gmail.com', password: 'abcd efgh ijkl mnop' }],
      ['/api/google/mail/reuse', {}],
      ['/api/google/apps/gmail/use', {}],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(403);
    }
    expect(service.connectPassword).not.toHaveBeenCalled();
    expect(shown).not.toHaveBeenCalled();
  });

  it('tells the browser only the email channel’s address, and reuses its password on the gateway', async () => {
    const { app, service } = setup();
    const reusable = await app.inject({ method: 'GET', url: '/api/google/mail/reusable' });
    expect(reusable.json()).toEqual({ address: 'ada@gmail.com' });
    expect(reusable.body).not.toContain('abcdefghijklmnop');
    const reused = await app.inject({ method: 'POST', url: '/api/google/mail/reuse', payload: {} });
    expect(reused.statusCode).toBe(200);
    expect(reused.body).not.toContain('abcdefghijklmnop');
    expect(service.connectPassword).toHaveBeenCalledWith({
      address: 'ada@gmail.com',
      password: 'abcdefghijklmnop',
    });
  });

  it('only shows apps Conch knows', async () => {
    const { app, shown } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/google/apps/../../x/use',
      payload: {},
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const other = await app.inject({
      method: 'POST',
      url: '/api/google/apps/slack/use',
      payload: {},
    });
    expect(other.statusCode).toBe(400);
    expect(shown).not.toHaveBeenCalled();
    await app.inject({ method: 'POST', url: '/api/google/apps/google-drive/use', payload: {} });
    expect(shown).toHaveBeenCalledWith('google-drive');
  });
});
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
    expect(response.headers.location).toBe('/integrations/done?app=google&result=connected');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
    service.finish.mockClear();
    await app.inject({ url: `/oauth/google/callback?state=${state}&state=${state}&code=code` });
    expect(service.finish).not.toHaveBeenCalled();
  });
  it('spends denied consent wherever Google lands, with Conch’s words, never Google’s', async () => {
    const { app, service } = setup();
    const state = 'a'.repeat(43);
    service.flowStatus.mockReturnValueOnce({
      state: 'failed',
      message: 'Add the exact address under Audience → Test users <b>',
    } as never);
    // Another browser (a phone's Conch app opened Google in Safari): no cookie, no session.
    const elsewhere = await app.inject({
      url: `/oauth/google/callback?state=${state}&error=access_denied&error_description=%3Cscript%3E`,
    });
    expect(service.refuse).toHaveBeenCalledWith(state, 'access_denied');
    expect(elsewhere.statusCode).toBe(200);
    expect(elsewhere.headers['content-type']).toContain('text/html');
    expect(elsewhere.headers['content-security-policy']).toContain("default-src 'none'");
    expect(elsewhere.body).toContain('Test users &lt;b&gt;');
    expect(elsewhere.body).not.toContain('<script');
    // The browser that started it goes to the sign-in window's own page.
    const here = await app.inject({
      url: `/oauth/google/callback?state=${state}&error=access_denied`,
      headers: { cookie: `conch_google_flow_${state}=browser-proof` },
    });
    expect(here.headers.location).toBe('/integrations/done?app=google&result=denied');
  });
  it('keeps a code Google sent to another browser for the window that started it, and only that window spends it', async () => {
    const { app, service } = setup();
    const state = 'a'.repeat(43);
    const response = await app.inject({
      url: `/oauth/google/callback?state=${state}&code=private-code`,
    });
    expect(service.finish).not.toHaveBeenCalled();
    expect(service.park).toHaveBeenCalledWith(state, 'private-code');
    expect(response.body).toContain('Finish connecting');
    expect(response.body).not.toContain('private-code');
    service.park.mockReturnValueOnce(false);
    const spent = await app.inject({ url: `/oauth/google/callback?state=${state}&code=again` });
    expect(spent.statusCode).toBe(400);
    expect(spent.body).toContain('start again');
    // Claiming needs a confirmed session, and passes this browser's own cookie.
    const unverified = await setup(false).app.inject({
      method: 'POST',
      url: `/api/google/flows/${state}/claim`,
      payload: {},
    });
    expect(unverified.statusCode).toBe(403);
    const claimed = await app.inject({
      method: 'POST',
      url: `/api/google/flows/${state}/claim`,
      payload: {},
      headers: { cookie: `conch_google_flow_${state}=browser-proof` },
    });
    expect(claimed.statusCode).toBe(200);
    expect(service.claim).toHaveBeenCalledWith(state, 'browser-proof', 'http://localhost:80');
    expect(claimed.headers['set-cookie']).toContain('Max-Age=0');
  });
});

describe('what an account may do, over HTTP', () => {
  it('lets anyone signed in take access away, but a raise needs a confirmed session', async () => {
    const { app, service } = setup(false);
    const lower = await app.inject({
      method: 'POST',
      url: '/api/google/accounts/work1/access',
      payload: { product: 'gmail', level: 'read' },
    });
    expect(lower.statusCode).toBe(200);
    const raise = await app.inject({
      method: 'POST',
      url: '/api/google/accounts/work1/access',
      payload: { product: 'gmail', level: 'write' },
    });
    expect(raise.statusCode).toBe(403);
    expect(service.setAccess).toHaveBeenCalledTimes(1);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/google/accounts/..%2Fx/access',
      payload: { product: 'gmail', level: 'read' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('answers 409 when Google has to be asked first', async () => {
    const { app, service } = setup();
    const { GoogleError } = await import('./service');
    service.setAccess.mockRejectedValueOnce(new GoogleError('consent', 'Sign in to Google again.'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/google/accounts/work1/access',
      payload: { product: 'calendar', level: 'write' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'consent', message: 'Sign in to Google again.' });
  });
});
