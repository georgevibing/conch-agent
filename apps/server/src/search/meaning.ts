/**
 * Searching your chats by meaning (ADR 0139): "our honeymoon" finds "the trip
 * to Bali" though no word is shared.
 *
 * The same model as memory's meaning search (ADR 0041: Ollama's embedding
 * model when there is one, else Conch's own, once downloaded) turns each
 * message the keyword index keeps (`index.ts`) into vectors, kept in
 * `chats-meaning.db`. Without a model nothing is made and nothing is lost:
 * search goes on by words, and the vectors are made once it arrives.
 *
 * - **What's embedded.** Your words and the answers, not the steps (commands
 *   and files are words, and keyword search finds them). A long message is a
 *   few pieces of about a thousand characters, so its middle counts too.
 *   "ok" and "thanks" aren't worth a vector.
 * - **In the background, gently.** One message batch at a time, resting as
 *   long as it worked, and waiting whenever the gateway says there's no room
 *   (`GatewayRecovery.room()`, ADR 0094): a backfill of years of chats never
 *   takes the computer.
 * - **Resumable.** Each message's vectors are kept as they're made, and a
 *   chat is marked done (with what the keyword index last saw of it) only
 *   once all of it is. A restart carries on where it stopped; nothing is made
 *   twice.
 * - **Derived.** Vectors are rebuilt from the chats, so they're never backed
 *   up. A damaged file is made again (once per run on its own, then by
 *   Repair), a deleted chat takes its vectors with it, and vectors from
 *   another model are dropped, never compared.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { excerpt, type SearchGroup, type SearchHit, type SearchResults } from '@conch/protocol';

import type { Embedder } from '../memory/embed';
import { isBroken, type IndexedConversation, type SliceRow } from './index';

/** What the keyword index tells meaning search (a `SearchIndex`). */
export interface ChatMeaningSource {
  chats(): { id: string; updatedAt: number }[];
  messages(conversationId: string): SliceRow[];
}

export interface ChatMeaningDeps {
  /** `~/.conch/chats-meaning.db`. */
  path: string;
  /** The keyword index now (it's replaced when it's rebuilt); none while it isn't open. */
  source: () => ChatMeaningSource | undefined;
  /** The best embedding model here now, the one memory uses; none means words only. */
  meaning: () => Promise<Embedder | undefined>;
  /** Whether there's room for background work now (`GatewayRecovery.room().room`). */
  room?: () => boolean;
  heal?: (message: string) => void;
  log?: (error: unknown) => void;
  /** How long a search waits for the model before answering by words alone. */
  waitMs?: number;
  /** Tests: time without waiting. */
  sleep?: (ms: number) => Promise<void>;
}

/** A message found by meaning: its best piece's closeness, on its model's scale. */
export interface MeaningHit {
  conversationId: string;
  anchor: string;
  /** Which piece of the message matched. */
  part: number;
  score: number;
}

export interface ChatMeaningStatus {
  /** `off`: no model here (words only); `catching-up`; `ready`; `unavailable`: broken until Repair. */
  state: 'off' | 'catching-up' | 'ready' | 'unavailable';
  model?: string;
  /** Chats whose every message has its vectors, of `total`. */
  indexed: number;
  total: number;
}

/** Bump to make every vector again (a change to what's embedded). */
const SCHEMA_VERSION = 1;
/** Pieces embedded in one go; a message is never split across two. */
const BATCH = 16;
/** Shorter messages ("ok", "thanks") carry no meaning worth a vector. */
const MIN_CHARS = 12;
/** A piece of a long message, in characters: about what a small model reads at once. */
const PIECE = 1000;
const MOST_PIECES = 4;
/** How long to wait, when the gateway says there's no room, before looking again. */
const HELD_MS = 30_000;
/** Most messages a search hands back for blending. */
const MOST_HITS = 200;
/** The vectors in memory go back to the computer after this long without a search. */
const IDLE_MS = 10 * 60_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const hashOf = (text: string) => createHash('sha1').update(text).digest('hex');

/** Worth embedding: your words and the answers, long enough to mean something. */
const worth = (row: SliceRow) => row.role !== 'tool' && row.text.trim().length >= MIN_CHARS;

/**
 * A message as pieces of about `PIECE` characters, cut between paragraphs,
 * then sentences, then words where it can; at most `MOST_PIECES`.
 */
export function pieces(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= PIECE) return [clean];
  const out: string[] = [];
  let rest = clean;
  while (rest.length > 0 && out.length < MOST_PIECES) {
    if (rest.length <= PIECE) {
      out.push(rest);
      break;
    }
    const window = rest.slice(0, PIECE);
    const cut = [
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    ].find((at) => at > PIECE / 2);
    const end = cut === undefined ? PIECE : cut + 1;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  return out.filter(Boolean);
}

/** A unit vector as bytes: a quarter of the size, and closeness barely moves. */
function quantize(v: Float32Array): Uint8Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++)
    q[i] = Math.max(-127, Math.min(127, Math.round(((v[i] ?? 0) / n) * 127)));
  return new Uint8Array(q.buffer);
}

interface Loaded {
  model: string;
  dims: number;
  keys: { conversationId: string; anchor: string; part: number }[];
  data: Int8Array;
}

export class ChatMeaning {
  #db?: DatabaseSync;
  #stmts = new Map<string, StatementSync>();
  #pumping?: Promise<void>;
  /** Chats that just changed: embedded before the backfill's next one. */
  #soon = new Set<string>();
  #again = false;
  #closed = false;
  /** Rebuilt on its own this run: the next failure waits for Repair. */
  #rebuilt = false;
  #broken = false;
  #loaded?: Loaded;
  #idle?: ReturnType<typeof setTimeout>;
  #wake?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: ChatMeaningDeps) {}

  // ── The file ─────────────────────────────────────────────────────────────

  #open(): DatabaseSync {
    if (this.#db) return this.#db;
    const { path } = this.deps;
    const create = () => {
      if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        // Made from the text of every chat: owner-only, like search.db.
        if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 });
        else chmodSync(path, 0o600);
      }
      const db = new DatabaseSync(path);
      try {
        db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
        const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
          user_version: number;
        };
        if (version !== SCHEMA_VERSION)
          db.exec(`
            DROP TABLE IF EXISTS vectors;
            DROP TABLE IF EXISTS chats;
            CREATE TABLE vectors (
              conversation_id TEXT NOT NULL, anchor TEXT NOT NULL, part INTEGER NOT NULL,
              model TEXT NOT NULL, hash TEXT NOT NULL, vec BLOB NOT NULL,
              PRIMARY KEY (conversation_id, anchor, part)
            );
            CREATE TABLE chats (
              conversation_id TEXT PRIMARY KEY, model TEXT NOT NULL, updated_at INTEGER NOT NULL
            );
            PRAGMA user_version = ${SCHEMA_VERSION};
          `);
        // A file that opens but isn't ours (or is damaged) fails here, not mid-search.
        db.prepare('SELECT count(*) FROM vectors').get();
      } catch (error) {
        db.close();
        throw error;
      }
      return db;
    };
    try {
      this.#db = create();
    } catch (error) {
      if (!this.#mayRebuild(error)) throw error;
      this.#remove();
      this.#db = create();
      this.deps.heal?.('Rebuilt chat search by meaning');
    }
    return this.#db;
  }

  #stmt(sql: string): StatementSync {
    const db = this.#open();
    let stmt = this.#stmts.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }

  /** Whether Conch may make the file again by itself now: once per run, then it waits for Repair. */
  #mayRebuild(error: unknown): boolean {
    this.deps.log?.(error);
    if (this.#rebuilt) {
      this.#broken = true;
      return false;
    }
    this.#rebuilt = true;
    return true;
  }

  #remove() {
    this.#let();
    for (const suffix of ['', '-wal', '-shm'])
      if (this.deps.path !== ':memory:') rmSync(`${this.deps.path}${suffix}`, { force: true });
  }

  /** Let go of the file (and the vectors in memory). */
  #let() {
    this.#stmts.clear();
    try {
      this.#db?.close();
    } catch {
      // Already closed.
    }
    this.#db = undefined;
    this.#loaded = undefined;
  }

  /**
   * Run `fn` on the file. A damaged one is made again, once per run on its
   * own (the vectors are made again in the background); after that it's
   * `unavailable` until Repair, and searches go on by words.
   */
  #use<T>(fn: () => T, otherwise: T): T {
    if (this.#broken || this.#closed) return otherwise;
    try {
      return fn();
    } catch (error) {
      if (!isBroken(error)) throw error;
      if (!this.#mayRebuild(error)) {
        this.#let();
        return otherwise;
      }
      this.#remove();
      try {
        this.#open();
        this.deps.heal?.('Rebuilt chat search by meaning');
        this.wake();
      } catch (again) {
        this.deps.log?.(again);
        this.#broken = true;
      }
      return otherwise;
    }
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#idle);
    clearTimeout(this.#wake);
    this.#let();
  }

  // ── Keeping up ───────────────────────────────────────────────────────────

  /** A chat's messages changed (the keyword index has them): embed it soon. */
  changed(conversationId: string) {
    this.#soon.add(conversationId);
    // A turn is a burst (your message, then the answer): one look after it settles.
    clearTimeout(this.#wake);
    this.#wake = setTimeout(() => this.wake(), 2_000);
    this.#wake.unref?.();
  }

  /** A chat was deleted: its vectors go with it, now. */
  remove(conversationId: string) {
    this.#soon.delete(conversationId);
    this.#use(() => {
      this.#stmt('DELETE FROM vectors WHERE conversation_id = ?').run(conversationId);
      this.#stmt('DELETE FROM chats WHERE conversation_id = ?').run(conversationId);
      this.#loaded = undefined;
    }, undefined);
  }

  /**
   * Catch up: every chat whose vectors are missing, stale or from another
   * model, newest first, in the background. Resolves when there's nothing
   * left to do (or no model to do it with).
   */
  wake(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#pumping) {
      this.#again = true;
      return this.#pumping;
    }
    this.#pumping = (async () => {
      try {
        do {
          this.#again = false;
          await this.#pump();
        } while (this.#again && !this.#closed);
      } catch (error) {
        this.deps.log?.(error);
      } finally {
        this.#pumping = undefined;
      }
    })();
    return this.#pumping;
  }

  /** The model to use now, if there is one that answers. */
  async #embedder(): Promise<Embedder | undefined> {
    return this.deps.meaning().catch(() => undefined);
  }

  async #pump() {
    const embedder = await this.#embedder();
    if (!embedder || this.#closed || this.#broken) return;
    // Vectors from another model are never compared: they go.
    this.#use(() => {
      const other = this.#stmt('SELECT 1 FROM vectors WHERE model <> ? LIMIT 1').get(embedder.id);
      const stale = this.#stmt('SELECT 1 FROM chats WHERE model <> ? LIMIT 1').get(embedder.id);
      if (other || stale) {
        this.#stmt('DELETE FROM vectors WHERE model <> ?').run(embedder.id);
        this.#stmt('DELETE FROM chats WHERE model <> ?').run(embedder.id);
        this.#loaded = undefined;
      }
    }, undefined);
    const todo = this.#todo(embedder.id);
    while (!this.#closed && !this.#broken) {
      const [first] = this.#soon;
      let next: { id: string; updatedAt: number } | undefined;
      if (first !== undefined) {
        this.#soon.delete(first);
        const due = this.#todo(embedder.id, first).get(first);
        if (due === undefined) continue;
        next = { id: first, updatedAt: due };
        todo.delete(first);
      } else {
        const [entry] = todo;
        if (!entry) return;
        todo.delete(entry[0]);
        next = { id: entry[0], updatedAt: entry[1] };
      }
      const done = await this.#embedChat(embedder, next.id, next.updatedAt);
      // The model stopped answering: try again when it's back (`wake`).
      if (!done) return;
    }
  }

  /**
   * Chats to embed (just `only`, when given), newest first: not marked done
   * for this model at what the keyword index last saw of them. Chats no longer
   * in the index (deleted while Conch was off) lose their vectors here.
   */
  #todo(model: string, only?: string): Map<string, number> {
    const chats = this.#chats();
    if (!chats) return new Map();
    return this.#use(() => {
      const marked = new Map(
        (
          this.#stmt('SELECT conversation_id, model, updated_at FROM chats').all() as {
            conversation_id: string;
            model: string;
            updated_at: number;
          }[]
        ).map((r) => [r.conversation_id, r]),
      );
      if (!only) {
        const alive = new Set(chats.map((c) => c.id));
        const ids = (
          this.#stmt('SELECT DISTINCT conversation_id FROM vectors').all() as {
            conversation_id: string;
          }[]
        ).map((r) => r.conversation_id);
        for (const id of new Set([...marked.keys(), ...ids])) if (!alive.has(id)) this.remove(id);
      }
      const out = new Map<string, number>();
      for (const chat of chats) {
        if (only !== undefined && chat.id !== only) continue;
        const mark = marked.get(chat.id);
        if (mark?.model === model && mark.updated_at === chat.updatedAt) continue;
        out.set(chat.id, chat.updatedAt);
      }
      return out;
    }, new Map<string, number>());
  }

  /** The keyword index's chats; none while it's closed or being rebuilt (its own service heals it). */
  #chats(): { id: string; updatedAt: number }[] | undefined {
    try {
      return this.deps.source()?.chats();
    } catch {
      return undefined;
    }
  }

  /** Wait until there's room for background work (or Conch is closing). */
  async #room() {
    while (!this.#closed && this.deps.room && !this.deps.room())
      await (this.deps.sleep ?? sleep)(HELD_MS);
  }

  /**
   * Bring one chat's vectors up to date, a few messages at a time. False when
   * the model stopped answering (it's tried again later).
   */
  async #embedChat(embedder: Embedder, id: string, updatedAt: number): Promise<boolean> {
    const source = this.deps.source();
    if (!source) return true;
    let rows: SliceRow[];
    try {
      rows = source.messages(id).filter(worth);
    } catch {
      // The keyword index is being rebuilt: this chat comes round again after.
      return true;
    }
    const wanted = new Map(rows.map((r) => [r.anchor, hashOf(r.text)]));
    const have = new Map(
      this.#use(
        () =>
          this.#stmt(
            'SELECT anchor, hash FROM vectors WHERE conversation_id = ? AND part = 0 AND model = ?',
          ).all(id, embedder.id) as { anchor: string; hash: string }[],
        [],
      ).map((r) => [r.anchor, r.hash]),
    );
    // Messages gone or changed since: their old vectors go.
    const drop = [...have].filter(([anchor, hash]) => wanted.get(anchor) !== hash);
    if (drop.length)
      this.#use(() => {
        const del = this.#stmt('DELETE FROM vectors WHERE conversation_id = ? AND anchor = ?');
        for (const [anchor] of drop) del.run(id, anchor);
        this.#loaded = undefined;
      }, undefined);
    const todo = rows
      .filter((r) => have.get(r.anchor) !== wanted.get(r.anchor))
      .map((r) => ({ anchor: r.anchor, hash: wanted.get(r.anchor) ?? '', texts: pieces(r.text) }));
    for (let i = 0; i < todo.length;) {
      // Whole messages, about `BATCH` pieces: a message is kept all at once or not at all.
      const batch: typeof todo = [];
      let size = 0;
      while (
        i < todo.length &&
        (batch.length === 0 || size + (todo[i]?.texts.length ?? 0) <= BATCH)
      ) {
        const next = todo[i++];
        if (!next) break;
        batch.push(next);
        size += next.texts.length;
      }
      await this.#room();
      if (this.#closed) return true;
      const started = performance.now();
      let made: Float32Array[];
      try {
        made = await embedder.embed(batch.flatMap((m) => m.texts));
      } catch (error) {
        this.deps.log?.(error);
        return false;
      }
      if (this.#closed) return true;
      this.#use(() => {
        const put = this.#stmt(
          `INSERT OR REPLACE INTO vectors (conversation_id, anchor, part, model, hash, vec)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const db = this.#open();
        db.exec('BEGIN');
        try {
          let at = 0;
          for (const message of batch)
            message.texts.forEach((_, part) => {
              const vec = made[at++];
              if (vec) put.run(id, message.anchor, part, embedder.id, message.hash, quantize(vec));
            });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        this.#loaded = undefined;
      }, undefined);
      // Rest as long as it worked: at most half of one process, however long the history.
      await (this.deps.sleep ?? sleep)(Math.max(20, performance.now() - started));
    }
    if (this.#closed) return true;
    this.#use(() => {
      this.#stmt(
        `INSERT INTO chats (conversation_id, model, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (conversation_id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at`,
      ).run(id, embedder.id, updatedAt);
    }, undefined);
    return true;
  }

  // ── Searching ────────────────────────────────────────────────────────────

  /**
   * Messages closest in meaning to `query`, best first, each at least its
   * model's `floor`. Undefined when meaning can't answer now (no model, it
   * didn't answer in time, the file is broken): search goes on by words.
   */
  async search(query: string): Promise<MeaningHit[] | undefined> {
    if (this.#broken || this.#closed || !query.trim()) return undefined;
    const waitMs = this.deps.waitMs ?? 1_500;
    const late = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), waitMs).unref?.();
    });
    const embedder = await Promise.race([this.#embedder(), late]);
    if (!embedder) return undefined;
    const qv = await Promise.race([
      embedder
        .embed([query.slice(0, 2000)])
        .then(([v]) => v)
        .catch(() => undefined),
      late,
    ]);
    if (!qv) return undefined;
    const loaded = this.#use(() => this.#load(embedder.id), undefined);
    if (!loaded || loaded.dims !== qv.length) return loaded ? [] : undefined;
    // The query as the stored vectors are: unit length, so a dot product is closeness.
    let sum = 0;
    for (const x of qv) sum += x * x;
    const scale = (Math.sqrt(sum) || 1) * 127;
    const best = new Map<string, MeaningHit>();
    const { dims, data, keys } = loaded;
    for (let k = 0; k < keys.length; k++) {
      let dot = 0;
      const base = k * dims;
      for (let i = 0; i < dims; i++) dot += (qv[i] ?? 0) * (data[base + i] ?? 0);
      const score = dot / scale;
      if (score < embedder.floor) continue;
      const key = keys[k];
      if (!key) continue;
      const id = `${key.conversationId}\u0000${key.anchor}`;
      const known = best.get(id);
      if (!known || known.score < score) best.set(id, { ...key, score });
    }
    this.#touch();
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MOST_HITS);
  }

  /** Every vector of `model`, in memory until the next change (or ten idle minutes). */
  #load(model: string): Loaded {
    if (this.#loaded?.model === model) return this.#loaded;
    const keys: Loaded['keys'] = [];
    const chunks: Int8Array[] = [];
    let dims = 0;
    const rows = this.#stmt(
      'SELECT conversation_id, anchor, part, vec FROM vectors WHERE model = ?',
    ).iterate(model) as Iterable<{
      conversation_id: string;
      anchor: string;
      part: number;
      vec: Uint8Array;
    }>;
    for (const row of rows) {
      const vec = new Int8Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength);
      if (!dims) dims = vec.length;
      if (vec.length !== dims) continue;
      keys.push({ conversationId: row.conversation_id, anchor: row.anchor, part: row.part });
      chunks.push(vec.slice());
    }
    const data = new Int8Array(keys.length * dims);
    chunks.forEach((c, k) => data.set(c, k * dims));
    this.#loaded = { model, dims, keys, data };
    return this.#loaded;
  }

  #touch() {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      this.#loaded = undefined;
    }, IDLE_MS);
    this.#idle.unref?.();
  }

  // ── Health ───────────────────────────────────────────────────────────────

  /** How meaning search is doing; looking starts any catching up. */
  async status(): Promise<ChatMeaningStatus> {
    const total = this.#chats()?.length ?? 0;
    if (this.#broken) return { state: 'unavailable', indexed: 0, total };
    const embedder = await this.#embedder();
    if (!embedder) return { state: 'off', indexed: 0, total };
    const left = this.#todo(embedder.id).size;
    if (this.#broken) return { state: 'unavailable', indexed: 0, total };
    if (left > 0) void this.wake();
    return {
      state: left > 0 ? 'catching-up' : 'ready',
      model: embedder.label ?? embedder.id,
      indexed: Math.max(0, total - left),
      total,
    };
  }

  /** Whether the file reads as it should (Repair everything). */
  check(): 'ok' | 'damaged' {
    if (this.#broken) return 'damaged';
    try {
      const row = this.#open().prepare('PRAGMA quick_check').get() as
        { quick_check?: string } | undefined;
      return row?.quick_check === 'ok' ? 'ok' : 'damaged';
    } catch {
      return 'damaged';
    }
  }

  /** Throw the vectors away and make them again (Repair): always allowed. */
  async repair(): Promise<void> {
    this.#broken = false;
    if (this.#closed) return;
    this.#remove();
    this.#open();
    void this.wake();
  }

  /** Wait for the background work (tests). */
  async settled(): Promise<void> {
    while (this.#pumping) await this.#pumping;
  }
}

// ── Blending ───────────────────────────────────────────────────────────────

/** What blending needs from the keyword index. */
export interface BlendLookup {
  message(conversationId: string, anchor: string): SliceRow | undefined;
  about(conversationId: string): IndexedConversation | undefined;
}

const HITS_PER_GROUP = 3;

/**
 * Words and meaning, blended the way memory search blends them (ADR 0032):
 * half each, a chat found both ways first. A keyword result's share is its
 * place in the keyword ranking; a meaning result's is its closeness. A chat
 * found only by meaning comes with the lines that matched, marked
 * `byMeaning`, cut as snippets are; a message no longer in the index (deleted
 * or changed since) is never shown.
 */
export function blend(
  words: SearchResults,
  found: readonly MeaningHit[],
  lookup: BlendLookup,
  limit: number,
): SearchResults {
  if (!found.length) return words;
  const byChat = new Map<string, MeaningHit[]>();
  for (const hit of found) {
    const list = byChat.get(hit.conversationId);
    if (list) list.push(hit);
    else byChat.set(hit.conversationId, [hit]);
  }
  const line = (hit: MeaningHit): SearchHit | undefined => {
    const row = lookup.message(hit.conversationId, hit.anchor);
    if (!row) return undefined;
    const piece = pieces(row.text)[hit.part] ?? row.text;
    const cut = excerpt(piece, [], 150);
    return {
      conversationId: hit.conversationId,
      anchor: row.anchor,
      role: row.role,
      at: row.at,
      snippet: cut.text,
      ranges: [],
      byMeaning: true,
    };
  };
  const scored: { group: SearchGroup; score: number }[] = [];
  const seen = new Set<string>();
  words.groups.forEach((group, i) => {
    seen.add(group.conversationId);
    const hits = byChat.get(group.conversationId) ?? [];
    const vec = hits[0]?.score ?? 0;
    // First of the keyword results is 1, and each after a little less.
    const share = 1 / (1 + i / 3);
    // A few lines, the words' first; then what meaning adds.
    const lines = [...group.hits];
    for (const hit of hits) {
      if (lines.length >= HITS_PER_GROUP) break;
      if (lines.some((l) => l.anchor === hit.anchor)) continue;
      const extra = line(hit);
      if (extra) lines.push(extra);
    }
    scored.push({ group: { ...group, hits: lines }, score: 0.5 * share + 0.5 * vec });
  });
  let added = 0;
  for (const [conversationId, hits] of byChat) {
    if (seen.has(conversationId)) continue;
    const about = lookup.about(conversationId);
    if (!about) continue;
    const lines = hits
      .map(line)
      .filter((l): l is SearchHit => l !== undefined)
      .slice(0, HITS_PER_GROUP);
    if (!lines.length) continue;
    added += hits.length;
    scored.push({
      group: {
        conversationId,
        title: about.title,
        updatedAt: about.updatedAt,
        matches: hits.length,
        hits: lines,
      },
      score: 0.5 * (hits[0]?.score ?? 0),
    });
  }
  if (!added) return { ...words, groups: scored.map((s) => s.group) };
  return {
    ...words,
    groups: scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.group),
    total: words.total + added,
    byMeaning: true,
  };
}
