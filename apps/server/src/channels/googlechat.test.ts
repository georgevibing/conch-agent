import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
