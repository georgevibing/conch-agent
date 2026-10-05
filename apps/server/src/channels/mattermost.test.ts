import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MattermostAdapter, normalizeMattermost, serverUrl } from './mattermost';
import { MockMattermost } from './mock/mattermost';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-mattermost-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const mm = services.mockMattermost;
  if (!mm) throw new Error('no mock Mattermost');
  return {
    s: services,
    mm,
    keys: { kind: 'mattermost' as const, server: mm.base, token: MockMattermost.TOKEN },
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

async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(ctx.keys);
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  ctx.mm.say('hi');
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, MockMattermost.OWNER.id, 'allow');
  await until(() => ctx.mm.last()?.message.includes('Hi Ada'), 'welcome');
  return { ...ctx, channel };
}

describe('Mattermost (ADR 0081)', () => {
  it('checks the token with the server and says who the bot is, naming the box that’s wrong', async () => {
    const { s, keys } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { id: MockMattermost.BOT.id, username: 'conch' },
    });
    expect(await s.channels.check({ ...keys, token: 'wrongwrongwrongwrongwrong1' })).toMatchObject({
      ok: false,
      field: 'token',
    });
    expect(await s.channels.check({ ...keys, server: 'not a server' })).toMatchObject({
      ok: false,
      field: 'server',
    });
  });

  it('talks with the owner over the WebSocket, in Markdown, and asks with a number', async () => {
    const { s, mm } = await paired();
    expect(mm.last()?.message).toContain('**');
    mm.say('please run the tests');
    const question = await until(
      () => mm.sent.find((p) => /Reply with a number/.test(p.message)),
      'numbered question',
    );
    expect(question.message).toMatch(/would like to/);
    mm.say('1');
    await until(async () => {
      const chat = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
      const events = await s.conversations.eventsAfter(chat?.id ?? '');
      return events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow');
    }, 'allowed');
    // Once decided, the question says so.
    await until(() => mm.sent.some((p) => p.edited && p.id === question.id), 'edited');
  });

  it('answers in a channel only once you turn it on, and only when mentioned (ADR 0075)', async () => {
    const { s, mm, channel } = await paired();
    mm.sayIn('what’s new?', MockMattermost.MEMBER);
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups[0],
      'channel listed',
    );
    expect(group).toMatchObject({ name: '~Town Square', on: false });
    await s.channels.setGroup(channel.id, group.id, true);
    mm.sayIn('not for the bot', MockMattermost.MEMBER, false);
    mm.sayIn('what’s new?', MockMattermost.MEMBER);
    const chat = await until(
      async () =>
        (await s.conversations.list()).find((c) => c.origin?.kind === 'channel' && c.origin.guest),
      'guest conversation',
    );
    const said = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'message',
    );
    expect(said).toMatchObject({ text: 'what’s new?' });
    await until(() => mm.last(MockMattermost.TOWN.id), 'answer in the channel');
  });

  it('treats a server-provided bot username as literal text when stripping a mention', async () => {
    const username = String.raw`conch\.(a+)+$x`;
    const { mm, keys } = await setup();
    const saved = MockMattermost.BOT.username;
    MockMattermost.BOT.username = username;
    const message = vi.fn();
    const online = vi.fn();
    const connection = new MattermostAdapter(keys).connect({
      message,
      state: online,
      press: vi.fn(),
      healed: vi.fn(),
    });
    try {
      await until(() => online.mock.calls.some(([s]) => s === 'online'), 'online');
      mm.sayIn(`@${username} hello`, MockMattermost.MEMBER, true);
      await until(() => message.mock.calls.length, 'group message');
      expect(message.mock.calls[0]?.[0]).toMatchObject({ mentioned: true, text: '@conch hello' });
      // A username with regex syntax must not match and remove different text.
      mm.sayIn('@conchXaaaa hello', MockMattermost.MEMBER, true);
      await until(() => message.mock.calls.length === 2, 'second group message');
      expect(message.mock.calls[1]?.[0]).toMatchObject({ text: '@conch @conchXaaaa hello' });
    } finally {
      connection.close();
      MockMattermost.BOT.username = saved;
    }
  });

  it('reconnects after a drop, and asks for a new token when the old one is revoked', async () => {
    const { s, mm, channel } = await paired();
    mm.drop();
    await until(() => state(s, channel.id).then((st) => st === 'reconnecting'), 'reconnecting');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again', 15_000);
    mm.revoke();
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs-token',
      15_000,
    );
    mm.tokens.add('newnewnewnewnewnewnewnew01');
    await s.channels.replaceToken(channel.id, {
      kind: 'mattermost',
      token: 'newnewnewnewnewnewnewnew01',
    });
    await until(
      () => state(s, channel.id).then((st) => st === 'online'),
      'online with the new token',
    );
  });
});

describe('Mattermost pieces', () => {
  it('reads the server from whatever was pasted, and keeps a token off plain HTTP elsewhere', async () => {
    expect(serverUrl('chat.example.com/team/channels/town-square')).toBe(
      'https://chat.example.com',
    );
    expect(serverUrl('https://chat.example.com/')).toBe('https://chat.example.com');
    expect(serverUrl('ftp://x')).toBeUndefined();
    expect(
      normalizeMattermost({ kind: 'mattermost', server: 'chat.example.com', token: ' t ' }).server,
    ).toBe('https://chat.example.com');
    const plain = new MattermostAdapter({
      kind: 'mattermost',
      server: 'http://chat.example.com',
      token: MockMattermost.TOKEN,
    });
    await expect(plain.identify()).rejects.toMatchObject({
      code: 'setup',
      detail: { field: 'server' },
    });
  });
});
