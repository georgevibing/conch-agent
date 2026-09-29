import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  excerpt,
  findRanges,
  foldText,
  parseQuery,
  type ConversationEvent,
  type PreviewMessage,
  type SearchGroup,
  type SearchHit,
  type SearchPreview,
  type SearchResults,
  type SearchRole,
  type TextRange,
} from '@conch/protocol';

import { extractDocs } from './extract';

/** Bump to rebuild every index from the conversation logs on next start. */
const SCHEMA_VERSION = 1;
/** Ranked rows considered per query; plenty for grouping, cheap for SQLite. */
const CANDIDATES = 400;
/** Past this many matches a query is "broad": take the newest, don't rank them all. */
const BROAD = 2000;
const HITS_PER_GROUP = 3;
const DAY = 86_400_000;

export interface IndexedConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: number;
  conversation_id: string;
  anchor: string;
  role: SearchRole;
  seq: number;
  at: number;
  text: string;
  rank: number;
}

interface Scored {
  row: Row;
  score: number;
  /** Highlights; computed only for the hits that are shown. */
  ranges?: TextRange[];
}

/**
 * Full-text index of every conversation, in `~/.conch/search.db`.
 *
 * SQLite FTS5 with the trigram tokenizer gives substring matching ("deplo"
 * finds "redeployed") in any language, case- and accent-insensitive, from an
 * on-disk index — so queries stay a few milliseconds whether you have ten
 * conversations or ten thousand. When nothing matches exactly, a trigram vote
 * finds near-misses (typos). The index is derived data: it's rebuilt from the
 * JSONL logs whenever it's missing, stale or from an older schema.
 */
export class SearchIndex {
  readonly #db: DatabaseSync;
  readonly #stmts: Record<string, StatementSync> = {};

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.#migrate();
  }

  close() {
    this.#db.close();
  }

  #migrate() {
    const { user_version: version } = this.#db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version === SCHEMA_VERSION) return;
    this.#db.exec(`
      DROP TABLE IF EXISTS docs_fts;
      DROP TABLE IF EXISTS docs;
      DROP TABLE IF EXISTS conversations;
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        indexed_seq INTEGER NOT NULL DEFAULT -1
      );
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        anchor TEXT NOT NULL,
        role TEXT NOT NULL,
        seq INTEGER NOT NULL,
        at INTEGER NOT NULL,
        text TEXT NOT NULL,
        UNIQUE (conversation_id, anchor)
      );
      CREATE INDEX docs_by_seq ON docs (conversation_id, seq);
      CREATE VIRTUAL TABLE docs_fts USING fts5(
        text, content = 'docs', content_rowid = 'id',
        tokenize = 'trigram remove_diacritics 1'
      );
      CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts (rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER docs_au AFTER UPDATE OF text ON docs BEGIN
        INSERT INTO docs_fts (docs_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO docs_fts (rowid, text) VALUES (new.id, new.text);
      END;
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  #stmt(sql: string): StatementSync {
    return (this.#stmts[sql] ??= this.#db.prepare(sql));
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec('BEGIN');
    try {
      const out = fn();
      this.#db.exec('COMMIT');
      return out;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** When the index last saw this conversation (its `updatedAt`), if ever. */
  indexedAt(id: string): number | undefined {
    const row = this.#stmt('SELECT updated_at FROM conversations WHERE id = ?').get(id) as
      { updated_at: number } | undefined;
    return row?.updated_at;
  }

  /** Ids of every indexed conversation (to prune ones deleted while Conch was off). */
  ids(): string[] {
    return (this.#stmt('SELECT id FROM conversations').all() as { id: string }[]).map((r) => r.id);
  }

  /**
   * Bring one conversation up to date. Only documents touched since the last
   * call are written, so this is cheap to call after every turn.
   */
  index(conversation: IndexedConversation, events: ConversationEvent[]) {
    const known = this.#stmt('SELECT indexed_seq FROM conversations WHERE id = ?').get(
      conversation.id,
    ) as { indexed_seq: number } | undefined;
    const since = known?.indexed_seq ?? -1;
    const lastSeq = events.at(-1)?.seq ?? since;
    const docs = extractDocs(events).filter((d) => d.lastSeq > since);
    this.#tx(() => {
      this.#stmt(
        `INSERT INTO conversations (id, title, created_at, updated_at, indexed_seq)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, created_at = excluded.created_at,
           updated_at = excluded.updated_at, indexed_seq = excluded.indexed_seq`,
      ).run(
        conversation.id,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt,
        Math.max(since, lastSeq),
      );
      const upsert = this.#stmt(
        `INSERT INTO docs (conversation_id, anchor, role, seq, at, text) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (conversation_id, anchor) DO UPDATE SET text = excluded.text
         WHERE docs.text <> excluded.text`,
      );
      for (const doc of docs) {
        upsert.run(conversation.id, doc.anchor, doc.role, doc.seq, doc.at, doc.text);
      }
    });
  }

  /** Title changes don't need a re-index of the messages. */
  retitle(id: string, title: string, updatedAt: number) {
    this.#stmt('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title,
      updatedAt,
      id,
    );
  }

  remove(id: string) {
    this.#tx(() => {
      this.#stmt('DELETE FROM docs WHERE conversation_id = ?').run(id);
      this.#stmt('DELETE FROM conversations WHERE id = ?').run(id);
    });
  }

  search(query: string, options: { in?: string; limit?: number } = {}): SearchResults {
    const started = performance.now();
    const terms = parseQuery(query);
    const limit = options.limit ?? 20;
    const done = (
      mode: SearchResults['mode'],
      groups: SearchGroup[] = [],
      total = 0,
      capped = false,
    ): SearchResults => ({
      query,
      mode,
      groups: groups.flatMap((g) => {
        const conversation = this.#conversation(g.conversationId);
        return conversation
          ? [{ ...g, title: conversation.title, updatedAt: conversation.updated_at }]
          : [];
      }),
      total,
      capped,
      tookMs: Math.round((performance.now() - started) * 10) / 10,
    });

    // Trigrams need three characters; shorter terms only narrow longer ones.
    const indexed = terms.filter((t) => t.length >= 3);
    if (!indexed.length) return done('short');
    const narrow = terms.filter((t) => t.length < 3);

    const exact = this.#candidates(indexed.map(quote).join(' AND '), options.in)
      .map((row) => this.#scoreExact(row, terms, narrow))
      .filter((s): s is Scored => s !== null);
    // "The chat where we talked about X and Y": terms may be spread over messages.
    // Only worth it when single messages didn't already give plenty.
    if (indexed.length > 1 && !narrow.length && exact.length < 40)
      exact.push(...this.#acrossMessages(indexed, exact, options.in));
    if (exact.length) {
      const { groups, total } = group(
        exact,
        terms,
        options.in ? 1 : limit,
        options.in ? 50 : undefined,
      );
      return done('exact', groups, total, exact.length >= CANDIDATES);
    }

    const grams = [...new Set(indexed.flatMap(trigrams))];
    if (!grams.length || indexed.join('').length < 4) return done('exact');
    // Near-misses need relevance (most shared trigrams first), whatever it costs.
    const fuzzy = this.#candidates(grams.map(quote).join(' OR '), options.in, true)
      .map((row) => scoreFuzzy(row, indexed))
      .filter((s): s is Scored => s !== null);
    const { groups, total } = group(
      fuzzy,
      indexed,
      options.in ? 1 : limit,
      options.in ? 50 : undefined,
    );
    return done('fuzzy', groups, total, false);
  }

  /**
   * The best `CANDIDATES` matching rows. Ranking every match by relevance is
   * the one cost that grows with history, so when a query matches a lot
   * (a common word) we take the newest matches instead — walking the index
   * backwards and stopping early keeps it ~1ms at any size, and for broad
   * queries recency is the better signal anyway.
   */
  #candidates(match: string, conversationId?: string, alwaysRank = false): Row[] {
    const scope = conversationId ? 'AND d.conversation_id = ?' : '';
    const params = conversationId ? [match, conversationId] : [match];
    try {
      const broad =
        !alwaysRank &&
        (
          this.#stmt(
            `SELECT count(*) AS n FROM (SELECT 1 FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
              WHERE docs_fts MATCH ? ${scope} LIMIT ${BROAD + 1})`,
          ).get(...params) as { n: number }
        ).n > BROAD;
      const order = broad ? 'docs_fts.rowid DESC' : 'rank';
      return this.#stmt(
        `SELECT d.id, d.conversation_id, d.anchor, d.role, d.seq, d.at, d.text,
          bm25(docs_fts) AS rank
        FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
        WHERE docs_fts MATCH ? ${scope}
        ORDER BY ${order} LIMIT ${CANDIDATES}`,
      ).all(...params) as unknown as Row[];
    } catch {
      // A query FTS5 can't parse matches nothing rather than failing the request.
      return [];
    }
  }

  /**
   * Conversations containing every term, just not in any single message.
   * One indexed lookup per term, intersected; their best messages rank below
   * single-message matches.
   */
  #acrossMessages(terms: string[], found: Scored[], conversationId?: string): Scored[] {
    const have = new Set(found.map((s) => s.row.conversation_id));
    const per = `SELECT DISTINCT d.conversation_id FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
      WHERE docs_fts MATCH ? ${conversationId ? 'AND d.conversation_id = ?' : ''}`;
    let ids: string[];
    try {
      ids = (
        this.#stmt(`${terms.map(() => per).join(' INTERSECT ')} LIMIT 60`).all(
          ...terms.flatMap((t) => (conversationId ? [quote(t), conversationId] : [quote(t)])),
        ) as { conversation_id: string }[]
      )
        .map((r) => r.conversation_id)
        .filter((id) => !have.has(id));
    } catch {
      return [];
    }
    if (!ids.length) return [];
    const rows = this.#stmt(
      `SELECT d.id, d.conversation_id, d.anchor, d.role, d.seq, d.at, d.text, bm25(docs_fts) AS rank
        FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid
        WHERE docs_fts MATCH ? AND d.conversation_id IN (SELECT value FROM json_each(?))
        ORDER BY rank LIMIT ${CANDIDATES}`,
    ).all(terms.map(quote).join(' OR '), JSON.stringify(ids)) as unknown as Row[];
    return rows.map((row) => ({ row, score: weigh(-row.rank * 0.6, row) }));
  }

  #scoreExact(row: Row, terms: string[], narrow: string[]): Scored | null {
    const folded = foldText(row.text);
    if (narrow.some((t) => !folded.includes(t))) return null;
    let score = -row.rank;
    // Whole words and the full phrase read as intent; weigh them up.
    const phrase = terms.join(' ');
    if (terms.length > 1 && folded.includes(phrase)) score *= 1.6;
    if (terms.every((t) => wordAt(folded, t))) score *= 1.35;
    return { row, score: weigh(score, row) };
  }

  #conversation(id: string) {
    return this.#stmt(
      'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?',
    ).get(id) as { id: string; title: string; created_at: number; updated_at: number } | undefined;
  }

  /**
   * A glance at a conversation for the search preview: the matching message
   * with its neighbours, or — with no anchor — how it ended.
   */
  preview(conversationId: string, anchor: string | undefined, query: string): SearchPreview | null {
    const conversation = this.#conversation(conversationId);
    if (!conversation) return null;
    const cols = 'anchor, role, seq, at, text';
    const target = anchor
      ? (this.#stmt(`SELECT ${cols} FROM docs WHERE conversation_id = ? AND anchor = ?`).get(
          conversationId,
          anchor,
        ) as Row | undefined)
      : undefined;
    let rows: Row[];
    if (target) {
      const before = this.#stmt(
        `SELECT ${cols} FROM docs WHERE conversation_id = ? AND seq < ? ORDER BY seq DESC LIMIT 2`,
      ).all(conversationId, target.seq) as unknown as Row[];
      const after = this.#stmt(
        `SELECT ${cols} FROM docs WHERE conversation_id = ? AND seq > ? ORDER BY seq LIMIT 2`,
      ).all(conversationId, target.seq) as unknown as Row[];
      rows = [...before.reverse(), target, ...after];
    } else {
      rows = (
        this.#stmt(
          `SELECT ${cols} FROM docs WHERE conversation_id = ? ORDER BY seq DESC LIMIT 4`,
        ).all(conversationId) as unknown as Row[]
      ).reverse();
    }
    const terms = parseQuery(query);
    const { count } = this.#stmt(
      'SELECT count(*) AS count FROM docs WHERE conversation_id = ?',
    ).get(conversationId) as { count: number };
    return {
      conversationId,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      messageCount: count,
      messages: rows.map((row): PreviewMessage => {
        const focus = row.anchor === target?.anchor;
        const cut = excerpt(
          row.text,
          terms.length ? findRanges(foldText(row.text), terms) : [],
          focus ? 900 : 280,
        );
        return {
          anchor: row.anchor,
          role: row.role,
          at: row.at,
          text: cut.text,
          ranges: cut.ranges,
          focus,
          clippedStart: cut.clippedStart,
          clippedEnd: cut.clippedEnd,
        };
      }),
    };
  }
}

const quote = (term: string) => `"${term.replaceAll('"', '""')}"`;

function trigrams(term: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 3 <= term.length; i++) {
    const gram = term.slice(i, i + 3);
    if (!gram.includes(' ')) out.push(gram);
  }
  return out;
}

function wordAt(text: string, term: string): boolean {
  let at = text.indexOf(term);
  while (at !== -1) {
    const before = at === 0 ? ' ' : (text[at - 1] as string);
    if (!/[\p{L}\p{N}]/u.test(before)) return true;
    at = text.indexOf(term, at + 1);
  }
  return false;
}

/** Recent conversations and your own words rank a little higher. */
function weigh(score: number, row: Row): number {
  const ageDays = Math.max(0, (Date.now() - row.at) / DAY);
  const recency = 0.65 + 0.35 / (1 + ageDays / 21);
  const role = row.role === 'user' ? 1.15 : row.role === 'tool' ? 0.8 : 1;
  return score * recency * role;
}

/**
 * Typo tolerance: each query term votes, trigram by trigram, for where it
 * would start in the text; the best-supported start is the approximate match.
 */
function scoreFuzzy(row: Row, terms: string[]): Scored | null {
  const folded = foldText(row.text);
  const ranges: TextRange[] = [];
  let similarity = 0;
  for (const term of terms) {
    const grams = trigrams(term);
    if (!grams.length) continue;
    const votes = new Map<number, number>();
    grams.forEach((gram, offset) => {
      let at = folded.indexOf(gram);
      let seen = 0;
      while (at !== -1 && seen++ < 64) {
        // Allow the match to drift by one (an inserted or dropped letter).
        const start = at - offset;
        votes.set(start, (votes.get(start) ?? 0) + 1);
        votes.set(start - 1, (votes.get(start - 1) ?? 0) + 0.5);
        votes.set(start + 1, (votes.get(start + 1) ?? 0) + 0.5);
        at = folded.indexOf(gram, at + 1);
      }
    });
    let best = -1;
    let bestVotes = 0;
    for (const [start, count] of votes) {
      if (count > bestVotes) {
        bestVotes = count;
        best = start;
      }
    }
    const share = Math.min(1, bestVotes / grams.length);
    if (share < 0.34) return null;
    similarity += share;
    const start = Math.max(0, best);
    ranges.push([start, Math.min(folded.length, start + term.length)]);
  }
  similarity /= terms.length;
  if (similarity < 0.5) return null;
  return { row, score: weigh(similarity * (1 + -row.rank), row), ranges };
}

function group(
  scored: Scored[],
  terms: string[],
  maxGroups: number,
  hitsPerGroup = HITS_PER_GROUP,
): { groups: SearchGroup[]; total: number } {
  const byConversation = new Map<string, { best: number; items: Scored[] }>();
  for (const s of scored) {
    const entry = byConversation.get(s.row.conversation_id);
    if (entry) {
      entry.items.push(s);
      entry.best = Math.max(entry.best, s.score);
    } else {
      byConversation.set(s.row.conversation_id, { best: s.score, items: [s] });
    }
  }
  const ranked = [...byConversation.entries()]
    .map(([id, entry]) => ({
      id,
      ...entry,
      weight: entry.best * (1 + 0.12 * Math.log2(entry.items.length)),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxGroups);
  return {
    total: scored.length,
    groups: ranked.map(({ id, items }) => {
      const hits = items
        .sort((a, b) => b.score - a.score)
        .slice(0, hitsPerGroup)
        .map(({ row, ranges }): SearchHit => {
          const cut = excerpt(row.text, ranges ?? findRanges(foldText(row.text), terms), 150);
          return {
            conversationId: id,
            anchor: row.anchor,
            role: row.role,
            at: row.at,
            snippet: cut.text,
            ranges: cut.ranges,
          };
        });
      return {
        conversationId: id,
        // Filled in from the conversations table by `search()`.
        title: '',
        updatedAt: 0,
        matches: items.length,
        hits,
      };
    }),
  };
}
