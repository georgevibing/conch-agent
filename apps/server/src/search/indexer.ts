import { setImmediate as nextTick } from 'node:timers/promises';

import type { ConversationEvent, ConversationSummary, ServerEvent } from '@conch/protocol';

import type { SearchIndex } from './index';

interface Source {
  /** Every stored conversation (for the start-up catch-up). */
  list(): Promise<ConversationSummary[]>;
  /** A stored conversation's log, read from disk without caching it. */
  events(id: string): Promise<ConversationEvent[]>;
  /** A live conversation's summary and in-memory log. */
  detail(id: string): Promise<{ conversation: ConversationSummary; events: ConversationEvent[] }>;
}

/**
 * Keeps the search index in step with conversations: catches up on start
 * (only conversations that changed since they were last indexed), then
 * re-indexes a conversation whenever a message is sent or a turn completes.
 * Work for one conversation is serialised so updates never interleave.
 */
export class SearchIndexer {
  #chains = new Map<string, Promise<void>>();
  #ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly index: SearchIndex,
    private readonly source: Source,
    private readonly log: (error: unknown) => void = () => {},
  ) {}

  /** Resolves once the start-up catch-up has finished. */
  get ready() {
    return this.#ready;
  }

  start() {
    this.#ready = this.#catchUp().catch(this.log);
    return this.#ready;
  }

  onEvent(event: ServerEvent) {
    if (event.type === 'conversation.deleted') {
      this.#run(event.conversationId, () => this.index.remove(event.conversationId));
    } else if (event.type === 'conversation.event') {
      const { conversationId, type } = event.event;
      if (type === 'user.message' || type === 'turn.completed' || type === 'title') {
        this.#run(conversationId, async () => {
          const { conversation, events } = await this.source.detail(conversationId);
          this.index.index(conversation, events);
        });
      }
    }
  }

  /** Wait for pending work on a conversation (tests). */
  async settled(id?: string) {
    await this.#ready;
    if (id) await this.#chains.get(id);
    else await Promise.all(this.#chains.values());
  }

  #run(id: string, job: () => void | Promise<void>) {
    const next = (this.#chains.get(id) ?? Promise.resolve())
      .then(job)
      .catch(this.log)
      .finally(() => {
        if (this.#chains.get(id) === next) this.#chains.delete(id);
      });
    this.#chains.set(id, next);
  }

  async #catchUp() {
    const conversations = await this.source.list();
    const alive = new Set(conversations.map((c) => c.id));
    for (const id of this.index.ids()) if (!alive.has(id)) this.index.remove(id);
    for (const conversation of conversations) {
      if (this.index.indexedAt(conversation.id) === conversation.updatedAt) continue;
      const events = await this.source.events(conversation.id);
      this.index.index(conversation, events);
      // Stay responsive while catching up on a long history.
      await nextTick();
    }
  }
}
