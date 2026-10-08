import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MockTelegram } from './mock/telegram';
import { TelegramAdapter } from './telegram';
import { ChannelError, type ChannelEvents } from './types';

let telegram: MockTelegram;
let adapter: TelegramAdapter;

beforeEach(async () => {
  telegram = new MockTelegram();
  telegram.pollCapMs = 100;
  adapter = new TelegramAdapter(MockTelegram.TOKEN, await telegram.start());
});

afterEach(() => telegram.stop());

const quiet: ChannelEvents = {
  message: () => undefined,
  press: () => undefined,
  state: () => undefined,
  healed: () => undefined,
};

describe('TelegramAdapter', () => {
  it('gives settings their own rows so model names remain readable on a phone', async () => {
    const connection = adapter.connect(quiet);
    await connection.send('4242', 'Choose a model', {
      buttons: [
        { label: 'A model with a long name', data: 's:menu:0' },
        { label: 'Another model with a long name', data: 's:menu:1' },
      ],
    });
    expect(telegram.calls.find((c) => c.method === 'sendMessage')?.params.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'A model with a long name', callback_data: 's:menu:0' }],
        [{ text: 'Another model with a long name', callback_data: 's:menu:1' }],
      ],
    });
    connection.close();
  });

  it('sends formatted text, and plain text when Telegram refuses the formatting', async () => {
    const connection = adapter.connect(quiet);
    await connection.send('4242', '**Hi** there');
    expect(telegram.last()).toMatchObject({ text: '<b>Hi</b> there', parse_mode: 'HTML' });
    telegram.refuseHtml = true;
    await connection.send('4242', '**Hi** again');
    expect(telegram.last()).toMatchObject({ text: 'Hi again' });
    expect(telegram.last()?.parse_mode).toBeUndefined();
    connection.close();
  });

  it('splits long answers and puts the buttons under the last part', async () => {
    const connection = adapter.connect(quiet);
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`).join(
      '\n\n',
    );
    const refs = await connection.send('4242', long, {
      buttons: [{ label: 'Allow', data: 'p:x:a' }],
    });
    expect(refs.length).toBeGreaterThan(1);
    const sent = telegram.sent.slice(-refs.length);
    expect(sent.every((m) => m.text.length <= 4096)).toBe(true);
    expect(sent.slice(0, -1).every((m) => m.buttons.length === 0)).toBe(true);
    expect(sent.at(-1)?.buttons).toEqual([{ text: 'Allow', callback_data: 'p:x:a' }]);
    connection.close();
  });

  it('refuses something that isn’t a key without sending it anywhere', async () => {
    const bad = new TelegramAdapter('not a key/../../x', telegram.base);
    await expect(bad.identify()).rejects.toMatchObject({ code: 'auth' });
    expect(telegram.calls).toHaveLength(0);
  });

  it('never puts the key in an error', async () => {
    const offline = new TelegramAdapter(MockTelegram.TOKEN, 'http://127.0.0.1:1');
    const error = await offline.identify().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).code).toBe('network');
    expect((error as Error).message).not.toContain(MockTelegram.TOKEN);
  });

  it('only answers private chats', async () => {
    const got: boolean[] = [];
    const connection = adapter.connect({ ...quiet, message: (m) => got.push(m.direct) });
    telegram.say('in a group', MockTelegram.OWNER, {
      chat: { id: -100, type: 'supergroup' },
    });
    telegram.say('in private');
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toEqual([false, true]);
    connection.close();
  });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const picture = (name = 'beach.png', bytes: Buffer = PNG) => ({
  id: `att_${name.replace(/\W/g, '')}`,
  name,
  mimeType: 'image/png',
  bytes,
  image: true,
  width: 1024,
  height: 768,
});

describe('TelegramAdapter — pictures and files', () => {
  it('sends a picture as a photo with its caption, formatted', async () => {
    const connection = adapter.connect(quiet);
    const refs = await connection.files?.send('4242', [picture()], 'Your **beach**');
    expect(refs).toHaveLength(1);
    expect(telegram.uploads).toEqual([
      expect.objectContaining({
        method: 'sendPhoto',
        chat_id: '4242',
        kind: 'photo',
        name: 'beach.png',
        type: 'image/png',
        size: PNG.length,
        caption: 'Your <b>beach</b>',
        parse_mode: 'HTML',
      }),
    ]);
    // No text message besides: the caption is the message.
    expect(telegram.sent).toEqual([]);
    connection.close();
  });

  it('sends anything else as a document', async () => {
    const connection = adapter.connect(quiet);
    await connection.files?.send(
      '4242',
      [
        {
          id: 'att_r',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          bytes: Buffer.from('%PDF-1.4'),
          image: false,
        },
      ],
      'The report',
    );
    expect(telegram.uploads).toEqual([
      expect.objectContaining({
        method: 'sendDocument',
        kind: 'document',
        name: 'report.pdf',
        caption: 'The report',
      }),
    ]);
    connection.close();
  });

  it('sends documents with their name and type, music and video in Telegram’s players', async () => {
    const connection = adapter.connect(quiet);
    const file = (name: string, mimeType: string) => ({
      id: `att_${name.replace(/\W/g, '')}`,
      name,
      mimeType,
      bytes: Buffer.from('x'),
      image: false,
    });
    await connection.files?.send('4242', [
      file('Q3 report.pdf', 'application/pdf'),
      file('Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ]);
    await connection.files?.send('4242', [file('song.mp3', 'audio/mpeg')], 'A song');
    await connection.files?.send('4242', [file('clip.mp4', 'video/mp4')]);
    await connection.files?.send('4242', [file('memo.ogg', 'audio/ogg')]);
    expect(telegram.uploads.map((u) => [u.method, u.kind, u.name, u.type])).toEqual([
      ['sendMediaGroup', 'document', 'Q3 report.pdf', 'application/pdf'],
      [
        'sendMediaGroup',
        'document',
        'Budget.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      ['sendAudio', 'audio', 'song.mp3', 'audio/mpeg'],
      ['sendVideo', 'video', 'clip.mp4', 'video/mp4'],
      ['sendDocument', 'document', 'memo.ogg', 'audio/ogg'],
    ]);
    expect(telegram.uploads[2]?.caption).toBe('A song');
    connection.close();
  });

  it('puts several pictures in one album, the caption on the first', async () => {
    const connection = adapter.connect(quiet);
    const refs = await connection.files?.send('4242', [picture('a.png'), picture('b.png')], 'Two');
    expect(refs).toHaveLength(2);
    expect(telegram.uploads.map((u) => [u.method, u.name, u.caption])).toEqual([
      ['sendMediaGroup', 'a.png', 'Two'],
      ['sendMediaGroup', 'b.png', undefined],
    ]);
    connection.close();
  });

  it('sends pictures and documents apart (Telegram won’t mix them in an album)', async () => {
    const connection = adapter.connect(quiet);
    await connection.files?.send('4242', [
      picture(),
      {
        id: 'att_n',
        name: 'notes.txt',
        mimeType: 'text/plain',
        bytes: Buffer.from('hi'),
        image: false,
      },
    ]);
    expect(telegram.uploads.map((u) => u.method)).toEqual(['sendPhoto', 'sendDocument']);
    connection.close();
  });

  it('sends a picture over 10 MB, or one too long to be a photo, as a document', async () => {
    const connection = adapter.connect(quiet);
    await connection.files?.send('4242', [picture('big.png', Buffer.alloc(11 * 1024 * 1024, 1))]);
    await connection.files?.send('4242', [{ ...picture('strip.png'), width: 9000, height: 200 }]);
    expect(telegram.uploads.map((u) => [u.method, u.name])).toEqual([
      ['sendDocument', 'big.png'],
      ['sendDocument', 'strip.png'],
    ]);
    expect(connection.files?.maxBytes).toBe(50 * 1024 * 1024);
    connection.close();
  });

  it('sends the caption plain when Telegram can’t read the formatting, and a long one first on its own', async () => {
    const connection = adapter.connect(quiet);
    telegram.refuseHtml = true;
    await connection.files?.send('4242', [picture()], '**Hi**');
    expect(telegram.uploads.at(-1)).toMatchObject({ caption: 'Hi' });
    expect(telegram.uploads.at(-1)?.parse_mode).toBeUndefined();
    telegram.refuseHtml = false;
    await connection.files?.send('4242', [picture()], 'word '.repeat(300));
    expect(telegram.sent.at(-1)?.text).toMatch(/^word word/);
    expect(telegram.uploads.at(-1)?.caption).toBeUndefined();
    connection.close();
  });
});

describe('the pretend apps', () => {
  it('start on any free port when the one asked for is taken', async () => {
    const { createServer } = await import('node:net');
    const { MockDiscord } = await import('./mock/discord');
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    const pretendTelegram = new MockTelegram();
    const pretendDiscord = new MockDiscord();
    try {
      expect(await pretendTelegram.start(taken)).not.toContain(`:${taken}`);
      expect(await pretendDiscord.start(taken)).not.toContain(`:${taken}`);
    } finally {
      await pretendTelegram.stop();
      await pretendDiscord.stop();
      blocker.close();
    }
  });
});
