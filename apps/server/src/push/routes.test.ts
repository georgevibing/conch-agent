import { createECDH } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { PhoneAddress, PushStatus, ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { hereInit, NOT_HERE, onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { PushStore } from './store';

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
  const app = onThisComputer(await buildApp(services), services);
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
  return { app, services, cookie, home };
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
  it('finishes signed-out device cleanup before shutdown releases its files', async () => {
    const { services, home } = await setup();
    await services.push.subscribe('session:retired', 'Old phone', subscription());
    const remove = PushStore.prototype.remove;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(PushStore.prototype, 'remove').mockImplementationOnce(async function (
      this: PushStore,
      predicate,
    ) {
      await pending;
      return remove.call(this, predicate);
    });

    services.gate.disconnect(['retired']);
    let stopped = false;
    const closing = Promise.resolve(services.stop()).then(() => (stopped = true));
    try {
      await setImmediate();
      expect(stopped).toBe(false);
    } finally {
      release();
      await closing;
    }
    expect(await new PushStore(home).list()).toEqual([]);
  });

  it('reports failed sign-out cleanup without an unhandled background rejection', async () => {
    const { services } = await setup();
    const error = new Error('Notification storage unavailable');
    vi.spyOn(services.push, 'forget').mockRejectedValueOnce(error);
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    services.gate.disconnect(['retired']);
    await services.stop();
    expect(report).toHaveBeenCalledWith('[push] Could not forget signed-out devices', error);
  });

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

  it('an answer without a decision is a no, as the first notifications sent it', async () => {
    const { app, services, cookie } = await setup();
    const respond = vi.spyOn(services.conversations, 'respond').mockResolvedValue(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/answer',
      headers: { cookie },
      payload: { conversationId: 'c_1', permissionId: 'p_1' },
    });
    expect(response.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledWith('c_1', 'p_1', 'deny');
  });

  it('never allows what isn’t waiting, nor with a made-up ticket (ADR 0108)', async () => {
    const { app, services, cookie } = await setup();
    const respond = vi.spyOn(services.conversations, 'respond').mockResolvedValue(undefined);
    for (const payload of [
      { conversationId: 'c_1', permissionId: 'p_1', decision: 'allow' },
      {
        conversationId: 'c_1',
        permissionId: 'p_1',
        decision: 'allow',
        ticket: 'made-up-ticket-0123456789',
      },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/push/answer',
        headers: { cookie },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome: 'gone' });
    }
    expect(respond).not.toHaveBeenCalledWith('c_1', 'p_1', 'allow');
    const looked = await app.inject({
      method: 'GET',
      url: '/api/push/approvals/c_1/p_1',
      headers: { cookie },
    });
    expect(looked.json()).toEqual({ waiting: false });
    // Another site can't post an answer with this browser's cookie.
    const cross = await app.inject({
      method: 'POST',
      url: '/api/push/answer',
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      payload: { conversationId: 'c_1', permissionId: 'p_1', decision: 'deny' },
    });
    expect(cross.statusCode).toBe(403);
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

describe('a step that matters, from another device (ADR 0108)', () => {
  /** A socket from a device that isn't this computer: its own sign-in, no proof. */
  async function socket(port: number, headers: Record<string, string>) {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers });
    const events: ServerEvent[] = [];
    ws.onmessage = (msg) => events.push(ServerEvent.parse(JSON.parse(String(msg.data))));
    await new Promise((r) => (ws.onopen = r));
    const respond = (decision: 'allow' | 'deny') =>
      ws.send(
        JSON.stringify({
          type: 'permission.respond',
          conversationId: 'c_1',
          permissionId: 'p_1',
          decision,
        }),
      );
    return { ws, events, respond };
  }

  it('the chat’s card asks for a passkey or password first, as the sheet does; this computer doesn’t', async () => {
    const { app, services, cookie } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    vi.spyOn(services.push, 'confirmFor').mockReturnValue('It deletes or sends something.');
    const respond = vi.spyOn(services.conversations, 'respond').mockResolvedValue(undefined);
    // Signed in a while ago: the last passkey or password was more than ten minutes back.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);

    const phone = await socket(port, { cookie });
    phone.respond('allow');
    await vi.waitUntil(() => phone.events.some((e) => e.type === 'error'));
    expect(phone.events.find((e) => e.type === 'error')).toMatchObject({
      code: 'verify-required',
      conversationId: 'c_1',
      permissionId: 'p_1',
    });
    expect(respond).not.toHaveBeenCalled();
    // A no never needs it.
    phone.respond('deny');
    await vi.waitUntil(() => respond.mock.calls.length === 1);
    expect(respond).toHaveBeenLastCalledWith('c_1', 'p_1', 'deny', undefined);

    // The sheet's way in is held to the same.
    const answer = vi.spyOn(services.push, 'answer');
    await app.inject({
      method: 'POST',
      url: '/api/push/answer',
      headers: { cookie, [NOT_HERE]: '1' },
      payload: { conversationId: 'c_1', permissionId: 'p_1', decision: 'allow' },
    });
    expect(answer.mock.calls.at(-1)?.[2]).toMatchObject({ verified: false });

    // Confirmed on the phone: the same socket may allow it now.
    const verified = await app.inject({
      method: 'POST',
      url: '/api/access/verify',
      headers: { cookie, [NOT_HERE]: '1' },
      payload: { secret: PASSWORD },
    });
    expect(verified.statusCode).toBe(200);
    phone.respond('allow');
    await vi.waitUntil(() => respond.mock.calls.length === 2);
    expect(respond).toHaveBeenLastCalledWith('c_1', 'p_1', 'allow', undefined);
    phone.ws.close();

    // This computer, proven, allows as it always did: Date.now is still past the window.
    vi.spyOn(Date, 'now').mockReturnValue(now + 30 * 60_000);
    const here = await socket(port, {
      cookie: `${cookie}; ${hereInit(app).headers.cookie ?? ''}`,
    });
    here.respond('allow');
    await vi.waitUntil(() => respond.mock.calls.length === 3);
    expect(here.events.some((e) => e.type === 'error')).toBe(false);
    await app.inject({
      method: 'POST',
      url: '/api/push/answer',
      headers: { cookie },
      payload: { conversationId: 'c_1', permissionId: 'p_1', decision: 'allow' },
    });
    expect(answer.mock.calls.at(-1)?.[2]).toMatchObject({ verified: true });
    here.ws.close();
  });

  it('an everyday step needs nothing more, from anywhere', async () => {
    const { app, services, cookie } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const respond = vi.spyOn(services.conversations, 'respond').mockResolvedValue(undefined);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    const phone = await socket(port, { cookie });
    phone.respond('allow');
    await vi.waitUntil(() => respond.mock.calls.length === 1);
    expect(phone.events.some((e) => e.type === 'error')).toBe(false);
    phone.ws.close();
  });
});
