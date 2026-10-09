import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { askFirst } from '../test/modes';
import { MockRocketChat } from './mock/rocketchat';
import { normalizeRocketChat, RocketChatAdapter } from './rocketchat';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-rocketchat-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await askFirst(services);
  await services.start();
  const rc = services.mockRocketChat;
  if (!rc) throw new Error('no mock Rocket.Chat');
  return {
    s: services,
    rc,
    keys: {
      kind: 'rocketchat' as const,
      server: rc.base,
      userId: MockRocketChat.BOT._id,
      token: MockRocketChat.TOKEN,
    },
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
  ctx.rc.say('hi');
  await until(async () => (await ctx.s.channels.get(channel.id)).requests.length === 1, 'request');
  await ctx.s.channels.answer(channel.id, MockRocketChat.OWNER._id, 'allow');
  await until(() => ctx.rc.last()?.text.includes('Hi Ada'), 'welcome');
  return { ...ctx, channel };
}

describe('Rocket.Chat (ADR 0083)', () => {
  it('checks the user id and token with the server, naming the box that’s wrong', async () => {
    const { s, keys } = await setup();
    expect(await s.channels.check(keys)).toMatchObject({
      ok: true,
      bot: { id: MockRocketChat.BOT._id, username: 'conch' },
    });
    expect(
      await s.channels.check({ ...keys, token: 'wrongwrongwrongwrongwrongwrong1' }),
    ).toMatchObject({ ok: false, field: 'token' });
    expect(await s.channels.check({ ...keys, server: 'not a server' })).toMatchObject({
      ok: false,
      field: 'server',
    });
  });

  it('stays connecting until the message subscription is ready', async () => {
    const { s, rc, keys } = await setup();
    rc.holdSubscriptions = true;
    const channel = await s.channels.create(keys);
    await until(() => rc.waitingSubscriptions === 1, 'subscription requested');
    expect(await state(s, channel.id)).toBe('connecting');
    rc.releaseSubscriptions();
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online');
    rc.say('hi');
    await until(
      async () => (await s.channels.get(channel.id)).requests.length === 1,
      'first message',
    );
  });

  it('talks with the owner over the realtime API, and asks with a number', async () => {
    const { s, rc } = await paired();
    expect(rc.last()?.text).toContain('**');
    rc.say('please run the tests');
    const question = await until(
      () => rc.sent.find((m) => /Reply with a number/.test(m.text)),
      'numbered question',
    );
    rc.say('1');
    await until(async () => {
      const chat = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
      const events = await s.conversations.eventsAfter(chat?.id ?? '');
      return events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow');
    }, 'allowed');
    await until(() => rc.sent.some((m) => m.edited && m.id === question.id), 'edited');
  });

  it('answers in a channel only once you turn it on, and only when mentioned (ADR 0075)', async () => {
    const { s, rc, channel } = await paired();
    rc.sayIn('hello', MockRocketChat.MEMBER);
    const group = await until(
      async () => (await s.channels.get(channel.id)).groups[0],
      'channel listed',
    );
    expect(group).toMatchObject({ name: '#general', on: false });
    await s.channels.setGroup(channel.id, group.id, true);
    rc.sayIn('not for the bot', MockRocketChat.MEMBER, false);
    rc.sayIn('what’s new?', MockRocketChat.MEMBER);
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
  });

  it('reconnects after a drop, and asks for a new token when it’s removed', async () => {
    const { s, rc, channel } = await paired();
    rc.drop();
    await until(() => state(s, channel.id).then((st) => st === 'reconnecting'), 'reconnecting');
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again', 15_000);
    rc.revoke();
    await until(
      () => state(s, channel.id).then((st) => st === 'needs-token'),
      'needs-token',
      15_000,
    );
    const fresh = 'freshRocketChatPersonalAccessToken0123456';
    rc.tokens.add(fresh);
    await s.channels.replaceToken(channel.id, {
      kind: 'rocketchat',
      userId: MockRocketChat.BOT._id,
      token: fresh,
    });
    await until(() => state(s, channel.id).then((st) => st === 'online'), 'online again');
  });
});

describe('Rocket.Chat pieces', () => {
  it('finds the server, user id and token in what was pasted', () => {
    const made = normalizeRocketChat({
      kind: 'rocketchat',
      server: 'chat.example.com/channel/general',
      userId: 'Your user Id: B0tB0tB0tB0tB0tB0',
      token: ` ${'a'.repeat(43)} `,
    });
    expect(made).toEqual({
      kind: 'rocketchat',
      server: 'https://chat.example.com',
      userId: 'B0tB0tB0tB0tB0tB0',
      token: 'a'.repeat(43),
    });
  });
});

describe('Rocket.Chat — pictures and files Conch sends', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const files = [
    { id: 'att_1', name: 'beach.png', mimeType: 'image/png', bytes: png, image: true },
    {
      id: 'att_2',
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4'),
      image: false,
    },
  ];
  const quiet = {
    message: () => undefined,
    press: () => undefined,
    state: () => undefined,
    healed: () => undefined,
  };

  it('sends each file as a message of its own, the caption with the first', async () => {
    const { rc, keys } = await setup();
    const connection = new RocketChatAdapter(keys).connect(quiet);
    try {
      const room = rc.dmOf(MockRocketChat.OWNER._id);
      await connection.files?.send(room, files, 'Here’s **your** beach');
      expect(
        rc.sent.filter((m) => m.file).map((m) => [m.text, m.file?.name, m.file?.type]),
      ).toEqual([
        ['Here’s **your** beach', 'beach.png', 'image/png'],
        ['', 'notes.pdf', 'application/pdf'],
      ]);
    } finally {
      connection.close();
    }
  });

  it('uses rooms.upload on a server older than 6.8', async () => {
    const { rc, keys } = await setup();
    rc.legacyUploads = true;
    const connection = new RocketChatAdapter(keys).connect(quiet);
    try {
      const room = rc.dmOf(MockRocketChat.OWNER._id);
      await connection.files?.send(room, files.slice(0, 1), 'A beach');
      expect(rc.sent.at(-1)).toMatchObject({
        rid: room,
        text: 'A beach',
        file: { name: 'beach.png', size: png.length },
      });
    } finally {
      connection.close();
    }
  });
});
