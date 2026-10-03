import { existsSync, rmSync } from 'node:fs';

import type { SearchPreview, SearchResults, SearchState, ServerEvent } from '@conch/protocol';

import { setAside, type Heal } from '../lib/recover';
import { isBroken, SearchIndex, type SearchSlice } from './index';
import { SearchIndexer, type SearchSource } from './indexer';

export interface SearchServiceDeps {
  /** `~/.conch/search.db`. */
  path: string;
  source: SearchSource;
  heal?: Heal;
  log?: (error: unknown) => void;
  /** How long a search waits for the catch-up before answering with what's there. */
  waitMs?: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * Full-text search, kept working. The index is derived data (ADR 0007), so
 * when it won't open, or stops working mid-session, it's set aside
 * (`search.db.broken-<time>`) and rebuilt from the chats while searches say
 * "catching up". That happens once per run on its own: an index that fails
 * again right after is left `unavailable` until a person presses Repair (or
 * restarts), never rebuilt in a loop.
 */
export class SearchService {
  #index?: SearchIndex;
  #indexer?: SearchIndexer;
  /** Bumped per index, so errors from one that was replaced are ignored. */
  #generation = 0;
  #state: SearchState = 'catching-up';
  /** Opening or rebuilding; searches wait for it. */
  #work: Promise<void> = Promise.resolve();
  #rebuilt = false;

  constructor(private readonly deps: SearchServiceDeps) {}

  get state(): SearchState {
    return this.#state;
  }

  /** Open the index (rebuilding it if it won't open). Never throws. */
  open(): void {
    try {
      this.#attach(new SearchIndex(this.deps.path));
    } catch (error) {
      this.#automatic(
        error,
        'The search index couldn’t be read, so Conch rebuilt it from your chats.',
      );
    }
  }

  /** Rebuild because a person asked (Repair): always allowed, never a note. */
  repair(): Promise<SearchState> {
    this.#state = 'catching-up';
    this.#work = this.#work.then(() => this.#rebuild());
    return this.#work.then(() => this.#state);
  }

  onEvent(event: ServerEvent): void {
    this.#indexer?.onEvent(event);
  }

  /**
   * Results so far. While catching up it waits a moment (a search right after
   * start-up shouldn't miss what's being indexed), then answers with what's
   * there and `catchingUp`.
   */
  search(
    q: string,
    options: { in?: string; limit?: number },
  ): Promise<SearchResults | 'unavailable'> {
    const nothingYet: SearchResults = {
      query: q,
      mode: 'exact',
      groups: [],
      total: 0,
      capped: false,
      tookMs: 0,
      catchingUp: true,
    };
    return this.#use((index) => {
      const results = index.search(q, options);
      return this.#state === 'catching-up' ? { ...results, catchingUp: true } : results;
    }, nothingYet);
  }

  preview(
    conversationId: string,
    anchor: string | undefined,
    q: string,
  ): Promise<SearchPreview | null | 'unavailable'> {
    return this.#use((index) => index.preview(conversationId, anchor, q), null);
  }

  /** A stretch of one conversation, for the assistant's `read_chat` (ADR 0059). */
  slice(
    conversationId: string,
    options: Parameters<SearchIndex['slice']>[1],
  ): Promise<SearchSlice | null | 'unavailable'> {
    return this.#use((index) => index.slice(conversationId, options), null);
  }

  /** Wait for pending indexing (tests). */
  async settled(id?: string): Promise<void> {
    await this.#work;
    await this.#indexer?.settled(id);
  }

  close(): void {
    this.#generation++;
    try {
      this.#index?.close();
    } catch {
      // Already closed.
    }
    this.#index = undefined;
    this.#indexer = undefined;
  }

  /**
   * Run `query` on the index once it's open. A broken index starts its
   * rebuild and the answer is `rebuilding` ("catching up") instead of an error;
   * so is one that was replaced while this request was on its way.
   */
  async #use<T>(query: (index: SearchIndex) => T, rebuilding: T): Promise<T | 'unavailable'> {
    await this.#work;
    if (this.#state === 'catching-up' && this.#indexer)
      await Promise.race([this.#indexer.ready, wait(this.deps.waitMs ?? 3_000)]);
    const index = this.#index;
    const generation = this.#generation;
    if (this.#state === 'unavailable' || !index) return 'unavailable';
    try {
      return query(index);
    } catch (error) {
      if (generation === this.#generation) {
        if (!isBroken(error)) throw error;
        this.#failed(error, generation);
      }
      // Read through the getter: `#failed` may have just changed it.
      return this.state === 'unavailable' ? 'unavailable' : rebuilding;
    }
  }

  #attach(index: SearchIndex, done?: string) {
    const generation = ++this.#generation;
    this.#index = index;
    this.#indexer = new SearchIndexer(index, this.deps.source, (error) =>
      this.#failed(error, generation),
    );
    this.#state = 'catching-up';
    void this.#indexer.start().then(() => {
      if (generation !== this.#generation || this.#state !== 'catching-up') return;
      this.#state = 'ready';
      // Said once the chats are back in, so the note is true when it's read.
      if (done) this.deps.heal?.('search', done);
    });
  }

  /** Something failed while indexing or searching `generation`'s index. */
  #failed(error: unknown, generation: number) {
    if (generation !== this.#generation) return; // An index already replaced.
    if (!isBroken(error)) {
      this.deps.log?.(error);
      return;
    }
    // Whatever else the broken index reports now is this same failure.
    this.#generation++;
    this.#automatic(error, 'Search stopped working, so Conch rebuilt its index from your chats.');
  }

  /** The one rebuild per run Conch does on its own; after that, `unavailable` until Repair. */
  #automatic(error: unknown, note: string) {
    this.deps.log?.(error);
    if (this.#rebuilt) {
      this.close();
      this.#state = 'unavailable';
      return;
    }
    this.#rebuilt = true;
    this.#state = 'catching-up';
    this.#work = this.#work.then(() => this.#rebuild(note));
  }

  /**
   * Set the broken index aside and start a fresh one, filled from the chats.
   * `note` says what happened, once it's done (a Repair isn't noted).
   */
  async #rebuild(note?: string) {
    this.close();
    const { path } = this.deps;
    try {
      // Derived data holding every chat's text: keep one copy to look at, no more.
      if (existsSync(path)) await setAside(path, { keep: 1 });
      for (const extra of ['-wal', '-shm']) rmSync(`${path}${extra}`, { force: true });
    } catch {
      // It stays where it is (another program has it open): build one in memory
      // for this run, and try the file again next start.
      this.#attachOrGiveUp(
        ':memory:',
        note &&
          'The search index was in use by another program, so Conch rebuilt it in memory for now.',
      );
      return;
    }
    this.#attachOrGiveUp(path, note);
  }

  #attachOrGiveUp(path: string, note: string | undefined) {
    try {
      this.#attach(new SearchIndex(path), note);
    } catch (error) {
      this.deps.log?.(error);
      this.#state = 'unavailable';
    }
  }
}
