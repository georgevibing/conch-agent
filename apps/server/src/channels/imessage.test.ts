import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ChannelState } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  accessApp,
  appleTime,
  ImessageAdapter,
  imessageSetup,
  ChatDb,
  sendError,
} from './imessage';
import { MockMessages } from './mock/imessage';
import type { ChannelMessage, ChannelPress, StateDetail } from './types';

let messages: MockMessages | undefined;
let close: (() => void) | undefined;

afterEach(async () => {
  close?.();
  close = undefined;
  await messages?.stop();
  messages = undefined;
});

async function until<T>(fn: () => T, what: string, ms = 8_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

function connect(mode: 'self' | 'account', cursor?: string) {
  messages ??= new MockMessages();
  const adapter = new ImessageAdapter({ ...messages.endpoints, mode, handle: MockMessages.ME });
  const got: ChannelMessage[] = [];
  const presses: ChannelPress[] = [];
  const states: { state: ChannelState; detail?: StateDetail }[] = [];
  const cursors: string[] = [];
  const connection = adapter.connect(
    {
      message: (m) => got.push(m),
      press: (p) => presses.push(p),
      state: (state, detail) => states.push({ state, ...(detail && { detail }) }),
      healed: () => undefined,
      cursor: (c) => cursors.push(c),
    },
    cursor ? { cursor } : {},
  );
  close = () => connection.close();
  const online = () => until(() => states.some((s) => s.state === 'online'), 'online');
  return { adapter, connection, got, presses, states, cursors, online, mock: messages };
}

describe('iMessage — texting yourself', () => {
  it('reads only the chat with yourself, from now on, words kept in attributedBody', async () => {
    const { got, online, mock, cursors } = connect('self');
    await online();
    // Nothing from before connecting is answered: not the old note to self, not the friend.
    mock.say('hello from a friend', { from: MockMessages.FRIEND });
    mock.say('what’s on today?');
    await until(() => got.length, 'a message');
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      text: 'what’s on today?',
      direct: true,
      chatId: `iMessage;-;${MockMessages.ME}`,
      user: { username: MockMessages.ME },
    });
    expect(Number(cursors.at(-1))).toBeGreaterThan(2);
  });

  it('never reads its own answers back as yours', async () => {
    const { got, online, mock, connection } = connect('self');
    await online();
    await connection.send(
      `iMessage;-;${MockMessages.ME}`,
      'Here’s **your** day:\n\n- Dentist at 3',
    );
    expect(mock.last()).toEqual({
      // Ends with Conch's mark, so it's never read back as yours.
      text: 'Here’s your day:\n\n• Dentist at 3\u2063',
      target: `iMessage;-;${MockMessages.ME}`,
      kind: 'chat',
    });
    mock.say('thanks');
    await until(() => got.length, 'a message');
    await new Promise((r) => setTimeout(r, 300));
    expect(got.map((m) => m.text)).toEqual(['thanks']);
  });

  it('sends a picture and a file after their caption, and never reads them back', async () => {
    const { got, online, mock, connection } = connect('self');
    await online();
    const chat = `iMessage;-;${MockMessages.ME}`;
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await connection.files?.send(
      chat,
      [
        { id: 'att_1', name: 'beach.png', mimeType: 'image/png', bytes: png, image: true },
        {
          id: 'att_2',
          name: 'notes.pdf',
          mimeType: 'application/pdf',
          bytes: Buffer.from('%PDF-1.4'),
          image: false,
        },
      ],
      'Your **beach**',
    );
    expect(mock.sent.slice(-3)).toEqual([
      { text: 'Your beach\u2063', target: chat, kind: 'chat' },
      { text: '', target: chat, kind: 'chat', file: { name: 'beach.png', size: png.length } },
      { text: '', target: chat, kind: 'chat', file: { name: 'notes.pdf', size: 8 } },
    ]);
    mock.say('thanks');
    await until(() => got.length, 'a message');
    await new Promise((r) => setTimeout(r, 300));
    expect(got.map((m) => m.text)).toEqual(['thanks']);
  });

  it('asks with numbered answers instead of buttons, and a reply of one answers', async () => {
    const { got, presses, online, mock, connection } = connect('self');
    await online();
    const chat = `iMessage;-;${MockMessages.ME}`;
    await connection.send(chat, '🔐 **Conch would like to:**\nDelete old.log', {
      buttons: [
        { label: 'Allow', data: 'p:x:a', style: 'primary' },
        { label: 'Don’t allow', data: 'p:x:d', style: 'danger' },
      ],
    });
    expect(mock.last()?.text).toContain('Reply with a number: 1 Allow · 2 Don’t allow');
    mock.say('yes but which file?');
    await until(() => got.length, 'a message');
    mock.say('1');
    await until(() => presses.length, 'a press');
    expect(presses[0]).toMatchObject({ data: 'p:x:a', chatId: chat });
    // Answered (the service says so by editing the question): a later "1" is just a message.
    await connection.edit(presses[0]?.message ?? { chatId: chat, messageId: '' }, '✅ Allowed');
    mock.say('1');
    await until(() => got.length === 2, 'another message');
  });

  it('takes photos, as JPEG when they’re HEIC, and only from Messages’ own folder', async () => {
    const { got, online, mock, connection } = connect('self');
    await online();
    mock.say('', {
      file: { name: 'IMG_0001.HEIC', mime: 'image/heic', bytes: Buffer.from('heic') },
    });
    const message = await until(() => got[0], 'a photo');
    const file = message.files[0];
    expect(file).toMatchObject({ name: 'IMG_0001.HEIC', mimeType: 'image/heic' });
    if (!file) throw new Error('no file');
    expect(await connection.download(file)).toMatchObject({
      name: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
    });
    await expect(connection.download({ ...file, ref: '/etc/passwd' })).rejects.toThrow(
      /doesn’t have that file/,
    );
    await expect(
      connection.download({ ...file, ref: join(mock.attachments, '..', 'chat.db') }),
    ).rejects.toThrow(/doesn’t have that file/);
  });

  it('skips reactions, and carries on from where it was after a restart', async () => {
    const first = connect('self');
    await first.online();
    first.mock.say('Loved “thanks”', { reaction: true });
    first.mock.say('one');
    await until(() => first.got.length, 'one');
    await until(() => first.cursors.length > 1, 'a cursor');
    const cursor = first.cursors.at(-1);
    first.connection.close();
    first.mock.say('two, while Conch was off');
    const second = connect('self', cursor);
    await until(() => second.got.length, 'two');
    expect(second.got.map((m) => m.text)).toEqual(['two, while Conch was off']);
  });

  it('waits for Full Disk Access, says so, and carries on once it’s on', async () => {
    messages = new MockMessages();
    messages.hide();
    const { states, online, mock, got } = connect('self');
    await until(
      () => states.find((s) => s.detail?.access === 'full-disk-access'),
      'asking for Full Disk Access',
    );
    expect(await imessageSetup(new ChatDb(mock.db))).toMatchObject({ access: 'full-disk-access' });
    mock.show();
    await online();
    mock.say('there you are');
    await until(() => got.length, 'a message');
  }, 15_000);

  it('says when macOS hasn’t let it use Messages, and recovers when it has', async () => {
    const { states, online, mock, connection } = connect('self');
    await online();
    mock.denyAutomation = true;
    await expect(connection.send('to:ada@icloud.com', 'hi')).rejects.toThrow(/Automation/);
    expect(states.at(-1)).toMatchObject({ state: 'error', detail: { access: 'automation' } });
    mock.denyAutomation = false;
    await connection.send('to:ada@icloud.com', 'hi');
    expect(states.at(-1)?.state).toBe('online');
  });

  it('sends to the person when Messages no longer has the chat', async () => {
    const { online, mock, connection } = connect('self');
    await online();
    mock.forgetChats();
    await connection.send(`iMessage;-;${MockMessages.ME}`, 'still here');
    expect(mock.last()).toMatchObject({ kind: 'to', target: MockMessages.ME });
  });
});

describe('iMessage — a Mac with its own Apple ID', () => {
  it('reads people’s one-to-one texts, never its own, and marks groups', async () => {
    const { got, online, mock, connection } = connect('account');
    await online();
    mock.say('hi, it’s Grace', { from: MockMessages.FRIEND, plainText: true });
    mock.say('dinner?', { from: MockMessages.FRIEND, group: true });
    await connection.send(`to:${MockMessages.FRIEND}`, 'Hi Grace');
    await until(() => got.length === 2, 'two messages');
    expect(got[0]).toMatchObject({
      text: 'hi, it’s Grace',
      direct: true,
      user: { username: MockMessages.FRIEND },
    });
    expect(got[1]).toMatchObject({ direct: false });
    expect(await connection.directChat(got[0]?.user.id ?? '')).toBe(`to:${MockMessages.FRIEND}`);
  });

  it('knows who it is, and what’s missing when it can’t', async () => {
    messages = new MockMessages();
    const self = new ImessageAdapter({
      ...messages.endpoints,
      mode: 'self',
      handle: 'Ada@iCloud.com',
    });
    expect(await self.identify()).toMatchObject({
      address: 'ada@icloud.com',
      chatUrl: 'sms:ada@icloud.com',
    });
    expect(self.owner()).toMatchObject({ username: 'ada@icloud.com' });
    const elsewhere = new ImessageAdapter({
      ...messages.endpoints,
      platform: 'linux',
      mode: 'self',
      handle: 'a@b.c',
    });
    await expect(elsewhere.identify()).rejects.toThrow(/only works on a Mac/);
    messages.hide();
    const hidden = new ImessageAdapter({ ...messages.endpoints, mode: 'self', handle: 'a@b.c' });
    await expect(hidden.identify()).rejects.toThrow(/Full Disk Access/);
    messages.show();
    const setup = await imessageSetup(new ChatDb(messages.db), { TERM_PROGRAM: 'Apple_Terminal' });
    expect(setup).toEqual({ access: 'ready', handles: [MockMessages.ME], app: 'Terminal' });
    expect(await new ChatDb(join(messages.dir, 'nope', 'chat.db')).access()).toBe('no-messages');
  });
});

describe('iMessage — the pieces', () => {
  it('reads Messages’ clock', () => {
    const now = Date.UTC(2026, 9, 2);
    expect(appleTime((now - 978_307_200_000) * 1e6)).toBe(now);
    expect(appleTime((now - 978_307_200_000) / 1000)).toBe(now);
  });

  it('turns what Messages said into the fix', () => {
    const say = (stderr: string) => sendError({ stdout: '', stderr, code: 1 });
    expect(say('Not authorized to send Apple events to Messages. (-1743)').message).toMatch(
      /Automation/,
    );
    expect(say('Can’t get participant "x". (-1728)').code).toBe('refused');
    expect(
      say('Messages got an error: Can’t get account 1 whose service type = iMessage.').message,
    ).toMatch(/sign in/);
  });

  it('names the app that needs Full Disk Access', () => {
    expect(accessApp({ TERM_PROGRAM: 'iTerm.app' })).toBe('iTerm');
    expect(accessApp({})).toBe('node');
  });

  it.runIf(process.platform === 'darwin')(
    'has a send script Messages understands, that takes its words only as arguments',
    async () => {
      // Compiling checks every word against Messages' own dictionary; nothing is sent.
      const script = join(import.meta.dirname, 'assets', 'messages-send.applescript');
      await promisify(execFile)('/usr/bin/osacompile', ['-o', '/dev/null', script]);
    },
  );

  it.runIf(process.platform === 'darwin')(
    'hands osascript words that look like its own options as words, not commands',
    async () => {
      // The same shape as the send script (a script file, then the words), but it only echoes.
      const dir = await mkdtemp(join(tmpdir(), 'conch-osa-'));
      const echo = join(dir, 'echo.applescript');
      await writeFile(
        echo,
        'on run argv\nset out to ""\nrepeat with a in argv\nset out to out & "[" & a & "]"\nend repeat\nreturn out\nend run\n',
      );
      const words = [
        '-e',
        'do shell script "touch /tmp/conch-pwned"',
        '"; quit',
        '$(id) `id` \\ é 🎉',
      ];
      const { stdout } = await promisify(execFile)('/usr/bin/osascript', [echo, ...words]);
      expect(stdout.trim()).toBe(words.map((w) => `[${w}]`).join(''));
      await rm(dir, { recursive: true, force: true });
    },
  );
});
