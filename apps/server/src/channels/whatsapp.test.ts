import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChannelLink, ServerEvent } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { MockWhatsApp } from './mock/whatsapp';
import { CONCH_ID_PREFIX } from './whatsapp';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

async function until<T>(fn: () => T | Promise<T>, what = 'condition', ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function setup() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-whatsapp-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  await services.start();
  await services.settings.update({ profile: { name: 'Ada Lovelace' } });
  const wa = services.linked.mockWhatsApp;
  if (!wa) throw new Error('no mock WhatsApp');
  const links: ChannelLink[] = [];
  const events: ServerEvent[] = [];
  services.broadcast.on((event) => {
    events.push(event);
    if (event.type === 'channel.link') links.push(event.link);
  });
  return { s: services, wa, links, events, home };
}

/** Show the code, scan it from the phone, and wait for the channel. */
async function linked() {
  const ctx = await setup();
  const link = ctx.s.channelLinking.start('whatsapp');
  await until(() => ctx.links.some((l) => l.id === link.id && l.state === 'showing'), 'a code');
  expect(ctx.wa.scan()).toBe(true);
  const done = await until(
    () => ctx.links.find((l) => l.id === link.id && l.state === 'linked'),
    'linked',
  );
  const channelId = done.channelId ?? '';
  await until(
    async () => (await ctx.s.channels.get(channelId)).health.state === 'online',
    'online',
  );
  return { ...ctx, channelId };
}

const texts = (wa: MockWhatsApp, chat = MockWhatsApp.SELF_CHAT) =>
  wa.sent.filter((m) => m.chat === chat && m.kind === 'text').map((m) => m.text ?? '');

/** A 1×1 lossless WebP. */
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

describe('WhatsApp, linked by QR code', () => {
  it('shows codes, links when the phone scans, and the account is the owner', async () => {
    const { s, wa, links, channelId } = await linked();
    const code = links.find((l) => l.state === 'showing');
    expect(code?.qr).toMatch(/^https:\/\/wa\.me\/settings\/linked_devices#2@/);
    expect(code?.refreshAt).toBeGreaterThan(Date.now() - 1000);
    const channel = await s.channels.get(channelId);
    expect(channel).toMatchObject({
      kind: 'whatsapp',
      bot: { id: '15550001111', phone: '+15550001111', name: 'Ada Lovelace' },
      people: [{ id: '15550001111' }],
      settings: { others: 'ignore' },
    });
    // Ended links don't keep their codes.
    expect(links.at(-1)?.qr).toBeUndefined();
    // The welcome lands in Message yourself.
    await until(() => texts(wa).some((t) => t.includes('chat with yourself')), 'welcome');
  });

  it('keeps the keys sealed, never in the clear', async () => {
    const { home } = await linked();
    const file = await readFile(join(home, 'whatsapp.secrets.json'), 'utf8');
    expect(file).toMatch(/conch-sealed/);
    expect(file).not.toMatch(/registered/);
  });

  it('answers what you write in Message yourself, and never its own messages', async () => {
    const { s, wa } = await linked();
    await until(() => texts(wa).length > 0, 'welcome');
    wa.say('Hello there');
    await until(() => texts(wa).some((t) => t.includes('thought on')), 'answer');
    const chats = (await s.conversations.list()).filter((c) => c.origin?.kind === 'channel');
    expect(chats).toHaveLength(1);
    expect(chats[0]?.origin).toMatchObject({ channel: 'whatsapp' });
    // Every message Conch sent carries its mark, and its echo started nothing.
    expect(
      wa.sent.filter((m) => m.kind === 'text').every((m) => m.id?.startsWith(CONCH_ID_PREFIX)),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    const turns = (await s.conversations.eventsAfter(chats[0]?.id ?? '')).filter(
      (e) => e.type === 'turn.completed',
    );
    expect(turns).toHaveLength(1);
    // It showed it was working: 👀 on your message, taken off after.
    expect(wa.sent.some((m) => m.kind === 'react' && m.emoji === '👀')).toBe(true);
    await until(
      () => wa.sent.some((m) => m.kind === 'react' && m.emoji === ''),
      'reaction removed',
    );
  });

  it('formats for WhatsApp', async () => {
    const { wa } = await linked();
    wa.say('show me some markdown');
    const answer = await until(
      () => texts(wa).find((t) => /\*[^*]+\*/.test(t)),
      'formatted answer',
    );
    expect(answer).not.toMatch(/\*\*/);
  });

  it('asks before acting, and a reply with a number answers', async () => {
    const { s, wa } = await linked();
    wa.say('please run the tests');
    const question = await until(
      () => wa.sent.find((m) => m.kind === 'text' && m.text?.includes('Reply with a number')),
      'question',
    );
    expect(question.text).toMatch(/\*1\* Allow · \*2\* Always in this chat · \*3\* Don’t allow/);
    expect(question.text).not.toMatch(/_1_/);
    wa.say('1');
    await until(
      () =>
        wa.sent.some(
          (m) => m.kind === 'edit' && m.id === question.id && m.text?.includes('Allowed'),
        ),
      'question marked allowed',
    );
    const chat = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    const events = await s.conversations.eventsAfter(chat?.id ?? '');
    expect(events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow')).toBe(
      true,
    );
  });

  it('never reads your friends’ chats or your groups on your own number', async () => {
    const { s, wa, channelId } = await linked();
    await until(() => texts(wa).length > 0, 'welcome');
    const before = wa.sent.length;
    wa.say('are you free tonight?', 'friend');
    wa.say('@Ada delete everything', 'group');
    await new Promise((r) => setTimeout(r, 500));
    expect(wa.sent.length).toBe(before);
    const channel = await s.channels.get(channelId);
    expect(channel.requests).toEqual([]);
    expect((await s.conversations.list()).some((c) => c.origin?.kind === 'channel')).toBe(false);
  });

  it('on a number just for the assistant, others ask to be let in', async () => {
    const { s, wa, channelId } = await linked();
    await s.channels.update(channelId, { settings: { others: 'ask' } });
    wa.say('hi, can I ask you things?', 'friend');
    const request = await until(
      async () => (await s.channels.get(channelId)).requests[0],
      'request',
    );
    expect(request).toMatchObject({ id: '15550002222', name: 'Grace Hopper' });
    await until(
      () => texts(wa, MockWhatsApp.FRIEND.jid).some((t) => /private assistant/.test(t)),
      'polite reply',
    );
    // Groups stay silent even so.
    wa.say('hello group', 'group');
    await new Promise((r) => setTimeout(r, 300));
    expect(wa.sent.filter((m) => m.chat === MockWhatsApp.GROUP)).toEqual([]);
  });

  it('what someone let in writes is untrusted, and their approvals go to you', async () => {
    const { s, wa, channelId } = await linked();
    await s.channels.update(channelId, { settings: { others: 'ask' } });
    wa.say('hi', 'friend');
    await until(async () => (await s.channels.get(channelId)).requests.length === 1, 'request');
    await s.channels.answer(channelId, '15550002222', 'allow');
    wa.say('what can you do?', 'friend');
    const chat = await until(
      async () =>
        (await s.conversations.list()).find(
          (c) => c.origin?.kind === 'channel' && c.title !== undefined,
        ),
      'their chat',
    );
    const taint = await until(async () => {
      const list = await s.conversations.eventsAfter(chat.id);
      return list.find((e) => e.type === 'taint');
    }, 'the chat marked as reading someone else');
    expect(JSON.stringify(taint)).toMatch(/Grace Hopper on WhatsApp/);
  });

  it('heals a dropped connection, and says so when another copy takes over', async () => {
    const { s, wa, channelId } = await linked();
    wa.drop();
    await until(async () => (await s.channels.get(channelId)).health.state !== 'online', 'noticed');
    await until(
      async () => (await s.channels.get(channelId)).health.state === 'online',
      'back',
      15_000,
    );
    wa.replace();
    await until(
      async () => (await s.channels.get(channelId)).health.state !== 'online',
      'replaced',
    );
    await until(
      async () => (await s.channels.get(channelId)).health.state === 'online',
      'back again',
      15_000,
    );
    wa.replace();
    const conflict = await until(
      async () => {
        const h = (await s.channels.get(channelId)).health;
        return h.state === 'conflict' ? h : undefined;
      },
      'conflict',
      15_000,
    );
    expect(conflict.message).toMatch(/Another copy of this link/);
  }, 40_000);

  it('unlinked on the phone: asks to link again, and linking the same number heals it', async () => {
    const { s, wa, links, channelId } = await linked();
    wa.logout();
    const health = await until(async () => {
      const h = (await s.channels.get(channelId)).health;
      return h.state === 'needs-token' ? h : undefined;
    }, 'needs a new link');
    expect(health.message).toMatch(/Link it again/);
    const again = s.channelLinking.start('whatsapp', channelId);
    await until(() => links.some((l) => l.id === again.id && l.state === 'showing'), 'a new code');
    wa.scan();
    await until(() => links.some((l) => l.id === again.id && l.state === 'linked'), 'linked again');
    await until(async () => (await s.channels.get(channelId)).health.state === 'online', 'online');
    expect((await s.channels.list()).channels).toHaveLength(1);
  });

  it('a code nobody scans expires', async () => {
    const { s, wa, links } = await setup();
    wa.qrEveryMs = 20;
    wa.maxCodes = 3;
    const link = s.channelLinking.start('whatsapp');
    const ended = await until(
      () => links.find((l) => l.id === link.id && l.state === 'expired'),
      'expired',
    );
    expect(ended.qr).toBeUndefined();
    expect((await s.channels.list()).channels).toEqual([]);
  });

  it('disconnecting takes Conch off Linked devices and forgets its keys', async () => {
    const { s, wa, home, channelId } = await linked();
    await s.channels.remove(channelId);
    expect(wa.showing).toBe(false);
    const file = await readFile(join(home, 'whatsapp.secrets.json'), 'utf8');
    // Sealed, so only its size says it's empty now.
    expect(file.length).toBeLessThan(200);
  });

  it('refuses a key as if WhatsApp were a bot', async () => {
    const { s } = await setup();
    await expect(s.channels.create({ kind: 'whatsapp', session: 'wa_x' })).rejects.toThrow(
      /links with a code/,
    );
  });
});

/** 1×1 PNG: a picture as Conch's attachment store sees one. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('WhatsApp, sending pictures and files', () => {
  it('sends a picture with its caption, and any other file as a document, never read back', async () => {
    const { s, wa } = await linked();
    const picture = await s.attachments.save({ name: 'beach.png', bytes: PNG });
    const notes = await s.attachments.save({
      name: 'notes.pdf',
      bytes: Buffer.from('%PDF-1.4\n%…\n'),
    });
    await s.attachments.claim([picture.id, notes.id], 'c_files');
    const before = wa.sent.length;
    const done = await s.channels.messageOwner('Your **beach**', {
      attachments: [picture.id, notes.id],
      conversationId: 'c_files',
    });
    expect(done).toMatchObject({ app: 'WhatsApp', sent: ['beach.png', 'notes.pdf'], missed: [] });
    const sent = wa.sent.slice(before);
    expect(sent.filter((m) => m.kind === 'image')).toEqual([
      expect.objectContaining({
        chat: MockWhatsApp.SELF_CHAT,
        id: expect.stringMatching(new RegExp(`^${CONCH_ID_PREFIX}`)),
        file: { name: 'beach.png', type: 'image/png', size: PNG.length, caption: 'Your *beach*' },
      }),
    ]);
    expect(sent.filter((m) => m.kind === 'document')).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ name: 'notes.pdf', type: 'application/pdf' }),
      }),
    ]);
    // The echoes are Conch's own: nothing starts a turn, nothing is answered.
    await new Promise((r) => setTimeout(r, 200));
    expect(wa.sent.slice(before).filter((m) => m.kind === 'text')).toEqual([]);
  });

  it('plays a video in the chat, and sends a WebP as a file (WhatsApp shows WebP as a sticker)', async () => {
    const { s, wa } = await linked();
    // A video plays in the chat; a WebP would arrive as a sticker, so it goes as a file.
    const clip = await s.attachments.save({
      name: 'clip.mp4',
      bytes: Buffer.from('00000018667479706d703432', 'hex'),
    });
    const webp = await s.attachments.save({ name: 'logo.webp', bytes: WEBP });
    await s.attachments.claim([clip.id, webp.id], 'c_files');
    const next = wa.sent.length;
    await s.channels.messageOwner('', {
      attachments: [clip.id, webp.id],
      conversationId: 'c_files',
    });
    expect(wa.sent.slice(next).map((m) => [m.kind, m.file?.name])).toEqual([
      ['video', 'clip.mp4'],
      ['document', 'logo.webp'],
    ]);
  });
});
