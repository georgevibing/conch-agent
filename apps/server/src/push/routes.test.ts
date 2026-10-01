import { createECDH } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PhoneAddress, PushStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';

const PASSWORD = 'a long enough sentence for conch';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-push-app-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  await vi.waitUntil(() => Boolean(services.mockVendor?.base), { timeout: 5000 });
  close = async () => {
    services.integrations.stop();
    await services.mockVendor?.stop();
    await app.close();
  };
  const signedIn = await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
  return { app, services, cookie };
}

const subscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, 3).toString('base64url'),
    },
  };
};

describe('notification routes', () => {
  it('turns a device’s notifications on, names it, and lets it change and remove them', async () => {
    const { app, cookie } = await setup();
    const headers = {
      cookie,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    };
    const first = PushStatus.parse(
      (await app.inject({ method: 'GET', url: '/api/push', headers })).json(),
    );
    expect(first.publicKey).toMatch(/^B/);
    expect(first.devices).toEqual([]);

    const on = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers,
      payload: { subscription: subscription(), prefs: { replies: false } },
    });
    expect(on.statusCode).toBe(200);
    const [device] = PushStatus.parse(on.json()).devices;
    expect(device).toMatchObject({ current: true, prefs: { replies: false, approvals: true } });
    expect(device?.name).toMatch(/iPhone/);

    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/push/subscriptions/${device?.id}`,
      headers,
      payload: { prefs: { previews: false } },
    });
    expect(PushStatus.parse(changed.json()).devices[0]?.prefs).toMatchObject({
      previews: false,
      replies: false,
    });

    const off = await app.inject({
      method: 'DELETE',
      url: `/api/push/subscriptions/${device?.id}`,
      headers,
    });
    expect(PushStatus.parse(off.json()).devices).toEqual([]);
  });

  it('never stores an endpoint that isn’t a push service (SSRF)', async () => {
    const { app, cookie } = await setup();
    for (const endpoint of [
      'https://169.254.169.254/latest',
      'https://localhost:4317/api/state',
      'http://fcm.googleapis.com/x',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/push/subscriptions',
        headers: { cookie },
        payload: { subscription: subscription(endpoint) },
      });
      expect(response.statusCode, endpoint).toBe(400);
    }
  });

  it('needs a sign-in, and isn’t for access keys', async () => {
    const { app, cookie } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/push' })).statusCode).toBe(401);
    const key = await app.inject({
      method: 'POST',
      url: '/api/access/keys',
      headers: { cookie },
      payload: { name: 'script' },
    });
    const token = (key.json() as { token?: string }).token;
    if (!token) return;
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { subscription: subscription() },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Deny from a notification only ever says no', async () => {
    const { app, services, cookie } = await setup();
    const respond = vi.spyOn(services.conversations, 'respond').mockResolvedValue(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/answer',
      headers: { cookie },
      payload: { conversationId: 'c_1', permissionId: 'p_1', decision: 'allow' },
    });
    expect(response.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledWith('c_1', 'p_1', 'deny');
  });
});

describe('the phone’s secure address', () => {
  it('turns on with one press (the mock engine’s pretend Tailscale), after confirming it’s you', async () => {
    const { app, cookie } = await setup();
    const before = PhoneAddress.parse(
      (await app.inject({ method: 'GET', url: '/api/phone/address', headers: { cookie } })).json(),
    );
    expect(before).toMatchObject({ state: 'off', name: 'conch-studio.tail1234.ts.net' });
    // Phones aren't offered an address that doesn't reach Conch yet.
    const access = await app.inject({ method: 'GET', url: '/api/access', headers: { cookie } });
    expect((access.json() as { urls: string[] }).urls).toEqual([]);

    const on = PhoneAddress.parse(
      (await app.inject({ method: 'POST', url: '/api/phone/address', headers: { cookie } })).json(),
    );
    expect(on).toMatchObject({ state: 'ready', url: 'https://conch-studio.tail1234.ts.net' });
    const after = await app.inject({ method: 'GET', url: '/api/access', headers: { cookie } });
    expect((after.json() as { urls: string[] }).urls).toContain(
      'https://conch-studio.tail1234.ts.net',
    );
  });
});
