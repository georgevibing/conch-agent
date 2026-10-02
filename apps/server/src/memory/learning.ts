/**
 * It learns you (ADR 0032, ADR 0041), put together: the search index, the tidy-up and
 * skill suggestions, fed by what you said in your chats — your own words,
 * never a chat app's other people — and the default provider's cheapest model.
 */
import type { ConversationEvent, TaintSource } from '@conch/protocol';

import { describeTaint } from '../conversations/taint';
import { cheapestModel } from '../conversations/title';
import type { Engine } from '../engines/types';
import type { OllamaClient } from '../local/ollama';
import type { Asked } from '../skills/suggest';
import { ollamaEmbedder, type Embedder } from './embed';
import { findMeaningModel } from './index';
import type { Said } from './tidy';

export interface ChatSource {
  list(): Promise<{ id: string; updatedAt: number; origin?: { kind: string } }[]>;
  events(id: string): Promise<ConversationEvent[]>;
}

/** What you said in chats changed since `since`; chats that read something untrusted say so. */
export async function yourWords(chats: ChatSource, since: number): Promise<Said[]> {
  const out: Said[] = [];
  for (const chat of await chats.list()) {
    // A routine's run starts with its own instruction, not something you just said.
    if (chat.updatedAt < since || chat.origin?.kind === 'routine') continue;
    const events = await chats.events(chat.id).catch(() => []);
    const taint: TaintSource[] = events.flatMap((e) => (e.type === 'taint' ? [e.source] : []));
    // Someone else on a chat app: their words aren't yours.
    if (taint.some((t) => t.kind === 'person')) continue;
    const untrusted = taint.length ? describeTaint(taint) : undefined;
    for (const e of events)
      if (e.type === 'user.message' && e.at >= since && e.text.trim())
        out.push({
          conversationId: chat.id,
          text: e.text,
          at: e.at,
          ...(untrusted && { untrusted }),
        });
  }
  return out;
}

export async function yourRequests(chats: ChatSource, since: number): Promise<Asked[]> {
  return (await yourWords(chats, since)).map(({ conversationId, text, at }) => ({
    conversationId,
    text,
    at,
  }));
}

/** The default provider's cheapest model that can complete, for tidy-ups and drafts. */
export async function cheapModel(engine: Engine) {
  if (!engine.complete) return undefined;
  const models = await engine
    .capabilities()
    .then((c) => c.models)
    .catch(() => []);
  const model = cheapestModel(models) ?? engine.smallModel;
  return { complete: engine.complete.bind(engine), ...(model && { model }) };
}

/**
 * Ollama's embedding model, when the person has one (looked up now and then,
 * never more than every few minutes). Conch doesn't offer to pull one any
 * more: its own model (`ondevice.ts`, ADR 0041) is a tenth of the size and
 * needs no Ollama.
 */
export class MeaningModel {
  #found?: { at: number; model?: string };

  constructor(private readonly client: OllamaClient) {}

  async #look() {
    if (this.#found && Date.now() - this.#found.at < 5 * 60_000) return this.#found;
    const running = Boolean(await this.client.version());
    const model = running ? await findMeaningModel(this.client).catch(() => undefined) : undefined;
    this.#found = { at: Date.now(), ...(model && { model }) };
    return this.#found;
  }

  async embedder(): Promise<Embedder | undefined> {
    const found = await this.#look();
    return found.model ? ollamaEmbedder(this.client, found.model) : undefined;
  }
}
