import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type * as FileSystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryStore } from './store';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FileSystem>();
  return { ...fs, readdir: vi.fn(fs.readdir) };
});

const folders: string[] = [];
beforeEach(async () => {
  const fs = await vi.importActual<typeof FileSystem>('node:fs/promises');
  vi.mocked(readdir).mockReset().mockImplementation(fs.readdir);
});
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function open() {
  const home = await mkdtemp(join(tmpdir(), 'conch-memory-load-'));
  folders.push(home);
  return new MemoryStore(join(home, 'memory'));
}

describe('memory loading during startup', () => {
  it('does not let a delayed empty read replace a memory saved by another caller', async () => {
    const store = await open();
    let release = () => {};
    let entered = () => {};
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(readdir)
      .mockImplementationOnce(async () => {
        entered();
        await held;
        return [];
      })
      .mockResolvedValueOnce([]);
    const first = store.list();
    await reading;
    const adding = store.add({ content: 'Prefers short answers', source: 'user' });
    // Let the second caller reach loading. Before the fix it reads independently;
    // finish that write before releasing the stale empty directory snapshot.
    await setImmediate();
    if (vi.mocked(readdir).mock.calls.length > 1) await adding;
    release();
    await first;
    const memory = await adding;
    expect(await store.get(memory.id)).toEqual(memory);
    expect(readdir).toHaveBeenCalledTimes(1);
  });

  it('lets every waiting caller retry after an initial read fails', async () => {
    const store = await open();
    const failure = Object.assign(new Error('Temporarily unavailable'), { code: 'EACCES' });
    vi.mocked(readdir).mockRejectedValueOnce(failure);
    const results = await Promise.allSettled([store.list(), store.list()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(await store.list()).toEqual([]);
    const memory = await store.add({ content: 'Uses TypeScript', source: 'user' });
    expect(await store.get(memory.id)).toEqual(memory);
  });
});
