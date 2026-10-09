/**
 * A chat app a Conch app brings (ADR 0119), as a channel: what its sealed
 * code hands over is checked before the service sees it, Conch owns the loop
 * (it heals by itself, and stops at a refused token), and questions go out
 * as numbered answers the reply presses.
 */
import { describe, expect, it } from 'vitest';

import type { PartCall, PartName } from '../conchapps/runtime';
import type { AppCallOutcome, AppRuntime } from '../conchapps/types';
import type { ChannelEvents, ChannelMessage, ChannelPress } from '../channels/types';
import { AppChannelAdapter, channelError } from './channel';

/** A sealed runtime stand-in that answers each function with what the test says. */
function runtime(
  answer: (
    part: PartName,
    input: Record<string, unknown>,
    call: PartCall,
  ) => AppCallOutcome | Promise<AppCallOutcome>,
) {
  const calls: { part: PartName; input: Record<string, unknown>; keys: Record<string, string> }[] =
    [];
  const fake: AppRuntime = {
    running: true,
    list: async () => [],
    stop: async () => undefined,
    call: async () => ({ ok: false, text: 'no tools' }),
    parts: async () => ['channel.identify', 'channel.poll', 'channel.send'],
    callPart: async (part, input, call) => {
      calls.push({ part, input, keys: call.keys });
      return answer(part, input, call);
    },
  };
  return { fake, calls };
}

function events() {
  const got = {
    messages: [] as ChannelMessage[],
    presses: [] as ChannelPress[],
    states: [] as string[],
    cursors: [] as string[],
    healed: [] as string[],
  };
  const listeners: ChannelEvents = {
    message: (m) => got.messages.push(m),
    press: (p) => got.presses.push(p),
    state: (s) => got.states.push(s),
    healed: (h) => got.healed.push(h),
    cursor: (c) => got.cursors.push(c),
  };
  return { got, listeners };
}

const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const part = { receives: 'poll' as const, fields: [], steps: [], buttons: false };
const secrets = { kind: 'app' as const, app: 'example', fields: { token: 't-1' } };

describe('a chat app’s channel', () => {
  it('hands over only messages that read, as people Conch can name, with its cursor', async () => {
    let polled = 0;
    const { fake, calls } = runtime((p) => {
      if (p !== 'channel.poll') return { ok: true, text: '' };
      polled++;
      return polled === 1
        ? {
            ok: true,
            text: '',
            json: {
              messages: [
                { chatId: 7, messageId: 1, user: { id: 42, name: 'Ada' }, text: 'hello' },
                { chatId: 'c', user: { id: 'x' }, text: 'no name: dropped' },
                'not even a message',
                { chatId: 'c', user: { id: '@ada:example.org', name: 'Ada' }, text: 'odd id' },
              ],
              cursor: '1',
            },
          }
        : { ok: true, text: '', json: { messages: [] } };
    });
    const adapter = new AppChannelAdapter(secrets, {
      name: 'Example',
      part,
      runtime: async () => fake,
    });
    const { got, listeners } = events();
    const connection = adapter.connect(listeners);
    await until(() => got.messages.length === 2);
    connection.close();
    expect(got.messages[0]).toMatchObject({
      chatId: '7',
      messageId: '1',
      user: { id: '42', name: 'Ada' },
      direct: true,
    });
    // An id that isn't one Conch can keep is written so it reads back the same.
    expect(got.messages[1]?.user.id).toMatch(/^X/);
    expect(got.cursors).toEqual(['1']);
    expect(got.states).toContain('online');
    // The fields typed for it, every call; its next poll starts from the cursor.
    expect(calls[0]?.keys).toEqual({ token: 't-1' });
    expect(calls.find((c) => c.input.cursor === '1')).toBeTruthy();
  });

  it('heals by itself when the app’s servers fail, and says so once it’s back', async () => {
    let polled = 0;
    const { fake } = runtime(() => {
      polled++;
      return polled === 1
        ? { ok: false, text: 'Example said 503.' }
        : { ok: true, text: '', json: { messages: [] } };
    });
    const adapter = new AppChannelAdapter(secrets, {
      name: 'Example',
      part,
      runtime: async () => fake,
      random: () => 0,
    });
    const { got, listeners } = events();
    const connection = adapter.connect(listeners);
    await until(() => got.healed.length > 0, 4000);
    connection.close();
    expect(got.states).toEqual(expect.arrayContaining(['reconnecting', 'online']));
    expect(got.healed).toEqual(['Reconnected Example']);
  });

  it('stops at a refused token, and asks for a new one', async () => {
    const { fake, calls } = runtime(() => ({
      ok: false,
      text: 'Example said 401: it refused the token.',
    }));
    const adapter = new AppChannelAdapter(secrets, {
      name: 'Example',
      part,
      runtime: async () => fake,
    });
    const { got, listeners } = events();
    adapter.connect(listeners);
    await until(() => got.states.includes('needs-token'));
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.filter((c) => c.part === 'channel.poll')).toHaveLength(1);
  });

  it('writes a question’s answers as numbers, and a reply presses the one it names', async () => {
    let next: unknown[] = [];
    const { fake, calls } = runtime((p) =>
      p === 'channel.send'
        ? { ok: true, text: '', json: { messageId: 'out-1' } }
        : { ok: true, text: '', json: { messages: next.splice(0) } },
    );
    const adapter = new AppChannelAdapter(secrets, {
      name: 'Example',
      part,
      runtime: async () => fake,
    });
    const { got, listeners } = events();
    const connection = adapter.connect(listeners);
    await connection.send('c1', '**Allow this?**', {
      buttons: [
        { label: 'Allow', data: 'p:k:a', style: 'primary' },
        { label: 'Don’t allow', data: 'p:k:d', style: 'danger' },
      ],
    });
    const sent = calls.find((c) => c.part === 'channel.send');
    expect(sent?.input).toEqual({
      chatId: 'c1',
      text: '**Allow this?**\n\nReply with a number: **1** Allow · **2** Don’t allow',
    });
    next = [{ chatId: 'c1', messageId: 'in-1', user: { id: 'ada', name: 'Ada' }, text: '2' }];
    await until(() => got.presses.length === 1);
    connection.close();
    expect(got.presses[0]).toMatchObject({
      data: 'p:k:d',
      message: { chatId: 'c1', messageId: 'out-1' },
    });
    expect(got.messages).toEqual([]);
  });

  it('sends a long answer in parts, and says who the bot is only in the shape it promised', async () => {
    const { fake, calls } = runtime((p) =>
      p === 'channel.identify'
        ? { ok: true, text: '', json: { id: 9, name: 'Bot', chatUrl: 'javascript:alert(1)' } }
        : { ok: true, text: '', json: {} },
    );
    const adapter = new AppChannelAdapter(secrets, {
      name: 'Example',
      part,
      runtime: async () => fake,
    });
    // An address that isn't https is a shape it didn't promise.
    await expect(adapter.identify()).rejects.toThrow(/shape Conch can’t read/);
    const connection = adapter.connect(events().listeners);
    const refs = await connection.send('c1', `${'a'.repeat(5000)}\n\n${'b'.repeat(5000)}`);
    connection.close();
    expect(refs).toHaveLength(2);
    expect(
      calls.filter((c) => c.part === 'channel.send').map((c) => String(c.input.text).length),
    ).toEqual([5000, 5000]);
  });

  it('reads the app’s own errors as what to do', () => {
    expect(channelError('it said 401').code).toBe('auth');
    expect(channelError('it said 429, too many requests').code).toBe('rate-limit');
    expect(channelError('Couldn’t reach chat.example.com.').code).toBe('network');
    expect(channelError('That chat is closed.').code).toBe('refused');
  });
});
