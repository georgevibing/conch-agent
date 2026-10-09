import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { normalizeDingTalk, toDingTalkMarkdown } from './dingtalk';
import { MockDingTalk } from './mock/dingtalk';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-dingtalk-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const dingtalk = services.mockDingTalk;
  if (!dingtalk) throw new Error('no mock DingTalk');
  return { s: services, dingtalk };
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
  kind: 'dingtalk' as const,
  clientId: MockDingTalk.CLIENT_ID,
  clientSecret: MockDingTalk.CLIENT_SECRET,
};

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function online() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  return { ...ctx, channel };
}

async function paired() {
  const ctx = await online();
  ctx.dingtalk.say('你好');
  await until(
    async () => (await ctx.s.channels.get(ctx.channel.id)).requests.length === 1,
    'request',
  );
  await ctx.s.channels.answer(ctx.channel.id, personId(MockDingTalk.OWNER), 'allow');
  await until(() => ctx.dingtalk.sent.some((m) => m.text.includes('Hi Ada')), 'welcome');
  return ctx;
}

describe('DingTalk’s Markdown', () => {
  it('keeps what DingTalk reads, and turns code and tables into quoted lines', () => {
    const out = toDingTalkMarkdown(
      '# Plan\n\n**Bold** and *italic*, [a link](https://example.com)\nnext line\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(out).toContain('### Plan');
    expect(out).toContain('**Bold** and *italic*, [a link](https://example.com)  \nnext line');
    expect(out).toContain('> const a = 1;');
    expect(out).not.toContain('```');
  });

  it('finds the Client ID in whatever was pasted', () => {
    expect(
      normalizeDingTalk({
        ...keys,
        clientId: `Client ID: ${MockDingTalk.CLIENT_ID}`,
        clientSecret: ' s ',
      }),
    ).toMatchObject({ clientId: MockDingTalk.CLIENT_ID, clientSecret: 's' });
  });
});

describe('DingTalk in Stream mode', { timeout: 30_000 }, () => {
  it('checks the Client ID and Client Secret with DingTalk', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { id: MockDingTalk.CLIENT_ID },
    });
    expect(await s.channels.check({ ...keys, clientSecret: 'wrong' })).toMatchObject({
      ok: false,
      field: 'clientSecret',
      message: expect.stringMatching(/doesn’t accept this Client ID and Client Secret/),
    });
  });

  it('acknowledges every callback, answers pings with their own data, and a stranger gets one polite reply', async () => {
    const { s, dingtalk, channel } = await paired();
    dingtalk.ping();
    await until(() => dingtalk.pongs.length === 1, 'the ping answered');
    expect(dingtalk.pongs[0]).toMatch(/opaque/);
    dingtalk.say('hello?', { from: MockDingTalk.STRANGER });
    dingtalk.say('anyone?', { from: MockDingTalk.STRANGER });
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests.find((r) => r.count === 2),
      'a request',
    );
    expect(request).toMatchObject({ name: 'Grace Hopper' });
    await until(
      () =>
        dingtalk.sent.find(
          (m) => m.to === MockDingTalk.STRANGER && /private assistant/.test(m.text),
        ),
      'a polite reply',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(dingtalk.sent.filter((m) => m.to === MockDingTalk.STRANGER)).toHaveLength(1);
    expect(dingtalk.acks.length).toBeGreaterThanOrEqual(3);
  });

  it('asks with numbered answers, takes “1” as Allow, and says what was decided', async () => {
    const { dingtalk } = await paired();
    expect(dingtalk.sent.find((m) => m.text.includes('Hi Ada'))).toMatchObject({
      to: MockDingTalk.OWNER,
      via: 'oto',
      msgKey: 'sampleMarkdown',
    });
    dingtalk.say('please run the tests');
    await until(
      () => dingtalk.sent.find((m) => /Reply with a number/.test(m.text)),
      'the question',
    );
    dingtalk.say('1');
    await until(() => dingtalk.sent.find((m) => m.text.includes('Allowed')), 'the decision');
  });

  it('reads DingTalk’s own transcript of a voice message, and takes a picture in', async () => {
    const { s, dingtalk } = await paired();
    dingtalk.say('', {
      msgtype: 'audio',
      content: { duration: 3, downloadCode: 'voice1', recognition: '明天提醒我买牛奶' },
    });
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'a conversation',
    );
    const message = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'the message',
    );
    expect(message.type === 'user.message' && message.text).toBe('明天提醒我买牛奶');
    dingtalk.say('', { msgtype: 'picture', content: { downloadCode: 'picture-code-1' } });
    await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find(
          (e) => e.type === 'user.message' && e.attachments?.[0]?.name === 'picture.png',
        ),
      'the picture',
    );
  });

  it('sends a picture and a PDF, and says plainly which files DingTalk won’t take', async () => {
    const { s, dingtalk } = await paired();
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    const notes = await s.attachments.save({ name: 'notes.pdf', bytes: Buffer.from('%PDF-1.4 x') });
    const text = await s.attachments.save({ name: 'notes.txt', bytes: Buffer.from('hello') });
    await s.attachments.claim([picture.id, notes.id, text.id], 'c_files');
    const done = await s.channels.messageOwner('Here you are', {
      attachments: [picture.id, notes.id, text.id],
      conversationId: 'c_files',
    });
    expect(done).toMatchObject({
      sent: ['beach.png', 'notes.pdf'],
      missed: [expect.stringMatching(/notes\.txt/)],
    });
    expect(dingtalk.sent.find((m) => m.msgKey === 'sampleImageMsg')?.media).toMatchObject({
      name: 'beach.png',
      type: 'image',
    });
    expect(dingtalk.sent.find((m) => m.msgKey === 'sampleFile')?.media).toMatchObject({
      name: 'notes.pdf',
      type: 'file',
    });
  });

  it('before the robot is published, answers through the conversation’s own reply address', async () => {
    const { s, dingtalk, channel } = await online();
    dingtalk.published = false;
    dingtalk.say('你好');
    await until(async () => (await s.channels.get(channel.id)).requests.length === 1, 'request');
    await until(
      () => dingtalk.sent.find((m) => m.via === 'webhook' && /That’s me/.test(m.text)),
      'reply by webhook',
    );
  });

  it('a group is off until turned on, then answers whoever @mentions it', async () => {
    const { s, dingtalk, channel } = await paired();
    dingtalk.say('hello everyone', { from: MockDingTalk.MEMBER, group: true });
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups.find((g) => g.name === 'Family'),
      'the group listed',
    );
    expect(group.on).toBe(false);
    await until(() => dingtalk.sent.find((m) => m.to === MockDingTalk.GROUP), 'a hint');
    expect(dingtalk.sent.find((m) => m.to === MockDingTalk.GROUP)?.text).toMatch(
      /don’t answer in this group/,
    );
    await s.channels.setGroup(channel.id, group.id, true);
    const before = dingtalk.sent.length;
    dingtalk.say('what is 2+2?', { from: MockDingTalk.MEMBER, group: true });
    await until(
      () =>
        dingtalk.sent.slice(before).find((m) => m.to === MockDingTalk.GROUP && m.via === 'group'),
      'an answer in the group',
    );
  });

  it('moves to a new connection when told, reconnects after a drop, and says when the month’s messages ran out', async () => {
    const { s, dingtalk, channel } = await paired();
    const first = dingtalk.connections;
    dingtalk.disconnect();
    await until(() => dingtalk.connections > first, 'a new connection');
    dingtalk.drop();
    await until(() => dingtalk.connections > first + 1, 'another new connection', 15_000);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    dingtalk.say('', { errorCode: '20001' });
    await until(() => state(s, channel.id).then((st) => st === 'error'), 'the allowance named');
    expect((await s.channels.get(channel.id)).health.message).toMatch(/5,000/);
    dingtalk.say('back again');
    await until(
      () => state(s, channel.id).then((st) => st === 'online'),
      'online once messages come',
    );
  });

  it('a changed Client Secret stops this channel and asks for the new one', async () => {
    const { s, dingtalk, channel } = await paired();
    dingtalk.secret = 'changed';
    dingtalk.drop();
    await s.channels.repair(channel.id).catch(() => undefined);
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'asks for it',
      15_000,
    );
  });
});
