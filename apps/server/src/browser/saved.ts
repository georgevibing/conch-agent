import { join } from 'node:path';

import { z } from 'zod';

import { writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** Chats whose tabs are kept; the ones browsed longest ago go first. */
const CHATS_KEPT = 200;

/** One chat's tabs, in order, and which one was in view. */
export interface SavedChat {
  urls: string[];
  active: number;
  at: number;
}

const SavedChat = z.object({
  urls: z.array(z.string().max(8192)).max(16),
  active: z.number().int().min(0),
  at: z.number(),
});

const SavedFile = z.object({
  version: z.literal(1).default(1),
  chats: z.record(z.string(), SavedChat).default({}),
});
type SavedFile = z.infer<typeof SavedFile>;

/** Only real pages come back: not blank tabs, error pages or Conch's own notices. */
export function restorable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * `~/.conch/browser/tabs.json`: each chat's open tabs, so they open again
 * after the browser stops, crashes or Conch restarts, the way a browser
 * restores its last session. Reads are from memory; writes are coalesced.
 */
export class SavedTabs {
  #data?: Promise<SavedFile>;
  #timer?: NodeJS.Timeout;
  #writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {}

  get #path() {
    return join(this.home, 'browser', 'tabs.json');
  }

  #read(): Promise<SavedFile> {
    this.#data ??= readStore(this.#path, SavedFile, {
      onRepair: () => this.heal?.('browser', 'Started the list of open tabs afresh'),
    }).then(
      (read) => read.value,
      () => SavedFile.parse({}),
    );
    return this.#data;
  }

  async get(conversationId: string): Promise<SavedChat | undefined> {
    return (await this.#read()).chats[conversationId];
  }

  async set(conversationId: string, chat: SavedChat | undefined): Promise<void> {
    const data = await this.#read();
    if (!chat && !(conversationId in data.chats)) return;
    const others = Object.entries(data.chats).filter(([id]) => id !== conversationId);
    const all = chat ? [...others, [conversationId, chat] as const] : others;
    // The chats browsed longest ago go first.
    data.chats = Object.fromEntries(all.sort(([, a], [, b]) => b.at - a.at).slice(0, CHATS_KEPT));
    this.#schedule();
  }

  async clear(): Promise<void> {
    const data = await this.#read();
    data.chats = {};
    this.#schedule();
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => void this.flush(), 300);
    this.#timer.unref();
  }

  /** Write what's pending now (on shutdown, and in tests). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const data = this.#data;
    if (!data) return;
    this.#writing = this.#writing
      .then(async () => writeJson(this.#path, await data))
      .catch(() => undefined);
    await this.#writing;
  }
}
