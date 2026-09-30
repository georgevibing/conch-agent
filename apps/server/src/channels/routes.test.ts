import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { MockTelegram } from './mock/telegram';

const PASSWORD = 'purple otters juggle at dawn';
const REMOTE = { remoteAddress: '192.168.1.20', host: 'conch.example' };
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'conch-channel-routes-'));
  const services = new Services(
    loadConfig({
      CONCH_HOME: home,
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
      CONCH_ALLOWED_HOSTS: 'conch.example',
    }),
  );
  const app = await buildApp(services);
  await app.ready();
  cleanup = async () => {
    await app.close();
    services.search.close();
    await rm(home, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  };
  return { app, services, home };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0] ?? '';
};

const remote = (
  app: App,
  url: string,
  init: { method?: string; cookie?: string; payload?: object } = {},
) =>
  app.inject({
    method: (init.method ?? 'GET') as 'GET',
    url,
    remoteAddress: REMOTE.remoteAddress,
    headers: { host: REMOTE.host, ...(init.cookie && { cookie: init.cookie }) },
    ...(init.payload && { payload: init.payload }),
  });

/** A password, then a sign-in from another device. */
async function phone(app: App) {
  await app.inject({
    method: 'PUT',
    url: '/api/access/password',
    payload: { username: 'ada', password: PASSWORD },
  });
  const res = await remote(app, '/api/auth/sign-in', {
    method: 'POST',
    payload: { with: 'password', username: 'ada', password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}

describe('channel routes', () => {
  it('never send a key back, and keep it in a file only you can read', async () => {
    const { app, home } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'telegram', token: MockTelegram.TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(MockTelegram.TOKEN.split(':')[1]);
    const list = await app.inject('/api/channels');
    expect(list.body).not.toContain(MockTelegram.TOKEN.split(':')[1]);
    // The settings file has no key either; the secrets file does.
    expect(await readFile(join(home, 'channels.json'), 'utf8')).not.toContain(MockTelegram.TOKEN);
    expect(await readFile(join(home, 'channels.secrets.json'), 'utf8')).toContain(
      MockTelegram.TOKEN,
    );
  });

  it('from another device, opening a new way in needs a fresh sign-in', async () => {
    const { app } = await setup();
    const cookie = await phone(app);
    // Just signed in there: that's fresh enough.
    const made = await remote(app, '/api/channels', {
      method: 'POST',
      cookie,
      payload: { kind: 'telegram', token: MockTelegram.TOKEN },
    });
    expect(made.statusCode).toBe(200);
    const id = made.json().id as string;

    // Ten minutes on, it isn't: connecting, letting someone in, new links, and turning it back on ask again.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const attempts = [
      remote(app, '/api/channels', {
        method: 'POST',
        cookie,
        payload: { kind: 'telegram', token: MockTelegram.TOKEN },
      }),
      remote(app, `/api/channels/${id}/requests/777`, {
        method: 'POST',
        cookie,
        payload: { answer: 'allow' },
      }),
      remote(app, `/api/channels/${id}/pair`, { method: 'POST', cookie, payload: {} }),
      remote(app, `/api/channels/${id}`, { method: 'PATCH', cookie, payload: { enabled: true } }),
      remote(app, `/api/channels/${id}/token`, {
        method: 'PUT',
        cookie,
        payload: { kind: 'telegram', token: MockTelegram.TOKEN },
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('verify-required');
    }
    // Taking trust away never needs it.
    const off = await remote(app, `/api/channels/${id}`, {
      method: 'PATCH',
      cookie,
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    const block = await remote(app, `/api/channels/${id}/requests/777`, {
      method: 'POST',
      cookie,
      payload: { answer: 'block' },
    });
    expect(block.statusCode).toBe(200);
  });

  it('refuse ids that could become paths, and bodies that aren’t keys', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/channels/..%2F..%2Fsecrets')).statusCode).toBe(404);
    const person = await app.inject({
      method: 'DELETE',
      url: '/api/channels/ch_1/people/..%2F..%2Fx',
    });
    expect(person.statusCode).toBe(404);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'irc', token: 'x' },
    });
    expect(wrong.statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'telegram', token: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'invalid', field: 'token' });
  });
});
