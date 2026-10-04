import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { onThisComputer } from '../test/here';
import { loadConfig } from '../config';
import { Services } from '../services';
import { MockMail } from './mock/email';
import { MockTelegram } from './mock/telegram';
import { MockWeChat } from './mock/wechat';

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
  const app = onThisComputer(await buildApp(services), services);
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
    // The settings file has no key either; the secrets file has it sealed (ADR 0025).
    expect(await readFile(join(home, 'channels.json'), 'utf8')).not.toContain(MockTelegram.TOKEN);
    const sealed = await readFile(join(home, 'channels.secrets.json'), 'utf8');
    expect(sealed).toMatch(/^\{"conch-sealed":1/);
    expect(sealed).not.toContain(MockTelegram.TOKEN.split(':')[1]);
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
      // Answering in a group lets everyone there reach it (ADR 0075).
      remote(app, `/api/channels/${id}/groups/Xgroup1`, {
        method: 'PUT',
        cookie,
        payload: { on: true },
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
    // Turning a group off never asks either (there's no such group here, so it's not found).
    const groupOff = await remote(app, `/api/channels/${id}/groups/Xgroup1`, {
      method: 'PUT',
      cookie,
      payload: { on: false },
    });
    expect(groupOff.statusCode).toBe(404);
    const traversal = await remote(app, `/api/channels/${id}/groups/..%2F..%2Fx`, {
      method: 'DELETE',
      cookie,
    });
    expect(traversal.statusCode).toBe(404);
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

  it('linking WhatsApp or Signal: a fresh sign-in from elsewhere, and no keys smuggled in', async () => {
    const { app, services } = await setup();
    await services.start();
    const cookie = await phone(app);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    // Showing a code is a new way in: whoever scans it talks to your assistant as you.
    const shown = await remote(app, '/api/channels/link', {
      method: 'POST',
      cookie,
      payload: { kind: 'whatsapp' },
    });
    expect(shown.statusCode).toBe(403);
    expect(shown.json().error).toBe('verify-required');
    vi.restoreAllMocks();
    const here = await remote(app, '/api/channels/link', {
      method: 'POST',
      cookie,
      payload: { kind: 'whatsapp' },
    });
    expect(here.statusCode).toBe(200);
    expect(here.json()).toMatchObject({ kind: 'whatsapp', state: 'starting' });
    const id = here.json().id as string;
    expect((await remote(app, `/api/channels/link/${id}`, { cookie })).statusCode).toBe(200);
    const stop = await remote(app, `/api/channels/link/${id}`, { method: 'DELETE', cookie });
    expect(stop.statusCode).toBe(204);
    expect((await remote(app, `/api/channels/link/${id}`, { cookie })).json()).toMatchObject({
      state: 'failed',
    });
    // Not an app that links, an id that could be a path, or a "session" posted as if it were a key.
    const telegram = await remote(app, '/api/channels/link', {
      method: 'POST',
      cookie,
      payload: { kind: 'telegram' },
    });
    expect(telegram.statusCode).toBe(400);
    expect((await remote(app, '/api/channels/link/..%2F..%2Fsecrets', { cookie })).statusCode).toBe(
      404,
    );
    const smuggled = await remote(app, '/api/channels', {
      method: 'POST',
      cookie,
      payload: { kind: 'whatsapp', session: 'wa_someone_elses' },
    });
    expect(smuggled.statusCode).toBe(400);
    expect(smuggled.json().message).toMatch(/links with a code/);
  });

  it('keep an email’s app password sealed, and say which box is wrong', async () => {
    const { app, home, services } = await setup();
    await services.start();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'email', provider: 'gmail', address: MockMail.ADDRESS, password: 'not it' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'invalid', field: 'password' });
    const bogus = await app.inject({
      method: 'POST',
      url: '/api/channels/check',
      payload: { kind: 'email', provider: 'other', address: 'not an address', password: 'x' },
    });
    expect(bogus.statusCode).toBe(400);
    const made = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: {
        kind: 'email',
        provider: 'gmail',
        address: MockMail.ADDRESS,
        password: MockMail.PASSWORD,
      },
    });
    expect(made.statusCode).toBe(200);
    expect(made.body).not.toContain('efgh');
    const sealed = await readFile(join(home, 'channels.secrets.json'), 'utf8');
    expect(sealed).toMatch(/^\{"conch-sealed":1/);
    expect(sealed).not.toContain('efgh');
    services.stop();
  });

  it('offer Gmail’s app password for talking by email, only by its address, and use it only when asked', async () => {
    const { app, services, home } = await setup();
    await services.start();
    expect((await app.inject('/api/channels/email/gmail')).json()).toEqual({});
    const gmail = await app.inject({
      method: 'POST',
      url: '/api/google/mail/password',
      payload: { address: MockMail.ADDRESS, password: MockMail.PASSWORD },
    });
    expect(gmail.statusCode).toBe(200);
    const offer = await app.inject('/api/channels/email/gmail');
    expect(offer.json()).toEqual({ address: MockMail.ADDRESS });
    expect(offer.body).not.toContain('efgh');
    // Nothing happened by itself: there's no email channel until someone says so.
    expect((await app.inject('/api/channels')).json().channels).toEqual([]);

    const made = await app.inject({ method: 'POST', url: '/api/channels/email/gmail' });
    expect(made.statusCode).toBe(200);
    expect(made.body).not.toContain('efgh');
    expect(made.json()).toMatchObject({
      kind: 'email',
      app: 'gmail',
      bot: { address: 'ada+conch@gmail.com' },
    });
    // It's your own address: you're in already, no hello needed.
    expect(made.json().people).toHaveLength(1);
    // Gmail the app is still there, and still can't send.
    const apps = (await app.inject('/api/integrations')).json().integrations as { id: string }[];
    expect(apps.map((a) => a.id)).toContain('gmail');

    // From another device, only right after confirming it's you.
    const cookie = await phone(app);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
    const there = await remote(app, '/api/channels/email/gmail', { method: 'POST', cookie });
    expect(there.statusCode).toBe(403);
    expect(there.json().error).toBe('verify-required');
    vi.restoreAllMocks();
    services.stop();

    // After a restart, the channel is still Gmail's (nothing new was written to keep it so).
    const stored = JSON.parse(await readFile(join(home, 'channels.json'), 'utf8')) as {
      channels: Record<string, unknown>[];
    };
    expect(stored.channels[0]).not.toHaveProperty('app');
  });

  it('open System Settings for iMessage only for someone at this Mac', async () => {
    const { app } = await setup();
    const here = await app.inject({
      method: 'POST',
      url: '/api/channels/imessage/open',
      payload: { place: 'full-disk-access' },
    });
    expect(here.statusCode).toBe(200);
    const odd = await app.inject({
      method: 'POST',
      url: '/api/channels/imessage/open',
      payload: { place: 'x-apple.systempreferences:anything' },
    });
    expect(odd.statusCode).toBe(400);
    expect((await app.inject('/api/channels/imessage')).json()).toMatchObject({ access: 'ready' });
    const cookie = await phone(app);
    const there = await remote(app, '/api/channels/imessage/open', {
      method: 'POST',
      cookie,
      payload: { place: 'full-disk-access' },
    });
    expect(there.statusCode).toBe(403);
  });

  it('the public door: opening it, and reading WeChat’s keys, need a fresh sign-in from elsewhere', async () => {
    const { app } = await setup();
    const made = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: {
        kind: 'wechat',
        mode: 'official',
        appId: MockWeChat.APP_ID,
        secret: MockWeChat.APP_SECRET,
      },
    });
    expect(made.statusCode).toBe(200);
    expect(made.body).not.toContain(MockWeChat.APP_SECRET);
    const id = made.json().id as string;
    const cookie = await phone(app);
    // Right after signing in, the keys come back (and never with the list).
    const hook = await remote(app, `/api/channels/${id}/hook`, { cookie });
    expect(hook.json()).toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9]+$/),
      aesKey: expect.stringMatching(/^[A-Za-z0-9]{43}$/),
    });
    const list = await remote(app, '/api/channels', { cookie });
    expect(list.body).not.toContain(hook.json().aesKey as string);
    // Ten minutes on, opening the door or reading them again asks again.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    for (const [method, url, payload] of [
      ['POST', '/api/channels/door/tailscale', {}],
      ['PUT', '/api/channels/door', { url: 'https://conch.example.org' }],
      ['GET', `/api/channels/${id}/hook`, undefined],
    ] as const) {
      const res = await remote(app, url, { method, cookie, ...(payload && { payload }) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toMatchObject({ error: 'verify-required' });
    }
    // Closing it never needs that.
    expect((await remote(app, '/api/channels/door', { method: 'DELETE', cookie })).statusCode).toBe(
      200,
    );
  });

  it('an address of your own must be plain HTTPS', async () => {
    const { app } = await setup();
    for (const url of [
      'http://conch.example.org',
      'https://user:pw@conch.example.org',
      'https://conch.example.org/?k=1',
      'not a url at all',
    ])
      expect(
        (await app.inject({ method: 'PUT', url: '/api/channels/door', payload: { url } }))
          .statusCode,
        url,
      ).toBe(400);
  });

  it('offers the Teams app only for a Teams channel', async () => {
    const { app } = await setup();
    const made = await app.inject({
      method: 'POST',
      url: '/api/channels',
      payload: { kind: 'telegram', token: MockTelegram.TOKEN },
    });
    expect(
      (await app.inject(`/api/channels/${made.json().id as string}/teams-app`)).statusCode,
    ).toBe(404);
  });
});
