import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { unifiedDiff } from './diff';
import { UndoService } from './service';
import { UndoStore, type ChangeSet } from './store';

let root: string;
let home: string;
let work: string;
let secret: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-undo-'));
  home = join(root, 'home');
  work = join(root, 'work');
  secret = join(root, 'secret');
  for (const d of [home, work, secret]) mkdirSync(d, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(options: { maxBytes?: number } = {}) {
  const changes: ChangeSet[] = [];
  const restored: { id: string; direction: string }[] = [];
  const store = new UndoStore(home);
  const undo = new UndoService({
    store,
    forbidden: (p) => p === secret || p.startsWith(`${secret}/`),
    restored: (set, direction) => restored.push({ id: set.id, direction }),
    ...options,
  });
  const tracker = () =>
    undo.tracker({
      conversationId: 'c1',
      workspace: work,
      label: (name, input) => `${name} ${String(input.file_path ?? input.command ?? '')}`,
      onChange: (set) => changes.push(set),
    });
  return { store, undo, tracker, changes, restored };
}

describe('the preview diff', () => {
  it('shows a change with its context, like a person reads one', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = before.replace('e', 'E').replace('j', 'J');
    expect(unifiedDiff(before, after, 'x.txt')).toBe(
      [
        '--- a/x.txt',
        '+++ b/x.txt',
        '@@ -2,9 +2,9 @@',
        ' b',
        ' c',
        ' d',
        '-e',
        '+E',
        ' f',
        ' g',
        ' h',
        ' i',
        '-j',
        '+J',
      ].join('\n'),
    );
    expect(unifiedDiff('same', 'same')).toBeUndefined();
    expect(unifiedDiff('', 'new\n', 'n.md')).toBe('--- a/n.md\n+++ b/n.md\n@@ -0,0 +1,1 @@\n+new');
  });
});

describe('noticing what changed', () => {
  it('a file tool’s edit: kept before, compared after, one change set', async () => {
    const { tracker, changes } = setup();
    const file = join(work, 'notes.md');
    writeFileSync(file, 'one\n');
    const t = tracker();
    await t.begin();
    await t.before('t1', 'Edit', { file_path: file });
    writeFileSync(file, 'one\ntwo\n');
    const set = await t.after('t1');
    expect(set?.files).toMatchObject([
      {
        path: file,
        shown: 'notes.md',
        before: { hash: expect.any(String) },
        after: { hash: expect.any(String) },
      },
    ]);
    expect(await t.end()).toBeUndefined();
    expect(changes).toHaveLength(1);
  });

  it('a command’s changes: created, changed and deleted, put down to that command', async () => {
    const { tracker } = setup();
    writeFileSync(join(work, 'a.txt'), 'a');
    writeFileSync(join(work, 'gone.txt'), 'bye');
    const t = tracker();
    await t.begin();
    await t.before('b1', 'Bash', { command: 'tidy' });
    writeFileSync(join(work, 'a.txt'), 'A');
    unlinkSync(join(work, 'gone.txt'));
    mkdirSync(join(work, 'src'));
    writeFileSync(join(work, 'src', 'new.ts'), 'export {}');
    const set = await t.after('b1');
    expect(set?.label).toBe('Bash tidy');
    expect(set?.files.map((f) => [f.shown, Boolean(f.before), Boolean(f.after)])).toEqual([
      ['a.txt', true, true],
      ['gone.txt', true, false],
      ['src/new.ts', false, true],
    ]);
  });

  it('what a turn changed some other way (another provider) is the turn’s', async () => {
    const { tracker } = setup();
    const t = tracker();
    await t.begin();
    writeFileSync(join(work, 'codex.txt'), 'made by a provider without tool events');
    const set = await t.end();
    expect(set).toMatchObject({
      label: 'Changed during this turn',
      files: [{ shown: 'codex.txt' }],
    });
  });

  it('never keeps where keys live, links, or rebuilt folders', async () => {
    const { tracker, store } = setup();
    const t = tracker();
    mkdirSync(join(work, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(secret, 'id_ed25519'), 'PRIVATE KEY');
    symlinkSync(join(secret, 'id_ed25519'), join(work, 'key-link'));
    await t.begin();
    await t.before('t1', 'Write', { file_path: join(secret, 'id_ed25519') });
    writeFileSync(join(secret, 'id_ed25519'), 'CHANGED');
    expect(await t.after('t1')).toBeUndefined();
    writeFileSync(join(work, 'node_modules', 'x', 'i.js'), 'x');
    expect(await t.end()).toBeUndefined();
    // Not a copy of the key anywhere in the store.
    const usage = await store.usage();
    expect(usage.sets).toBe(0);
  });

  it('a work folder that’s the whole home folder: only file tools, and it says so', async () => {
    const { undo } = setup();
    const t = undo.tracker({
      conversationId: 'c1',
      workspace: (await import('node:os')).homedir(),
      label: () => 'x',
      onChange: () => undefined,
    });
    await t.begin();
    expect(t.unavailable).toMatch(/whole home folder/);
  });
});

describe('putting it back', () => {
  async function edited() {
    const s = setup();
    const file = join(work, 'notes.md');
    writeFileSync(file, 'before\n');
    chmodSync(file, 0o640);
    const t = s.tracker();
    await t.begin();
    await t.before('t1', 'Write', { file_path: file });
    writeFileSync(file, 'after\n');
    const set = await t.after('t1');
    if (!set) throw new Error('no change');
    return { ...s, file, set };
  }

  it('previews exactly what will change, undoes it, and redoes it', async () => {
    const { undo, file, set, restored } = await edited();
    const preview = await undo.preview([set.id], 'undo');
    expect(preview.files).toEqual([
      expect.objectContaining({
        path: 'notes.md',
        action: 'restore',
        diff: expect.stringContaining('-after\n+before'),
      }),
    ]);
    expect(await undo.apply([set.id], 'undo')).toEqual({
      restored: [{ path: 'notes.md', kind: 'changed' }],
      skipped: [],
    });
    expect(readFileSync(file, 'utf8')).toBe('before\n');
    expect(statSync(file).mode & 0o777).toBe(0o640);
    expect(await undo.state(set.id)).toBe('undone');
    await undo.apply([set.id], 'redo');
    expect(readFileSync(file, 'utf8')).toBe('after\n');
    expect(restored.map((r) => r.direction)).toEqual(['undo', 'redo']);
  });

  it('a file it created is removed; one it deleted comes back', async () => {
    const s = setup();
    const t = s.tracker();
    writeFileSync(join(work, 'old.txt'), 'old');
    await t.begin();
    await t.before('b', 'Bash', { command: 'x' });
    writeFileSync(join(work, 'new.txt'), 'new');
    unlinkSync(join(work, 'old.txt'));
    const set = await t.after('b');
    const preview = await s.undo.preview([set?.id ?? ''], 'undo');
    expect(preview.files.map((f) => [f.path, f.action])).toEqual([
      ['new.txt', 'remove'],
      ['old.txt', 'recreate'],
    ]);
    await s.undo.apply([set?.id ?? ''], 'undo');
    expect(existsSync(join(work, 'new.txt'))).toBe(false);
    expect(readFileSync(join(work, 'old.txt'), 'utf8')).toBe('old');
  });

  it('a file you changed since is a conflict: left alone unless you say so', async () => {
    const { undo, file, set } = await edited();
    writeFileSync(file, 'yours, later\n');
    const preview = await undo.preview([set.id], 'undo');
    expect(preview.files[0]?.conflict).toMatch(/changed since/);
    const result = await undo.apply([set.id], 'undo');
    expect(result.skipped).toEqual([
      { path: 'notes.md', reason: expect.stringMatching(/changed since/) },
    ]);
    expect(readFileSync(file, 'utf8')).toBe('yours, later\n');
    expect(await undo.state(set.id)).toBe('applied');
    await undo.apply([set.id], 'undo', true);
    expect(readFileSync(file, 'utf8')).toBe('before\n');
  });

  it('never writes through a link put where the file was', async () => {
    const { undo, file, set } = await edited();
    unlinkSync(file);
    writeFileSync(join(secret, 'target'), 'keep me');
    symlinkSync(join(secret, 'target'), file);
    const preview = await undo.preview([set.id], 'undo');
    expect(preview.files[0]?.blocked).toMatch(/link/);
    await undo.apply([set.id], 'undo', true);
    expect(readFileSync(join(secret, 'target'), 'utf8')).toBe('keep me');
  });

  it('never follows a folder that now points somewhere else', async () => {
    const s = setup();
    const dir = join(work, 'sub');
    mkdirSync(dir);
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'one');
    const t = s.tracker();
    await t.begin();
    await t.before('t', 'Write', { file_path: file });
    writeFileSync(file, 'two');
    const set = await t.after('t');
    rmSync(dir, { recursive: true });
    symlinkSync(secret, dir);
    const result = await s.undo.apply([set?.id ?? ''], 'undo', true);
    expect(result.skipped[0]?.reason).toMatch(/points somewhere else/);
    expect(existsSync(join(secret, 'f.txt'))).toBe(false);
  });

  it('never puts back a damaged copy', async () => {
    const { undo, store, set } = await edited();
    await store.corrupt(set.files[0]?.before?.hash ?? '');
    expect((await undo.preview([set.id], 'undo')).files[0]?.blocked).toMatch(/damaged/);
    expect((await undo.apply([set.id], 'undo', true)).skipped).toHaveLength(1);
  });

  it('undoes several changes to one file newest first, back to how it began', async () => {
    const s = setup();
    const file = join(work, 'n.md');
    writeFileSync(file, 'v1');
    const t = s.tracker();
    await t.begin();
    const ids: string[] = [];
    for (const [i, v] of ['v2', 'v3'].entries()) {
      await t.before(`t${i}`, 'Edit', { file_path: file });
      writeFileSync(file, v);
      ids.push((await t.after(`t${i}`))?.id ?? '');
      await new Promise((r) => setTimeout(r, 2));
    }
    expect((await s.undo.preview(ids, 'undo')).files).toHaveLength(1);
    await s.undo.apply(ids, 'undo');
    expect(readFileSync(file, 'utf8')).toBe('v1');
  });

  it('unknown and expired changes say so', async () => {
    const { undo, set } = await edited();
    await expect(undo.preview(['cs_nope'], 'undo')).rejects.toThrow(/isn’t there/);
    await expect(undo.preview(['../../etc/passwd'], 'undo')).rejects.toThrow(/isn’t there/);
    await undo.sweep(Date.now() + 31 * 24 * 60 * 60_000);
    await expect(undo.apply([set.id], 'undo')).rejects.toThrow(/too old/);
  });
});

describe('staying small', () => {
  it('lets the oldest changes go first past its share, and sweeps copies nothing needs', async () => {
    const s = setup({ maxBytes: 1_000 });
    const t = s.tracker();
    await t.begin();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const file = join(work, `f${i}.bin`);
      await t.before(`t${i}`, 'Write', { file_path: file });
      writeFileSync(file, Buffer.alloc(400, i + 1));
      ids.push((await t.after(`t${i}`))?.id ?? '');
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await s.undo.sweep()).toBeGreaterThan(0);
    expect(await s.undo.state(ids[0] ?? '')).toBe('expired');
    expect(await s.undo.state(ids[3] ?? '')).toBe('applied');
    const check = await s.undo
      .doctorCheck()
      .run({ repair: false, signal: new AbortController().signal });
    expect(check[0]?.message).toMatch(/can be undone/);
  });
});
