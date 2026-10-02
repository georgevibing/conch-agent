/**
 * Memory search that finds what you meant (ADR 0032). Each search ranks
 * your memories two ways at once and blends them:
 *
 * - by the words in them (BM25: rarer shared words count for more), and
 * - by vectors (`embed.ts`): an embedding model's when Ollama has one, else
 *   Conch's own model once it's downloaded (`ondevice.ts`, ADR 0041) —
 *   "meaning" — else Conch's own words-and-spellings vectors ("words").
 *
 * Both know the few concepts in `concepts.ts`, so "car" finds "vehicle" even
 * with words alone. Only a model's vectors cost anything to make, so only
 * those are kept, in
 * `memory-index.db` (derived: rebuilt whenever it's missing, damaged or from
 * another model). A memory waiting for your OK is never found.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Memory, MemoryIndexStatus } from '@conch/protocol';

import { withConcepts } from './concepts';
import { cosine, MEANING_MODELS, tokens, wordsEmbedder, type Embedder } from './embed';
import type { MemoryStore } from './store';

/** What the prompt carries of your memories; the rest is a `recall` away. */
export const PROMPT_BUDGET = 6000;

const contentHash = (m: Memory) => createHash('sha1').update(m.content).digest('hex');

/** Levenshtein distance, giving up past `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + cost);
      next.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    row = next;
  }
  return row[b.length] ?? max + 1;
}

/**
 * Typos forgiven: a query word no memory has becomes the closest word one
 * does ("lisbn" → "lisbon"), one letter off for short words, two for long.
 */
export function forgive(query: string[], docs: string[][]): string[] {
  const vocabulary = new Set(docs.flat());
  return query.map((token) => {
    if (vocabulary.has(token) || token.length < 4) return token;
    const max = token.length >= 7 ? 2 : 1;
    let best: [string, number] | undefined;
    for (const word of vocabulary) {
      const d = distance(token, word, max);
      if (d <= max && (!best || d < best[1])) best = [word, d];
    }
    return best?.[0] ?? token;
  });
}

/** BM25 over a handful of documents: rarer shared words count for more. */
export function bm25(queryTokens: string[], docs: string[][], k1 = 1.4, b = 0.75): number[] {
  const n = docs.length;
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, n);
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const unique = [...new Set(queryTokens)];
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of unique) {
      const f = tf.get(q) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / Math.max(1, avg)));
    }
    return score;
  });
}

export interface MemoryIndexDeps {
  path: string;
  store: MemoryStore;
  /** The best embedding model here now: Ollama's, else Conch's own; none means words. */
  meaning: () => Promise<Embedder | undefined>;
  /** What Conch would get for meaning, for people who speak these languages. */
  offer?: (languages: string[]) => Promise<MemoryIndexStatus['offer']>;
  heal?: (message: string) => void;
}

export class MemoryIndex {
  #db?: DatabaseSync;
  #syncing?: Promise<void>;

  constructor(private readonly deps: MemoryIndexDeps) {}

  /** The vectors database, opened (or made again, when it's damaged). */
  #open(): DatabaseSync {
    if (this.#db) return this.#db;
    const { path } = this.deps;
    const create = () => {
      if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 });
        else chmodSync(path, 0o600);
      }
      const db = new DatabaseSync(path);
      db.exec(`PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT NOT NULL, model TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL,
          PRIMARY KEY (id, model)
        );`);
      return db;
    };
    try {
      this.#db = create();
    } catch {
      // Derived data: a damaged file is simply made again.
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
      this.#db = create();
      this.deps.heal?.('The memory search index was damaged, so Conch built it again.');
    }
    return this.#db;
  }

  close() {
    this.#db?.close();
    this.#db = undefined;
  }

  async #active(): Promise<Memory[]> {
    return (await this.deps.store.list()).filter((m) => !m.pending);
  }

  /** Vectors for these memories from `embedder`, making (and keeping) any that are missing or stale. */
  async #vectors(embedder: Embedder, memories: Memory[]): Promise<Map<string, Float32Array>> {
    if (embedder === wordsEmbedder) {
      const vectors = await embedder.embed(memories.map((m) => m.content));
      return new Map(memories.map((m, i) => [m.id, vectors[i] ?? new Float32Array()]));
    }
    const db = this.#open();
    const rows = db
      .prepare('SELECT id, hash, vec FROM vectors WHERE model = ?')
      .all(embedder.id) as {
      id: string;
      hash: string;
      vec: Uint8Array;
    }[];
    const known = new Map(rows.map((r) => [r.id, r]));
    const out = new Map<string, Float32Array>();
    const missing: Memory[] = [];
    for (const m of memories) {
      const row = known.get(m.id);
      if (row && row.hash === contentHash(m))
        out.set(
          m.id,
          new Float32Array(
            row.vec.buffer.slice(row.vec.byteOffset, row.vec.byteOffset + row.vec.byteLength),
          ),
        );
      else missing.push(m);
    }
    if (missing.length) {
      const put = db.prepare(
        'INSERT OR REPLACE INTO vectors (id, model, hash, vec) VALUES (?, ?, ?, ?)',
      );
      // A batch at a time, kept as it's made: a re-index shows its progress
      // and survives being cut short, and the chat isn't kept waiting.
      for (let start = 0; start < missing.length; start += 64) {
        const batch = missing.slice(start, start + 64);
        const made = await embedder.embed(batch.map((m) => m.content));
        batch.forEach((m, i) => {
          const vec = made[i];
          if (!vec) return;
          // Exactly this vector's bytes: a view can sit inside a bigger buffer.
          put.run(
            m.id,
            embedder.id,
            contentHash(m),
            new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength).slice(),
          );
          out.set(m.id, vec);
        });
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    // Forgotten memories leave no vectors behind.
    const ids = new Set(memories.map((m) => m.id));
    const gone = rows.filter((r) => !ids.has(r.id));
    if (gone.length) {
      const drop = db.prepare('DELETE FROM vectors WHERE id = ? AND model = ?');
      for (const r of gone) drop.run(r.id, embedder.id);
    }
    return out;
  }

  /** The model to use now, or Conch's own when there's none (or it fails). */
  async #embedder(): Promise<Embedder> {
    return (await this.deps.meaning().catch(() => undefined)) ?? wordsEmbedder;
  }

  /** Your memories, best match first: words and vectors blended. Pending ones are never found. */
  async search(query: string, limit = 8): Promise<{ memory: Memory; score: number }[]> {
    const memories = await this.#active();
    const q = tokens(query);
    if (!memories.length) return [];
    if (!q.length) return memories.slice(0, limit).map((memory) => ({ memory, score: 0 }));
    let embedder = await this.#embedder();
    let vectors: Map<string, Float32Array>;
    let qv: Float32Array | undefined;
    try {
      vectors = await this.#vectors(embedder, memories);
      [qv] = await embedder.embed([query]);
    } catch {
      // The model stopped answering: words still work.
      embedder = wordsEmbedder;
      vectors = await this.#vectors(embedder, memories);
      [qv] = await embedder.embed([query]);
    }
    // Words and the concepts they're about: "car" meets "vehicle" here too.
    const docs = memories.map((m) => withConcepts(tokens(m.content)));
    const lexical = bm25(withConcepts(forgive(q, docs)), docs);
    const top = Math.max(...lexical, 0) || 1;
    const now = Date.now();
    const scored = memories.map((memory, i) => {
      const words = (lexical[i] ?? 0) / top;
      const vec = qv ? Math.max(0, cosine(qv, vectors.get(memory.id) ?? new Float32Array())) : 0;
      const fresh = Math.exp(-(now - memory.updatedAt) / (90 * 86_400_000));
      return { memory, score: 0.5 * words + 0.5 * vec + 0.03 * fresh, words, vec };
    });
    // What counts as a match: a shared word or concept, or a vector close enough on its model's scale.
    return scored
      .filter((s) => s.words > 0 || s.vec >= embedder.floor)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ memory, score }) => ({ memory, score }));
  }

  /**
   * The memories this turn's prompt carries. All of them while they fit (the
   * same every turn, so the provider's prompt cache keeps working); beyond
   * that, the ones that match what was just said, then the newest.
   */
  async forPrompt(
    said: string,
    budget = PROMPT_BUDGET,
  ): Promise<{ memories: Memory[]; total: number }> {
    const active = await this.#active();
    const line = (m: Memory) => m.content.length + m.kind.length + m.id.length + 8;
    const size = active.reduce((sum, m) => sum + line(m), 0);
    if (size <= budget) return { memories: active, total: active.length };
    const relevant = said.trim() ? (await this.search(said, 25)).map((r) => r.memory) : [];
    const chosen: Memory[] = [];
    const seen = new Set<string>();
    let used = 0;
    for (const m of [...relevant, ...active]) {
      if (seen.has(m.id) || used + line(m) > budget) continue;
      seen.add(m.id);
      chosen.push(m);
      used += line(m);
    }
    return { memories: chosen, total: active.length };
  }

  /** Make any missing vectors now, quietly (after a change, or when a model arrives). */
  sync(): Promise<void> {
    this.#syncing ??= (async () => {
      try {
        const embedder = await this.#embedder();
        if (embedder !== wordsEmbedder) await this.#vectors(embedder, await this.#active());
      } catch {
        // Next search tries again.
      } finally {
        this.#syncing = undefined;
      }
    })();
    return this.#syncing;
  }

  /** How search works now; `languages` (the browser's) choose what would be offered. */
  async status(languages: string[] = []): Promise<MemoryIndexStatus> {
    const active = await this.#active();
    const embedder = await this.#embedder();
    if (embedder === wordsEmbedder) {
      const offer = await this.deps.offer?.(languages).catch(() => undefined);
      return {
        mode: 'words',
        indexed: active.length,
        total: active.length,
        ...(offer && { offer }),
      };
    }
    const db = this.#open();
    const ids = new Set(
      (
        db.prepare('SELECT id, hash FROM vectors WHERE model = ?').all(embedder.id) as {
          id: string;
          hash: string;
        }[]
      )
        .filter((r) => active.some((m) => m.id === r.id && contentHash(m) === r.hash))
        .map((r) => r.id),
    );
    // Some aren't indexed yet (a model just arrived, a sync was cut short): carry on.
    if (ids.size < active.length) void this.sync();
    return {
      mode: 'meaning',
      model: embedder.label ?? embedder.id,
      source: embedder.source === 'ollama' ? 'ollama' : 'built-in',
      indexed: ids.size,
      total: active.length,
    };
  }

  /** Throw the vectors away and make them again. */
  async rebuild(): Promise<void> {
    this.#open().exec('DELETE FROM vectors');
    await this.sync();
  }
}

/** Which installed Ollama model makes embeddings, by name (no extra request), else by asking it. */
export async function findMeaningModel(client: {
  tags(): Promise<{ name: string }[]>;
  show(model: string): Promise<{ capabilities?: string[] | null }>;
}): Promise<string | undefined> {
  const tags = await client.tags();
  const named = tags.find((t) =>
    MEANING_MODELS.some((m) => t.name === m || t.name.startsWith(`${m}:`)),
  );
  if (named) return named.name;
  for (const tag of tags.slice(0, 8)) {
    const shown = await client.show(tag.name).catch(() => undefined);
    if (shown?.capabilities?.includes('embedding')) return tag.name;
  }
  return undefined;
}
