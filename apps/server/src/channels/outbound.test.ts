/**
 * Pictures and files out to a chat app: `message_user` with attachment ids,
 * and a picture made in a chat that came from Telegram going back as a photo.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config';
import type { ImageBackend } from '../images/backends';
import { Services } from '../services';
import { MockTelegram } from './mock/telegram';
import { deliver, filesOf, mayCarry } from './outbound';
import { channelTools } from './tools';

let services: Services | undefined;

afterEach(() => {
  services?.stop();
  services = undefined;
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function until<T>(fn: () => T | Promise<T>, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Conch with the mock Telegram bot connected and paired with its owner. */
async function withTelegram() {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-outbound-'));
  const s = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  services = s;
  delete process.env.CONCH_MOCK_STATE;
  await s.start();
  const telegram = s.mockTelegram;
  if (!telegram) throw new Error('no mock Telegram');
  telegram.pollCapMs = 200;
  const channel = await s.channels.create({ kind: 'telegram', token: MockTelegram.TOKEN });
  const code = new URL(channel.pairing?.link ?? '').searchParams.get('start');
  telegram.say(`/start ${code}`);
  await until(async () => (await s.channels.get(channel.id)).people.length === 1, 'pairing');
  await until(() => s.channels.reachable().length === 1, 'online');
  return { s, telegram, channel };
}

/** A file kept with a conversation, as image_generate or publish_file keeps one. */
async function kept(s: Services, conversationId: string, name: string, bytes: Buffer) {
  const saved = await s.attachments.save({ name, bytes });
  await s.attachments.claim([saved.id], conversationId);
  return saved;
}

describe('message_user with pictures and files', () => {
  it('sends a picture of this chat’s as a Telegram photo, with the text as its caption', async () => {
    const { s, telegram } = await withTelegram();
    const picture = await kept(s, 'c_here', 'beach.png', PNG);
    const [tool] = channelTools(s.channels, { conversationId: 'c_here' });
    const out = await tool?.run({ text: 'Your **beach**', attachments: [picture.id] });
    expect(out).toBe('Sent to the user on Telegram, with beach.png.');
    expect(telegram.uploads).toEqual([
      expect.objectContaining({
        method: 'sendPhoto',
        chat_id: String(MockTelegram.OWNER.id),
        name: 'beach.png',
        type: 'image/png',
        size: PNG.length,
        caption: 'Your <b>beach</b>',
      }),
    ]);
    // The caption is the message: no second one with the words, and never a path.
    expect(telegram.sent.filter((m) => /beach/.test(m.text))).toEqual([]);
  });

  it('sends any other file as a document', async () => {
    const { s, telegram } = await withTelegram();
    const report = await kept(s, 'c_here', 'report.pdf', Buffer.from('%PDF-1.4\n%…\n'));
    const [tool] = channelTools(s.channels, { conversationId: 'c_here' });
    expect(await tool?.run({ attachments: [report.id] })).toMatch(/^Sent .* with report\.pdf\.$/);
    expect(telegram.uploads).toEqual([
      expect.objectContaining({ method: 'sendDocument', kind: 'document', name: 'report.pdf' }),
    ]);
  });

  it('refuses an unknown id, another chat’s file and a path, and sends nothing', async () => {
    const { s, telegram } = await withTelegram();
    const theirs = await kept(s, 'c_other', 'private.png', PNG);
    const [tool] = channelTools(s.channels, { conversationId: 'c_here' });
    const before = telegram.sent.length;
    for (const id of [
      'att_nothere',
      theirs.id,
      '/home/yiotis/.conch/attachments/att_f9dcb17c73d4/beach.png',
      '../../etc/passwd',
    ]) {
      const out = await tool?.run({ text: 'Here it is', attachments: [id] });
      expect(out).toMatch(/^Not sent: There’s no file .* in this chat\. Use the id \(att_…\)/);
    }
    expect(telegram.uploads).toEqual([]);
    // The words didn't go without the file either.
    expect(telegram.sent.length).toBe(before);
    // Nor with neither words nor files.
    expect(await tool?.run({})).toMatch(/^Not sent/);
  });

  it('tells the model that files go by id, and that a chat app’s chat gets them with the reply', async () => {
    const { s } = await withTelegram();
    const [elsewhere] = channelTools(s.channels, { conversationId: 'c_here' });
    expect(elsewhere?.description).toMatch(
      /attachments.*image_generate.*Never paste a file’s path/,
    );
    const [fromTelegram] = channelTools(s.channels, {
      conversationId: 'c_here',
      origin: { kind: 'channel', channelId: 'ch_x', channel: 'telegram' },
    });
    expect(fromTelegram?.description).toMatch(/pictures and files you make here .* are sent there/);
  });
});

describe('deliver', () => {
  const file = {
    id: 'att_a',
    name: 'a.png',
    mimeType: 'image/png',
    bytes: PNG,
    image: true,
  };

  it('says honestly when the app can’t carry files, and still sends the words', async () => {
    const send = vi.fn().mockResolvedValue([{ chatId: 'c', messageId: '1' }]);
    const done = await deliver({ send }, 'SMS', 'c', [file], 'Look');
    expect(send).toHaveBeenCalledWith('c', 'Look');
    expect(done).toMatchObject({ sent: [], missed: ['a.png (SMS can’t carry files from Conch)'] });
  });

  it('never hands an app a file over its limit', async () => {
    const files = { maxBytes: 10, send: vi.fn().mockResolvedValue([]) };
    const send = vi.fn().mockResolvedValue([]);
    const big = { ...file, name: 'big.png', bytes: Buffer.alloc(11) };
    const done = await deliver({ send, files }, 'Discord', 'c', [file, big], 'Two');
    expect(files.send).not.toHaveBeenCalled();
    expect(done.missed).toEqual(['a.png (over Discord’s 0 MB)', 'big.png (over Discord’s 0 MB)']);
    expect(send).toHaveBeenCalledWith('c', 'Two');
  });

  it('leaves out only the files an app won’t take, and sends the rest', async () => {
    const files = {
      maxBytes: 1024,
      accepts: (f: { image: boolean }) => f.image,
      send: vi.fn().mockResolvedValue([{ chatId: 'c', messageId: '1' }]),
    };
    const pdf = { ...file, id: 'att_p', name: 'a.pdf', mimeType: 'application/pdf', image: false };
    const done = await deliver({ send: vi.fn(), files }, 'Teams', 'c', [file, pdf], 'Both');
    expect(files.send).toHaveBeenCalledWith('c', [file], 'Both');
    expect(done).toMatchObject({
      sent: ['a.png'],
      missed: ['a.pdf (Teams takes only pictures from Conch)'],
    });
  });

  it('reads only ids of the conversation’s own files', async () => {
    const store = {
      inConversation: vi.fn().mockResolvedValue(undefined),
    };
    await expect(filesOf(store, ['att_x'], 'c_1')).rejects.toThrow(/no file/);
    await expect(filesOf(store, ['not an id/..'], 'c_1')).rejects.toThrow(/no file/);
    // A malformed id never reaches the store.
    expect(store.inConversation).toHaveBeenCalledTimes(1);
    await expect(filesOf(store, ['att_x'], undefined)).rejects.toThrow(/belong to/);
    await expect(
      filesOf(
        store,
        Array.from({ length: 11 }, (_, i) => `att_${i}`),
        'c_1',
      ),
    ).rejects.toThrow(/At most 10/);
  });
});

describe('what goes back to a chat', () => {
  it('sends someone else only a picture made from words, never a file of yours', () => {
    const drawn = { name: 'mcp__conch__image_generate', input: { prompt: 'a cat' } };
    const edited = { name: 'mcp__conch__image_generate', input: { prompt: 'x', source: 'me.jpg' } };
    const published = { name: 'mcp__conch__publish_file', input: { file_path: 'taxes.pdf' } };
    expect([drawn, edited, published].map((m) => mayCarry(m, true))).toEqual([true, true, true]);
    expect([drawn, edited, published].map((m) => mayCarry(m, false))).toEqual([true, false, false]);
    // Listing a chat's files shows them; it doesn't send them.
    expect(mayCarry({ name: 'mcp__conch__list_attachments', input: {} }, true)).toBe(false);
  });
});

describe('a picture made in a Telegram chat', () => {
  /** A way to make pictures that costs nothing more, and makes a tiny PNG at once. */
  const backend: ImageBackend = {
    id: 'plan:test',
    by: 'a test plan',
    cost: 'included',
    typicalMs: 10,
    claims: () => true,
    models: async () => [],
    prepare: async () => ({ model: 'test-image', run: async () => ({ bytes: PNG }) }),
  };

  it('goes back to the chat as a photo with the reply, once', async () => {
    const { s, telegram } = await withTelegram();
    vi.spyOn(s.images, 'backends').mockResolvedValue([backend]);
    const created: string[] = [];
    s.broadcast.on((event) => {
      if (event.type === 'conversation.created') created.push(event.conversation.id);
    });
    telegram.say('draw me a beach at golden hour');
    const photo = await until(
      () => telegram.uploads.find((u) => u.method === 'sendPhoto'),
      'the photo',
    );
    expect(photo).toMatchObject({
      chat_id: String(MockTelegram.OWNER.id),
      kind: 'photo',
      type: 'image/png',
      name: 'Picture.png',
    });
    await until(
      () => telegram.sent.some((m) => m.text.includes('Here’s your picture')),
      'the reply',
    );
    // Asked to send it again in the same chat, it isn't sent twice.
    const conversationId = created.at(-1) ?? '';
    expect(conversationId).toBeTruthy();
    const [made] = await s.attachments.forConversation(conversationId);
    const [tool] = channelTools(s.channels, { conversationId: conversationId });
    expect(await tool?.run({ attachments: [made?.id ?? ''] })).toMatch(/already sent/);
    expect(telegram.uploads.filter((u) => u.method === 'sendPhoto')).toHaveLength(1);
    // Never a path pasted into the chat.
    expect(telegram.sent.some((m) => m.text.includes('.conch/attachments'))).toBe(false);
  });
});
