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
