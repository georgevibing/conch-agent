import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ChatImportRun,
  ChatSourceId,
  ConversationEvent,
  type PastChatDetail,
  PastChatId,
  type PastChatMessage,
  type PastChatSummary,
} from '@conch/protocol';
import { z } from 'zod';

import { titleFrom } from '../../conversations/summarize';
import { Mutex, removeTree, safeJoin, writeFileAtomic, writeJson } from '../../lib/fs';
import { readStore, type Heal } from '../../lib/recover';

/** `~/.conch/past-chats/`: what came in from other apps (ADR 0111). */
export const PAST_DIR = 'past-chats';

/**
 * One past chat in `index.json`: where it came from and how the file looked
 * when it was read, so bringing them in again reads only what's new or grew.
 */
const Entry = z.object({
  id: PastChatId,
  source: ChatSourceId,
  /** The app's own id for it (a session id, a file's name). */
  key: z.string().min(1).max(400),
  /** The file it was read from, to tell when it has grown. */
  file: z.string().max(4096),
  size: z.number().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  title: z.string().max(200).catch('Untitled chat'),
  project: z.string().max(120).optional().catch(undefined),
  createdAt: z.number().catch(0),
  updatedAt: z.number().catch(0),
  messages: z.number().int().nonnegative().catch(0),
  model: z.string().max(120).optional().catch(undefined),
  /** Read, with nothing in it to keep (only steps, or empty): not read again until it changes. */
  empty: z.boolean().optional().catch(undefined),
});
export type PastEntry = z.infer<typeof Entry>;

const IndexFile = z.object({
  chats: z.array(Entry).default([]),
  last: ChatImportRun.optional().catch(undefined),
});

/** The same id every time the same chat comes in: bringing it in twice is one chat. */
export function pastChatId(source: ChatSourceId, key: string): PastChatId {
  return `pc_${createHash('sha256').update(`${source}\0${key}`).digest('hex').slice(0, 16)}`;
}

/** A message's id carries its app, so a log read without its index still says where it's from. */
const messageId = (source: ChatSourceId, n: number) => `${source}.${n}`;
const sourceOf = (id: string) => ChatSourceId.safeParse(id.slice(0, id.lastIndexOf('.'))).data;

/** A past chat's messages as a log the search index and a carried-on chat read like any other. */
export function toEvents(
  id: string,
  source: ChatSourceId,
  title: string,
  messages: readonly Omit<PastChatMessage, 'id'>[],
): ConversationEvent[] {
  const events: ConversationEvent[] = [];
  let seq = 0;
  const at0 = messages[0]?.at ?? 0;
  events.push({ conversationId: id, seq: seq++, at: at0, type: 'title', title });
  messages.forEach((m, n) => {
    const base = { conversationId: id, at: m.at, messageId: messageId(source, n) };
    if (m.role === 'user') events.push({ ...base, seq: seq++, type: 'user.message', text: m.text });
    else {
      events.push({ ...base, seq: seq++, type: 'assistant.delta', kind: 'text', delta: m.text });
      events.push({ ...base, seq: seq++, type: 'assistant.done' });
    }
  });
  return events;
}

/** The messages back out of a past chat's log. */
export function fromEvents(events: readonly ConversationEvent[]): PastChatMessage[] {
  const out: PastChatMessage[] = [];
  for (const e of events) {
    if (e.type === 'user.message')
      out.push({ id: e.messageId, role: 'user', text: e.text, at: e.at });
    else if (e.type === 'assistant.delta' && e.kind === 'text') {
      const last = out.at(-1);
      if (last?.id === e.messageId) last.text += e.delta;
      else out.push({ id: e.messageId, role: 'assistant', text: e.delta, at: e.at });
    }
  }
  return out;
}

const summaryOf = (e: PastEntry): PastChatSummary => ({
  id: e.id,
  source: e.source,
  title: e.title,
  ...(e.project && { project: e.project }),
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  messages: e.messages,
  ...(e.model && { model: e.model }),
});

/**
 * The past chats Conch brought in: `index.json` lists them, one log each
 * (`<id>.jsonl`, the same events as a chat of Conch's own). The logs are the
 * truth: a damaged list keeps what's still good, and a log it lost is listed
 * again from what the log says.
 */
export class PastChatStore {
  readonly #mutex = new Mutex();
  readonly #dir: string;
  #index?: Promise<{ chats: Map<string, PastEntry>; last?: ChatImportRun }>;

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.#dir = join(home, PAST_DIR);
  }

  get dir() {
    return this.#dir;
  }

  async entries(): Promise<PastEntry[]> {
    return [...(await this.#load()).chats.values()];
  }

  /** Every past chat with something in it, newest first. */
  async list(): Promise<PastChatSummary[]> {
    return (await this.entries())
      .filter((e) => !e.empty)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summaryOf);
  }

  async get(id: string): Promise<PastEntry | undefined> {
    const entry = (await this.#load()).chats.get(id);
    return entry && !entry.empty ? entry : undefined;
  }

  async last(): Promise<ChatImportRun | undefined> {
    return (await this.#load()).last;
  }

  async events(id: string): Promise<ConversationEvent[]> {
    if (!PastChatId.safeParse(id).success) return [];
    try {
      const text = await readFile(safeJoin(this.#dir, `${id}.jsonl`), 'utf8');
      return text.split('\n').flatMap((line) => {
        if (!line) return [];
        try {
          const parsed = ConversationEvent.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async detail(id: string): Promise<PastChatDetail | undefined> {
    const entry = await this.get(id);
    if (!entry) return undefined;
    return { chat: summaryOf(entry), messages: fromEvents(await this.events(id)) };
  }

  /** Keep one chat: its log first, then its line in the list. */
  async put(
    entry: Omit<PastEntry, 'title' | 'messages' | 'createdAt' | 'updatedAt'>,
    chat: { title: string; messages: Omit<PastChatMessage, 'id'>[] },
  ): Promise<PastEntry> {
    const events = toEvents(entry.id, entry.source, chat.title, chat.messages);
    await writeFileAtomic(
      safeJoin(this.#dir, `${entry.id}.jsonl`),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    );
    const full: PastEntry = {
      ...entry,
      title: chat.title.slice(0, 200),
      createdAt: chat.messages[0]?.at ?? 0,
      updatedAt: chat.messages.at(-1)?.at ?? 0,
      messages: chat.messages.length,
    };
    return this.#mutex.run(async () => {
      (await this.#load()).chats.set(entry.id, full);
      return full;
    });
  }

  /** A file read with nothing to keep: noted, so it isn't read again until it changes. */
  async putEmpty(entry: Omit<PastEntry, 'title' | 'messages' | 'createdAt' | 'updatedAt'>) {
    await this.#mutex.run(async () => {
      (await this.#load()).chats.set(entry.id, {
        ...entry,
        title: 'Untitled chat',
        createdAt: 0,
        updatedAt: 0,
        messages: 0,
        empty: true,
      });
    });
  }

  /** Write the list out (every few chats while bringing them in, and at the end). */
  save(last?: ChatImportRun): Promise<void> {
    return this.#mutex.run(async () => {
      const index = await this.#load();
      if (last) index.last = last;
      await writeJson(join(this.#dir, 'index.json'), {
        chats: [...index.chats.values()],
        ...(index.last && { last: index.last }),
      });
    });
  }

  /** Every past chat out of Conch. The other apps keep theirs. */
  removeAll(): Promise<number> {
    return this.#mutex.run(async () => {
      const index = await this.#load();
      const removed = [...index.chats.values()].filter((e) => !e.empty).length;
      await removeTree(this.#dir);
      this.#index = Promise.resolve({ chats: new Map() });
      return removed;
    });
  }

  /** Forget what's in memory (tests, and after a restore). */
  reload() {
    this.#index = undefined;
  }

  #load() {
    this.#index ??= this.#read().catch((error: unknown) => {
      this.#index = undefined;
      throw error;
    });
    return this.#index;
  }

  async #read() {
    let repaired = false;
    const read = await readStore(join(this.#dir, 'index.json'), IndexFile, {
      fallback: () => ({ chats: [] }),
      onRepair: () => (repaired = true),
    });
    const chats = new Map(read.value.chats.map((e) => [e.id, e]));
    if (read.state === 'salvaged' || read.state === 'reset') {
      for (const entry of await this.#fromLogs(chats)) chats.set(entry.id, entry);
      if (repaired) this.heal?.('conversations', 'Rebuilt the list of chats you brought in');
    }
    return { chats, ...(read.value.last && { last: read.value.last }) };
  }

  /**
   * Past chats whose logs are here but the list lost, worked out from the
   * logs. Where their file was isn't known, so the next look reads them again.
   */
  async #fromLogs(known: Map<string, PastEntry>): Promise<PastEntry[]> {
    const names = await readdir(this.#dir).catch(() => [] as string[]);
    const found: PastEntry[] = [];
    for (const name of names) {
      const id = name.slice(0, -'.jsonl'.length);
      if (!name.endsWith('.jsonl') || known.has(id) || !PastChatId.safeParse(id).success) continue;
      const events = await this.events(id).catch(() => []);
      const messages = fromEvents(events);
      const source = messages[0] && sourceOf(messages[0].id);
      if (!source || !messages.length) continue;
      const title = events.find((e) => e.type === 'title');
      found.push({
        id,
        source,
        key: id,
        file: '',
        size: 0,
        mtimeMs: 0,
        title:
          title?.type === 'title'
            ? title.title
            : titleFrom(messages.find((m) => m.role === 'user')?.text ?? 'Untitled chat'),
        createdAt: messages[0]?.at ?? 0,
        updatedAt: messages.at(-1)?.at ?? 0,
        messages: messages.length,
      });
    }
    return found;
  }
}
