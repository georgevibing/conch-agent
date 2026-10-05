import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LearnedEntry } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { dayKey, KEEP_ENTRIES, LearningStore } from './store';

const temp = () => mkdtemp(join(tmpdir(), 'conch-learning-'));

const memory = (id: string, content: string) => ({
  id,
  content,
  kind: 'preference' as const,
  source: 'agent' as const,
  createdAt: 1,
  updatedAt: 1,
});

const entry = (id: string, memoryId = `m_${id}`): Omit<LearnedEntry, 'id'> & { id: string } => ({
  id,
  at: 1,
  change: 'added',
  after: memory(memoryId, 'Prefers TypeScript'),
  why: '',
  from: { quotes: ['no, I meant TypeScript'], signals: ['correction'], trigger: 'idle' },
  state: 'applied',
  seen: 1,
});

describe('LearningStore (ADR 0087)', () => {
  it('keeps the record newest first, and reads it back', async () => {
    const home = await temp();
    const store = new LearningStore({ home });
    await store.record(entry('le_1'));
    await store.record(entry('le_2'));
    expect((await store.entries()).map((e) => e.id)).toEqual(['le_2', 'le_1']);
    expect((await store.byMemory('m_le_1'))?.id).toBe('le_1');
    const again = new LearningStore({ home });
    expect((await again.entries()).map((e) => e.id)).toEqual(['le_2', 'le_1']);
  });

  it('makes an id when an entry has none', async () => {
    const store = new LearningStore({ home: await temp() });
    const { id: _id, ...rest } = entry('x');
    const made = await store.record(rest);
    expect(made.id).toMatch(/^le_/);
  });

  it('changes one entry, and says when it is gone', async () => {
    const store = new LearningStore({ home: await temp() });
    await store.record(entry('le_1'));
    expect((await store.update('le_1', (e) => ({ ...e, state: 'undone' })))?.state).toBe('undone');
    expect(await store.update('le_missing', (e) => e)).toBeUndefined();
  });

  it('keeps only so many entries', async () => {
    const store = new LearningStore({ home: await temp() });
    for (let i = 0; i < KEEP_ENTRIES + 3; i++) await store.record(entry(`le_${i}`));
    const entries = await store.entries();
    expect(entries).toHaveLength(KEEP_ENTRIES);
    expect(entries[0]?.id).toBe(`le_${KEEP_ENTRIES + 2}`);
  });

  it('a damaged record is set aside and started again, with a note', async () => {
    const home = await temp();
    await mkdir(join(home, 'learning'), { recursive: true });
    await writeFile(join(home, 'learning', 'ledger.json'), '{ not json');
    const notes: string[] = [];
    const store = new LearningStore({ home, heal: (_area, message) => notes.push(message) });
    expect(await store.entries()).toEqual([]);
    expect(notes[0]).toMatch(/record of what Conch learned/);
    expect((await readdir(join(home, 'learning'))).some((f) => f.includes('broken'))).toBe(true);
    await store.record(entry('le_1'));
    expect(await new LearningStore({ home }).entries()).toHaveLength(1);
  });

  it('the never-list: once each, and Remove', async () => {
    const store = new LearningStore({ home: await temp() });
    const a = await store.addNever('  Likes   dark mode ', 'undo');
    const b = await store.addNever('likes dark mode', 'forgot');
    expect(b?.id).toBe(a?.id);
    expect((await store.never()).map((i) => i.text)).toEqual(['Likes dark mode']);
    expect(await store.addNever('   ', 'undo')).toBeUndefined();
    expect(await store.removeNever(a?.id ?? '')).toBe(true);
    expect(await store.removeNever('nv_missing')).toBe(false);
    expect(await store.never()).toEqual([]);
  });

  it('remembers how far each chat was read, and which are quiet', async () => {
    const home = await temp();
    const store = new LearningStore({ home });
    await store.setChat('c1', { reviewed: 12 });
    await store.setChat('c2', { quiet: true });
    await store.setChat('c1', { unread: 1 });
    expect(await store.chat('c1')).toMatchObject({ reviewed: 12, unread: 1 });
    expect(await store.chat('nope')).toEqual({});
    expect(await new LearningStore({ home }).quiet()).toEqual(['c2']);
  });

  it('counts what was applied today, and starts again tomorrow', async () => {
    let now = new Date(2026, 9, 5, 10).getTime();
    const store = new LearningStore({ home: await temp(), now: () => now });
    await store.countApplied(3);
    await store.countApplied(2);
    expect(await store.appliedToday()).toBe(5);
    now += 86_400_000;
    expect(await store.appliedToday()).toBe(0);
    expect(dayKey(now)).toBe('2026-10-06');
  });
});
