/**
 * The small model that writes a story's headline and answers "Why?" on a step
 * (ADR 0103), and what it may cost: the same rules as quiet learning. The
 * provider that answered the chat first (it has read it already), else one on
 * this computer, else any connected one, but a chat that's private (marked
 * "Don't learn from this chat", a guest's, a routine's or a task's) goes only
 * to its own provider or one on this computer. Only pay-as-you-go money
 * counts, against learning's monthly cap, and nothing is asked past the
 * month's budget.
 */
import type { Usage } from '@conch/protocol';

import type { Completion, CompletionInput, Engine } from '../../engines/types';

export interface SmallModel {
  engine: Engine;
  complete: (input: CompletionInput) => Promise<Completion>;
  model?: string;
}

/** Why there's no one to ask now. */
export type NotAsked = 'none' | 'budget' | 'cap' | 'plan-room';

export interface SmallModelDeps {
  /** The provider for this chat by the rule above, and its cheapest model. */
  model(conversationId: string): Promise<SmallModel | undefined>;
  /** May this provider be asked now (learning's cap, a plan with room, the month's budget)? */
  allow(engine: Engine): Promise<{ ok: true } | { ok: false; reason: NotAsked }>;
  /** What it cost, for the month's spend and learning's cap. */
  spent(usage: Usage, engine: Engine, model?: string): void;
}

/**
 * The provider for a short answer about a chat (`shortAnswerEngine`'s rule),
 * kept to the chat's own provider or one on this computer when the chat is
 * private.
 */
export function smallModelEngine(
  answered: Engine | undefined,
  ready: readonly Engine[],
  options: { private: boolean },
): Engine | undefined {
  const able = ready.filter((engine) => engine.complete);
  return (
    able.find((engine) => engine.id === answered?.id) ??
    able.find((engine) => engine.local) ??
    (options.private ? undefined : able[0])
  );
}

/** Words for each reason there's no answer, for the "Why?" card. */
export const NOT_ASKED_WORDS: Record<NotAsked | 'busy' | 'failed', string> = {
  none: 'None of your providers can answer this. Connect one in Settings → Providers.',
  budget: 'This month’s budget is spent, so Conch isn’t asking a model now.',
  cap: 'Small questions like this reached this month’s limit. Change it in Settings → Usage.',
  'plan-room': 'Your plan is nearly used up, so Conch is saving it for your chats.',
  busy: 'That’s a lot of questions at once. Ask again in a minute.',
  failed: 'Couldn’t get an answer just now. Try again in a moment.',
};

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
