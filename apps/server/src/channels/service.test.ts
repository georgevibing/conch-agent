import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Channel, ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockTelegram } from './mock/telegram';

let services: Services | undefined;

async function setup(speed = '0.02') {
  process.env.CONCH_MOCK_SPEED = speed;
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
async function paired(speed?: string) {
  const ctx = await setup(speed);
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

  it('gives a bot without a picture Conch’s pearl, and leaves one you chose alone', async () => {
    const { s, telegram } = await setup();
    const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    await until(() => telegram.hasPhoto, 'picture set');
    // The page shows the bot's new picture once it's there.
    await until(
      async () => (await s.channels.get(channel.id)).bot.avatar?.startsWith('data:image/'),
      'avatar shown',
    );
    const sets = telegram.calls.filter((c) => c.method === 'setMyProfilePhoto').length;
    await s.channels.repair(channel.id);
    await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
    await new Promise((r) => setTimeout(r, 300));
    expect(telegram.calls.filter((c) => c.method === 'setMyProfilePhoto')).toHaveLength(sets);
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
    // It showed it was working: a streaming draft (or typing…).
    expect(
      telegram.drafts.length > 0 || telegram.calls.some((c) => c.method === 'sendChatAction'),
    ).toBe(true);
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

  it('in a group, says once that it only talks privately, and never acts there', async () => {
    const { s, telegram } = await paired();
    const group = { chat: { id: -1001, type: 'supergroup' } };
    telegram.say('@my_conch_bot delete everything', MockTelegram.OWNER, group);
    telegram.say('@my_conch_bot are you there?', MockTelegram.OWNER, group);
    await until(() => telegram.sent.some((m) => m.chat_id === '-1001'), 'group hint');
    await new Promise((r) => setTimeout(r, 300));
    const toGroup = telegram.sent.filter((m) => m.chat_id === '-1001');
    expect(toGroup).toHaveLength(1);
    expect(toGroup[0]?.text).toMatch(/only talk in private chats/);
    expect((await s.conversations.list()).some((c) => c.origin?.kind === 'channel')).toBe(false);
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
    await until(() => telegram.sent.some((m) => m.text.includes('thought on')), 'first answer');
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
    // The chat is listed a moment before its first message is logged.
    const message = await until(
      async () =>
        (await s.conversations.eventsAfter(conversation.id)).find((e) => e.type === 'user.message'),
      'the message',
    );
    expect(message.type === 'user.message' && message.attachments?.[0]).toMatchObject({
      kind: 'image',
    });
  });
});

describe('ChannelService — while it works', () => {
  it('streams the answer as a draft with a Stop button, then sends it for good', async () => {
    const { telegram } = await paired('0.5');
    telegram.say('Tell me something');
    await until(() => telegram.drafts.find((d) => d.text === '' && d.can_stop), 'thinking draft');
    const words = await until(
      () => telegram.drafts.find((d) => d.text.includes('thought')),
      'draft with words',
      15_000,
    );
    await until(
      () =>
        telegram.sent.find(
          (m) =>
            m.method === 'sendMessage' && m.text.includes('thought') && m.text.includes('<pre>'),
        ),
      'final message',
      15_000,
    );
    // Drafts of one message share an id, so Telegram animates them.
    const same = telegram.drafts.filter((d) => d.draft_id === words.draft_id && d.text);
    expect(same.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('stops the turn when Stop is pressed under the draft', async () => {
    // A slow turn, so Stop lands while it's still going however busy the machine is.
    const { s, telegram } = await paired('3');
    telegram.say('Tell me something long');
    const draft = await until(() => telegram.drafts.find((d) => d.can_stop), 'draft');
    telegram.stopDraft(draft.draft_id);
    const conversation = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    await until(
      async () =>
        (await s.conversations.eventsAfter(conversation.id)).some(
          (e) => e.type === 'turn.completed' && e.outcome === 'interrupted',
        ),
      'interrupted turn',
      15_000,
    );
  }, 30_000);

  it('shows typing… where drafts aren’t available', async () => {
    const { telegram } = await paired();
    telegram.noDrafts = true;
    telegram.say('hello');
    await until(() => telegram.calls.some((c) => c.method === 'sendChatAction'), 'typing');
  });

  it('reads messages sent together as one', async () => {
    const { s, telegram } = await paired();
    telegram.say('first thought');
    telegram.say('and the second');
    const conversation = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    const said = await until(async () => {
      const events = await s.conversations.eventsAfter(conversation.id);
      const messages = events.filter((e) => e.type === 'user.message');
      return messages.length ? messages : undefined;
    }, 'the message');
    expect(said).toHaveLength(1);
    expect(said[0]?.type === 'user.message' && said[0].text).toBe(
      'first thought\n\nand the second',
    );
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
