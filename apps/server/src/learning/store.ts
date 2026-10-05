/**
 * What quiet learning keeps (ADR 0087), in `~/.conch/learning/`:
 *
 * - `ledger.json`: the record of everything learned, newest first, with where
 *   it came from, what it replaced and how it stands now (Why?, Undo);
 * - `never.json`: what the person took back once, never learned again;
 * - `chats.json`: how far each chat was read, the chats marked "Don't learn
 *   from this chat", and the day's count.
 *
 * Each is read through `readStore`: a damaged file is set aside and started
 * again, with a note under "Fixed on its own". The agent can't reach any of
 * them (`lib/protect.ts`).
 */
import { join } from 'node:path';

import { LearnedEntry, NeverItem } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';

/** Entries kept in the record; the oldest go first. */
export const KEEP_ENTRIES = 500;
/** Things kept on the never-list. */
export const KEEP_NEVER = 500;
/** Chats remembered by how far they were read. */
const KEEP_CHATS = 2000;

const LedgerFile = z.object({
  version: z.literal(1).default(1),
  entries: z.array(LearnedEntry).default([]),
});
type LedgerFile = z.infer<typeof LedgerFile>;

const NeverFile = z.object({
  version: z.literal(1).default(1),
  items: z.array(NeverItem).default([]),
});
type NeverFile = z.infer<typeof NeverFile>;

const ChatState = z.object({
  /** Everything up to this log position was read. */
  reviewed: z.number().int().optional(),
  /** When a look last stopped for want of money or a model: tried again an hour on. */
  tried: z.number().optional(),
  /** Answers in a row that couldn't be read: after two, the words are passed over. */
  unread: z.number().int().nonnegative().optional(),
  /** "Don't learn from this chat". */
  quiet: z.boolean().optional(),
  /** The chat's `updatedAt` when a look last finished: nothing new since means nothing to read. */
  upTo: z.number().optional(),
  /** When it was last touched here (to keep the newest). */
  at: z.number().optional(),
});
export type ChatState = z.infer<typeof ChatState>;

const ChatsFile = z.object({
  version: z.literal(1).default(1),
  chats: z.record(z.string(), ChatState).default({}),
  /** The recap you've seen up to. */
  recapSeen: z.number().optional(),
  /** What was applied by itself today (a day's limit, ADR 0087 § 4). */
  day: z.object({ key: z.string(), applied: z.number().int().nonnegative() }).optional(),
});
type ChatsFile = z.infer<typeof ChatsFile>;

export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class LearningStore {
  readonly #mutex = new Mutex();
  #ledger?: LedgerFile;
  #never?: NeverFile;
  #chats?: ChatsFile;

  constructor(private readonly deps: { home: string; heal?: Heal; now?: () => number }) {}

  get dir() {
    return join(this.deps.home, 'learning');
  }

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  async #read<S extends z.ZodType>(name: string, schema: S, what: string): Promise<z.output<S>> {
    return (
      await readStore(join(this.dir, name), schema, {
        onRepair: () =>
          this.deps.heal?.(
            'settings',
            `${what} couldn’t be read, so Conch kept a copy and started again.`,
          ),
      })
    ).value;
  }

  async #loadLedger(): Promise<LedgerFile> {
    this.#ledger ??= await this.#read(
      'ledger.json',
      LedgerFile,
      'The record of what Conch learned',
    );
    return this.#ledger;
  }

  async #loadNever(): Promise<NeverFile> {
    this.#never ??= await this.#read('never.json', NeverFile, 'What Conch won’t learn again');
    return this.#never;
  }

  async #loadChats(): Promise<ChatsFile> {
    this.#chats ??= await this.#read('chats.json', ChatsFile, 'How far Conch had read your chats');
    return this.#chats;
  }

  // ── The record ─────────────────────────────────────────────────────────

  async entries(): Promise<LearnedEntry[]> {
    return [...(await this.#mutex.run(() => this.#loadLedger())).entries];
  }

  async entry(id: string): Promise<LearnedEntry | undefined> {
    return (await this.entries()).find((e) => e.id === id);
  }

  /** The newest entry that made this memory, if Conch made it. */
  async byMemory(memoryId: string): Promise<LearnedEntry | undefined> {
    return (await this.entries()).find((e) => e.after.id === memoryId);
  }

  /** A new entry, its id made here when it has none. */
  record(entry: Omit<LearnedEntry, 'id'> & { id?: string }): Promise<LearnedEntry> {
    return this.#mutex.run(async () => {
      const file = await this.#loadLedger();
      const made = LearnedEntry.parse({ ...entry, id: entry.id ?? newId('le') });
      file.entries = [made, ...file.entries.filter((e) => e.id !== made.id)].slice(0, KEEP_ENTRIES);
      await writeJson(join(this.dir, 'ledger.json'), file);
      return made;
    });
  }

  /** Change one entry; `undefined` when it isn't there any more. */
  update(
    id: string,
    change: (entry: LearnedEntry) => LearnedEntry,
  ): Promise<LearnedEntry | undefined> {
    return this.#mutex.run(async () => {
      const file = await this.#loadLedger();
      const at = file.entries.findIndex((e) => e.id === id);
      const current = file.entries[at];
      if (!current) return undefined;
      const next = LearnedEntry.parse(change(current));
      file.entries[at] = next;
      await writeJson(join(this.dir, 'ledger.json'), file);
      return next;
    });
  }

  // ── Never again ────────────────────────────────────────────────────────

  async never(): Promise<NeverItem[]> {
    return [...(await this.#mutex.run(() => this.#loadNever())).items];
  }

  addNever(text: string, from: NeverItem['from']): Promise<NeverItem | undefined> {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return Promise.resolve(undefined);
    return this.#mutex.run(async () => {
      const file = await this.#loadNever();
      const same = file.items.find((i) => i.text.toLowerCase() === clean.toLowerCase());
      if (same) return same;
      const item = NeverItem.parse({ id: newId('nv'), text: clean, at: this.#now, from });
      file.items = [item, ...file.items].slice(0, KEEP_NEVER);
      await writeJson(join(this.dir, 'never.json'), file);
      return item;
    });
  }

  /** You put it back yourself: these words come off the list. */
  forgive(text: string): Promise<boolean> {
    const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
    return this.#mutex.run(async () => {
      const file = await this.#loadNever();
      const before = file.items.length;
      file.items = file.items.filter((i) => i.text.toLowerCase() !== clean);
      if (file.items.length === before) return false;
      await writeJson(join(this.dir, 'never.json'), file);
      return true;
    });
  }

  removeNever(id: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const file = await this.#loadNever();
      const before = file.items.length;
      file.items = file.items.filter((i) => i.id !== id);
      if (file.items.length === before) return false;
      await writeJson(join(this.dir, 'never.json'), file);
      return true;
    });
  }

  // ── Chats ──────────────────────────────────────────────────────────────

  async chat(id: string): Promise<ChatState> {
    return { ...(await this.#mutex.run(() => this.#loadChats())).chats[id] };
  }

  setChat(id: string, patch: Partial<ChatState>): Promise<ChatState> {
    return this.#mutex.run(async () => {
      const file = await this.#loadChats();
      const next = ChatState.parse({ ...file.chats[id], ...patch, at: this.#now });
      file.chats[id] = next;
      const all = Object.entries(file.chats);
      if (all.length > KEEP_CHATS)
        // The newest are kept, and every chat marked quiet.
        file.chats = Object.fromEntries(
          all
            .sort(
              ([, a], [, b]) =>
                Number(Boolean(b.quiet)) - Number(Boolean(a.quiet)) || (b.at ?? 0) - (a.at ?? 0),
            )
            .slice(0, KEEP_CHATS),
        );
      await writeJson(join(this.dir, 'chats.json'), file);
      return next;
    });
  }

  /** Chats marked "Don't learn from this chat". */
  async quiet(): Promise<string[]> {
    const file = await this.#mutex.run(() => this.#loadChats());
    return Object.entries(file.chats)
      .filter(([, c]) => c.quiet)
      .map(([id]) => id);
  }

  /** What was applied by itself today. */
  async appliedToday(): Promise<number> {
    const file = await this.#mutex.run(() => this.#loadChats());
    return file.day?.key === dayKey(this.#now) ? file.day.applied : 0;
  }

  countApplied(n: number): Promise<void> {
    if (n <= 0) return Promise.resolve();
    return this.#mutex.run(async () => {
      const file = await this.#loadChats();
      const key = dayKey(this.#now);
      file.day = { key, applied: (file.day?.key === key ? file.day.applied : 0) + n };
      await writeJson(join(this.dir, 'chats.json'), file);
    });
  }

  async recapSeen(): Promise<number | undefined> {
    return (await this.#mutex.run(() => this.#loadChats())).recapSeen;
  }

  seeRecap(at: number): Promise<void> {
    return this.#mutex.run(async () => {
      const file = await this.#loadChats();
      file.recapSeen = at;
      await writeJson(join(this.dir, 'chats.json'), file);
    });
  }
}
