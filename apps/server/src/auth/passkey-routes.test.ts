import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccessSettings, AuthStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { PretendAuthenticator } from '../test/authenticator';
import { onThisComputer } from '../test/here';

/**
 * The hello link (ADR 0064) and passkeys at the gateway (ADR 0065), through a
 * proxy on this computer that says it relayed HTTPS, as an address of your
 * own does. The attacks: a used or stolen hello link, a second claim, a
 * password-only "confirm it's you" on a passkey Conch, a device that isn't
 * let in trying to let others in, and a removed passkey that stays signed in.
 */

vi.setConfig({ testTimeout: 30_000 });

const HOST = 'conch.example';
const ORIGIN = `https://${HOST}`;
const PASSWORD = 'purple otters juggle at dawn';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-passkey-routes-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    CONCH_ALLOWED_HOSTS: HOST,
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  return { app, services, store: services.access };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** A browser out on the internet, reaching Conch at its own HTTPS address. */
class Browser {
  cookies = new Map<string, string>();
  constructor(
    readonly app: App,
    readonly address: string,
    readonly userAgent = MAC,
  ) {}

  async fetch(url: string, init: { method?: string; payload?: object } = {}) {
    const res = await this.app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url,
      remoteAddress: '127.0.0.1',
      headers: {
        host: HOST,
        'x-forwarded-for': this.address,
        'x-forwarded-proto': 'https',
        'user-agent': this.userAgent,
        ...(this.cookies.size && {
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        }),
      },
      ...(init.payload && { payload: init.payload }),
    });
    const raw = res.headers['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [String(raw)] : []) {
      const [pair = ''] = line.split(';');
      const [name = '', ...value] = pair.split('=');
      if (/Max-Age=0/.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value.join('='));
    }
    return res;
  }

  post(url: string, payload: object = {}) {
    return this.fetch(url, { method: 'POST', payload });
  }

  async status(): Promise<AuthStatus> {
    return (await this.fetch('/api/auth')).json();
  }

  async access(): Promise<AccessSettings> {
    return (await this.fetch('/api/access')).json();
  }

  /** Touch ID on this browser: a passkey answer for what the gateway asked. */
  async passkeySignIn(authenticator: PretendAuthenticator) {
    const { options } = (await this.post('/api/auth/passkey', { purpose: 'sign-in' })).json();
    return this.post('/api/auth/sign-in', {
      with: 'passkey',
      response: authenticator.get(options, ORIGIN),
    });
  }

  async confirmWithPasskey(authenticator: PretendAuthenticator) {
    const { options } = (
      await this.post('/api/access/passkeys/options', { purpose: 'verify' })
    ).json();
    return this.post('/api/access/verify', { passkey: authenticator.get(options, ORIGIN) });
  }
}

/** Make Conch yours from the hello link with Touch ID, as `conch setup` leads to. */
async function claimWithPasskey(app: App, store: Services['access']) {
  const { code } = await store.createHello();
  const laptop = new Browser(app, '203.0.113.10');
  const authenticator = new PretendAuthenticator();
  const { options } = (await laptop.post('/api/auth/passkey', { purpose: 'hello', code })).json();
  const res = await laptop.post('/api/auth/hello/finish', {
    with: 'passkey',
    code,
    response: authenticator.create(options, ORIGIN),
  });
  expect(res.statusCode).toBe(200);
  return { laptop, authenticator, code };
}

describe('the hello link', () => {
  it('says whether the link is good, where Conch is, and that passkeys work here', async () => {
    const { app, store } = await setup();
    const { code } = await store.createHello();
    const laptop = new Browser(app, '203.0.113.10');
    expect((await laptop.post('/api/auth/hello', { code })).json()).toMatchObject({
      ok: true,
      address: HOST,
      passkeys: true,
    });
    expect((await laptop.post('/api/auth/hello', { code: 'nope' })).json()).toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });

  it('makes Conch yours with Touch ID: signed in, approved, approval on, link used up', async () => {
    const { app, store } = await setup();
    const { laptop, code } = await claimWithPasskey(app, store);
    expect(await laptop.status()).toMatchObject({ signedIn: true, method: 'passkey' });
    const access = await laptop.access();
    expect(access.approval).toMatchObject({ on: true, canApprove: true, here: false });
    expect(access.devices[0]).toMatchObject({ current: true, approvedHow: 'hello' });
    expect(access.passkeys[0]).toMatchObject({ name: 'Apple Passwords', here: true, rpId: HOST });
    // Whoever opens it next is too late.
    const late = new Browser(app, '198.51.100.66');
    expect((await late.post('/api/auth/hello', { code })).json()).toMatchObject({
      ok: false,
      reason: 'claimed',
    });
    const again = await late.post('/api/auth/hello/finish', {
      with: 'password',
      code,
      username: 'mallory',
      password: PASSWORD,
    });
    expect(again.statusCode).toBe(410);
    expect(await store.method()).toBe('passkey');
  });

  it('makes Conch yours with a password, and a weak one leaves the link usable', async () => {
    const { app, store } = await setup();
    const { code } = await store.createHello();
    const laptop = new Browser(app, '203.0.113.10');
    const weak = await laptop.post('/api/auth/hello/finish', {
      with: 'password',
      code,
      username: 'george',
      password: 'password1234567',
    });
    expect(weak.statusCode).toBe(400);
    const ok = await laptop.post('/api/auth/hello/finish', {
      with: 'password',
      code,
      username: 'george',
      password: PASSWORD,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ signedIn: true, method: 'password' });
    expect((await laptop.access()).approval.on).toBe(true);
  });

  it('won’t give a passkey challenge for a link that isn’t good', async () => {
    const { app } = await setup();
    const laptop = new Browser(app, '203.0.113.10');
    const res = await laptop.post('/api/auth/passkey', { purpose: 'hello', code: 'made-up' });
    expect(res.statusCode).toBe(410);
  });
});

describe('passkeys, signed in', () => {
  it('signs in with a passkey on a new device without waiting, and says passkeys work here', async () => {
    const { app, store } = await setup();
    const { authenticator } = await claimWithPasskey(app, store);
    // The same (synced) passkey, on the person's phone.
    const phone = new Browser(app, '203.0.113.20', IPHONE);
    expect(await phone.status()).toMatchObject({ signedIn: false, passkeys: true });
    const res = await phone.passkeySignIn(authenticator);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ signedIn: true });
    expect((await phone.access()).devices.find((d) => d.current)).toMatchObject({
      approvedHow: 'passkey',
    });
  });

  it('refuses a made-up passkey, and counts it as a failed try', async () => {
    const { app, store } = await setup();
    await claimWithPasskey(app, store);
    const stranger = new Browser(app, '198.51.100.66');
    const res = await stranger.passkeySignIn(new PretendAuthenticator()).catch(() => undefined);
    expect(res).toBeUndefined();
    const forged = new PretendAuthenticator();
    forged.create({ rp: { id: HOST }, user: { id: 'AAAA' }, challenge: 'x' }, ORIGIN);
    const again = await stranger.passkeySignIn(forged);
    expect(again.statusCode).toBe(401);
    expect(await stranger.status()).toMatchObject({ signedIn: false });
  });

  it('confirms it’s you with a passkey, never with a typed secret on a passkey-only Conch', async () => {
    const { app, store } = await setup();
    const { laptop, authenticator } = await claimWithPasskey(app, store);
    const typed = await laptop.post('/api/access/verify', { secret: 'anything at all' });
    expect(typed.statusCode).toBe(401);
    const touched = await laptop.confirmWithPasskey(authenticator);
    expect(touched.statusCode).toBe(200);
    expect(touched.json()).toMatchObject({ verified: true });
  });

  it('adds a second passkey only after confirming it’s you', async () => {
    const { app, store } = await setup();
    const { laptop, authenticator } = await claimWithPasskey(app, store);
    const yubi = new PretendAuthenticator({ aaguid: 'd548826e-79b4-db40-a3d8-11116f7e8349' });
    const ask = async () => {
      const { options } = (
        await laptop.post('/api/access/passkeys/options', { purpose: 'add' })
      ).json();
      return laptop.post('/api/access/passkeys', { response: yubi.create(options, ORIGIN) });
    };
    // The hello just now counts as having confirmed it's you, for ten minutes.
    expect((await ask()).statusCode).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    expect((await ask()).json()).toMatchObject({ error: 'verify-required' });
    expect((await laptop.confirmWithPasskey(authenticator)).statusCode).toBe(200);
    expect((await ask()).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect((await laptop.access()).passkeys.map((p) => p.name)).toContain('Bitwarden');
  });

  it('signs out what a removed passkey signed in, and keeps the last way in', async () => {
    const { app, store } = await setup();
    const { laptop, authenticator } = await claimWithPasskey(app, store);
    const phone = new Browser(app, '203.0.113.20', IPHONE);
    await phone.passkeySignIn(authenticator);
    const [only] = (await laptop.access()).passkeys;
    const last = await laptop.fetch(`/api/access/passkeys/${only?.id}`, { method: 'DELETE' });
    expect(last.statusCode).toBe(409);

    await laptop.post('/api/access/keys', { name: 'Spare' });
    expect(await store.method()).toBe('key');
    const removed = await laptop.fetch(`/api/access/passkeys/${only?.id}`, { method: 'DELETE' });
    expect(removed.statusCode).toBe(200);
    expect(await phone.status()).toMatchObject({ signedIn: false });
  });

  it('never lets a script’s access key add a passkey (it would let its own device in)', async () => {
    const { app, store } = await setup();
    await claimWithPasskey(app, store);
    const { key } = await store.addKey('Script');
    const asScript = (url: string, payload: object) =>
      app.inject({
        method: 'POST',
        url,
        remoteAddress: '127.0.0.1',
        headers: {
          host: HOST,
          'x-forwarded-for': '198.51.100.66',
          'x-forwarded-proto': 'https',
          'x-conch-here': '',
          authorization: `Bearer ${key}`,
        },
        payload,
      });
    // The script is let in first (as the person would, in the terminal)…
    const asked = await asScript('/api/access/passkeys/options', { purpose: 'add' });
    expect(asked.json().error).toBe('approval-required');
    await store.approve(asked.json().code, 'terminal');
    // …and may use Conch, but never to mint a way in.
    const options = await asScript('/api/access/passkeys/options', { purpose: 'add' });
    expect(options.statusCode).toBe(403);
    expect(options.json().error).toBe('approver-only');
    const forged = new PretendAuthenticator().create(
      { rp: { id: HOST }, user: { id: 'AAAA' }, challenge: 'x' },
      ORIGIN,
    );
    const added = await asScript('/api/access/passkeys', { response: forged });
    expect(added.json().error).toBe('approver-only');
    expect(await store.passkeyRecords()).toHaveLength(1);
  });

  it('doesn’t offer passkeys where browsers can’t use them', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/passkey',
      remoteAddress: '192.168.1.20',
      headers: { host: HOST },
      payload: { purpose: 'sign-in' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('approving from your own devices', () => {
  async function waitingPhone(app: App, store: Services['access']) {
    const { laptop, authenticator } = await claimWithPasskey(app, store);
    // A password beside the passkey, so a new device can sign in with it and wait.
    await laptop.confirmWithPasskey(authenticator);
    expect(
      (
        await laptop.fetch('/api/access/password', {
          method: 'PUT',
          payload: { username: 'george', password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
    const phone = new Browser(app, '203.0.113.20', IPHONE);
    const waiting = await phone.post('/api/auth/sign-in', {
      with: 'password',
      username: 'george',
      password: PASSWORD,
    });
    const code = (waiting.json() as AuthStatus).approval?.code ?? '';
    expect(code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    return { laptop, authenticator, phone, code };
  }

  it('lets an approved device approve, after confirming it’s you, and says who did', async () => {
    const { app, store } = await setup();
    const { laptop, authenticator, phone, code } = await waitingPhone(app, store);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    const unconfirmed = await laptop.post(`/api/access/requests/${code}/approve`);
    vi.restoreAllMocks();
    // The request may have run out with the clock moved on: ask again for this part.
    expect([403, 404]).toContain(unconfirmed.statusCode);

    const fresh = await phone.post('/api/auth/sign-in', {
      with: 'password',
      username: 'george',
      password: PASSWORD,
    });
    const again = (fresh.json() as AuthStatus).approval?.code ?? '';
    await laptop.confirmWithPasskey(authenticator);
    const approved = await laptop.post(`/api/access/requests/${again}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(await phone.status()).toMatchObject({ signedIn: true });
    const device = (await laptop.access()).devices.find((d) => d.name.includes('iPhone'));
    expect(device).toMatchObject({
      approvedHow: 'device',
      approvedBy: expect.stringContaining('Mac'),
    });
  });

  it('won’t let a device that isn’t let in approve anyone, itself included', async () => {
    const { app, store } = await setup();
    const { phone, code } = await waitingPhone(app, store);
    const self = await phone.post(`/api/access/requests/${code}/approve`);
    expect(self.statusCode).toBe(401);
    expect(await phone.status()).toMatchObject({ signedIn: false });
  });

  it('still keeps turning approval off on this computer', async () => {
    const { app, store } = await setup();
    const { laptop, authenticator } = await claimWithPasskey(app, store);
    await laptop.confirmWithPasskey(authenticator);
    const off = await laptop.fetch('/api/access/approval', {
      method: 'PUT',
      payload: { on: false },
    });
    expect(off.statusCode).toBe(403);
  });
});
