import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockDiscord } from './mock/discord';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-discord-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const discord = services.mockDiscord;
  if (!discord) throw new Error('no mock Discord');
  discord.heartbeatMs = 1000;
  return { s: services, discord };
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
    await new Promise((r) => setTimeout(r, 15));
  }
}

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

async function connected() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create({ kind: 'discord', token: MockDiscord.TOKEN });
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  return { ...ctx, channel };
}

/** The owner messages the bot and is let in from the page ("That's me"). */
async function paired() {
  const ctx = await connected();
  ctx.discord.say('hi');
  await until(
    async () => (await ctx.s.channels.get(ctx.channel.id)).requests.length === 1,
    'request',
  );
  await ctx.s.channels.answer(ctx.channel.id, MockDiscord.OWNER.id, 'allow');
  await until(() => ctx.discord.last()?.content.includes('Hi Ada'), 'welcome');
  return ctx;
}

describe('Discord', () => {
  it('checks the token and makes an invite link that asks for no permissions', async () => {
    const { s } = await setup();
    const check = await s.channels.check({ kind: 'discord', token: `Token: ${MockDiscord.TOKEN}` });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.bot).toMatchObject({ username: 'conch_bot', name: 'Conch', servers: 0 });
    const invite = new URL(check.bot.inviteUrl ?? '');
    expect(invite.searchParams.get('client_id')).toBe('1100000000000000000');
    expect(invite.searchParams.get('permissions')).toBe('0');
    expect(invite.searchParams.get('scope')).toBe('bot');
    const bad = await s.channels.check({ kind: 'discord', token: 'nope' });
    expect(bad).toMatchObject({ ok: false, field: 'token' });
  });

  it('connects with direct-message intents only (nothing to switch on in the portal)', async () => {
    const { discord } = await connected();
    expect(discord.identifies).toBe(1);
  });

  it('answers in a server channel you turned on, only when mentioned (ADR 0075)', async () => {
    const { s, discord, channel } = await paired();
    discord.join();
    discord.sayInServer('not for the bot');
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups[0],
      'channel listed',
    );
    expect(group).toMatchObject({ name: '#general (My server)', on: false });
    await s.channels.setGroup(channel.id, group.id, true);
    const bob = { id: '777', username: 'bob', global_name: 'Bob' };
    discord.sayInServer('what time is it?', bob, { mention: true });
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    expect(chat.origin).toMatchObject({ guest: true, group: '#general (My server)' });
    const said = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'message logged',
    );
    expect(said).toMatchObject({ text: 'what time is it?' });
    await until(() => discord.last('general1'), 'answer in the channel');
  });

  it('clears an Interactions Endpoint URL that would swallow button presses', async () => {
    const ctx = await setup();
    ctx.discord.endpoint = 'https://example.com/interactions';
    await ctx.s.channels.create({ kind: 'discord', token: MockDiscord.TOKEN });
    await until(() => ctx.discord.endpoint === '', 'endpoint cleared');
  });

  it('gives a bot without a picture Conch’s pearl', async () => {
    const { discord } = await connected();
    await until(() => discord.avatarSet, 'avatar set');
  });

  it('notices when the bot is added to a server', async () => {
    const { s, discord, channel } = await connected();
    discord.join();
    await until(async () => (await s.channels.get(channel.id)).bot.servers === 1, 'server count');
  });

  it('lets the owner in from the page, then answers them in their DM', async () => {
    const { s, discord, channel } = await paired();
    expect((await s.channels.get(channel.id)).people[0]).toMatchObject({ name: 'Ada Lovelace' });
    discord.say('Hello there');
    await until(() => discord.last()?.content.includes('thought on'), 'answer', 10_000);
    const conversation = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    expect(conversation?.origin).toMatchObject({ channel: 'discord' });
  });

  it('asks with buttons and takes the answer from a press', async () => {
    const { s, discord } = await paired();
    discord.say('please run the tests');
    const question = await until(
      () => discord.sent.find((m) => m.buttons.length === 3),
      'question',
      10_000,
    );
    expect(question.buttons.map((b) => b.style)).toEqual([1, 2, 4]);
    discord.press(question.buttons[0]?.custom_id ?? '', question.id);
    await until(
      () =>
        discord.sent.find((m) => m.edited && m.id === question.id && m.content.includes('Allowed')),
      'edited question',
    );
    expect(discord.calls.some((c) => c.path.includes('/interactions/'))).toBe(true);
    const conversation = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    const events = await s.conversations.eventsAfter(conversation?.id ?? '');
    expect(events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow')).toBe(
      true,
    );
  });

  it('lets someone in even when Discord won’t deliver the welcome', async () => {
    const { s, discord, channel } = await connected();
    discord.say('hi');
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    discord.dmsClosed = true;
    const view = await s.channels.answer(channel.id, MockDiscord.OWNER.id, 'allow');
    expect(view.people.map((p) => p.id)).toEqual([MockDiscord.OWNER.id]);
  });

  it('ignores messages in servers', async () => {
    const { s, discord, channel } = await connected();
    discord.say('hey bot', MockDiscord.OWNER, { guild_id: 'guild1', channel_id: 'general' });
    await new Promise((r) => setTimeout(r, 400));
    expect((await s.channels.get(channel.id)).requests).toEqual([]);
  });

  it('resumes where it left off after the connection drops', async () => {
    const { s, discord, channel } = await connected();
    discord.drop();
    await until(() => discord.resumes === 1, 'resume');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    expect(discord.identifies).toBe(1);
  });

  it('replaces a connection that stopped answering heartbeats', async () => {
    const { s, discord, channel } = await connected();
    discord.silence();
    await until(() => discord.resumes >= 1, 'resume after zombie', 8000);
    discord.silence(false);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
  });

  it('asks for a new token when Discord stops accepting it', async () => {
    const { s, discord, channel } = await connected();
    discord.revoke();
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs-token',
      10_000,
    );
    expect((await s.channels.get(channel.id)).health.message).toMatch(/Developer Portal/);
  });
});
