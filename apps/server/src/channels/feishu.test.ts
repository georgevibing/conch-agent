import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { askFirst } from '../test/modes';
import { gunzipSync } from 'node:zlib';

import { normalizeFeishu } from './feishu';
import { CONTROL, DATA, decodeFrame, encodeFrame, header } from './feishu-frame';
import { MockFeishu } from './mock/feishu';
import { personId } from './types';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-feishu-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  // These are about the approval question itself: start chats in Ask first (ADR 0119).
  await askFirst(services);
  await services.start();
  const feishu = services.mockFeishu;
  if (!feishu) throw new Error('no mock Feishu');
  return { s: services, feishu };
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
  kind: 'feishu' as const,
  region: 'feishu' as const,
  appId: MockFeishu.APP_ID,
  appSecret: MockFeishu.APP_SECRET,
};

const state = async (s: Services, id: string) => (await s.channels.get(id)).health.state;

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function paired() {
  const ctx = await setup();
  const channel = await ctx.s.channels.create(keys);
  await until(() => state(ctx.s, channel.id).then((st) => st === 'online'), 'online');
  ctx.feishu.say('hi');
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, personId(MockFeishu.OWNER), 'allow');
  await until(() => ctx.feishu.sent.some((m) => m.text.includes('Hi Ada')), 'welcome');
  return { ...ctx, channel };
}

describe('Feishu’s long-connection frames', () => {
  it('round-trips a frame, with its headers and payload', () => {
    const frame = {
      seqId: 2n ** 40n + 7n,
      logId: 123n,
      service: 7,
      method: DATA,
      headers: [
        ['type', 'event'],
        ['message_id', 'abc'],
        ['sum', '1'],
      ] as [string, string][],
      payload: new TextEncoder().encode('{"x":"你好"}'),
      logIdNew: 'log-1',
    };
    const back = decodeFrame(encodeFrame(frame));
    expect(back).toMatchObject({ seqId: frame.seqId, logId: 123n, service: 7, method: DATA });
    expect(back && header(back, 'message_id')).toBe('abc');
    expect(new TextDecoder().decode(back?.payload)).toBe('{"x":"你好"}');
  });

  it('reads the bytes as protobuf writes them, and refuses what isn’t a frame', () => {
    // SeqID 1, LogID 0, service 7, method 0, header type=ping: what Feishu's SDKs send.
    const ping = Uint8Array.from([
      0x08, 0x01, 0x10, 0x00, 0x18, 0x07, 0x20, 0x00, 0x2a, 0x0c, 0x0a, 0x04, 0x74, 0x79, 0x70,
      0x65, 0x12, 0x04, 0x70, 0x69, 0x6e, 0x67,
    ]);
    const frame = decodeFrame(ping);
    expect(frame).toMatchObject({ seqId: 1n, service: 7, method: CONTROL });
    expect(frame && header(frame, 'type')).toBe('ping');
    expect(
      encodeFrame({
        seqId: 1n,
        logId: 0n,
        service: 7,
        method: CONTROL,
        headers: [['type', 'ping']],
      }),
    ).toEqual(ping);
    expect(decodeFrame(Uint8Array.from([0x0a, 0xff, 0xff]))).toBeUndefined();
    expect(decodeFrame(Uint8Array.from([0x20, 0x09]))).toBeUndefined();
    expect(decodeFrame(new TextEncoder().encode('not protobuf at all'))).toBeUndefined();
  });

  it('finds the App ID in whatever was pasted', () => {
    expect(
      normalizeFeishu({ ...keys, appId: `App ID ${MockFeishu.APP_ID} copied`, appSecret: ' x ' }),
    ).toMatchObject({ appId: MockFeishu.APP_ID, appSecret: 'x', region: 'feishu' });
  });
});

describe('Feishu / Lark through the long connection', { timeout: 30_000 }, () => {
  it('checks the App ID and App Secret with Feishu, and says which is wrong', async () => {
    const { s } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: {
        name: 'Conch',
        account: 'feishu',
        chatUrl: expect.stringContaining('applink.feishu.cn'),
      },
    });
    expect(await s.channels.check({ ...keys, appSecret: 'wrong' })).toMatchObject({
      ok: false,
      field: 'appSecret',
      message: expect.stringMatching(/doesn’t accept/),
    });
    expect(await s.channels.check({ ...keys, appId: 'nope' })).toMatchObject({
      ok: false,
      field: 'appId',
    });
    // Lark is the same app on the other cloud, and is named so.
    expect(await s.channels.check({ ...keys, region: 'lark', appSecret: 'wrong' })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^Lark doesn’t accept/),
    });
  });

  it('a stranger gets one polite reply and shows as a request', async () => {
    const { s, feishu, channel } = await paired();
    feishu.say('hello?', { from: MockFeishu.STRANGER });
    feishu.say('anyone?', { from: MockFeishu.STRANGER });
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests.find((r) => r.count === 2),
      'a request',
    );
    expect(request).toMatchObject({ name: 'Grace Hopper' });
    await until(
      () =>
        feishu.sent.find((m) => m.to === MockFeishu.STRANGER && /private assistant/.test(m.text)),
      'a polite reply',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(feishu.sent.filter((m) => m.to === MockFeishu.STRANGER)).toHaveLength(1);
    // Every delivery was answered, so Feishu doesn't send it again.
    expect(feishu.acks.every((a) => a.code === 200)).toBe(true);
  });

  it('opening the chat with the bot is the hello', async () => {
    const { s, feishu } = await setup();
    const channel = await s.channels.create(keys);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    feishu.enter();
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests[0],
      'a request from entering',
    );
    expect(request).toMatchObject({ id: personId(MockFeishu.OWNER), name: 'Ada Lovelace' });
  });

  it('answers in rich text, an approval as a card whose press is answered and the card changed', async () => {
    const { feishu } = await paired();
    const welcome = feishu.sent.find((m) => m.text.includes('Hi Ada'));
    expect(welcome).toMatchObject({ to: MockFeishu.OWNER, as: 'open_id', type: 'post' });
    feishu.say('please run the tests');
    const question = await until(
      () => feishu.sent.find((m) => m.type === 'interactive' && m.buttons?.length),
      'a card',
    );
    expect(question.buttons?.map((b) => b.label)).toEqual(
      expect.arrayContaining(['Allow', 'Don’t allow']),
    );
    const allow = question.buttons?.find((b) => b.label === 'Allow');
    const answer = await feishu.press(question.id, allow?.value ?? '');
    expect(answer).toMatchObject({ toast: { content: 'Allowed' } });
    await until(() => question.edited?.includes('Allowed'), 'the card changed in place');
    expect(question.buttons).toEqual([]);
    // Pressing it again is told it's done.
    expect(await feishu.press(question.id, allow?.value ?? '')).toMatchObject({
      toast: { content: 'That was already answered.' },
    });
  });

  it('someone else can’t press the owner’s buttons', async () => {
    const { feishu } = await paired();
    feishu.say('please run the tests');
    const question = await until(
      () => feishu.sent.find((m) => m.type === 'interactive' && m.buttons?.length),
      'a card',
    );
    const answer = await feishu.press(
      question.id,
      question.buttons?.[0]?.value ?? '',
      MockFeishu.STRANGER,
    );
    expect(answer).toMatchObject({ toast: { content: 'Only people who were let in can answer.' } });
    expect(question.edited).toBeUndefined();
  });

  it('takes a picture and a voice message in, and sends a picture and a file back', async () => {
    const { s, feishu, channel } = await paired();
    feishu.say('', { type: 'image', content: { image_key: 'img_v3_beach' } });
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'a conversation',
    );
    const message = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'the picture, as an attachment',
    );
    expect(message.type === 'user.message' && message.attachments?.[0]).toMatchObject({
      name: 'beach.png',
    });
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    const notes = await s.attachments.save({ name: 'notes.pdf', bytes: Buffer.from('%PDF-1.4 x') });
    await s.attachments.claim([picture.id, notes.id], 'c_files');
    const done = await s.channels.messageOwner('Your beach', {
      attachments: [picture.id, notes.id],
      conversationId: 'c_files',
    });
    expect(done).toMatchObject({ sent: ['beach.png', 'notes.pdf'] });
    expect(feishu.sent.find((m) => m.image)).toMatchObject({
      to: MockFeishu.OWNER,
      image: { name: 'beach.png', size: PNG.length },
    });
    expect(feishu.sent.find((m) => m.file)).toMatchObject({
      file: { name: 'notes.pdf', type: 'pdf' },
    });
    expect(feishu.sent.findIndex((m) => m.text === 'Your beach')).toBeLessThan(
      feishu.sent.findIndex((m) => m.image),
    );
    expect(channel.kind).toBe('feishu');
  });

  it('hears a voice message on this computer, and the words go to the assistant', async () => {
    const { s, feishu } = await paired();
    s.voice.hearing = async () => ({ ready: true });
    s.voice.transcribeNote = async () => ({ text: '明天提醒我买牛奶', cut: false, seconds: 3 });
    feishu.say('', { type: 'audio', content: { file_key: 'voice_v3_1', duration: 3000 } });
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'a conversation',
    );
    const message = await until(
      async () =>
        (await s.conversations.eventsAfter(chat.id)).find((e) => e.type === 'user.message'),
      'the message',
    );
    if (message.type !== 'user.message') throw new Error('not a message');
    expect(message.text).toBe('明天提醒我买牛奶');
    expect(message.attachments?.[0]).toMatchObject({ name: 'voice.opus' });
  });

  it('puts an event in two parts back together, and takes one delivered twice once', async () => {
    const { s, feishu, channel } = await setup().then(async (ctx) => ({
      ...ctx,
      channel: await ctx.s.channels.create(keys),
    }));
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    feishu.split = true;
    feishu.say('in two parts', { from: MockFeishu.STRANGER, eventId: 'evt-1' });
    feishu.say('in two parts', { from: MockFeishu.STRANGER, eventId: 'evt-1' });
    const request = await until(
      async () => (await s.channels.get(channel.id)).requests[0],
      'request',
    );
    await new Promise((r) => setTimeout(r, 300));
    expect((await s.channels.get(channel.id)).requests[0]?.count).toBe(1);
    expect(request.preview).toBe('in two parts');
  });

  it('reconnects by itself after a drop, and a reset App Secret asks for the new one', async () => {
    const { s, feishu, channel } = await paired();
    const before = feishu.connections;
    feishu.drop();
    await until(() => feishu.connections > before, 'a new connection', 15_000);
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
    feishu.secret = 'reset-in-the-console';
    feishu.drop();
    // The token it has still works for a while; a fresh one is refused.
    await s.channels.repair(channel.id).catch(() => undefined);
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'asks for a new secret',
      15_000,
    );
  });
});

describe('Feishu groups', { timeout: 30_000 }, () => {
  it('a group is off until turned on; then only mentions are answered, others in words only', async () => {
    const { s, feishu, channel } = await paired();
    feishu.say('hello everyone', { from: MockFeishu.MEMBER, group: true });
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups.find((g) => g.name === 'Family'),
      'the group listed',
    );
    expect(group.on).toBe(false);
    await new Promise((r) => setTimeout(r, 300));
    // One hint that it's quiet here, naming nobody, and nothing reached a conversation.
    const quiet = feishu.sent.filter((m) => m.to === MockFeishu.GROUP);
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.text).toMatch(/don’t answer in this group/);
    expect(quiet[0]?.text).not.toMatch(/Ada/);
    await s.channels.setGroup(channel.id, group.id, true);
    // Without a mention, Feishu doesn't deliver it; Conch doesn't answer what isn't for it.
    feishu.say('just chatting', { from: MockFeishu.MEMBER, group: true, mention: false });
    feishu.say('what is 2+2?', { from: MockFeishu.MEMBER, group: true });
    await until(
      () => feishu.sent.filter((m) => m.to === MockFeishu.GROUP && m.as === 'chat_id').length > 1,
      'an answer in the group',
    );
    const guest = (await s.conversations.list()).find(
      (c) => c.origin?.kind === 'channel' && c.origin.guest,
    );
    expect(guest?.origin).toMatchObject({ group: 'Family', guest: true });
    // A reply to the bot's own message counts as a mention.
    const answer = feishu.sent.filter((m) => m.to === MockFeishu.GROUP).at(-1);
    const before = feishu.sent.length;
    feishu.say('and 3+3?', {
      from: MockFeishu.MEMBER,
      group: true,
      mention: false,
      parent: answer?.id,
    });
    await until(
      () => feishu.sent.slice(before).some((m) => m.to === MockFeishu.GROUP),
      'reply answered',
    );
  });
});

describe('Making a Feishu bot by scanning a code', { timeout: 30_000 }, () => {
  it('asks for the app Conch needs, and whoever scans it is the owner, welcomed by name', async () => {
    const { s, feishu } = await setup();
    const begun = await s.feishuScans.begin('feishu');
    const url = new URL(begun.url);
    expect(url.searchParams.get('name')).toBeTruthy();
    const addons = JSON.parse(
      gunzipSync(Buffer.from(url.searchParams.get('addons') ?? '', 'base64url')).toString(),
    ) as {
      scopes: { tenant: string[] };
      events: { items: { tenant: string[] } };
      callbacks: { items: string[] };
    };
    expect(addons.scopes.tenant).toContain('im:message.p2p_msg:readonly');
    expect(addons.events.items.tenant).toContain('im.message.receive_v1');
    expect(addons.callbacks.items).toEqual(['card.action.trigger']);
    expect(s.feishuScans.status(begun.id)).toMatchObject({ state: 'waiting' });
    expect(feishu.scan(begun.url)).toBe(true);
    const done = await until(() => {
      const status = s.feishuScans.status(begun.id);
      return status?.state === 'done' ? status : undefined;
    }, 'the app made');
    const channel = await s.channels.get(done.channelId);
    expect(channel.people[0]).toMatchObject({
      id: personId(MockFeishu.OWNER),
      name: 'Ada Lovelace',
    });
    expect(channel.pairing).toBeUndefined();
    await until(
      () => feishu.sent.find((m) => m.to === MockFeishu.OWNER && m.text.includes('Hi Ada')),
      'the welcome',
    );
  });

  it('says so when the code is declined in the app', async () => {
    const { s, feishu } = await setup();
    const begun = await s.feishuScans.begin('feishu');
    feishu.scan(begun.url, true);
    await until(() => s.feishuScans.status(begun.id)?.state === 'denied', 'declined');
    expect((await s.channels.list()).channels).toHaveLength(0);
  });
});
