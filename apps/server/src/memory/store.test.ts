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

/**
 * How the version before quiet learning reads the memory folder (ADR 0051):
 * every `*.md` directly in it, each parsed with the schema it knew.
 */
async function readAsBefore(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const out: string[] = [];
  for (const file of files) {
    const memory = parse(await readFile(join(dir, file), 'utf8'));
    if (memory && ['fact', 'preference', 'project', 'person'].includes(memory.kind))
      out.push(memory.content);
  }
  return out;
}

describe('superseded, not overwritten (ADR 0087)', () => {
  it('keeps what used to be true, dated, out of the live memories', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const berlin = await store.add({ content: 'Lives in Berlin', source: 'user' });
    const moved = await store.supersede(berlin.id, {
      content: 'Lives in Lisbon',
      source: 'agent',
      conversationId: 'c1',
      learned: 'le_1',
    });
    expect(moved?.after.content).toBe('Lives in Lisbon');
    expect(moved?.after.learned).toBe('le_1');
    expect((await store.list()).map((m) => m.content)).toEqual(['Lives in Lisbon']);
    const [past] = await store.listPast();
    expect(past?.content).toBe('Lives in Berlin');
    expect(past?.supersededBy).toBe(moved?.after.id);
    expect(past?.invalidAt).toBeGreaterThan(0);
    // A fresh store sees the same.
    expect((await new MemoryStore(dir).listPast()).map((m) => m.id)).toEqual([berlin.id]);
  });

  it('the version before never reads a superseded memory as true', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const berlin = await store.add({ content: 'Lives in Berlin', source: 'user' });
    await store.add({
      content: 'On this computer, `python` isn’t found; `py` works.',
      source: 'agent',
      about: 'environment',
    });
    await store.supersede(berlin.id, { content: 'Lives in Lisbon', source: 'agent' });
    const before = await readAsBefore(dir);
    expect(before).toContain('Lives in Lisbon');
    expect(before).not.toContain('Lives in Berlin');
    // A learned fact is still a fact there, just without what it's about.
    expect(before).toContain('On this computer, `python` isn’t found; `py` works.');
  });

  it('Undo puts it back exactly as it was', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const berlin = await store.add({ content: 'Lives in Berlin', kind: 'fact', source: 'user' });
    const moved = await store.supersede(berlin.id, { content: 'Lives in Lisbon', source: 'agent' });
    if (!moved) throw new Error('no supersede');
    const back = await store.unsupersede(moved.after.id, moved.past);
    expect(back).toEqual(berlin);
    expect(await store.list()).toEqual([berlin]);
    expect(await store.listPast()).toEqual([]);
    expect(await new MemoryStore(dir).list()).toEqual([berlin]);
  });

  it('a stop part way leaves the old one live, never neither', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const berlin = await store.add({ content: 'Lives in Berlin', source: 'user' });
    // The past copy was written, and then Conch stopped.
    const { writeFileAtomic } = await import('../lib/fs');
    await writeFileAtomic(
      join(dir, 'superseded', `${berlin.id}.md`),
      serialise({ ...berlin, invalidAt: 5, supersededBy: 'm_x' }),
    );
    const again = new MemoryStore(dir);
    expect((await again.list()).map((m) => m.id)).toEqual([berlin.id]);
    expect(await again.listPast()).toEqual([]);
  });

  it('round-trips what a learned memory says about itself', () => {
    const m = {
      id: 'm_2',
      content: 'Lives in Berlin',
      kind: 'fact' as const,
      source: 'agent' as const,
      createdAt: 1,
      updatedAt: 2,
      about: 'pitfall' as const,
      learned: 'le_9',
      invalidAt: 3,
      supersededBy: 'm_3',
    };
    expect(parse(serialise(m))).toEqual(m);
  });

  it('nothing to supersede is nothing done', async () => {
    const store = new MemoryStore(await temp());
    expect(await store.supersede('m_gone', { content: 'x', source: 'agent' })).toBeUndefined();
  });
});
