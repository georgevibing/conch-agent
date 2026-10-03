import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { writeJson } from './fs';
import { brokenPath, isBrokenCopy, readStore, salvage, setAside } from './recover';
import { deviceSealer, KeyUnavailableError, registerSealer, unregisterSealer } from './sealed';

const home = () => mkdtemp(join(tmpdir(), 'conch-recover-'));
const copiesIn = async (dir: string) => (await readdir(dir)).filter(isBrokenCopy).sort();

const Prefs = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).default('Conch'),
  nested: z
    .object({ tone: z.enum(['warm', 'dry']).default('warm'), size: z.number().default(13) })
    .default({ tone: 'warm', size: 13 }),
  tags: z.array(z.string()).default([]),
  keys: z.record(z.string(), z.object({ value: z.string() })).default({}),
});

describe('brokenPath', () => {
  it('keeps the extension last, and sorts by time', () => {
    const at = new Date('2026-09-30T10:15:30.123Z');
    expect(brokenPath('/h/settings.json', at)).toBe(
      '/h/settings.broken-2026-09-30T10-15-30-123Z.json',
    );
    expect(brokenPath('/h/search.db', at)).toBe('/h/search.db.broken-2026-09-30T10-15-30-123Z');
    expect(brokenPath('/h/settings.json', at, 2)).toBe(
      '/h/settings.broken-2026-09-30T10-15-30-123Z-2.json',
    );
    expect(isBrokenCopy('settings.broken-2026-09-30T10-15-30-123Z.json')).toBe(true);
    expect(isBrokenCopy('r_abc.json')).toBe(false);
  });
});

describe('setAside', () => {
  it('keeps a copy once per damage and only the newest two', async () => {
    const dir = await home();
    const path = join(dir, 'settings.json');
    for (const text of ['{ one', '{ two', '{ three']) {
      await writeFile(path, text);
      const first = await setAside(path, { bytes: Buffer.from(text) });
      expect(first.fresh).toBe(true);
      // The same damage, seen again (a restart, the CLI): nothing new.
      const again = await setAside(path, { bytes: Buffer.from(text) });
      expect(again).toEqual({ copy: first.copy, fresh: false });
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const kept = await copiesIn(dir);
    expect(kept).toHaveLength(2);
    expect(await readFile(join(dir, kept[1] ?? ''), 'utf8')).toBe('{ three');
    // The damaged file is left for the caller.
    expect(await readFile(path, 'utf8')).toBe('{ three');
    if (process.platform !== 'win32')
      expect((await stat(join(dir, kept[1] ?? ''))).mode & 0o777).toBe(0o600);
  });

  it('moves a file aside when there are no bytes to copy', async () => {
    const dir = await home();
    const path = join(dir, 'search.db');
    await writeFile(path, 'not a database');
    const { copy } = await setAside(path, { keep: 1 });
    expect(await readdir(dir)).toEqual([copy.slice(dir.length + 1)]);
  });
});

describe('salvage', () => {
  it('keeps every field that still reads, at any depth', () => {
    const raw = {
      version: 7,
      name: 'Ada',
      nested: { tone: 'grumpy', size: 16 },
      tags: ['a', 3, 'b'],
      keys: { good: { value: 'x' }, bad: { value: 4 } },
      extra: true,
    };
    expect(Prefs.parse(salvage(Prefs, raw))).toEqual({
      version: 1,
      name: 'Ada',
      nested: { tone: 'warm', size: 16 },
      tags: ['a', 'b'],
      keys: { good: { value: 'x' } },
    });
  });

  it('gives nothing back for the wrong shape entirely', () => {
    expect(salvage(Prefs, [1, 2])).toBeUndefined();
    expect(salvage(Prefs, 'hello')).toBeUndefined();
  });
});

describe('readStore', () => {
  it('reads a good file, and a missing one as the defaults, without a repair', async () => {
    const dir = await home();
    const path = join(dir, 'prefs.json');
    const onRepair = vi.fn();
    expect(await readStore(path, Prefs, { onRepair })).toMatchObject({
      state: 'missing',
      value: { name: 'Conch' },
    });
    await writeFile(path, JSON.stringify({ name: 'Ada' }));
    expect(await readStore(path, Prefs, { onRepair })).toMatchObject({
      state: 'read',
      value: { name: 'Ada' },
    });
    expect(onRepair).not.toHaveBeenCalled();
  });

  it('sets aside a file that won’t parse, goes back to the defaults, and says so once', async () => {
    const dir = await home();
    const path = join(dir, 'prefs.json');
    await writeFile(path, '{"name": "Ada", ');
    const onRepair = vi.fn();
    const read = await readStore(path, Prefs, { onRepair });
    expect(read).toMatchObject({ state: 'reset', value: { name: 'Conch' } });
    expect(onRepair).toHaveBeenCalledExactlyOnceWith('reset', read.copy);
    expect(await readFile(read.copy ?? '', 'utf8')).toBe('{"name": "Ada", ');
    // Gone, so the next start reads the defaults without another repair.
    expect(await readdir(dir)).toEqual([read.copy?.slice(dir.length + 1)]);
    expect((await readStore(path, Prefs, { onRepair })).state).toBe('missing');
    expect(onRepair).toHaveBeenCalledOnce();
  });

  it('keeps what still reads, saves it back, and keeps the original', async () => {
    const dir = await home();
    const path = join(dir, 'prefs.json');
    const damaged = JSON.stringify({ name: 'Ada', nested: { tone: 'grumpy' } });
    await writeFile(path, damaged);
    const onRepair = vi.fn();
    const read = await readStore(path, Prefs, { onRepair });
    expect(read).toMatchObject({
      state: 'salvaged',
      value: { name: 'Ada', nested: { tone: 'warm' } },
    });
    expect(onRepair).toHaveBeenCalledWith('salvaged', read.copy);
    expect(await readFile(read.copy ?? '', 'utf8')).toBe(damaged);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ name: 'Ada' });
    expect((await readStore(path, Prefs, { onRepair })).state).toBe('read');
  });

  it('treats any damage as a reset when salvaging is off', async () => {
    const dir = await home();
    const path = join(dir, 'prefs.json');
    await writeFile(path, JSON.stringify({ name: 'Ada', nested: { tone: 'grumpy' } }));
    expect(await readStore(path, Prefs, { salvage: false })).toMatchObject({
      state: 'reset',
      value: { name: 'Conch' },
    });
  });
});

describe('readStore on a sealed key file', () => {
  it('leaves the file alone when the key that opens it can’t be had right now', async () => {
    const dir = await home();
    let away = false;
    registerSealer(
      dir,
      deviceSealer(async () => {
        // Windows' DPAPI through PowerShell can fail for a moment (a busy
        // computer, a console that won't attach); the key itself is fine.
        if (away) throw new Error('Windows wouldn’t open the key for your passwords.');
        return Buffer.alloc(32, 7);
      }),
    );
    try {
      const path = join(dir, 'secrets.json');
      await writeJson(path, { keys: { openrouter: { value: 'sk-or-kept' } } });
      const sealed = await readFile(path, 'utf8');
      const onRepair = vi.fn();

      away = true;
      await expect(readStore(path, Prefs, { onRepair })).rejects.toBeInstanceOf(
        KeyUnavailableError,
      );
      // Not damage: nothing set aside, nothing reset, the keys still there.
      expect(onRepair).not.toHaveBeenCalled();
      expect(await copiesIn(dir)).toEqual([]);
      expect(await readFile(path, 'utf8')).toBe(sealed);

      away = false;
      const read = await readStore(path, Prefs);
      expect(read.value.keys).toEqual({ openrouter: { value: 'sk-or-kept' } });
    } finally {
      unregisterSealer(dir);
    }
  });

  it('leaves it alone when nothing here can open it yet', async () => {
    const dir = await home();
    registerSealer(
      dir,
      deviceSealer(async () => Buffer.alloc(32, 7)),
    );
    const path = join(dir, 'secrets.json');
    await writeJson(path, { keys: { a: { value: 'b' } } });
    unregisterSealer(dir);
    const sealed = await readFile(path, 'utf8');

    await expect(readStore(path, Prefs)).rejects.toBeInstanceOf(KeyUnavailableError);
    expect(await copiesIn(dir)).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe(sealed);
  });
});
