import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ChatSpend,
  ConversationEvent,
  ConversationStatus,
  ConversationSummary,
  EngineId,
  Id,
  TurnOptions,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, safeJoin, writeFileAtomic, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { titleFrom } from './summarize';

/** One provider's own session within a conversation. */
export interface EngineSession {
  /** Engine-native id to resume (Claude Code's session UUID, Codex's thread, a transcript name). */
  resumeId: string;
  /** The last event this session has seen; anything later is handed over when it next answers. */
  seq: number;
}

export interface ConversationRecord extends ConversationSummary {
  /** The provider that answered last. */
  engine: EngineId;
  /** Before ADR 0012: the session of `engine`. Read into `sessions` when loaded. */
  resumeId?: string;
  /** Each provider keeps its own session; none can read another's (ADR 0012). */
  sessions?: Partial<Record<EngineId, EngineSession>>;
}

/**
 * One summary in `index.json`. Lenient on purpose: an odd field is put right
 * rather than losing the chat; only an entry without an id can't be kept.
 */
const StoredRecord = z.object({
  id: z.string().min(1),
  title: z.string().catch('Untitled chat'),
  preview: z.string().catch(''),
  createdAt: z.number().catch(0),
  updatedAt: z.number().catch(0),
  status: ConversationStatus.catch('idle'),
  titling: z.boolean().optional().catch(undefined),
  options: TurnOptions.catch({}),
  origin: ConversationSummary.shape.origin.catch(undefined),
  archivedAt: z.number().optional().catch(undefined),
  spend: ChatSpend.optional().catch(undefined),
  engine: EngineId.catch('claude-code'),
  resumeId: z.string().optional().catch(undefined),
  sessions: z
    .partialRecord(EngineId, z.object({ resumeId: z.string(), seq: z.number() }))
    .optional()
    .catch(undefined),
});
const IndexFile = z.array(StoredRecord);

/**
 * `~/.conch/conversations/` — `index.json` with summaries plus one JSONL event
 * log per conversation. Streaming deltas are merged before writing so logs
 * stay small; `seq` stays monotonic so resumable subscriptions keep working.
 *
 * The logs are the truth and the index lists them, so a damaged index is kept
 * aside and rebuilt from the logs: no chat goes missing.
 */
export class ConversationStore {
  #mutex = new Mutex();
  #index?: Promise<Map<string, ConversationRecord>>;
  /** The chats that were mid-turn when Conch last stopped (read once, before they're reset to idle). */
  interrupted: string[] = [];

  constructor(
    private readonly dir: string,
    private readonly heal?: Heal,
  ) {}

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
      // A line that won't read (cut short by a full disk) is skipped, not the whole chat.
      return text
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = ConversationEvent.safeParse(parseLine(line));
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

  #load(): Promise<Map<string, ConversationRecord>> {
    this.#index ??= this.#read().catch((error: unknown) => {
      this.#index = undefined;
      throw error;
    });
    return this.#index;
  }

  async #read(): Promise<Map<string, ConversationRecord>> {
    let repaired = false;
    const read = await readStore(join(this.dir, 'index.json'), IndexFile, {
      fallback: () => [],
      onRepair: () => (repaired = true),
    });
    let records: ConversationRecord[] = read.value;
    if (read.state === 'salvaged' || read.state === 'reset') {
      records = [...records, ...(await this.#fromLogs(new Set(records.map((r) => r.id))))];
      await writeJson(join(this.dir, 'index.json'), records);
      if (repaired)
        this.heal?.(
          'conversations',
          'Your list of chats couldn’t be read, so Conch kept a copy and rebuilt it from the chats themselves.',
        );
    }
    // A turn (or a title being written) can't survive a restart; don't show stale states.
    this.interrupted = records
      .filter((r) => r.status === 'running' || r.status === 'awaiting-permission')
      .map((r) => r.id);
    return new Map(
      records.map((r) => [r.id, { ...r, status: 'idle' as const, titling: undefined }]),
    );
  }

  /** Summaries of the chats whose logs are here but aren't in `known`, worked out from the logs. */
  async #fromLogs(known: Set<string>): Promise<ConversationRecord[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const found: ConversationRecord[] = [];
    for (const name of names) {
      const id = name.slice(0, -'.jsonl'.length);
      if (!name.endsWith('.jsonl') || known.has(id) || !Id.safeParse(id).success) continue;
      const record = recordFromLog(id, await this.events(id).catch(() => []));
      if (record) found.push(record);
    }
    return found;
  }

  async #saveIndex() {
    const index = await this.#load();
    await writeJson(join(this.dir, 'index.json'), [...index.values()]);
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * A chat's summary, worked out from its log: the title it was given (or its
 * first line), what you said last, and who answered last. Which provider
 * session to resume is lost, so the next answer starts a new session and is
 * handed the conversation so far (ADR 0012).
 */
export function recordFromLog(
  id: string,
  events: ConversationEvent[],
): ConversationRecord | undefined {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return undefined;
  let title: string | undefined;
  let firstText: string | undefined;
  let lastText: string | undefined;
  let options: TurnOptions = {};
  let engine: EngineId | undefined;
  for (const event of events) {
    if (event.type === 'title') title = event.title;
    else if (event.type === 'user.message') {
      firstText ??= event.text;
      lastText = event.text;
    } else if (event.type === 'options') options = event.options;
    else if (event.type === 'turn.completed' && event.engine) engine = event.engine;
  }
  return {
    id,
    title: title ?? (firstText ? titleFrom(firstText) : 'Untitled chat'),
    preview: (lastText ?? '').slice(0, 140),
    createdAt: first.at,
    updatedAt: last.at,
    status: 'idle',
    options,
    engine: engine ?? options.engine ?? 'claude-code',
  };
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
