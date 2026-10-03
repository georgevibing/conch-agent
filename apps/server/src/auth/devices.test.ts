import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccessSettings, AuthStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { NOT_HERE, onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { APPROVAL_TTL_MS, AccessStore, MAX_WAITING } from './store';

/**
 * Devices, and **Approve new devices**: a device seen for the first time from
 * somewhere other than this computer needs the person's OK even with the right
 * password or key. The attacks: a stolen password, a stolen key used from a
 * script, a remote device trying to approve itself or switch approval off, and
 * a flood of requests hiding the real one.
 */

vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'purple otters juggle at dawn';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-devices-'));
  const config = loadConfig({
    CONCH_HOME: home,
    CONCH_ENGINE: 'mock',
    CONCH_LOG_LEVEL: 'silent',
    CONCH_WEB_DIST: '/nonexistent',
    CONCH_ALLOWED_HOSTS: 'conch.example',
  });
  const services = new Services(config);
  const app = onThisComputer(await buildApp(services), services);
  close = () => app.close();
  return { app, services, home, store: services.access };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

type App = Awaited<ReturnType<typeof setup>>['app'];

/** A browser: keeps its cookies like a real one, and says where it is. */
class Browser {
  cookies = new Map<string, string>();
  constructor(
    readonly app: App,
    readonly where: { remoteAddress: string; host: string; userAgent: string; proof?: false },
  ) {}

  async fetch(url: string, init: { method?: string; payload?: object; bearer?: string } = {}) {
    const res = await this.app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url,
      remoteAddress: this.where.remoteAddress,
      headers: {
        host: this.where.host,
        'user-agent': this.where.userAgent,
        // A browser here that wasn't opened from Conch, or a proxy that hides itself (ADR 0063).
        ...(this.where.proof === false && { [NOT_HERE]: '1' }),
        ...(this.cookies.size && {
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        }),
        ...(init.bearer && { authorization: `Bearer ${init.bearer}` }),
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

  signIn(password = PASSWORD) {
    return this.fetch('/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'password', username: 'ada', password },
    });
  }

  async status(): Promise<AuthStatus> {
    return (await this.fetch('/api/auth')).json();
  }

  async access(): Promise<AccessSettings> {
    return (await this.fetch('/api/access')).json();
  }
}

const phone = (app: App, address = '100.64.0.7') =>
  new Browser(app, { remoteAddress: address, host: 'conch.example', userAgent: IPHONE });
const laptop = (app: App) =>
  new Browser(app, { remoteAddress: '100.64.0.9', host: 'conch.example', userAgent: MAC });
const here = (app: App) =>
  new Browser(app, { remoteAddress: '127.0.0.1', host: 'localhost:4317', userAgent: MAC });
/** nginx's `proxy_pass http://127.0.0.1:4317;`: loopback, a loopback Host, no header, no proof. */
const hiddenProxy = (app: App) =>
  new Browser(app, {
    remoteAddress: '127.0.0.1',
    host: '127.0.0.1:4317',
    userAgent: IPHONE,
    proof: false,
  });

/** Password sign-in, set up on this computer, which stays signed in and verified. */
async function withPassword(app: App) {
  const owner = here(app);
  const res = await owner.fetch('/api/access/password', {
    method: 'PUT',
    payload: { username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return owner;
}

async function approvalOn(owner: Browser) {
  const res = await owner.fetch('/api/access/approval', { method: 'PUT', payload: { on: true } });
  expect(res.statusCode).toBe(200);
  return res.json() as AccessSettings;
}

describe('devices', () => {
  it('remembers each browser that signs in, with a long-lived HttpOnly device cookie', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    const iphone = phone(app);
    const res = await iphone.signIn();
    expect(res.statusCode).toBe(200);
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toMatch(
      /conch_device=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=34560000/,
    );

    const { devices } = await owner.access();
    const listed = devices.find((d) => d.name === 'Safari on iPhone');
    expect(listed).toMatchObject({ kind: 'phone', signedIn: true, address: '100.64.0.7' });
    // This computer's own browser was adopted as a device too.
    expect(devices.find((d) => d.current)).toBeDefined();

    // Signing out keeps the device (it's recognised next time), but not as signed in.
    await iphone.fetch('/api/auth/sign-out', { method: 'POST' });
    expect(iphone.cookies.has('conch_device')).toBe(true);
    expect((await owner.access()).devices.some((d) => d.name === 'Safari on iPhone')).toBe(false);
  });

  it('never stores the device cookie, only its hash', async () => {
    const { app, home } = await setup();
    await withPassword(app);
    const iphone = phone(app);
    await iphone.signIn();
    const file = await readFile(join(home, 'access.json'), 'utf8');
    expect(file).not.toContain(iphone.cookies.get('conch_device'));
  });

  it('signs a device out without forgetting its approval', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await store.approve((await iphone.signIn()).json().approval.code, 'terminal');
    const id = (await owner.access()).devices.find((d) => d.kind === 'phone')?.id ?? '';
    const res = await owner.fetch(`/api/access/devices/${id}/sign-out`, { method: 'POST' });
    expect(res.statusCode).toBe(200);
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);
    expect(((await iphone.signIn()).json() as AuthStatus).signedIn).toBe(true);
  });

  it('renames a device, and removing it signs it out', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    const iphone = phone(app);
    await iphone.signIn();
    const id = (await owner.access()).devices.find((d) => d.kind === 'phone')?.id ?? '';
    const renamed = await owner.fetch(`/api/access/devices/${id}`, {
      method: 'PATCH',
      payload: { name: 'Ada’s iPhone' },
    });
    expect(renamed.json().devices.find((d: { id: string }) => d.id === id).name).toBe(
      'Ada’s iPhone',
    );
    expect((await owner.fetch(`/api/access/devices/${id}`, { method: 'DELETE' })).statusCode).toBe(
      200,
    );
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);
    expect((await owner.fetch(`/api/access/devices/${id}`, { method: 'DELETE' })).statusCode).toBe(
      404,
    );
  });
});

describe('approve new devices', () => {
  it('makes a new device wait after the right password, until it’s approved in the terminal', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);

    const iphone = phone(app);
    const res = await iphone.signIn();
    expect(res.statusCode).toBe(200);
    const status: AuthStatus = res.json();
    expect(status.signedIn).toBe(false);
    expect(status.approval).toMatchObject({ device: 'Safari on iPhone', state: 'waiting' });
    expect(status.approval?.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);

    // Waiting is not signed in: nothing but the status answers.
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);
    expect((await iphone.fetch('/api/access')).statusCode).toBe(401);
    expect((await iphone.status()).approval?.code).toBe(status.approval?.code);

    // The owner sees who is asking, from where, and with what.
    const { requests } = await owner.access();
    expect(requests).toEqual([
      expect.objectContaining({
        code: status.approval?.code,
        device: 'Safari on iPhone',
        via: 'password',
        address: '100.64.0.7',
        rejected: false,
        script: false,
      }),
    ]);

    // `pnpm conch devices approve k7m q2x` — any spacing or case.
    const code = (status.approval?.code ?? '').toLowerCase().replace('-', ' ');
    await store.approve(code, 'terminal');
    const after = await iphone.status();
    expect(after.signedIn).toBe(true);
    expect(after.approval).toBeUndefined();
    expect((await iphone.fetch('/api/state')).statusCode).toBe(200);
    const device = (await owner.access()).devices.find((d) => d.kind === 'phone');
    expect(device).toMatchObject({ approved: true, approvedHow: 'terminal', signedIn: true });
  });

  it('lets an approved device sign in again without asking, and asks for every new one', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await store.approve((await iphone.signIn()).json().approval.code, 'terminal');
    await iphone.fetch('/api/auth/sign-out', { method: 'POST' });

    const again = (await iphone.signIn()).json() as AuthStatus;
    expect(again.signedIn).toBe(true);

    // The same password from a new browser: it waits.
    const other = laptop(app);
    expect(((await other.signIn()).json() as AuthStatus).approval?.state).toBe('waiting');
    // Even pretending to be the iPhone (same User-Agent, same address) doesn't help.
    const copycat = phone(app);
    expect(((await copycat.signIn()).json() as AuthStatus).signedIn).toBe(false);
  });

  it('keeps a wrong password just as wrong: no request, no device', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    const res = await iphone.signIn('not the password at all');
    expect(res.statusCode).toBe(401);
    expect(iphone.cookies.size).toBe(0);
    expect((await owner.access()).requests).toEqual([]);
  });

  it('tells a turned-down device, and can still approve it if that was a mistake', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    const { code } = (await iphone.signIn()).json().approval;

    // Any signed-in device may turn one down: it only takes trust away.
    const res = await owner.fetch(`/api/access/requests/${code}`, { method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect((await iphone.status()).approval?.state).toBe('rejected');
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);

    await store.approve(code, 'terminal');
    expect((await iphone.status()).signedIn).toBe(true);
  });

  it('asks again with the same code when the waiting device signs in again', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    const first = (await iphone.signIn()).json().approval.code;
    const second = (await iphone.signIn()).json().approval.code;
    expect(second).toBe(first);
    expect((await owner.access()).requests).toHaveLength(1);
  });

  it('stops waiting when the device cancels, and lets the request run out', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await iphone.signIn();
    await iphone.fetch('/api/auth/sign-out', { method: 'POST' });
    expect((await owner.access()).requests).toEqual([]);

    const { approval } = (await iphone.signIn()).json() as AuthStatus;
    expect(approval?.expiresAt).toBeGreaterThan(Date.now() + APPROVAL_TTL_MS - 60_000);
    vi.spyOn(Date, 'now').mockReturnValue((approval?.expiresAt ?? 0) + 1000);
    const status = await iphone.status();
    expect(status.approval).toBeUndefined();
    expect(status.signedIn).toBe(false);
    expect((await owner.access()).requests).toEqual([]);
  });

  it('approves this computer, and a one-time link, without asking', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);

    const second = here(app);
    expect(((await second.signIn()).json() as AuthStatus).signedIn).toBe(true);

    const { code } = (await owner.fetch('/api/access/pairing', { method: 'POST' })).json();
    const iphone = phone(app);
    const res = await iphone.fetch('/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'pairing', code },
    });
    expect((res.json() as AuthStatus).signedIn).toBe(true);
    const device = (await owner.access()).devices.find((d) => d.kind === 'phone');
    expect(device).toMatchObject({ approved: true, approvedHow: 'link' });
  });

  it('makes a proxy that hides itself wait like any new device, and never lets it approve', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);

    // The right password through nginx's defaults: a new device, not this computer.
    const visitor = hiddenProxy(app);
    const asked = (await visitor.signIn()).json() as AuthStatus;
    expect(asked.signedIn).toBe(false);
    expect(asked.approval?.code).toBeTruthy();
    expect((await visitor.fetch('/api/state')).statusCode).toBe(401);
    const code = asked.approval?.code ?? '';

    // Approved by the owner, it still can't approve others or turn approval off.
    expect(
      (await owner.fetch(`/api/access/requests/${code}/approve`, { method: 'POST' })).statusCode,
    ).toBe(200);
    expect((await visitor.fetch('/api/state')).statusCode).toBe(200);
    const iphone = phone(app);
    const waiting = (await iphone.signIn()).json() as AuthStatus;
    const approve = await visitor.fetch(`/api/access/requests/${waiting.approval?.code}/approve`, {
      method: 'POST',
    });
    expect(approve.statusCode).toBe(403);
    expect(approve.json().error).toBe('here-only');
    const off = await visitor.fetch('/api/access/approval', {
      method: 'PUT',
      payload: { on: false },
    });
    expect(off.statusCode).toBe(403);
    expect(off.json().error).toBe('here-only');
  });

  it('keeps devices signed in when it’s turned on, so nobody is locked out', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    const iphone = phone(app);
    await iphone.signIn();
    const access = await approvalOn(owner);
    expect(access.approval).toEqual({ on: true, here: true });
    expect(access.devices.find((d) => d.current)?.approvedHow).toBe('this-computer');
    expect(access.devices.find((d) => d.kind === 'phone')).toMatchObject({
      approved: true,
      approvedHow: 'already-signed-in',
    });
    expect((await iphone.fetch('/api/state')).statusCode).toBe(200);
  });

  it('only lets this computer approve devices or turn approval off', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    const iphone = phone(app);
    await iphone.signIn();
    await approvalOn(owner);

    const other = laptop(app);
    const { code } = (await other.signIn()).json().approval;
    // An approved remote device (or someone with its session) can't let others in…
    const approve = await iphone.fetch(`/api/access/requests/${code}/approve`, { method: 'POST' });
    expect(approve.statusCode).toBe(403);
    expect(approve.json().error).toBe('here-only');
    // …nor switch the protection off.
    const off = await iphone.fetch('/api/access/approval', {
      method: 'PUT',
      payload: { on: false },
    });
    expect(off.statusCode).toBe(403);
    expect((await other.status()).signedIn).toBe(false);

    // This computer can, once it has confirmed it's you.
    expect(
      (await owner.fetch(`/api/access/requests/${code}/approve`, { method: 'POST' })).statusCode,
    ).toBe(200);
    expect((await other.status()).signedIn).toBe(true);
    const device = (await owner.access()).devices.find(
      (d) => d.name === 'Chrome on Mac' && !d.current,
    );
    expect(device?.approvedHow).toBe('settings');
  });

  it('needs a recent password to approve or to turn approval on', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    const res = await owner.fetch('/api/access/approval', { method: 'PUT', payload: { on: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('verify-required');
  });

  it('can’t be turned on without a way to sign in', async () => {
    const { app } = await setup();
    const res = await here(app).fetch('/api/access/approval', {
      method: 'PUT',
      payload: { on: true },
    });
    expect(res.statusCode).toBe(409);
  });

  it('makes a removed device ask again', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await store.approve((await iphone.signIn()).json().approval.code, 'terminal');
    const id = (await owner.access()).devices.find((d) => d.kind === 'phone')?.id ?? '';
    await owner.fetch(`/api/access/devices/${id}`, { method: 'DELETE' });
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);
    expect(((await iphone.signIn()).json() as AuthStatus).approval?.state).toBe('waiting');
  });

  it('keeps approved devices when the password changes', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await store.approve((await iphone.signIn()).json().approval.code, 'terminal');
    await owner.fetch('/api/access/password', {
      method: 'PUT',
      payload: { username: 'ada', password: 'seven lanterns over quiet harbours' },
    });
    // Signed out by the change, but recognised: no new approval needed.
    expect((await iphone.fetch('/api/state')).statusCode).toBe(401);
    const status = (await iphone.signIn('seven lanterns over quiet harbours')).json() as AuthStatus;
    expect(status.signedIn).toBe(true);
  });

  it('lets only so many devices wait at once', async () => {
    const { app } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    for (let i = 0; i < MAX_WAITING; i++) {
      const res = await phone(app, `100.64.1.${i}`).signIn();
      expect(res.statusCode).toBe(200);
    }
    const res = await phone(app, '100.64.2.1').signIn();
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toContain('pnpm conch devices');
  });

  it('forgets approval, devices and requests when sign-in is reset', async () => {
    const { app, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    await phone(app).signIn();
    await store.disable();
    const file = await store.get();
    expect(file).toMatchObject({ approval: false, devices: [], requests: [] });
  });
});

describe('approve new devices — scripts with an access key', () => {
  async function withKey(app: App) {
    const owner = await withPassword(app);
    const created = await owner.fetch('/api/access/keys', {
      method: 'POST',
      payload: { name: 'Home server' },
    });
    // Making a key switched sign-in to keys; this computer stays signed in.
    return { owner, key: created.json().key as string };
  }

  it('asks once for a key used from another device, and says the code on every call', async () => {
    const { app, store } = await setup();
    const { owner, key } = await withKey(app);
    await approvalOn(owner);
    const script = new Browser(app, {
      remoteAddress: '100.64.0.20',
      host: 'conch.example',
      userAgent: 'curl/8.9.1',
    });
    const first = await script.fetch('/api/state', { bearer: key });
    expect(first.statusCode).toBe(403);
    expect(first.json()).toMatchObject({ error: 'approval-required' });
    const code = first.json().code as string;
    expect(first.json().message).toContain(`pnpm conch devices approve ${code}`);
    const again = await script.fetch('/api/state', { bearer: key });
    expect(again.json().code).toBe(code);

    const { requests } = await owner.access();
    expect(requests).toEqual([
      expect.objectContaining({
        code,
        script: true,
        keyName: 'Home server',
        device: 'Scripts using “Home server”',
      }),
    ]);

    await store.approve(code, 'terminal');
    expect((await script.fetch('/api/state', { bearer: key })).statusCode).toBe(200);
  });

  it('lets a key work on this computer without asking', async () => {
    const { app } = await setup();
    const { owner, key } = await withKey(app);
    await approvalOn(owner);
    const local = new Browser(app, {
      remoteAddress: '127.0.0.1',
      host: 'localhost:4317',
      userAgent: 'curl/8.9.1',
    });
    expect((await local.fetch('/api/state', { bearer: key })).statusCode).toBe(200);
  });

  it('a wrong key is still just unauthorized, and a revoked one forgets its approval', async () => {
    const { app, store } = await setup();
    const { owner, key } = await withKey(app);
    await approvalOn(owner);
    const script = phone(app);
    expect((await script.fetch('/api/state', { bearer: 'conch_nope' })).statusCode).toBe(401);
    const code = (await script.fetch('/api/state', { bearer: key })).json().code as string;
    await store.approve(code, 'terminal');
    const keyId = (await store.keys())[0]?.id ?? '';
    await owner.fetch(`/api/access/keys/${keyId}`, { method: 'DELETE' });
    expect((await store.get()).devices.some((d) => d.keyId === keyId)).toBe(false);
  });

  it('a key signing a browser in on a new device waits like a password does', async () => {
    const { app } = await setup();
    const { owner, key } = await withKey(app);
    await approvalOn(owner);
    const iphone = phone(app);
    const res = await iphone.fetch('/api/auth/sign-in', {
      method: 'POST',
      payload: { with: 'key', key },
    });
    expect((res.json() as AuthStatus).approval?.state).toBe('waiting');
    const { requests } = await owner.access();
    expect(requests[0]).toMatchObject({ via: 'key', keyName: 'Home server', script: false });
  });
});

describe('the terminal changing access.json while Conch runs', () => {
  it('closes sockets of devices removed elsewhere, and says devices changed', async () => {
    const { app, services, home } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const iphone = phone(app);
    await iphone.signIn();
    const gate = services.gate;

    // The waiting device's approval comes from another process (`pnpm conch`).
    const cli = new AccessStore(home);
    const { requests } = await owner.access();
    const changes: number[] = [];
    gate.devicesChanged.on(({ waiting }) => changes.push(waiting));
    await gate.sweep();
    await cli.approve(requests[0]?.code ?? '', 'terminal');
    await new Promise((r) => setTimeout(r, 600));
    await gate.sweep();
    expect(changes).toEqual([0]);

    const session = (await services.access.get()).sessions.find((s) => s.kind === 'phone');
    const socket = { closed: 0, close: () => void socket.closed++ };
    const untrack = gate.track(session?.id ?? '', socket);
    const id = (await cli.get()).devices.find((d) => d.kind === 'phone')?.id ?? '';
    await cli.removeDevice(id);
    await new Promise((r) => setTimeout(r, 600));
    await gate.sweep();
    expect(socket.closed).toBe(1);
    untrack();
  });
});

describe('a damaged access.json', () => {
  it('drops unreadable devices (they ask again) but keeps approval on', async () => {
    const { app, home, store } = await setup();
    const owner = await withPassword(app);
    await approvalOn(owner);
    const path = join(home, 'access.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.devices = [{ id: 42 }, ...file.devices];
    await writeFile(path, JSON.stringify(file));
    const fresh = new AccessStore(home);
    expect(await fresh.approvalOn()).toBe(true);
    expect(await fresh.locked()).toBe(false);
    void store;
  });

  it('locks rather than guess when the approval setting itself can’t be read', async () => {
    const { app, home } = await setup();
    await withPassword(app);
    const path = join(home, 'access.json');
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.approval = 'maybe';
    file.sessions = 'garbage';
    await writeFile(path, JSON.stringify(file));
    expect(await new AccessStore(home).locked()).toBe(true);
  });
});
