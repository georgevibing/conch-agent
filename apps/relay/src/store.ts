/**
 * Where a relay keeps its queue (ADR 0140). Only ciphertext and a little
 * metadata ever reach it: a delivery's id, when it came, when it expires, its
 * size, and the tag of the hook it came to (a hash, not the hook's address).
 */

export interface StoredItem {
  id: string;
  receivedAt: number;
  expiresAt: number;
  /** `hookTag` of the address it came to: for the per-address quota. */
  tag: string;
  /** Bytes of ciphertext, for the size bound. */
  size: number;
  /** HPKE's `enc`, base64url. */
  enc: string;
  /** The ciphertext, base64url. */
  ct: string;
}

export interface RelayStore {
  /** Everything kept, any order. */
  load(): Promise<{ items: StoredItem[]; tags: string[] }>;
  put(item: StoredItem): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** The hooks the gateway serves, by tag. */
  setTags(tags: string[]): Promise<void>;
}

/** A queue in memory: tests, and a relay that can afford to forget on restart. */
export class MemoryStore implements RelayStore {
  items = new Map<string, StoredItem>();
  tags: string[] = [];

  load() {
    return Promise.resolve({ items: [...this.items.values()], tags: [...this.tags] });
  }

  put(item: StoredItem) {
    this.items.set(item.id, item);
    return Promise.resolve();
  }

  remove(ids: string[]) {
    for (const id of ids) this.items.delete(id);
    return Promise.resolve();
  }

  setTags(tags: string[]) {
    this.tags = [...tags];
    return Promise.resolve();
  }
}

/** The smallest key–value storage both a Durable Object and a test can offer. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string[]): Promise<unknown>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

/** The queue in key–value storage (a Cloudflare Durable Object's). */
export class KeyValueStore implements RelayStore {
  readonly #kv: KeyValue;

  constructor(kv: KeyValue) {
    this.#kv = kv;
  }

  async load() {
    const items = [...(await this.#kv.list<StoredItem>({ prefix: 'item:' })).values()];
    const tags = (await this.#kv.get<string[]>('tags')) ?? [];
    return { items, tags };
  }

  put(item: StoredItem) {
    return this.#kv.put(`item:${item.id}`, item);
  }

  async remove(ids: string[]) {
    if (ids.length) await this.#kv.delete(ids.map((id) => `item:${id}`));
  }

  setTags(tags: string[]) {
    return this.#kv.put('tags', tags);
  }
}
