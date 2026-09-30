import type { TerminalLiveEvent } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { basicBackend, type PtyProcess } from './backend';
import { TerminalSession, type TerminalWatcher } from './session';

/** A PTY the test drives by hand. */
function fakePty() {
  let onData: (data: string) => void = () => undefined;
  let onExit: (exit: { exitCode: number }) => void = () => undefined;
  const pty: PtyProcess & { paused: boolean; written: string[] } = {
    pid: 1,
    paused: false,
    written: [],
    write(data) {
      this.written.push(data);
    },
    resize: vi.fn(),
    kill: vi.fn(),
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    onData: (listener) => (onData = listener),
    onExit: (listener) => (onExit = listener),
  };
  return {
    pty,
    print: (data: string) => onData(data),
    exit: (exitCode: number) => onExit({ exitCode }),
  };
}

const meta = {
  id: 'term_1',
  shell: 'zsh',
  cwd: '/home/ada',
  owner: 'local',
  openedFrom: 'this-computer' as const,
  safeMode: false,
};

function watcher(congested = () => false) {
  const events: TerminalLiveEvent[] = [];
  let bytes = '';
  const w: TerminalWatcher = {
    send: (e) => events.push(e),
    output: (data) => (bytes += data.toString('utf8')),
    congested,
  };
  return { w, events, output: () => bytes };
}

const hooks = { changed: vi.fn(), exited: vi.fn() };

describe('TerminalSession', () => {
  it('batches output, and names the tab from the shell’s title', async () => {
    const { pty, print } = fakePty();
    const session = new TerminalSession(meta, pty, hooks);
    const view = watcher();
    session.attach(view.w);
    print('\x1b]0;~/projects/conch\x07$ ');
    print('ls\r\n');
    await vi.waitFor(() => expect(view.output()).toContain('ls'));
    expect(session.info().title).toBe('~/projects/conch');
    expect(view.events).toContainEqual({ type: 'title', title: '~/projects/conch' });
  });

  it('keeps about 2 MB of scrollback for the next viewer, cut at a line', async () => {
    const { pty, print } = fakePty();
    const session = new TerminalSession(meta, pty, hooks);
    const line = `${'x'.repeat(1023)}\n`;
    print('FIRST LINE\n');
    for (let i = 0; i < 2600; i++) print(line);
    print('LAST LINE\n');
    await new Promise((r) => setTimeout(r, 20));
    const later = watcher();
    session.attach(later.w);
    const replay = later.output();
    expect(replay.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(replay).toContain('LAST LINE');
    expect(replay).not.toContain('FIRST LINE');
    expect(replay.startsWith('x')).toBe(true);
  });

  it('pauses the shell while a viewer can’t keep up, and resumes once it has', async () => {
    const { pty, print } = fakePty();
    const session = new TerminalSession(meta, pty, hooks);
    let behind = true;
    session.attach(watcher(() => behind).w);
    print('lots of output');
    await vi.waitFor(() => expect(pty.paused).toBe(true));
    behind = false;
    await vi.waitFor(() => expect(pty.paused).toBe(false));
  });

  it('marks a shell that failed right away, so Conch can offer to start without the profile', () => {
    const { pty, exit } = fakePty();
    const session = new TerminalSession(meta, pty, hooks);
    const view = watcher();
    session.attach(view.w);
    exit(1);
    expect(session.info()).toMatchObject({ status: 'exited', exitCode: 1, endedEarly: true });
    expect(view.events).toContainEqual({ type: 'exit', code: 1 });
    // A clean exit isn't a problem.
    const other = fakePty();
    const fine = new TerminalSession(meta, other.pty, hooks);
    other.exit(0);
    expect(fine.info().endedEarly).toBeUndefined();
  });

  it('ignores input once the shell has exited', () => {
    const { pty, exit } = fakePty();
    const session = new TerminalSession(meta, pty, hooks);
    session.write('before\r');
    exit(0);
    session.write('after\r');
    expect(pty.written).toEqual(['before\r']);
  });
});

describe('basic mode', () => {
  it('still lets you type: echo, backspace and Enter sends the line', async () => {
    const child = basicBackend().spawn(
      process.execPath,
      ['-e', "process.stdin.on('data', (d) => process.stdout.write('got:' + d))"],
      { cols: 80, rows: 24, cwd: process.cwd(), env: process.env as Record<string, string> },
    );
    let out = '';
    child.onData((d) => (out += d));
    child.write('hx\x7fi\r');
    await vi.waitFor(() => expect(out).toContain('got:hi'), { timeout: 10_000 });
    expect(out.startsWith('hx\b \bi\r\n')).toBe(true);
    child.kill();
  });
});
