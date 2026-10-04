import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { lineSignature, normalizeLine, signedByLine } from './line';
import { MockLine } from './mock/line';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-line-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const line = services.mockLine;
  if (!line) throw new Error('no mock LINE');
  return { s: services, line };
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

const keys = {
  kind: 'line' as const,
  channelSecret: MockLine.SECRET,
  accessToken: MockLine.TOKEN,
};
const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;
const chats = async (s: Services) =>
  (await s.conversations.list()).filter((c) => c.origin?.kind === 'channel');

async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await ctx.s.door.useTailscale();
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  expect(await ctx.line.say('hi')).toBe(200);
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, MockLine.OWNER.userId, 'allow');
  await until(() => ctx.line.to().some((m) => m.text.includes('Hi Ada')), 'welcome');
  return { ...ctx, channel };
}

describe('LINE (ADR 0082)', () => {
  it('checks the secret and the token, and says who the bot is', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { id: MockLine.BOT.userId, username: '@123conch' },
    });
    expect(
      await s.channels.check({ ...keys, accessToken: 'wrong-token-wrong-token-1' }),
    ).toMatchObject({
      ok: false,
      field: 'accessToken',
    });
    expect(await s.channels.check({ ...keys, channelSecret: 'not a secret' })).toMatchObject({
      ok: false,
      field: 'channelSecret',
    });
  });

  it('points its webhook at the public address by itself', async () => {
    const { s, line } = await setup();
    const channel = await s.channels.create(keys);
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'waiting for the door');
    await s.door.useTailscale();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    expect(line.endpoint).toBe((await s.channels.get(channel.id)).hook?.url);
  });

  it('answers the owner in plain words, with the free reply when it can', async () => {
    const { s, line } = await paired();
    const welcome = line.to().find((m) => m.text.includes('Hi Ada'));
    expect(welcome?.text).not.toContain('**');
    await line.say('Hello there');
    await until(async () => (await chats(s)).length === 1, 'conversation');
    await until(() => line.to().filter((m) => !m.text.includes('Hi Ada')).length > 0, 'answer');
    expect(line.to().some((m) => m.via === 'reply')).toBe(true);
  });

  it('asks before acting with quick replies, and a press allows it', async () => {
    const { s, line } = await paired();
    await line.say('please run the tests');
    const question = await until(
      () => line.to().find((m) => m.quickReplies.length === 3),
      'question with quick replies',
    );
    const allow = question.quickReplies.find((q) => q.label === 'Allow');
    // Someone else pressing it does nothing.
    await line.press(allow?.data ?? '', MockLine.MEMBER);
    await line.press(allow?.data ?? '');
    await until(async () => {
      const chat = (await chats(s))[0];
      const events = await s.conversations.eventsAfter(chat?.id ?? '');
      return events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow');
    }, 'allowed');
  });

  it('refuses a delivery with a wrong signature, none, or a body changed after signing', async () => {
    const { s, line } = await paired();
    for (const sign of ['wrong', 'none', 'tampered'] as const)
      expect(await line.deliver([line.event('run rm -rf ~')], sign), sign).toBe(401);
    await new Promise((r) => setTimeout(r, 300));
    expect(await chats(s)).toHaveLength(0);
  });

  it('reads a redelivered event once, and never one from hours ago', async () => {
    const { s, line } = await paired();
    const event = line.event('once');
    await line.deliver([event]);
    await line.deliver([event]);
    await line.deliver([{ ...line.event('long ago'), timestamp: Date.now() - 3 * 60 * 60_000 }]);
    const chat = await until(async () => (await chats(s))[0], 'conversation');
    await new Promise((r) => setTimeout(r, 1200));
    const said = (await s.conversations.eventsAfter(chat.id)).filter(
      (e) => e.type === 'user.message',
    );
    expect(said).toHaveLength(1);
    expect(JSON.stringify(said)).not.toContain('long ago');
  });

  it('answers in a group you turned on, only when mentioned (ADR 0075)', async () => {
    const { s, line, channel } = await paired();
    await line.say('hello all', MockLine.MEMBER, { group: true, mention: true });
    const group = await until(async () => (await s.channels.get(channel.id)).groups[0], 'group');
    expect(group).toMatchObject({ name: 'Family', on: false });
    await s.channels.setGroup(channel.id, group.id, true);
    await line.say('not to the bot', MockLine.MEMBER, { group: true });
    await line.say('what’s the time?', MockLine.MEMBER, { group: true, mention: true });
    const chat = await until(
      async () => (await chats(s)).find((c) => c.origin?.kind === 'channel' && c.origin.guest),
      'guest',
    );
    const said = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'message',
    );
    expect(said).toMatchObject({ text: 'what’s the time?' });
  });

  it('says plainly when the month’s messages are used up', async () => {
    const { s, line, channel } = await paired();
    line.monthlyLimit = true;
    await expect(s.channels.test(channel.id)).rejects.toMatchObject({
      message: expect.stringMatching(/all the messages its plan allows/),
    });
  });
});

describe('LINE pieces', () => {
  it('signs as LINE does, and checks it in constant time', () => {
    const body = '{"destination":"U1","events":[]}';
    const signature = lineSignature('s3cr3t', body);
    expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(signedByLine('s3cr3t', body, signature)).toBe(true);
    expect(signedByLine('s3cr3t', `${body} `, signature)).toBe(false);
    expect(signedByLine('other', body, signature)).toBe(false);
    expect(signedByLine('s3cr3t', body, undefined)).toBe(false);
  });

  it('finds the secret in what was pasted, and keeps its address', () => {
    const made = normalizeLine({ ...keys, channelSecret: `Channel secret ${MockLine.SECRET}` });
    expect(made.channelSecret).toBe(MockLine.SECRET);
    expect(normalizeLine({ ...keys }, made).hookId).toBe(made.hookId);
  });
});
