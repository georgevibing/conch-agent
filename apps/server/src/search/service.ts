import { existsSync, rmSync } from 'node:fs';

import type { SearchPreview, SearchResults, SearchState, ServerEvent } from '@conch/protocol';

import { setAside, type Heal } from '../lib/recover';
import { isBroken, SearchIndex, type SearchSlice } from './index';
import { SearchIndexer, type SearchSource } from './indexer';
import { blend, ChatMeaning, type ChatMeaningDeps, type ChatMeaningStatus } from './meaning';

export interface SearchServiceDeps {
  /** `~/.conch/search.db`. */
  path: string;
  source: SearchSource;
  heal?: Heal;
  log?: (error: unknown) => void;
  /** How long a search waits for the catch-up before answering with what's there. */
  waitMs?: number;
  /**
   * Search by meaning too (ADR 0139): vectors in their own file, made with
   * memory's model. Without it, or without a model, search is by words.
   */
  meaning?: Omit<ChatMeaningDeps, 'source' | 'heal' | 'log'>;
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
  readonly #meaning?: ChatMeaning;

  constructor(private readonly deps: SearchServiceDeps) {
    if (deps.meaning)
      this.#meaning = new ChatMeaning({
        ...deps.meaning,
        // The keyword index of the moment: it's replaced when it's rebuilt.
        source: () => (this.#state === 'unavailable' ? undefined : this.#index),
        heal: (message) => deps.heal?.('search', message),
        log: deps.log,
      });
  }

  get state(): SearchState {
    return this.#state;
  }

  /** Open the index (rebuilding it if it won't open). Never throws. */
  open(): void {
    try {
      this.#attach(new SearchIndex(this.deps.path));
    } catch (error) {
      this.#automatic(error, 'Rebuilt search from your chats');
    }
  }

  /** Rebuild because a person asked (Repair): always allowed, never a note. */
  repair(): Promise<SearchState> {
    this.#state = 'catching-up';
    this.#work = this.#work.then(() => this.#rebuild());
    return this.#work.then(() => this.#state);
  }

  onEvent(event: ServerEvent): void {
    // A deleted chat's vectors go at once, whatever the keyword index is doing.
    if (event.type === 'conversation.deleted') this.#meaning?.remove(event.conversationId);
    this.#indexer?.onEvent(event);
  }

  /** A meaning model arrived (or came back): make the vectors it can (ADR 0139). */
  meaningLanded(): Promise<void> {
    return this.#meaning?.wake() ?? Promise.resolve();
  }

  /** How search by meaning is doing, for Repair everything; undefined when it isn't on. */
  async meaningStatus(): Promise<(ChatMeaningStatus & { damaged: boolean }) | undefined> {
    const meaning = this.#meaning;
    if (!meaning) return undefined;
    await this.#work;
    return { ...(await meaning.status()), damaged: meaning.check() === 'damaged' };
  }

  /** Make the vectors again from the chats (Repair). */
  async repairMeaning(): Promise<void> {
    await this.#meaning?.repair();
  }

  /**
   * Results so far. While catching up it waits a moment (a search right after
   * start-up shouldn't miss what's being indexed), then answers with what's
   * there and `catchingUp`.
   */
  async search(
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
    const words = await this.#use((index) => {
      const results = index.search(q, options);
      return this.#state === 'catching-up' ? { ...results, catchingUp: true } : results;
    }, nothingYet);
    // Meaning for a search of every chat with something to search for; finding in one chat is by words.
    if (words === 'unavailable' || !this.#meaning || options.in || words.mode === 'short')
      return words;
    const found = await this.#meaning.search(q).catch((error: unknown) => {
      this.deps.log?.(error);
      return undefined;
    });
    const index = this.#index;
    if (!found?.length || !index) return words;
    try {
      return blend(words, found, index, options.limit ?? 20);
    } catch (error) {
      // The keyword index broke between the two: what words found still stands.
      if (!isBroken(error)) throw error;
      return words;
    }
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

  /** Catch up on chats that came in from elsewhere (ADR 0111): past chats from other apps. */
  async refresh(): Promise<void> {
    await this.#work;
    await this.#indexer?.refresh();
    void this.#meaning?.wake();
  }

  /** Wait for pending indexing (tests). */
  async settled(id?: string): Promise<void> {
    await this.#work;
    await this.#indexer?.settled(id);
  }

  /** Wait for the vectors too (tests). */
  async meaningSettled(): Promise<void> {
    await this.settled();
    await this.#meaning?.wake();
    await this.#meaning?.settled();
  }

  close(): void {
    this.#closeIndex();
    this.#meaning?.close();
  }

  #closeIndex(): void {
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
    this.#indexer = new SearchIndexer(
      index,
      this.deps.source,
      (error) => this.#failed(error, generation),
      (id) => this.#meaning?.changed(id),
    );
    this.#state = 'catching-up';
    void this.#indexer.start().then(() => {
      if (generation !== this.#generation || this.#state !== 'catching-up') return;
      this.#state = 'ready';
      // Said once the chats are back in, so the note is true when it's read.
      if (done) this.deps.heal?.('search', done);
      // Then meaning catches up, in the background (and carries on a backfill a restart cut short).
      void this.#meaning?.wake();
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
    this.#automatic(error, 'Rebuilt search from your chats');
  }

  /** The one rebuild per run Conch does on its own; after that, `unavailable` until Repair. */
  #automatic(error: unknown, note: string) {
    this.deps.log?.(error);
    if (this.#rebuilt) {
      this.#closeIndex();
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
    this.#closeIndex();
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
        note && 'Rebuilt search in memory for now. Another program had it open.',
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
