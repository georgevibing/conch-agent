import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockSlack } from './mock/slack';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-slack-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const slack = services.mockSlack;
  if (!slack) throw new Error('no mock Slack');
  return { s: services, slack };
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
const keys = {
  kind: 'slack' as const,
  botToken: MockSlack.BOT_TOKEN,
  appToken: MockSlack.APP_TOKEN,
};

async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  ctx.slack.say('hi');
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, MockSlack.OWNER.id, 'allow');
  await until(() => ctx.slack.last()?.text.includes('Hi Ada'), 'welcome');
  return { ...ctx, channel };
}

describe('Slack', () => {
  it('answers a mention in a channel only once you turned it on (ADR 0075)', async () => {
    const { s, slack, channel } = await paired();
    slack.mention('what’s on today?');
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups[0],
      'channel listed',
    );
    expect(group).toMatchObject({ name: '#general', on: false });
    await until(() => slack.last('C0GENERAL')?.text.match(/don’t answer in this group/), 'hint');
    expect((await s.conversations.list()).some((c) => c.origin?.kind === 'channel')).toBe(false);
    await s.channels.setGroup(channel.id, group.id, true);
    slack.mention('what’s on today?');
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'conversation',
    );
    // You, as in a private chat.
    expect(chat.origin).toMatchObject({ group: '#general' });
    expect(chat.origin).not.toHaveProperty('guest');
  });

  it('checks each key as it arrives, and says who the app is', async () => {
    const { s } = await setup();
    const bot = await s.channels.check({ kind: 'slack', botToken: MockSlack.BOT_TOKEN });
    expect(bot).toMatchObject({
      ok: true,
      checked: ['botToken'],
      bot: {
        name: 'Conch',
        workspace: 'Mock Workspace',
        chatUrl: 'https://slack.com/app_redirect?app=A0MOCKAPP&team=T0MOCK',
      },
    });
    const both = await s.channels.check(keys);
    expect(both).toMatchObject({ ok: true, checked: ['botToken', 'appToken'] });
  });

  it('puts keys pasted into each other’s boxes right', async () => {
    const { s } = await setup();
    const swapped = await s.channels.create({
      kind: 'slack',
      botToken: MockSlack.APP_TOKEN,
      appToken: MockSlack.BOT_TOKEN,
    });
    expect(swapped.bot.name).toBe('Conch');
  });

  it('names what was pasted when it isn’t the right key', async () => {
    const { s } = await setup();
    const user = await s.channels.check({
      kind: 'slack',
      botToken: 'xoxp-' + '1-2-3-mockmockmockmockmockmock',
    });
    expect(user).toMatchObject({ ok: false, field: 'botToken' });
    if (!user.ok) expect(user.message).toMatch(/your own account/);
    const other = await s.channels.check({
      kind: 'slack',
      botToken: MockSlack.BOT_TOKEN,
      appToken: MockSlack.OTHER_APP_TOKEN,
    });
    expect(other).toMatchObject({ ok: false, field: 'appToken' });
    if (!other.ok) expect(other.message).toMatch(/different Slack apps/);
  });

  it('acknowledges every envelope, and answers a DM with a 👀 while it works', async () => {
    const { s, slack } = await paired();
    slack.say('Hello there');
    await until(() => slack.last()?.text.includes('thought on'), 'answer', 10_000);
    expect(slack.reactions.some((r) => r.name === 'eyes' && r.added)).toBe(true);
    await until(() => slack.reactions.some((r) => r.name === 'eyes' && !r.added), 'eyes removed');
    // Both messages ("hi" and this one) were acknowledged.
    expect(slack.acked.size).toBe(2);
    const conversation = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    expect(conversation?.origin).toMatchObject({ channel: 'slack' });
  });

  it('asks with buttons and takes the answer from a press', async () => {
    const { slack } = await paired();
    slack.say('please run the tests');
    const question = await until(
      () => slack.sent.find((m) => m.blocks.some((b) => b.type === 'actions')),
      'question',
      10_000,
    );
    const actions = question.blocks.find((b) => b.type === 'actions');
    const allow = actions?.elements?.[0];
    expect(allow?.style).toBe('primary');
    slack.press(allow?.value ?? '', question.ts);
    await until(
      () => slack.sent.find((m) => m.updated && m.ts === question.ts && m.text.includes('Allowed')),
      'updated question',
    );
  });

  it('falls back to mrkdwn where Markdown blocks aren’t taken', async () => {
    const { slack } = await paired();
    slack.noMarkdownBlocks = true;
    slack.say('Hello again');
    const answer = await until(
      () =>
        slack.sent.find((m) => m.blocks[0]?.type === 'section' && m.text.includes('thought on')),
      'mrkdwn answer',
      10_000,
    );
    expect(JSON.stringify(answer.blocks[0])).toContain('mrkdwn');
  });

  it('follows Slack’s routine reconnects at once', async () => {
    const { s, slack, channel } = await paired();
    slack.refresh();
    await until(() => slack.connections === 2, 'second connection');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
  });

  it('names the switch when Socket Mode is turned off', async () => {
    const { s, slack, channel } = await paired();
    slack.disableSocketMode();
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'error');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/Socket Mode/);
  });

  it('asks for new keys when Slack stops accepting them', async () => {
    const { s, slack, channel } = await paired();
    slack.revoke();
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs-token',
      15_000,
    );
  }, 20_000);
});
