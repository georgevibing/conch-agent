import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ConversationEvent, type ConversationSummary, type EngineId } from '@conch/protocol';

import { Mutex, readJson, safeJoin, writeFileAtomic, writeJson } from '../lib/fs';

export interface ConversationRecord extends ConversationSummary {
  engine: EngineId;
  /** Engine-native session id used to resume (Claude Code session UUID). */
  resumeId?: string;
}

/**
 * `~/.conch/conversations/` — `index.json` with summaries plus one JSONL event
 * log per conversation. Streaming deltas are merged before writing so logs
 * stay small; `seq` stays monotonic so resumable subscriptions keep working.
 */
export class ConversationStore {
  #mutex = new Mutex();
  #index?: Map<string, ConversationRecord>;

  constructor(private readonly dir: string) {}

  async list(): Promise<ConversationRecord[]> {
    return [...(await this.#load()).values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<ConversationRecord | undefined> {
    return (await this.#load()).get(id);
  }

  upsert(record: ConversationRecord): Promise<void> {
    return this.#mutex.run(async () => {
      (await this.#load()).set(record.id, record);
      await this.#saveIndex();
    });
  }

  remove(id: string): Promise<void> {
    return this.#mutex.run(async () => {
      (await this.#load()).delete(id);
      await this.#saveIndex();
      await rm(safeJoin(this.dir, `${id}.jsonl`), { force: true });
    });
  }

  async events(id: string): Promise<ConversationEvent[]> {
    try {
      const text = await readFile(safeJoin(this.dir, `${id}.jsonl`), 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = ConversationEvent.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  saveEvents(id: string, events: ConversationEvent[]): Promise<void> {
    const lines = compact(events).map((e) => JSON.stringify(e));
    return writeFileAtomic(safeJoin(this.dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
  }

  async #load(): Promise<Map<string, ConversationRecord>> {
    if (!this.#index) {
      const records = (await readJson<ConversationRecord[]>(join(this.dir, 'index.json'))) ?? [];
      // A turn (or a title being written) can't survive a restart; don't show stale states.
      this.#index = new Map(
        records.map((r) => [
          r.id,
          { ...r, options: r.options ?? {}, status: 'idle', titling: undefined },
        ]),
      );
    }
    return this.#index;
  }

  #saveIndex() {
    return writeJson(join(this.dir, 'index.json'), [...(this.#index?.values() ?? [])]);
  }
}

/** Merge consecutive deltas of the same message and kind; keeps the last `seq`. */
export function compact(events: ConversationEvent[]): ConversationEvent[] {
  const out: ConversationEvent[] = [];
  for (const event of events) {
    const prev = out.at(-1);
    if (
      event.type === 'assistant.delta' &&
      prev?.type === 'assistant.delta' &&
      prev.messageId === event.messageId &&
      prev.kind === event.kind
    ) {
      out[out.length - 1] = { ...event, delta: prev.delta + event.delta };
    } else if (event.type !== 'status') {
      out.push(event);
    }
  }
  return out;
}
