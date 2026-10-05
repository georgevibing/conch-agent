import { readdir, readFile, rm } from 'node:fs/promises';

import { Memory, type MemoryAbout, type MemoryKind } from '@conch/protocol';

import { Emitter } from '../lib/emitter';
import { Mutex, safeJoin, writeFileAtomic } from '../lib/fs';
import { newId } from '../lib/ids';

/**
 * Where memories that stopped being true are kept (ADR 0087). The version
 * before reads only `memory/*.md`, so after going back one never returns as
 * if it were still true.
 */
export const PAST_DIR = 'superseded';

/** What a new memory is made of. */
export interface NewMemory {
  content: string;
  kind?: MemoryKind;
  source: Memory['source'];
  conversationId?: string;
  /** Waiting for the person's OK (ADR 0032), and why. */
  pending?: boolean;
  untrusted?: string;
  /** What a learned fact is about, and the record that taught it (ADR 0087). */
  about?: MemoryAbout;
  learned?: string;
}

/**
 * Long-term memory, stored as one Markdown file per memory under
 * `~/.conch/memory/`. Plain files are deliberate: memories are the user's
 * data — readable, editable, greppable, easy to back up or delete.
 *
 * ```md
 * ---
 * id: m_1a2b3c4d5e6f
 * kind: preference
 * source: agent
 * createdAt: 1727600000000
 * updatedAt: 1727600000000
 * ---
 * Prefers TypeScript examples over Python.
 * ```
 */
export class MemoryStore {
  readonly changed = new Emitter<void>();
  #mutex = new Mutex();
  #cache?: Map<string, Memory>;

  constructor(private readonly dir: string) {}

  async list(): Promise<Memory[]> {
    const all = [...(await this.#load()).values()];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Memory | undefined> {
    return (await this.#load()).get(id);
  }

  add(input: NewMemory): Promise<Memory> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const content = normalise(input.content);
      // Re-saying something we already know refreshes it instead of duplicating.
      const existing = [...memories.values()].find(
        (m) => normalise(m.content).toLowerCase() === content.toLowerCase(),
      );
      // (Something already known never goes back to waiting for an OK.)
      if (existing) return this.#write({ ...existing, updatedAt: Date.now() });
      return this.#write(made(input, Date.now()));
    });
  }

  /**
   * What's true now replaces a memory (ADR 0087): the new one is written, and
   * the old one moves to `memory/superseded/` saying when it stopped being
   * true and what replaced it. Nothing is lost; `unsupersede` puts it back.
   */
  supersede(
    id: string,
    next: NewMemory,
  ): Promise<{ before: Memory; past: Memory; after: Memory } | undefined> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const before = memories.get(id);
      if (!before) return undefined;
      const now = Date.now();
      const after = made(next, now);
      const past: Memory = { ...before, invalidAt: now, supersededBy: after.id };
      // The old one is kept first: a stop part way leaves both, never neither.
      await writeFileAtomic(safeJoin(this.#pastDir, `${id}.md`), serialise(past));
      await writeFileAtomic(safeJoin(this.dir, `${after.id}.md`), serialise(after));
      await rm(safeJoin(this.dir, `${id}.md`), { force: true });
      memories.delete(id);
      memories.set(after.id, after);
      this.changed.emit();
      return { before, past, after };
    });
  }

  /** Undo a supersede: the new memory goes, the old one comes back exactly as it was. */
  unsupersede(afterId: string, before: Memory): Promise<Memory> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      await rm(safeJoin(this.dir, `${afterId}.md`), { force: true });
      memories.delete(afterId);
      const { invalidAt: _i, supersededBy: _s, ...live } = before;
      const restored = Memory.parse(live);
      await writeFileAtomic(safeJoin(this.dir, `${restored.id}.md`), serialise(restored));
      memories.set(restored.id, restored);
      await rm(safeJoin(this.#pastDir, `${restored.id}.md`), { force: true });
      this.changed.emit();
      return restored;
    });
  }

  /**
   * Memories that stopped being true, newest first. One that's live again
   * (a stop part way through a supersede) counts as live.
   */
  async listPast(): Promise<Memory[]> {
    const live = await this.#load();
    let files: string[] = [];
    try {
      files = (await readdir(this.#pastDir)).filter((f) => f.endsWith('.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const past: Memory[] = [];
    for (const file of files) {
      const memory = parse(await readFile(safeJoin(this.#pastDir, file), 'utf8').catch(() => ''));
      if (memory && !live.has(memory.id)) past.push(memory);
    }
    return past.sort((a, b) => (b.invalidAt ?? 0) - (a.invalidAt ?? 0));
  }

  get #pastDir() {
    return safeJoin(this.dir, PAST_DIR);
  }

  update(id: string, patch: { content?: string; kind?: MemoryKind }): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const current = (await this.#load()).get(id);
      if (!current) return undefined;
      return this.#write({
        ...current,
        ...(patch.content !== undefined && { content: normalise(patch.content) }),
        ...(patch.kind !== undefined && { kind: patch.kind }),
        updatedAt: Date.now(),
      });
    });
  }

  /** You looked at a memory waiting for your OK, and keep it. */
  keep(id: string): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const current = (await this.#load()).get(id);
      if (!current) return undefined;
      const { pending: _p, untrusted: _u, ...kept } = current;
      return this.#write({ ...kept, updatedAt: Date.now() });
    });
  }

  /** Put a memory back exactly as it was (Undo after a tidy-up). */
  restore(memory: Memory): Promise<Memory> {
    return this.#mutex.run(() => this.#write(Memory.parse(memory)));
  }

  remove(id: string): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const current = memories.get(id);
      if (!current) return undefined;
      await rm(safeJoin(this.dir, `${id}.md`), { force: true });
      memories.delete(id);
      this.changed.emit();
      return current;
    });
  }

  /** Keyword search, ranked by term overlap then recency (the index's hybrid search is better: `MemoryIndex`). */
  async search(query: string, limit = 8): Promise<Memory[]> {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const scored = (await this.list()).map((m) => {
      const text = m.content.toLowerCase();
      return { m, score: terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0) };
    });
    return scored
      .filter((s) => terms.length === 0 || s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
      .slice(0, limit)
      .map((s) => s.m);
  }

  async #write(memory: Memory): Promise<Memory> {
    await writeFileAtomic(safeJoin(this.dir, `${memory.id}.md`), serialise(memory));
    (await this.#load()).set(memory.id, memory);
    this.changed.emit();
    return memory;
  }

  async #load(): Promise<Map<string, Memory>> {
    if (this.#cache) return this.#cache;
    const map = new Map<string, Memory>();
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith('.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const file of files) {
      const memory = parse(await readFile(safeJoin(this.dir, file), 'utf8'));
      if (memory) map.set(memory.id, memory);
    }
    this.#cache = map;
    return map;
  }
}

function normalise(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

/** A new memory, as it'll be written. */
function made(input: NewMemory, now: number): Memory {
  return Memory.parse({
    id: newId('m'),
    content: normalise(input.content),
    kind: input.kind ?? 'fact',
    source: input.source,
    conversationId: input.conversationId,
    createdAt: now,
    updatedAt: now,
    ...(input.pending && { pending: true }),
    ...(input.untrusted && { untrusted: input.untrusted.slice(0, 300) }),
    ...(input.about && { about: input.about }),
    ...(input.learned && { learned: input.learned }),
  });
}

export function serialise(m: Memory): string {
  const meta = [
    `id: ${m.id}`,
    `kind: ${m.kind}`,
    `source: ${m.source}`,
    ...(m.conversationId ? [`conversationId: ${m.conversationId}`] : []),
    ...(m.pending ? ['pending: true'] : []),
    ...(m.untrusted ? [`untrusted: ${m.untrusted.replace(/\s+/g, ' ')}`] : []),
    // Optional, so the version before reads the memory and leaves them out (ADR 0051).
    ...(m.about ? [`about: ${m.about}`] : []),
    ...(m.learned ? [`learned: ${m.learned}`] : []),
    `createdAt: ${m.createdAt}`,
    `updatedAt: ${m.updatedAt}`,
    ...(m.invalidAt !== undefined ? [`invalidAt: ${m.invalidAt}`] : []),
    ...(m.supersededBy ? [`supersededBy: ${m.supersededBy}`] : []),
  ];
  return `---\n${meta.join('\n')}\n---\n${m.content}\n`;
}

export function parse(text: string): Memory | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const meta: Record<string, string | number> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    meta[key] = /At$/.test(key) ? Number(value) : value;
  }
  const { pending, ...rest } = meta;
  const result = Memory.safeParse({
    ...rest,
    ...(pending === 'true' && { pending: true }),
    content: normalise(match[2] ?? ''),
  });
  return result.success ? result.data : undefined;
}
