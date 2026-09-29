import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { Memory, type MemoryKind } from '@conch/protocol';

import { Emitter } from '../lib/emitter';
import { Mutex, writeFileAtomic } from '../lib/fs';
import { newId } from '../lib/ids';

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

  add(input: {
    content: string;
    kind?: MemoryKind;
    source: Memory['source'];
    conversationId?: string;
  }): Promise<Memory> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const content = normalise(input.content);
      // Re-saying something we already know refreshes it instead of duplicating.
      const existing = [...memories.values()].find(
        (m) => normalise(m.content).toLowerCase() === content.toLowerCase(),
      );
      if (existing) return this.#write({ ...existing, updatedAt: Date.now() });
      const now = Date.now();
      return this.#write(
        Memory.parse({
          id: newId('m'),
          content,
          kind: input.kind ?? 'fact',
          source: input.source,
          conversationId: input.conversationId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    });
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

  remove(id: string): Promise<Memory | undefined> {
    return this.#mutex.run(async () => {
      const memories = await this.#load();
      const current = memories.get(id);
      if (!current) return undefined;
      await rm(join(this.dir, `${id}.md`), { force: true });
      memories.delete(id);
      this.changed.emit();
      return current;
    });
  }

  /** Keyword search, ranked by term overlap then recency. Good enough until embeddings. */
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
    await writeFileAtomic(join(this.dir, `${memory.id}.md`), serialise(memory));
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
      const memory = parse(await readFile(join(this.dir, file), 'utf8'));
      if (memory) map.set(memory.id, memory);
    }
    this.#cache = map;
    return map;
  }
}

function normalise(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

export function serialise(m: Memory): string {
  const meta = [
    `id: ${m.id}`,
    `kind: ${m.kind}`,
    `source: ${m.source}`,
    ...(m.conversationId ? [`conversationId: ${m.conversationId}`] : []),
    `createdAt: ${m.createdAt}`,
    `updatedAt: ${m.updatedAt}`,
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
  const result = Memory.safeParse({ ...meta, content: normalise(match[2] ?? '') });
  return result.success ? result.data : undefined;
}
