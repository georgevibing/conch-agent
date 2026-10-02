import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { ChannelLink } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config';
import { Services } from '../services';
import { type MockSignal } from './mock/signal';
import { CONCH_MARK } from './signal';
import { explainExit, SignalDaemon, signalCliCommand } from './signal-cli';

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

async function setup(prepare?: (signal: MockSignal) => void) {
  process.env.CONCH_MOCK_SPEED = '0.02';
  process.env.CONCH_MOCK_STATE = 'ready';
  const home = await mkdtemp(join(tmpdir(), 'conch-signal-'));
  services = new Services(
    loadConfig({ CONCH_HOME: home, CONCH_ENGINE: 'mock', CONCH_LOG_LEVEL: 'silent' }),
  );
  delete process.env.CONCH_MOCK_STATE;
  const signal = services.linked.mockSignal;
  if (!signal) throw new Error('no mock Signal');
  prepare?.(signal);
  await services.start();
  const links: ChannelLink[] = [];
  services.broadcast.on((event) => {
    if (event.type === 'channel.link') links.push(event.link);
  });
  return { s: services, signal, links, home };
}

async function linked() {
  const ctx = await setup();
  const link = ctx.s.channelLinking.start('signal');
  await until(() => ctx.links.some((l) => l.id === link.id && l.state === 'showing'), 'a code');
  expect(ctx.signal.scan()).toBe(true);
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

const toSelf = (signal: MockSignal) =>
  signal.sent
    .filter((m) => m.method === 'send' && m.params.noteToSelf === true)
    .map((m) => String(m.params.message ?? ''));

describe('Signal, linked by QR code through signal-cli', () => {
  it('shows the sgnl:// link as a code, and the account is the owner', async () => {
    const { s, signal, links, channelId } = await linked();
    expect(links.find((l) => l.state === 'showing')?.qr).toMatch(/^sgnl:\/\/linkdevice\?uuid=/);
    expect(await s.channels.get(channelId)).toMatchObject({
      kind: 'signal',
      bot: { id: '15550003333', phone: '+15550003333', name: 'Ada Lovelace' },
      people: [{ id: '15550003333' }],
      settings: { others: 'ignore' },
    });
    await until(() => toSelf(signal).some((t) => t.includes('chat with yourself')), 'welcome');
  });

  it('answers Note to Self with styles, marked as its own', async () => {
    const { signal } = await linked();
    await until(() => toSelf(signal).length > 0, 'welcome');
    await signal.say('show me some markdown');
    const answer = await until(
      () => signal.sent.find((m) => m.method === 'send' && Array.isArray(m.params.textStyle)),
      'styled answer',
    );
    expect(String(answer.params.message)).not.toMatch(/\*\*/);
    expect((answer.params.textStyle as string[])[0]).toMatch(
      /^\d+:\d+:(BOLD|ITALIC|MONOSPACE|STRIKETHROUGH)$/,
    );
    expect(toSelf(signal).every((t) => t.endsWith(CONCH_MARK))).toBe(true);
  });

  it('never reads another Conch’s answers as you writing', async () => {
    const { s, signal } = await linked();
    await signal.say(`I am another Conch${CONCH_MARK}`);
    await new Promise((r) => setTimeout(r, 400));
    expect((await s.conversations.list()).some((c) => c.origin?.kind === 'channel')).toBe(false);
  });

  it('asks before acting, and a reply with a number answers', async () => {
    const { s, signal } = await linked();
    await signal.say('please run the tests');
    const question = await until(
      () =>
        signal.sent.find(
          (m) => m.method === 'send' && String(m.params.message).includes('Reply with a number'),
        ),
      'question',
    );
    await signal.say('allow');
    await until(
      () =>
        signal.sent.some(
          (m) =>
            m.method === 'send' &&
            m.params.editTimestamp &&
            String(m.params.message).includes('Allowed'),
        ),
      'question marked allowed',
    );
    expect(question).toBeDefined();
    const chat = (await s.conversations.list()).find((c) => c.origin?.kind === 'channel');
    const events = await s.conversations.eventsAfter(chat?.id ?? '');
    expect(events.some((e) => e.type === 'permission.resolved' && e.decision === 'allow')).toBe(
      true,
    );
  });

  it('takes a photo from Note to Self as an attachment', async () => {
    const { s, signal } = await linked();
    await signal.photo('what is this?');
    const chat = await until(
      async () => (await s.conversations.list()).find((c) => c.origin?.kind === 'channel'),
      'chat',
    );
    const message = await until(async () => {
      const events = await s.conversations.eventsAfter(chat.id);
      return events.find((e) => e.type === 'user.message');
    }, 'message');
    expect(JSON.stringify(message)).toMatch(/attachments/);
  });

  it('never reads friends or groups on your own number', async () => {
    const { s, signal, channelId } = await linked();
    await until(() => toSelf(signal).length > 0, 'welcome');
    const before = signal.sent.length;
    await signal.say('dinner?', 'friend');
    await signal.say('hi all', 'group');
    await new Promise((r) => setTimeout(r, 400));
    expect(signal.sent.length).toBe(before);
    expect((await s.channels.get(channelId)).requests).toEqual([]);
  });

  it('starts signal-cli again when it stops', async () => {
    const { s, signal, channelId } = await linked();
    const starts = signal.starts;
    signal.crash();
    await until(() => signal.starts > starts, 'started again');
    await until(async () => (await s.channels.get(channelId)).health.state === 'online', 'online');
    await signal.say('still there?');
    await until(() => toSelf(signal).some((t) => t.includes('thought on')), 'answer after restart');
  });

  it('unlinked on the phone: asks to link again', async () => {
    const { s, signal, channelId } = await linked();
    signal.unlink();
    const health = await until(async () => {
      const h = (await s.channels.get(channelId)).health;
      return h.state === 'needs-token' ? h : undefined;
    }, 'needs a new link');
    expect(health.message).toMatch(/Link it again/);
  });

  it('without signal-cli, linking says what to install', async () => {
    const { s, links } = await setup((signal) => {
      signal.missing = true;
    });
    const link = s.channelLinking.start('signal');
    const ended = await until(
      () => links.find((l) => l.id === link.id && l.state === 'needs-install'),
      'needs',
    );
    expect(ended).toMatchObject({ need: 'signal-cli' });
  });

  it('without Java, linking says Java is what’s missing', async () => {
    const { s, links } = await setup((signal) => {
      signal.noJava = true;
    });
    const link = s.channelLinking.start('signal');
    // signal-cli starts, then stops at once saying it found no Java.
    const ended = await until(
      () =>
        links.find(
          (l) => l.id === link.id && (l.state === 'needs-install' || l.state === 'failed'),
        ),
      'ended',
    );
    expect(ended.state === 'needs-install' ? ended.need : ended.message).toMatch(/java|Java/);
  });

  it('a code nobody scans is replaced, then expires', async () => {
    const { s, signal, links } = await setup((mock) => {
      mock.linkTimeoutMs = 30;
    });
    const link = s.channelLinking.start('signal');
    const ended = await until(
      () => links.find((l) => l.id === link.id && l.state === 'expired'),
      'expired',
    );
    expect(ended.qr).toBeUndefined();
    expect(links.filter((l) => l.id === link.id && l.state === 'showing').length).toBe(3);
    expect(signal.showing).toBe(false);
  });

  it('disconnecting deletes the account’s files', async () => {
    const { s, home, channelId } = await linked();
    expect((await stat(join(home, 'signal', 'data', 'accounts.json'))).isFile()).toBe(true);
    await s.channels.remove(channelId);
    expect(services?.linked.mockSignal?.calls).toContain('deleteLocalAccountData');
    expect((await s.channels.list()).channels).toEqual([]);
  });
});

describe('signal-cli', () => {
  it('names Java when it’s missing or too old', () => {
    expect(explainExit('Unable to locate a Java Runtime.', 1).need).toBe('java');
    expect(
      explainExit('UnsupportedClassVersionError: has been compiled by a more recent version', 1)
        .need,
    ).toBe('java');
    expect(explainExit('something else', 2)).toEqual({
      message: 'signal-cli stopped (exit 2). Conch starts it again by itself.',
    });
  });

  it('starts the Windows release with Java, never its batch file', async () => {
    const { mkdtemp: temp, mkdir, writeFile } = await import('node:fs/promises');
    const dir = await temp(join(tmpdir(), 'conch-signal-cli-'));
    await mkdir(join(dir, 'bin'));
    const bat = join(dir, 'bin', 'signal-cli.bat');
    await writeFile(
      bat,
      'set DEFAULT_JVM_OPTS="--enable-native-access=ALL-UNNAMED"\r\nset CLASSPATH=%APP_HOME%\\lib\\signal-cli.jar;%APP_HOME%\\lib\\other.jar\r\n',
    );
    expect(signalCliCommand(bat, undefined)).toMatchObject({ need: 'java' });
    expect(signalCliCommand(bat, 'C:\\Java\\bin\\java.exe')).toEqual({
      command: 'C:\\Java\\bin\\java.exe',
      prefix: [
        '--enable-native-access=ALL-UNNAMED',
        '-classpath',
        `${dir}\\lib\\signal-cli.jar;${dir}\\lib\\other.jar`,
        'org.asamk.signal.Main',
      ],
    });
  });

  it('frames requests and answers line by line, and fails them when the process stops', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const exits: ((code: number | null) => void)[] = [];
    const daemon = new SignalDaemon({
      dir: await mkdtemp(join(tmpdir(), 'conch-signal-rpc-')),
      spawn: () =>
        Promise.resolve({
          stdin,
          stdout,
          stderr: new PassThrough(),
          kill: () => exits.forEach((exit) => exit(null)),
          onExit: (listener) => exits.push(listener),
        }),
    });
    stdin.setEncoding('utf8');
    stdin.on('data', (line: string) => {
      const { id, method } = JSON.parse(line) as { id: string; method: string };
      if (method !== 'listAccounts') return;
      // Two answers in one chunk, the second split across chunks.
      stdout.write(
        `{"jsonrpc":"2.0","method":"receive","params":{"account":"+1"}}\n{"jsonrpc":"2.0","id":"${id}","res`,
      );
      stdout.write(`ult":[{"number":"+1"}]}\n`);
    });
    await expect(daemon.request('listAccounts')).resolves.toEqual([{ number: '+1' }]);
    const pending = daemon.request('send', {});
    exits.forEach((exit) => exit(1));
    await expect(pending).rejects.toThrow(/stopped/);
    daemon.stop();
  });
});
