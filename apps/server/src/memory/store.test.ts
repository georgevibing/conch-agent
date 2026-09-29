import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryStore, parse, serialise } from './store';

const temp = () => mkdtemp(join(tmpdir(), 'conch-memory-'));

describe('MemoryStore', () => {
  it('stores memories as readable markdown files', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const m = await store.add({
      content: '  Prefers   TypeScript ',
      kind: 'preference',
      source: 'user',
    });
    expect(m.content).toBe('Prefers TypeScript');
    const text = await readFile(join(dir, `${m.id}.md`), 'utf8');
    expect(text).toContain('kind: preference');
    expect(text.trim().endsWith('Prefers TypeScript')).toBe(true);
    // A fresh store reads it back from disk.
    expect(await new MemoryStore(dir).list()).toEqual([m]);
  });

  it('deduplicates identical memories', async () => {
    const store = new MemoryStore(await temp());
    const a = await store.add({ content: 'Lives in Berlin', source: 'agent' });
    const b = await store.add({ content: 'lives in berlin', source: 'agent' });
    expect(b.id).toBe(a.id);
    expect(await store.list()).toHaveLength(1);
  });

  it('updates, removes and searches', async () => {
    const store = new MemoryStore(await temp());
    const coffee = await store.add({ content: 'Loves espresso', source: 'user' });
    await store.add({
      content: 'Works on a project called Conch',
      kind: 'project',
      source: 'agent',
    });
    expect((await store.search('conch project'))[0]?.content).toContain('Conch');
    await store.update(coffee.id, { content: 'Loves flat whites' });
    expect((await store.get(coffee.id))?.content).toBe('Loves flat whites');
    expect(await store.remove(coffee.id)).toBeDefined();
    expect(await store.list()).toHaveLength(1);
  });

  it('round-trips the file format and ignores garbage', () => {
    const m = {
      id: 'm_1',
      content: 'x: y',
      kind: 'fact' as const,
      source: 'user' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(parse(serialise(m))).toEqual(m);
    expect(parse('not a memory')).toBeUndefined();
  });

  it('notifies listeners on change', async () => {
    const store = new MemoryStore(await temp());
    let count = 0;
    store.changed.on(() => count++);
    const m = await store.add({ content: 'a', source: 'user' });
    await store.remove(m.id);
    expect(count).toBe(2);
  });
});
