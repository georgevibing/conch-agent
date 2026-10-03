import { EventEmitter } from 'node:events';
import type { FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeFolder, folderProblem, folderSource, SETTLE_MS, type FolderDeps } from './folder';
import type { Happening } from './types';
import { OwnWrites, writesOf } from './own';

const HOME = join(tmpdir(), 'conch-home-test');
const KEYS = join(homedir(), '.ssh');

/** A pretend file watcher the test drives. */
function fakeWatch() {
  const watchers: { path: string; emit: (name: string | null) => void; w: EventEmitter }[] = [];
  const watch = (path: string, listener: (filename: string | null) => void) => {
    const w = new EventEmitter() as EventEmitter & { close: () => void };
    w.close = () => {
      w.removeAllListeners();
    };
    watchers.push({ path, emit: listener, w });
    return w as unknown as FSWatcher;
  };
  return { watch, watchers };
}

async function setup(extra: Partial<FolderDeps> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'conch-watch-'));
  const fake = fakeWatch();
  const arrived: Happening[] = [];
  const problems: (string | undefined)[] = [];
  const own = new OwnWrites();
  let running = false;
  const source = folderSource({
    home: HOME,
    forbidden: () => [KEYS, join(root, 'secrets')],
    ownWrite: (p) => own.has(p),
    running: () => running,
    watch: fake.watch,
    ...extra,
  });
  const handle = source.watch?.(
    {
      routineId: 'r1',
      title: 'Downloads',
      trigger: { kind: 'folder', path: root },
      since: 0,
      state: {},
    },
    (h) => arrived.push(...h),
    (e) => problems.push(e?.message),
  );
  await vi.waitFor(() => expect(fake.watchers).toHaveLength(1));
  return {
    root,
    fake,
    arrived,
    problems,
    own,
    handle,
    setRunning: (on: boolean) => (running = on),
    emit: (name: string) => fake.watchers.at(-1)?.emit(name),
  };
}

afterEach(() => vi.useRealTimers());

describe('when a folder changes', () => {
  it('never watches where keys live, Conch’s own folder, a whole drive or the home folder', () => {
    const deps = { home: HOME, forbidden: () => [KEYS] };
    expect(folderProblem(KEYS, deps)).toMatch(/keys and sign-ins/);
    expect(folderProblem(join(KEYS, 'sub'), deps)).toMatch(/keys and sign-ins/);
    expect(folderProblem(homedir(), deps)).toMatch(/whole home folder/);
    expect(folderProblem(parse(homedir()).root, deps)).toMatch(/whole drive/);
    expect(folderProblem(HOME, deps)).toMatch(/Conch keeps its own things/);
    expect(folderProblem(join(HOME, 'routines'), deps)).toMatch(/Conch keeps its own things/);
    expect(folderProblem(join(HOME, '..'), { home: HOME, forbidden: () => [] })).toMatch(
      /Conch keeps its own things/,
    );
    expect(folderProblem('relative/path', deps)).toMatch(/Open dialog/);
    expect(folderProblem(join(homedir(), 'Downloads'), deps)).toBeUndefined();
    expect(describeFolder(join(homedir(), 'Downloads'))).toBe(
      'When something changes in Downloads',
    );
  });

  it('refuses a folder that isn’t there, or a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conch-watch-'));
    await writeFile(join(root, 'a.txt'), 'x');
    const source = folderSource({
      home: HOME,
      forbidden: () => [],
      ownWrite: () => false,
      running: () => false,
    });
    await expect(
      source.validate?.({ kind: 'folder', path: join(root, 'nope') }, {}),
    ).rejects.toThrow(/isn’t there/);
    await expect(
      source.validate?.({ kind: 'folder', path: join(root, 'a.txt') }, {}),
    ).rejects.toThrow(/That’s a file/);
    await expect(source.validate?.({ kind: 'folder', path: root }, {})).resolves.toEqual({
      kind: 'folder',
      path: root,
    });
  });

  it('waits for changes to settle, then reports them together, by name only', async () => {
    const s = await setup();
    await writeFile(join(s.root, 'report.pdf'), 'x');
    s.emit('report.pdf');
    s.emit('notes.txt');
    s.emit('report.pdf');
    expect(s.arrived).toHaveLength(0);
    await vi.waitFor(() => expect(s.arrived).toHaveLength(1), { timeout: SETTLE_MS + 3_000 });
    expect(s.arrived[0]?.label).toBe(`2 changes in ${parse(s.root).base}`);
    expect(s.arrived[0]?.detail).toContain('changed or added: report.pdf');
    expect(s.arrived[0]?.detail).toContain('removed: notes.txt');
    s.handle?.stop();
  }, 20_000);

  it('ignores hidden and scratch files, places where keys live, Conch’s own writes and its own run', async () => {
    const s = await setup();
    s.emit('.git/index');
    s.emit('node_modules/x/index.js');
    s.emit('draft.docx.tmp');
    s.emit('~$draft.docx');
    s.emit('movie.mp4.crdownload');
    s.emit(join('secrets', 'key.pem'));
    s.emit(join('..', 'outside.txt'));
    s.own.note(join(s.root, 'written-by-conch.md'));
    s.emit('written-by-conch.md');
    s.setRunning(true);
    s.emit('while-running.txt');
    s.setRunning(false);
    await new Promise((r) => setTimeout(r, SETTLE_MS + 500));
    expect(s.arrived).toHaveLength(0);
    s.handle?.stop();
  }, 20_000);

  it('says when the folder is gone, and watches it again when it’s back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = await setup();
    await rm(s.root, { recursive: true, force: true });
    s.fake.watchers[0]?.w.emit('error', new Error('EPERM'));
    await vi.advanceTimersByTimeAsync(1_100);
    await vi.waitFor(() => expect(s.problems.at(-1)).toMatch(/isn’t there any more/));
    await mkdir(s.root);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100);
    await vi.waitFor(() => expect(s.fake.watchers).toHaveLength(2));
    await vi.waitFor(() => expect(s.problems.at(-1)).toBeUndefined());
    s.handle?.stop();
  });
});

describe('Conch’s own writes', () => {
  it('are the files an assistant’s tool just wrote, for a couple of minutes', () => {
    let now = 0;
    const own = new OwnWrites(() => now);
    own.onEvent({
      type: 'conversation.event',
      event: {
        type: 'tool.started',
        toolUseId: 't',
        name: 'Write',
        input: { file_path: join(tmpdir(), 'a.md') },
        conversationId: 'c',
        seq: 1,
        at: 0,
      },
    } as never);
    expect(own.has(join(tmpdir(), 'a.md'))).toBe(true);
    expect(own.has(join(tmpdir(), 'b.md'))).toBe(false);
    now = 3 * 60_000;
    expect(own.has(join(tmpdir(), 'a.md'))).toBe(false);
    expect(writesOf('mcp__conch__Edit', { file_path: '/x' })).toEqual(['/x']);
    expect(writesOf('Read', { file_path: '/x' })).toEqual([]);
  });
});
