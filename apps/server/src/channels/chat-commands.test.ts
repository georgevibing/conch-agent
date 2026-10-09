/**
 * Conch's commands in chat apps, end to end through the ChannelService
 * (ADR 0098): `/clear` and its Undo, `/goal`, `/plan` approved with Start,
 * `/retry`, values as buttons, "did you mean", your own commands, and the
 * apps' own `/` menus — in Telegram (buttons), email (numbered replies),
 * Discord (application commands) and Slack (`/conch`).
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockDiscord } from './mock/discord';
import { MockMail } from './mock/email';
import { MockSlack } from './mock/slack';
import { MockTelegram } from './mock/telegram';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function start() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-chat-commands-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  return services;
}

async function until<T>(fn: () => T | Promise<T>, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const channelChat = async (s: Services) =>
  (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');

const eventsOf = async (s: Services): Promise<ConversationEvent[]> => {
  const chat = await channelChat(s);
  return chat ? s.conversations.eventsAfter(chat.id) : [];
};

/** The chat is quiet: its answer is in, and the turn let go. */
async function quiet(s: Services) {
  await until(
    async () => (await eventsOf(s)).some((e) => e.type === 'turn.completed'),
    'turn completed',
  );
  await until(async () => (await channelChat(s))?.status === 'idle', 'idle');
  await new Promise((r) => setTimeout(r, 150));
}

async function telegramPaired() {
  const s = await start();
  const telegram = s.mockTelegram;
  if (!telegram) throw new Error('no mock Telegram');
  telegram.pollCapMs = 200;
  const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
  const code = new URL(channel.pairing?.link ?? '').searchParams.get('start');
  telegram.say(`/start ${code}`);
  await until(async () => (await s.channels.get(channel.id)).people.length === 1, 'pairing');
  await until(() => telegram.last()?.text.includes('Hi Ada'), 'welcome');
  return { s, telegram, channel };
}

/** What Telegram was sent last, once it says this. */
const said = (telegram: MockTelegram, words: string) =>
  until(() => telegram.sent.findLast((m) => m.text.includes(words)), `“${words}”`);

const press = (telegram: MockTelegram, label: string, message = telegram.last()) => {
  const button = message?.buttons.find((b) => b.text === label);
  if (!button || !message) throw new Error(`Missing ${label}: ${JSON.stringify(message)}`);
  telegram.press(button.callback_data, message.message_id);
};

describe('Chat commands in Telegram', () => {
  it('lists Conch’s commands in Telegram’s own menu, and only new, stop and help in groups', async () => {
    const { telegram } = await telegramPaired();
    const calls = await until(() => {
      const found = telegram.calls.filter((c) => c.method === 'setMyCommands');
      return found.length >= 2 ? found : undefined;
    }, 'commands set');
    const names = (call: (typeof calls)[number] | undefined) =>
      ((call?.params.commands ?? []) as { command: string }[]).map((c) => c.command);
    expect(names(calls.find((c) => !c.params.scope))).toEqual(
      expect.arrayContaining(['new', 'clear', 'goal', 'plan', 'retry', 'model', 'effort', 'fast']),
    );
    expect(names(calls.find((c) => c.params.scope))).toEqual(['new', 'stop', 'help']);
  });

  it('clears the model’s memory with /clear, and puts it back with Undo or /undo', async () => {
    const { s, telegram } = await telegramPaired();
    telegram.say('/clear');
    await said(telegram, 'nothing to clear yet');
    telegram.say('hello');
    await quiet(s);
    telegram.say('/reset');
    const cleared = await said(telegram, 'Cleared');
    expect(cleared.buttons.map((b) => b.text)).toEqual(['Undo']);
    expect((await eventsOf(s)).some((e) => e.type === 'context.cleared')).toBe(true);
    press(telegram, 'Undo', cleared);
    await said(telegram, 'Undone');
    expect((await eventsOf(s)).some((e) => e.type === 'context.restored')).toBe(true);
    // The button works once.
    telegram.press(cleared.buttons[0]?.callback_data ?? '', cleared.message_id);
    await until(
      () =>
        telegram.calls.some(
          (c) => c.method === 'answerCallbackQuery' && String(c.params.text).includes('expired'),
        ),
      'used button',
    );
    telegram.say('/undo');
    await said(telegram, 'no /clear to take back');
    telegram.say('/clear');
    await said(telegram, 'Cleared');
    telegram.say('/undo');
    await until(
      () => telegram.sent.filter((m) => m.text.includes('Undone')).length === 2,
      'undone by command',
    );
  });

  it('sets a goal before the first message, keeps it with the chat, and clears it', async () => {
    const { s, telegram } = await telegramPaired();
    telegram.say('/goal');
    await said(telegram, 'no goal yet');
    telegram.say('/goal Ship the 2.4 release notes');
    const set = await said(telegram, 'starting with your next message');
    expect(set.buttons.map((b) => b.text)).toEqual(['Clear goal']);
    telegram.say('hello');
    await quiet(s);
    expect((await eventsOf(s)).findLast((e) => e.type === 'goal')).toMatchObject({
      goal: 'Ship the 2.4 release notes',
    });
    telegram.say('/status');
    await said(telegram, 'Goal: Ship the 2.4 release notes');
    telegram.say('/goal');
    const shown = await said(telegram, 'Change it with /goal');
    press(telegram, 'Clear goal', shown);
    await said(telegram, 'Goal cleared');
    expect((await eventsOf(s)).findLast((e) => e.type === 'goal')).toMatchObject({ goal: null });
    telegram.say(`/goal ${'x'.repeat(600)}`);
    await said(telegram, 'Keep the goal to 500 characters');
  });

  it('plans first with /plan, and starts on the plan when you press Start', async () => {
    const { s, telegram } = await telegramPaired();
    telegram.say('/plan');
    const on = await said(telegram, 'Read only on');
    expect(on.buttons.map((b) => b.text)).toEqual(['Act as usual']);
    telegram.say('please tidy up this folder');
    const plan = await said(telegram, 'The plan');
    expect(plan.text).toContain('Sort everything by kind');
    const question = await until(
      () => telegram.sent.find((m) => m.buttons.some((b) => b.text === 'Start')),
      'Start on the plan?',
    );
    expect(question.buttons.map((b) => b.text)).toEqual(['Start', 'Keep planning']);
    const chat = await until(() => channelChat(s), 'chat');
    expect(chat.options.permissionMode).toBe('plan');
    press(telegram, 'Start', question);
    await until(
      () =>
        telegram.sent.some(
          (m) =>
            m.method === 'editMessageText' &&
            m.message_id === question.message_id &&
            m.text.includes('Started on the plan'),
        ),
      'started',
    );
    await quiet(s);
    // Start took the chat out of plan mode, back to the mode it had before.
    expect((await channelChat(s))?.options.permissionMode).toBeUndefined();
    telegram.say('/plan on');
    await said(telegram, 'Read only on');
    telegram.say('/plan off');
    await said(telegram, 'Read only off. Back to Auto');
  });

  it('sends your last message again with /retry', async () => {
    const { s, telegram } = await telegramPaired();
    telegram.say('/retry');
    await said(telegram, 'nothing to send again');
    telegram.say('hello there');
    await quiet(s);
    telegram.say('/again');
    await until(
      async () =>
        (await eventsOf(s)).filter((e) => e.type === 'user.message' && e.text === 'hello there')
          .length === 2,
      'sent again',
    );
  });

  it('chooses effort and fast mode from buttons, the one in use ticked', async () => {
    const { telegram } = await telegramPaired();
    telegram.say('/effort');
    const menu = await said(telegram, 'Choose how hard');
    expect(menu.buttons.map((b) => b.text)).toEqual([
      '✓ Auto',
      'Low',
      'Medium',
      'High',
      'Extra',
      'Max',
    ]);
    press(telegram, 'Max', menu);
    await said(telegram, '✓ Thinking effort: Max.');
    telegram.say('/fast on');
    await said(telegram, '✓ Fast mode: on.');
    telegram.say('/fast');
    const fast = await said(telegram, 'Fast mode answers sooner');
    expect(fast.buttons.map((b) => b.text)).toEqual(['✓ On', 'Off']);
  });

  it('says what a mistyped command meant, with a button for it, and points to Conch for its own', async () => {
    const { s, telegram } = await telegramPaired();
    telegram.say('/efort');
    const meant = await said(telegram, 'Did you mean /effort?');
    press(telegram, '/effort', meant);
    await said(telegram, 'Choose how hard');
    telegram.say('/xyzzy');
    await said(telegram, 'Send /help');
    telegram.say('/export');
    await said(telegram, '/export works in Conch itself');
    telegram.say('/help');
    const help = await said(telegram, 'your assistant on Conch');
    for (const name of ['/clear', '/goal', '/plan', '/retry', '/model', '/effort', '/stop'])
      expect(help.text).toContain(name);
    // None of it reached the model.
    expect(await channelChat(s)).toBeUndefined();
  });

  it('runs a command of yours, filled in, and leaves a skill’s name for the gateway', async () => {
    const { s, telegram } = await telegramPaired();
    await s.commands.save({
      name: 'shout',
      description: 'Say it loudly',
      prompt: 'Say {{input}} loudly.',
    });
    telegram.say('/shout hello');
    await until(
      async () =>
        (await eventsOf(s)).some(
          (e) => e.type === 'user.message' && e.text === 'Say hello loudly.',
        ),
      'your command, filled in',
    );
  });

  it('keeps the owner’s commands to the owner, and a forward never runs one', async () => {
    const { s, telegram, channel } = await telegramPaired();
    telegram.say('/clear', MockTelegram.OWNER, {
      forward_origin: { type: 'hidden_user', sender_user_name: 'Someone', date: 1 },
    });
    await said(telegram, 'Commands need a message you typed yourself');
    await s.channels.answer(channel.id, String(MockTelegram.OWNER.id), 'allow').catch(() => {});
    telegram.say('hello', MockTelegram.MEMBER);
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    await s.channels.answer(channel.id, String(MockTelegram.MEMBER.id), 'allow');
    telegram.say('/goal take over', MockTelegram.MEMBER);
    await until(
      () => telegram.last(MockTelegram.MEMBER.id)?.text.includes('typed by the channel owner'),
      'owner only',
    );
    telegram.say('/help', MockTelegram.MEMBER);
    const help = await until(
      () =>
        telegram.sent.findLast(
          (m) => m.chat_id === String(MockTelegram.MEMBER.id) && m.text.includes('/clear'),
        ),
      'help for someone let in',
    );
    expect(help.text).not.toContain('/model');
  });
});

describe('Chat commands where there are no buttons (email)', () => {
  it('clears with a numbered Undo, and a plain “ok” never undoes it', async () => {
    const s = await start();
    const mail = s.mockMail;
    if (!mail) throw new Error('no pretend mail');
    const channel = await s.channels.create({
      kind: 'email',
      provider: 'gmail',
      address: MockMail.ADDRESS,
      password: MockMail.PASSWORD,
    });
    await until(async () => (await s.channels.get(channel.id)).health.state === 'online', 'online');
    const first = mail.deliver({ subject: 'Plans', text: 'Hello there' });
    const answer = await until(() => mail.sent.find((m) => m.inReplyTo === first), 'answer');
    await quiet(s);
    mail.deliver({ subject: 'Re: Plans', text: '/clear', inReplyTo: answer.messageId });
    const cleared = await until(() => mail.sent.find((m) => m.text.includes('Cleared')), 'cleared');
    expect(cleared.text).toContain('Reply with a number');
    expect(cleared.text).toContain('Undo');
    mail.deliver({ subject: 'Re: Plans', text: '1', inReplyTo: cleared.messageId });
    await until(() => mail.sent.find((m) => m.text.includes('Undone')), 'undone');
  });
});

describe('Chat commands in Discord', () => {
  it('registers Discord’s own / menu, and answers a command chosen from it', async () => {
    const s = await start();
    const discord = s.mockDiscord;
    if (!discord) throw new Error('no mock Discord');
    discord.heartbeatMs = 1000;
    const channel = await s.channels.create({ kind: 'discord', token: MockDiscord.TOKEN });
    await until(() => discord.commands.length > 0, 'application commands');
    expect(discord.commands.map((c) => c.name)).toEqual(
      expect.arrayContaining(['new', 'clear', 'goal', 'plan', 'model', 'effort']),
    );
    discord.say('hi');
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    await s.channels.answer(channel.id, MockDiscord.OWNER.id, 'allow');
    await until(() => discord.last()?.content.includes('Hi Ada'), 'welcome');
    discord.command('effort', 'high');
    await until(() => discord.last()?.content.includes('Thinking effort: High'), 'effort set');
    const answered = discord.calls.find(
      (c) =>
        c.method === 'POST' &&
        c.path.startsWith('/interactions/') &&
        (c.body as { type?: number }).type === 4,
    );
    expect(answered?.body).toMatchObject({ data: { content: '/effort high', flags: 64 } });
    discord.command('model');
    await until(() => discord.last()?.content.includes('Choose a model from'), 'models');
    expect(discord.last()?.buttons.length).toBeLessThanOrEqual(5);
  });
});

describe('Chat commands in Slack', () => {
  it('takes Conch’s commands after /conch, and writes them that way', async () => {
    const s = await start();
    const slack = s.mockSlack;
    if (!slack) throw new Error('no mock Slack');
    const channel = await s.channels.create({
      kind: 'slack',
      botToken: MockSlack.BOT_TOKEN,
      appToken: MockSlack.APP_TOKEN,
    });
    await until(async () => (await s.channels.get(channel.id)).health.state === 'online', 'online');
    slack.say('hi');
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    await s.channels.answer(channel.id, MockSlack.OWNER.id, 'allow');
    await until(() => slack.last()?.text.includes('Hi Ada'), 'welcome');
    slack.slash('');
    const help = await until(
      () => slack.sent.findLast((m) => m.text.includes('your assistant on Conch')),
      'help',
    );
    expect(help.text).toContain('/conch clear');
    slack.slash('model');
    await until(() => slack.last()?.text.includes('/conch model <name>'), 'models');
    slack.slash('goal Plan the offsite');
    await until(() => slack.last()?.text.includes('Goal set'), 'goal set');
  });
});

describe('Agents in a chat app (ADR 0101)', () => {
  it('answers as the channel’s agent, and /agent changes who answers here', async () => {
    const { s, telegram, channel } = await telegramPaired();
    const sage = await s.agents.create({ name: 'Sage', role: 'Plans trips' });
    await s.agents.create({ name: 'Milo' });
    // The channel's own agent answers new chats there.
    await s.channels.update(channel.id, { agentId: sage.id });
    expect((await s.channels.get(channel.id)).agentId).toBe(sage.id);
    telegram.say('hello');
    await quiet(s);
    expect((await channelChat(s))?.agentId).toBe(sage.id);

    // Without a name: the agents, the one answering marked, the others as buttons.
    telegram.say('/agent');
    const list = await said(telegram, 'Who answers you here');
    expect(list.text).toMatch(/Sage · Plans trips ✓/);
    expect(list.buttons.map((b) => b.text)).toEqual(['Conch', 'Milo']);
    press(telegram, 'Milo', list);
    await said(telegram, 'Milo answers you here');
    const chat = await channelChat(s);
    expect(chat?.agentId).toBe((await s.agents.list()).agents.find((a) => a.name === 'Milo')?.id);
    expect((await eventsOf(s)).some((e) => e.type === 'agent' && e.name === 'Milo')).toBe(true);

    // By name, and an agent it doesn't know.
    telegram.say('/agent sage');
    await said(telegram, 'Sage answers you here');
    expect((await channelChat(s))?.agentId).toBe(sage.id);
    telegram.say('/agent nobody');
    await said(telegram, 'I don’t know an agent called “nobody”');
    // Chosen in Conch, the owner's chat here changes too, as `/agent` would.
    const milo = (await s.agents.list()).agents.find((a) => a.name === 'Milo');
    await s.channels.update(channel.id, { agentId: milo?.id ?? null });
    expect((await channelChat(s))?.agentId).toBe(milo?.id);
    // `null` goes back to the default agent, for new chats and the owner's.
    await s.channels.update(channel.id, { agentId: null });
    expect((await s.channels.get(channel.id)).agentId).toBeUndefined();
    expect((await channelChat(s))?.agentId).toBe((await s.agents.default()).id);
    await expect(s.channels.update(channel.id, { agentId: 'ag_never_was' })).rejects.toThrow(
      /isn’t there/,
    );
  });
});
