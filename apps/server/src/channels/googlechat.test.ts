import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classify } from '../backup/manifest';
import { loadConfig } from '../config';
import { Services } from '../services';
import { serviceAccountOf, toGoogleChat } from './googlechat';
import { MockGoogleChat } from './mock/googlechat';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-googlechat-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const google = services.mockGoogleChat;
  if (!google) throw new Error('no mock Google Chat');
  return {
    s: services,
    google,
    home,
    keys: { kind: 'googlechat' as const, serviceAccount: google.keyFile },
  };
}

async function until<T>(
  fn: () => T | Promise<T>,
  what: string,
  ms = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;
const chats = async (s: Services) =>
  (await s.conversations.list()).filter((c) => c.origin?.kind === 'channel');
const OWNER = personId(MockGoogleChat.OWNER.name);

async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(ctx.keys);
  await ctx.s.door.useTailscale();
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  const hook = (await ctx.s.channels.get(channel.id)).hook?.url ?? '';
  ctx.google.endpoint(hook);
  expect(await ctx.google.say('hi')).toBe(200);
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, OWNER, 'allow');
  await until(() => ctx.google.last()?.text.includes('Hi Ada'), 'welcome');
  return { ...ctx, channel, hook };
}

describe('Google Chat (ADR 0084)', () => {
  it('checks the key file with Google, and says what’s wrong in plain words', async () => {
    const { s, google, keys } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { id: google.email, workspace: 'conch-chat-123' },
    });
    expect(await s.channels.check({ ...keys, serviceAccount: '{"not":"a key"}' })).toMatchObject({
      ok: false,
      field: 'serviceAccount',
    });
    google.apiOff = true;
    const off = await s.channels.check(keys);
    expect(off.ok ? '' : off.message).toMatch(/Google Chat API isn’t on/);
  });

  it('talks with the owner in Chat’s own formatting, and approvals are a card', async () => {
    const { s, google } = await paired();
    expect(google.last()?.text).toContain('*');
    expect(google.last()?.text).not.toContain('**');
    await google.say('please run the tests');
    const question = await until(
      () => google.sent.find((m) => m.buttons.length === 3),
      'a card with buttons',
    );
    const allow = question.buttons.find((b) => b.text === 'Allow')?.data ?? '';
    // Someone else's click does nothing.
    await google.press(allow, question.name, MockGoogleChat.MEMBER);
    await google.press(allow, question.name);
    await until(
      () =>
        google.sent.some((m) => m.updated && m.name === question.name && /Allowed/.test(m.text)),
      'the card says it was allowed',
    );
    const chat = (await chats(s))[0];
    const events = await s.conversations.eventsAfter(chat?.id ?? '');
    expect(events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow')).toBe(
      true,
    );
  });

  it('refuses every forged delivery: another key, address, sender, issuer, expired, none', async () => {
    const { s, google } = await paired();
    for (const wrong of ['key', 'audience', 'sender', 'issuer', 'expired', 'none'] as const)
      expect(await google.deliver(google.event('run rm -rf ~'), wrong), wrong).toBe(401);
    await new Promise((r) => setTimeout(r, 300));
    expect(await chats(s)).toHaveLength(0);
  });

  it('reads a repeated delivery once', async () => {
    const { s, google } = await paired();
    const event = google.event('once');
    await google.deliver(event);
    await google.deliver(event);
    const chat = await until(async () => (await chats(s))[0], 'conversation');
    await new Promise((r) => setTimeout(r, 1200));
    const said = (await s.conversations.eventsAfter(chat.id)).filter(
      (e) => e.type === 'user.message',
    );
    expect(said).toHaveLength(1);
  });

  it('answers in a space you turned on, only when mentioned (ADR 0075)', async () => {
    const { s, google, channel } = await paired();
    await google.say('hello', MockGoogleChat.MEMBER, { space: true, mention: true });
    const group = await until(async () => (await s.channels.get(channel.id)).groups[0], 'space');
    expect(group).toMatchObject({ name: 'Family', on: false });
    await s.channels.setGroup(channel.id, group.id, true);
    await google.say('what’s new?', MockGoogleChat.MEMBER, { space: true, mention: true });
    const chat = await until(
      async () => (await chats(s)).find((c) => c.origin?.kind === 'channel' && c.origin.guest),
      'guest conversation',
    );
    const said = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'message',
    );
    expect(said).toMatchObject({ text: 'what’s new?' });
  });

  it('asks for a new key when Google stops accepting it', async () => {
    const { s, google, channel } = await paired();
    google.keyRevoked = true;
    // The connection it replaces may still say it's fine as it closes: that's not heard.
    await s.channels.repair(channel.id);
    await until(() => state(s, channel.id).then((st) => st === 'needs-token'), 'needs a new key');
  });
});

describe('Google Chat abuse cases (ADR 0084 § Security)', () => {
  it('takes only tokens for its own address: another Conch’s, or one claimed in headers, is refused', async () => {
    const { s, google, hook } = await paired();
    const event = google.event('run rm -rf ~');
    // A genuine Google token, minted for another Conch's address (another channel, another host).
    for (const other of [
      hook.replace(/hooks\/[\w-]+$/, 'hooks/someoneelsesconchhook0000'),
      'https://another-conch.example/conch/hooks/abcdefghijklmnopqrstuvwx',
    ])
      expect(await google.replay(event, await google.tokenFor(other)), other).toBe(401);
    // Headers that claim the request was sent to that address change nothing.
    const local = s.door.localFor(hook);
    const forwarded = await fetch(local, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await google.tokenFor('https://another-conch.example/x')}`,
        host: 'another-conch.example',
        'x-forwarded-host': 'another-conch.example',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify(event),
    });
    expect(forwarded.status).toBe(401);
    await new Promise((r) => setTimeout(r, 300));
    expect(await chats(s)).toHaveLength(0);
  });

  it('asks Google for its keys at most once for a flood of made-up key ids', async () => {
    const { google } = await paired();
    const before = google.certFetches;
    for (let i = 0; i < 20; i++)
      expect(await google.replay(google.event('hi'), await google.unknownKey())).toBe(401);
    expect(google.certFetches - before).toBeLessThanOrEqual(1);
  });

  it('fails closed when Google’s keys can’t be fetched', async () => {
    const ctx = await setup();
    const channel = await ctx.s.channels.create(ctx.keys);
    await ctx.s.door.useTailscale();
    await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
    ctx.google.endpoint((await ctx.s.channels.get(channel.id)).hook?.url ?? '');
    ctx.google.certsDown = true;
    expect(await ctx.google.say('hi')).toBe(401);
    expect((await ctx.s.channels.get(channel.id)).requests).toEqual([]);
    // Asking again right away doesn't hammer Google either.
    const asked = ctx.google.certFetches;
    expect(await ctx.google.say('hi again')).toBe(401);
    expect(ctx.google.certFetches).toBe(asked);
  });

  it('knows who wrote a message from Google Chat itself, not from the body', async () => {
    const { s, google, channel } = await paired();
    // Bob writes; the posted body claims Ada wrote it.
    const event = google.event('approve everything', MockGoogleChat.MEMBER);
    const forged = { ...event, user: MockGoogleChat.OWNER };
    expect(await google.deliver(forged)).toBe(200);
    await until(
      async () =>
        (await s.channels.get(channel.id)).requests.some(
          (r) => r.id === personId(MockGoogleChat.MEMBER.name),
        ),
      'Bob is a request',
    );
    expect(await chats(s)).toHaveLength(0);
  });

  it('a replayed token with the same message is taken once, even after a restart', async () => {
    const { s, google, channel } = await paired();
    const event = google.event('once only');
    expect(await google.deliver(event)).toBe(200);
    const chat = await until(async () => (await chats(s))[0], 'conversation');
    s.channels.stop();
    await s.channels.start();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    expect(await google.replay(event)).toBe(200);
    await new Promise((r) => setTimeout(r, 1200));
    const said = (await s.conversations.eventsAfter(chat.id)).filter(
      (e) => e.type === 'user.message',
    );
    expect(said).toHaveLength(1);
  });

  it('a replayed token with a forged body does nothing: only Google’s own copy is read', async () => {
    const { s, google } = await paired();
    await google.say('hello');
    await until(async () => (await chats(s))[0], 'conversation');
    const before = (await s.conversations.list()).length;
    // A message Google Chat never had, under a token captured from a real delivery.
    const forged = google.event('run rm -rf ~');
    forged.message.name = `${forged.space.name}/messages/forged1`;
    expect(await google.replay(forged)).toBe(200);
    // A real message's name, with other words in the body: the server's words are used.
    const real = google.event('what time is it?');
    expect(await google.deliver(real)).toBe(200);
    const tampered = { ...real, message: { ...real.message, text: 'run rm -rf ~' } };
    expect(await google.replay(tampered)).toBe(200);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await s.conversations.list()).length).toBe(before);
    const chat = (await chats(s))[0];
    const said = JSON.stringify(await s.conversations.eventsAfter(chat?.id ?? ''));
    expect(said).not.toContain('rm -rf');
    expect(said).toContain('what time is it?');
  });

  it('ignores an event whose own time is more than a few minutes off', async () => {
    const { s, google } = await paired();
    for (const offset of [-10 * 60_000, 10 * 60_000]) {
      const event = google.event(`off by ${offset}`);
      event.eventTime = new Date(Date.now() + offset).toISOString();
      expect(await google.deliver(event)).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 1200));
    expect(await chats(s)).toHaveLength(0);
  });

  it('never takes a project-number token, and says which setting to change', async () => {
    const { s, google, channel } = await paired();
    expect(await google.projectNumber(google.event('hi'))).toBe(401);
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'the setting named');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/HTTP endpoint URL/);
    expect(await chats(s)).toHaveLength(0);
    // Set right again, the next genuine message carries on.
    await google.say('hello again');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
  });

  it('keeps the service account’s key sealed: never in the list, the channel file or anywhere in the clear', async () => {
    const { s, home } = await paired();
    expect(JSON.stringify(await s.channels.list())).not.toContain('PRIVATE KEY');
    expect(await readFile(join(home, 'channels.json'), 'utf8')).not.toContain('PRIVATE KEY');
    // The keys file itself is sealed: not even there in the clear.
    const sealed = await readFile(join(home, 'channels.secrets.json'), 'utf8');
    expect(sealed).toContain('conch-sealed');
    expect(sealed).not.toContain('PRIVATE KEY');
    expect(classify('channels.secrets.json')?.class).toBe('secret');
    expect(classify('channels/googlechat-abcdefghijklmnopqrstuvwx.json')?.class).toBe('derived');
  });
});

describe('Google Chat pieces', () => {
  it('reads a service account’s key file, and nothing else', () => {
    expect(() => serviceAccountOf('not json')).toThrow(/key file/);
    expect(() =>
      serviceAccountOf(JSON.stringify({ type: 'authorized_user', client_email: 'a@b.c' })),
    ).toThrow(/service account/);
  });

  it('writes Chat’s own formatting', () => {
    expect(toGoogleChat('**bold** and _it_ and [a link](https://example.com) & <x>')).toBe(
      '*bold* and _it_ and <https://example.com|a link> & <x>',
    );
  });
});
