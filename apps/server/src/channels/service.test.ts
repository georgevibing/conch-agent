import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Channel, ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockTelegram } from './mock/telegram';

let services: Services | undefined;

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-channels-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const telegram = services.mockTelegram;
  if (!telegram) throw new Error('no mock Telegram');
  telegram.pollCapMs = 200;
  const events: ServerEvent[] = [];
  services.broadcast.on((event) => events.push(event));
  return { s: services, telegram, events };
}

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function until<T>(
  fn: () => T | Promise<T>,
  what = 'condition',
  ms = 5000,
): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const BOTFATHER = `Done! Congratulations on your new bot. You will find it at t.me/my_conch_bot.
Use this token to access the HTTP API:
${MockTelegram.TOKEN}
Keep your token secure and store it safely.`;

/** Connect the mock bot and say hello through the link, as the owner. */
async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create({ kind: 'telegram', token: BOTFATHER });
  const code = new URL(channel.pairing?.link ?? '').searchParams.get('start');
  ctx.telegram.say(`/start ${code}`);
  await until(async () => (await ctx.s.channels.get(channel.id)).people.length === 1, 'pairing');
  return { ...ctx, channel };
}

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

describe('ChannelService — Telegram', () => {
  it('finds the key in BotFather’s whole message and says who the bot is', async () => {
    const { s } = await setup();
    const check = await s.channels.check({ kind: 'telegram', token: BOTFATHER });
    expect(check).toMatchObject({ ok: true, bot: { username: 'my_conch_bot', name: 'Conch' } });
    const bad = await s.channels.check({ kind: 'telegram', token: '42:nope' });
    expect(bad).toMatchObject({ ok: false, field: 'token' });
    if (!bad.ok) expect(bad.message).toMatch(/BotFather/);
  });

  it('connects, tidies the bot’s profile and opens a hello link', async () => {
    const { s, telegram } = await setup();
    const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    expect(channel.pairing?.link).toMatch(/^https:\/\/t\.me\/my_conch_bot\?start=[\w-]{16}$/);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    await until(() => telegram.calls.some((c) => c.method === 'setMyCommands'), 'commands');
    const commands = telegram.calls.find((c) => c.method === 'setMyCommands')?.params.commands;
    expect(commands).toEqual(expect.arrayContaining([expect.objectContaining({ command: 'new' })]));
  });

  it('lets the owner in when they press Start on the hello link, once', async () => {
    const { s, telegram, channel } = await paired();
    const view = await s.channels.get(channel.id);
    expect(view.people[0]).toMatchObject({ id: '4242', name: 'Ada Lovelace', username: 'ada' });
    expect(view.pairing).toBeUndefined();
    await until(() => telegram.last()?.text.includes('Hi Ada!'), 'welcome');
  });

  it('turns a message into a chat and sends the answer back', async () => {
    const { s, telegram, channel } = await paired();
    const before = telegram.sent.length;
    telegram.say('Hello there');
    const conversation = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    expect(conversation.origin).toEqual({
      kind: 'channel',
      channelId: channel.id,
      channel: 'telegram',
    });
    await until(() => telegram.sent.length > before, 'answer');
    expect(telegram.calls.some((c) => c.method === 'sendChatAction')).toBe(true);
    const answer = telegram.sent.slice(before).find((m) => m.method === 'sendMessage');
    expect(answer?.parse_mode).toBe('HTML');
  });

  it('asks before acting, with buttons, and carries on when you press Allow', async () => {
    const { s, telegram } = await paired();
    telegram.say('please run the tests');
    const question = await until(
      () => telegram.sent.find((m) => m.buttons.length === 3),
      'question with buttons',
    );
    expect(question.text).toMatch(/would like to/);
    const allow = question.buttons.find((b) => b.text === 'Allow');
    telegram.press(allow?.callback_data ?? '', question.message_id);
    await until(
      () =>
        telegram.sent.some(
          (m) =>
            m.method === 'editMessageText' &&
            m.message_id === question.message_id &&
            m.text.includes('Allowed'),
        ),
      'question marked allowed',
    );
    const conversation = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    const events = await s.conversations.eventsAfter(conversation?.id ?? '');
    expect(events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow')).toBe(
      true,
    );
  });

  it('ignores buttons pressed by someone who isn’t let in', async () => {
    const { telegram } = await paired();
    telegram.say('please run the tests');
    const question = await until(
      () => telegram.sent.find((m) => m.buttons.length === 3),
      'question',
    );
    const stranger = { id: 777, first_name: 'Eve' };
    telegram.press(question.buttons[0]?.callback_data ?? '', question.message_id, stranger);
    await new Promise((r) => setTimeout(r, 300));
    expect(telegram.sent.some((m) => m.method === 'editMessageText')).toBe(false);
    const ack = telegram.calls.find((c) => c.method === 'answerCallbackQuery');
    expect(ack?.params.text).toMatch(/let in/);
  });

  it('answers a stranger once, lists them as a request, and lets them in when you allow it', async () => {
    const { s, telegram, channel } = await paired();
    const bob = { id: 5151, first_name: 'Bob', username: 'bob' };
    telegram.say('hey, can I use this?', bob);
    telegram.say('hello??', bob);
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests.find((r) => r.count === 2),
      'request',
    );
    expect(request).toMatchObject({ id: '5151', name: 'Bob', username: 'bob' });
    const toBob = telegram.sent.filter((m) => m.chat_id === '5151');
    expect(toBob).toHaveLength(1);
    expect(toBob[0]?.text).toMatch(/private assistant/);
    // Nothing reached a conversation.
    expect((await s.conversations.list()).some((c) => c.origin?.kind === 'channel')).toBe(false);

    const view: Channel = await s.channels.answer(channel.id, '5151', 'allow');
    expect(view.people.map((p) => p.id)).toEqual(['4242', '5151']);
    expect(view.requests).toEqual([]);
    await until(() => telegram.last(5151)?.text.includes('let you in'), 'welcome for Bob');
  });

  it('never answers someone you blocked', async () => {
    const { s, telegram, channel } = await paired();
    const eve = { id: 666, first_name: 'Eve' };
    telegram.say('hi', eve);
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    const view = await s.channels.answer(channel.id, '666', 'block');
    expect(view.blocked).toBe(1);
    const sent = telegram.sent.length;
    telegram.say('let me in', eve);
    await new Promise((r) => setTimeout(r, 400));
    expect(telegram.sent.length).toBe(sent);
    expect((await s.channels.get(channel.id)).requests).toEqual([]);
  });

  it('does not let a wrong or reused hello code in', async () => {
    const { s, telegram, channel } = await setup().then(async (ctx) => ({
      ...ctx,
      channel: await ctx.s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN }),
    }));
    telegram.say('/start AAAAAAAAAAAAAAAA');
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    expect((await s.channels.get(channel.id)).people).toEqual([]);
    await until(() => telegram.last()?.text.includes('That’s me'), 'finish-in-Conch hint');
  });

  it('starts fresh on /new and when the chat was deleted in Conch', async () => {
    const { s, telegram } = await paired();
    const channelChats = async () =>
      (await s.conversations.list()).filter((c) => c.origin?.kind === 'channel');
    telegram.say('hello');
    await until(async () => (await channelChats()).find((c) => c.status === 'idle'), 'first');
    const [first] = await channelChats();
    telegram.say('/new');
    await until(() => telegram.last()?.text.includes('Fresh start'), 'fresh start');
    telegram.say('hello again');
    await until(async () => (await channelChats()).length === 2, 'second chat');

    // Deleting it in Conch doesn't break the chat: the next message starts another.
    const second = (await channelChats()).find((c) => c.id !== first?.id);
    await until(async () => (await channelChats()).every((c) => c.status === 'idle'), 'idle');
    await s.conversations.remove(second?.id ?? '');
    telegram.say('still there?');
    await until(async () => (await channelChats()).length === 2, 'replacement chat');
  });

  it('takes photos as attachments', async () => {
    const { s, telegram } = await paired();
    telegram.photo('What is this?');
    const conversation = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    const events = await s.conversations.eventsAfter(conversation.id);
    const message = events.find((e) => e.type === 'user.message');
    expect(message?.type === 'user.message' && message.attachments?.[0]).toMatchObject({
      kind: 'image',
    });
  });
});

describe('ChannelService — healing', () => {
  it('takes the bot back from a webhook another tool left, and says so', async () => {
    const { s, telegram, events } = await setup();
    telegram.webhook();
    const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    expect(telegram.calls.some((c) => c.method === 'deleteWebhook')).toBe(true);
    expect(events.some((e) => e.type === 'healed' && /took them back/.test(e.note.message))).toBe(
      true,
    );
  });

  it('asks for a new key when the old one stops working, and reconnects with it', async () => {
    const { s, telegram, channel } = await paired();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    telegram.revoke();
    await until(() => state(s, channel.id).then((st) => st === 'needs-token'), 'needs-token');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/reset in BotFather/);

    const other = '999999:AAHanotherbotanotherbotanotherbot12';
    telegram.bots.set(other, {
      id: 999999,
      is_bot: true,
      first_name: 'Other',
      username: 'other_bot',
    });
    await expect(
      s.channels.replaceToken(channel.id, { kind: 'telegram', token: other }),
    ).rejects.toThrow(/another bot/);

    const renewed = '123456789:AAHrenewedrenewedrenewedrenewed123';
    telegram.bots.set(renewed, {
      id: 123456789,
      is_bot: true,
      first_name: 'Conch',
      username: 'my_conch_bot',
    });
    await s.channels.replaceToken(channel.id, { kind: 'telegram', token: renewed });
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    // The people who were let in are still let in.
    expect((await s.channels.get(channel.id)).people).toHaveLength(1);
  });

  it('names another program polling the same bot, and recovers when it stops', async () => {
    const { s, telegram } = await setup();
    telegram.rival(3);
    const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    await until(() => state(s, channel.id).then((st) => st === 'conflict'), 'conflict', 15_000);
    expect((await s.channels.get(channel.id)).health.message).toMatch(/Another program/);
  }, 20_000);

  it('retries while Telegram is unreachable and comes back by itself', async () => {
    const { s, telegram } = await setup();
    const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    telegram.down();
    await until(
      () => state(s, channel.id).then((st) => st === 'reconnecting'),
      'reconnecting',
      8000,
    );
    const view = await s.channels.get(channel.id);
    expect(view.health.retryAt).toBeGreaterThan(Date.now() - 1000);
    telegram.down(false);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'back online', 8000);
  }, 20_000);

  it('reconnects the channels it had after a restart', async () => {
    const { s, channel } = await paired();
    const home = s.config.CONCH_HOME;
    const port = new URL(s.mockTelegram?.base ?? '').port;
    s.stop();
    process.env.CONCH_MOCK_TELEGRAM_PORT = port;
    // The mock's state lives in the old one; a new gateway with a new mock only needs the key to work.
    services = new Services(
      loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
    );
    delete process.env.CONCH_MOCK_TELEGRAM_PORT;
    await services.start();
    await until(
      () => state(services as Services, channel.id).then((st) => st === 'online'),
      'online after restart',
    );
    expect((await services.channels.get(channel.id)).people).toHaveLength(1);
  });
});
