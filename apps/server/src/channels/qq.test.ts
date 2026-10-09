import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockQq } from './mock/qq';
import { INTENTS, normalizeQq } from './qq';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-qq-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  const qq = services.mockQq;
  if (!qq) throw new Error('no mock QQ');
  return { s: services, qq };
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

const keys = { kind: 'qq' as const, appId: MockQq.APP_ID, appSecret: MockQq.APP_SECRET };
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
  ctx.qq.befriend();
  await until(
    async () => (await ctx.s.channels.get(ctx.channel.id)).requests.length === 1,
    'request',
  );
  await ctx.s.channels.answer(ctx.channel.id, personId(MockQq.OWNER), 'allow');
  await until(() => ctx.qq.sent.some((m) => m.text.includes('Hi')), 'welcome');
  return ctx;
}

describe('QQ’s keys', () => {
  it('finds the AppID in whatever was pasted', () => {
    expect(
      normalizeQq({ ...keys, appId: `AppID: ${MockQq.APP_ID}`, appSecret: ' x ' }),
    ).toMatchObject({
      appId: MockQq.APP_ID,
      appSecret: 'x',
    });
  });
});

describe('QQ through its WebSocket gateway', { timeout: 30_000 }, () => {
  it('checks the AppID and AppSecret with QQ, and says which is wrong', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { name: 'Conch', id: MockQq.APP_ID },
    });
    expect(await s.channels.check({ ...keys, appSecret: 'wrong' })).toMatchObject({
      ok: false,
      field: 'appSecret',
      message: expect.stringMatching(/doesn’t accept this AppID and AppSecret/),
    });
    expect(await s.channels.check({ ...keys, appId: '999999' })).toMatchObject({
      ok: false,
      field: 'appId',
    });
  });

  it('identifies for private chats, groups and buttons, and keeps the heartbeat', async () => {
    const { qq } = await online();
    expect(qq.identifies).toEqual([INTENTS]);
  });

  it('adding the bot is the hello; a stranger gets one polite reply, as a reply to their message', async () => {
    const { s, qq, channel } = await paired();
    const welcome = qq.sent.find((m) => m.text.includes('Hi'));
    // It answered the friend-add event itself, which QQ lets a bot reply to.
    expect(welcome?.reply).toMatchObject({ field: 'event_id' });
    qq.say('hello?', { from: MockQq.STRANGER });
    qq.say('anyone?', { from: MockQq.STRANGER });
    await until(
      async () => (await s.channels.get(channel.id)).requests.find((r) => r.count === 2),
      'a request',
    );
    const polite = await until(
      () => qq.sent.find((m) => m.to === MockQq.STRANGER && /private assistant/.test(m.text)),
      'a polite reply',
    );
    expect(polite).toMatchObject({ msgType: 2, reply: { field: 'msg_id', seq: 1 } });
    await new Promise((r) => setTimeout(r, 200));
    expect(qq.sent.filter((m) => m.to === MockQq.STRANGER)).toHaveLength(1);
  });

  it('an approval has buttons and numbers; a press is acknowledged and answered', async () => {
    const { qq } = await paired();
    qq.say('please run the tests');
    const question = await until(() => qq.sent.find((m) => m.buttons?.length), 'the question');
    expect(question.text).toMatch(/Reply with a number/);
    const allow = question.buttons?.find((b) => b.label === 'Allow');
    const interaction = qq.press(allow?.data ?? '', question.id);
    await until(() => qq.acked.includes(interaction), 'the press acknowledged');
    await until(() => qq.sent.find((m) => m.text.includes('Allowed')), 'the decision');
  });

  it('without custom buttons, the numbers still answer', async () => {
    const { qq } = await paired();
    qq.buttons = false;
    qq.say('please run the tests');
    await until(
      () => qq.sent.find((m) => /Reply with a number/.test(m.text) && !m.buttons),
      'the question in numbers',
    );
    qq.say('1');
    await until(() => qq.sent.find((m) => m.text.includes('Allowed')), 'the decision');
  });

  it('reads QQ’s own transcript of a voice message, and sends a picture back', async () => {
    const { s, qq } = await paired();
    qq.say('', {
      attachments: [
        {
          content_type: 'voice',
          url: `${qq.base}/media/a.silk`,
          voice_wav_url: `${qq.base}/media/a.wav`,
          asr_refer_text: '明天提醒我买牛奶',
        },
      ],
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
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    await s.attachments.claim([picture.id], 'c_files');
    expect(
      await s.channels.messageOwner('Your beach', {
        attachments: [picture.id],
        conversationId: 'c_files',
      }),
    ).toMatchObject({
      sent: ['beach.png'],
    });
    expect(qq.sent.find((m) => m.msgType === 7)?.media).toMatchObject({
      type: 1,
      size: PNG.length,
    });
  });

  it('a group is off until turned on; then it answers whoever @mentions it, as a reply', async () => {
    const { s, qq, channel } = await paired();
    qq.say('hello everyone', { from: MockQq.MEMBER, group: true });
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups[0],
      'the group listed',
    );
    expect(group.on).toBe(false);
    await s.channels.setGroup(channel.id, group.id, true);
    const before = qq.sent.length;
    qq.say('what is 2+2?', { from: MockQq.MEMBER, group: true });
    const answer = await until(
      () => qq.sent.slice(before).find((m) => m.to === `g:${MockQq.GROUP}`),
      'an answer in the group',
    );
    expect(answer.reply).toMatchObject({ field: 'msg_id' });
  });

  it('resumes after a drop, identifies again when QQ forgot the session, and gets a new token when refused', async () => {
    const { s, qq, channel } = await paired();
    qq.drop();
    await until(() => qq.resumes.length === 1, 'resumed');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    qq.forgetSessions();
    qq.reconnect();
    await until(() => qq.identifies.length === 2, 'identified again', 15_000);
    qq.rotate();
    qq.drop(4004);
    await until(() => qq.identifies.length === 3, 'a new token and session', 15_000);
  });

  it('a reset AppSecret stops this channel and asks for the new one', async () => {
    const { s, qq, channel } = await paired();
    qq.secret = 'changed';
    qq.rotate();
    qq.drop(4004);
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'asks for it',
      15_000,
    );
  });
});
