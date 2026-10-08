/**
 * The small model that writes a story's headline and answers "Why?" on a step
 * (ADR 0103), chosen for the chat by the shared rule (`providers/small.ts`):
 * the chat's own provider on its cheapest model, then another connected one
 * with room, then one on this computer; a private chat only its own or one on
 * this computer. What it costs counts against learning's monthly cap, and
 * nothing that costs money is asked past the month's budget.
 */
import type { Usage } from '@conch/protocol';

import type { Engine } from '../../engines/types';
import type { SmallPick } from '../../providers/small';

export {
  NOT_ASKED_WORDS,
  notAskedWords,
  type NotAsked,
  type SmallModel,
  type SmallPick,
} from '../../providers/small';

export interface SmallModelDeps {
  /** The model for this chat that may be asked now, or why none may. */
  pick(conversationId: string): Promise<SmallPick>;
  /** What it cost, for the month's spend and learning's cap. */
  spent(usage: Usage, engine: Engine, model?: string): void;
}

/** At most `size` at once; the rest wait their turn, and at most `queue` wait. */
export class Limiter {
  #running = 0;
  #waiting: (() => void)[] = [];

  constructor(
    private readonly size: number,
    private readonly queue = 32,
  ) {}

  /** Runs `work` when there's room; undefined at once when too many are waiting. */
  async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.#running >= this.size) {
      if (this.#waiting.length >= this.queue) return undefined;
      // The one finishing hands its place straight over.
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else this.#running++;
    try {
      return await work();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#running--;
    }
  }
}

/** The newest `size` answers, by key. */
export class Recent<V> {
  #map = new Map<string, V>();
  constructor(private readonly size: number) {}

  get(key: string): V | undefined {
    const value = this.#map.get(key);
    if (value === undefined) return undefined;
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.#map.has(key);
  }

  set(key: string, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.size) {
      const oldest = this.#map.keys().next().value;
      if (oldest === undefined) break;
      this.#map.delete(oldest);
    }
  }
}
