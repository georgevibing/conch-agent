/**
 * Your past chats from other apps (ADR 0111).
 *
 * 1. **Find.** `status()` looks where each app keeps its chats (Claude Code,
 *    Codex, Gemini CLI, OpenCode, Copilot, OpenClaw, Hermes): names and sizes,
 *    a peek at most, so it's cheap enough for every Settings open. Nobody is
 *    asked for a folder.
 * 2. **Bring in.** `run()` reads only what's new or has grown since last time,
 *    one file at a time and streamed (a session of hundreds of megabytes never
 *    sits in memory), keeps what you and the assistant said (never a tool's
 *    output or the model's thinking), takes out anything that looks like a
 *    secret, and writes each as a past chat of Conch's (`PastChatStore`). The
 *    same chat brought in twice is one chat. Once you've said yes, the new
 *    ones come in by themselves (`keepUp`).
 * 3. **Use.** Past chats are found by ⌘K and the assistant's `search_chats` /
 *    `read_chat`, marked as from outside (what they say is information, never
 *    orders), and never learned from. **Carry on here** starts a chat of
 *    Conch's own with the same provider where it's connected.
 *
 * The other apps' files are only ever read, never followed out through a link,
 * and never changed.
 */
import { homedir } from 'node:os';
import { setImmediate as breathe } from 'node:timers/promises';

import {
  CHAT_SOURCE_LABELS,
  type ChatImportRun,
  type ChatImportStatus,
  type ChatProject,
  type ChatSourceFound,
  type ChatSourceId,
  type PastChatDetail,
  type PastChatSummary,
} from '@conch/protocol';

import { scrubSecrets } from '../../search/past';
import { titleFrom } from '../../conversations/summarize';
import { claudeCode } from './claude';
import { codex } from './codex';
import { copilotChats } from './copilot';
import { geminiCli } from './gemini';
import { hermesChats } from './hermes';
import { opencode } from './opencode';
import { openclawChats } from './openclaw';
import { type ChatFinder, projectOf, type SessionFile } from './read';
import { type PastEntry, pastChatId, type PastChatStore } from './store';

/** Every app Conch reads chats from, in the order a person meets them. */
export const FINDERS: readonly ChatFinder[] = [
  claudeCode,
  codex,
  geminiCli,
  opencode,
  copilotChats,
  openclawChats,
  hermesChats,
];

/** A look at the files is kept this long: Settings opens often, the files change slowly. */
const SCAN_MS = 60_000;
/** The list is written, and search told, every this many chats while bringing them in. */
const BATCH = 25;
const SECRET = '•••';

export class ChatImportError extends Error {
  constructor(
    readonly code: 'not-found' | 'busy' | 'nothing',
    message: string,
  ) {
    super(message);
  }
}

export interface ChatImportDeps {
  store: PastChatStore;
  /** Whose home folder to look in (tests point it at a fixture). */
  sourceHome?: string;
  env?: NodeJS.ProcessEnv;
  finders?: readonly ChatFinder[];
  /** Every secret Passwords has handed out, as ••• (the vault's redactor). */
  redact?: (text: string) => string;
  /**
   * The providers' own session ids behind Conch's own chats: Conch drives
   * Claude Code itself, so its sessions are already chats here.
   */
  ownSessions?: () => Promise<Set<string>>;
  /** Past chats came in or went: search catches up. */
  changed?: () => void;
  /** Start a chat of Conch's own from a past one (`ConversationManager.adopt`). */
  carryOn?: (chat: PastChatDetail) => Promise<string>;
  now?: () => number;
  log?: (error: unknown) => void;
}

/** How many times a secret's ••• appear in text: to count what was taken out. */
const dots = (text: string) => text.split(SECRET).length - 1;

interface Running {
  done: number;
  total: number;
  current?: string;
  job?: Promise<ChatImportRun>;
}

export class ChatImportService {
  #scan?: { at: number; files: SessionFile[] };
  #scanning?: Promise<SessionFile[]>;
  #running?: Running;

  constructor(private readonly deps: ChatImportDeps) {}

  get store() {
    return this.deps.store;
  }

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  get #finders() {
    return this.deps.finders ?? FINDERS;
  }

  /** Every chat file on this computer, looked at once a minute at most. */
  async #files(fresh = false): Promise<SessionFile[]> {
    if (!fresh && this.#scan && this.#now - this.#scan.at < SCAN_MS) return this.#scan.files;
    this.#scanning ??= (async () => {
      const home = this.deps.sourceHome ?? homedir();
      const env = this.deps.env ?? process.env;
      const own = (await this.deps.ownSessions?.().catch(() => undefined)) ?? new Set<string>();
      const files: SessionFile[] = [];
      for (const finder of this.#finders) {
        const found = await finder.find(home, env).catch((error: unknown) => {
          this.deps.log?.(error);
          return [];
        });
        files.push(...found.filter((f) => !own.has(f.key)));
      }
      this.#scan = { at: this.#now, files };
      return files;
    })().finally(() => (this.#scanning = undefined));
    return this.#scanning;
  }

  /** Whether a file is new to Conch, or has changed since it was read. */
  #isFresh(file: SessionFile, known: Map<string, PastEntry>) {
    const entry = known.get(pastChatId(file.source, file.key));
    return !entry || entry.size !== file.size || entry.mtimeMs !== file.mtimeMs;
  }

  /** What's on this computer, what's new, and what's in Conch already. */
  async status(): Promise<ChatImportStatus> {
    const files = await this.#files();
    const known = new Map((await this.store.entries()).map((e) => [e.id, e]));
    const bySource = new Map<ChatSourceId, SessionFile[]>();
    for (const f of files) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
    const sources: ChatSourceFound[] = [];
    for (const finder of this.#finders) {
      const list = (bySource.get(finder.id) ?? []).filter(
        // A file read before with nothing in it isn't a conversation.
        (f) => !known.get(pastChatId(f.source, f.key))?.empty || this.#isFresh(f, known),
      );
      if (!list.length) continue;
      const counts = new Map<string, number>();
      for (const f of list) {
        const project = f.project ?? known.get(pastChatId(f.source, f.key))?.project;
        if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
      }
      const projects: ChatProject[] = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([name, count]) => ({ name, count }));
      const times = list.map((f) => f.mtimeMs).filter((t) => t > 0);
      sources.push({
        id: finder.id,
        label: CHAT_SOURCE_LABELS[finder.id],
        found: list.length,
        fresh: list.filter((f) => this.#isFresh(f, known)).length,
        projects,
        ...(times.length && { from: Math.min(...times), to: Math.max(...times) }),
      });
    }
    const last = await this.store.last();
    const running = this.#running;
    return {
      sources,
      brought: [...known.values()].filter((e) => !e.empty).length,
      ...(running && {
        running: {
          done: running.done,
          total: running.total,
          ...(running.current && { current: running.current }),
        },
      }),
      ...(last && { last }),
    };
  }

  /**
   * Bring in what's new from `sources` (every app found, when left out). It
   * runs in the background; `status().running` says where it is. Asking again
   * while it runs gets the same run.
   */
  start(sources?: readonly ChatSourceId[]): Promise<ChatImportRun> {
    if (this.#running?.job) return this.#running.job;
    const state: Running = { done: 0, total: 0 };
    this.#running = state;
    const job = this.#run(state, sources).finally(() => {
      if (this.#running === state) this.#running = undefined;
    });
    state.job = job;
    return job;
  }

  async #run(state: Running, only?: readonly ChatSourceId[]): Promise<ChatImportRun> {
    const files = await this.#files(true);
    const known = new Map((await this.store.entries()).map((e) => [e.id, e]));
    const wanted = files.filter(
      (f) => (!only || only.includes(f.source)) && this.#isFresh(f, known),
    );
    // Newest first: the chats someone remembers best are in Conch soonest.
    wanted.sort((a, b) => b.mtimeMs - a.mtimeMs);
    state.total = wanted.length;
    const finders = new Map(this.#finders.map((f) => [f.id, f]));
    const run: ChatImportRun = { at: this.#now, added: 0, updated: 0, skipped: 0, redacted: 0 };
    const clean = (text: string) => scrubSecrets(this.deps.redact ? this.deps.redact(text) : text);

    for (const file of wanted) {
      state.current = CHAT_SOURCE_LABELS[file.source];
      const id = pastChatId(file.source, file.key);
      const before = known.get(id);
      const base = {
        id,
        source: file.source,
        key: file.key,
        file: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
      };
      try {
        const session = await finders.get(file.source)?.read(file);
        if (!session) {
          await this.store.putEmpty({ ...base, ...(file.project && { project: file.project }) });
        } else {
          const messages = session.messages.map((m) => {
            const text = clean(m.text);
            run.redacted += Math.max(0, dots(text) - dots(m.text));
            return { ...m, text };
          });
          const own = session.title?.replace(/\s+/g, ' ').trim().slice(0, 120);
          const firstYours = messages.find((m) => m.role === 'user')?.text;
          const title = (own && clean(own)) || titleFrom(firstYours ?? '') || 'Untitled chat';
          const project = projectOf(session.cwd) ?? file.project;
          await this.store.put(
            {
              ...base,
              ...(project && { project }),
              ...(session.model && { model: session.model.slice(0, 120) }),
            },
            { title, messages },
          );
          if (before && !before.empty) run.updated += 1;
          else run.added += 1;
        }
      } catch (error) {
        // A file that won't read (damaged, a shape not seen before) stays out; the rest come in.
        run.skipped += 1;
        this.deps.log?.(error);
      }
      state.done += 1;
      if (state.done % BATCH === 0) {
        await this.store.save();
        this.deps.changed?.();
      }
      // Stay responsive: one file, then whatever else is waiting.
      await breathe();
    }
    await this.store.save(run);
    this.#scan = undefined;
    this.deps.changed?.();
    return run;
  }

  /**
   * Once you've brought chats in, the new ones follow by themselves, from
   * the apps you brought them from (working agreement 11: nothing to press).
   * Quiet: nothing is said unless something came in.
   */
  async keepUp(): Promise<ChatImportRun | undefined> {
    if (this.#running || !(await this.store.last())) return undefined;
    const sources = [...new Set((await this.store.entries()).map((e) => e.source))];
    if (!sources.length) return undefined;
    const files = await this.#files(true);
    const known = new Map((await this.store.entries()).map((e) => [e.id, e]));
    if (!files.some((f) => sources.includes(f.source) && this.#isFresh(f, known))) return undefined;
    return this.start(sources);
  }

  list(): Promise<PastChatSummary[]> {
    return this.store.list();
  }

  detail(id: string): Promise<PastChatDetail | undefined> {
    return this.store.detail(id);
  }

  /** Carry a past chat on in Conch: a new chat with its messages, answered by the same app where it can be. */
  async carryOn(id: string): Promise<string> {
    const chat = await this.store.detail(id);
    if (!chat) throw new ChatImportError('not-found', 'That past chat isn’t in Conch any more.');
    if (!this.deps.carryOn)
      throw new ChatImportError('nothing', 'Carrying a past chat on works in Conch itself.');
    return this.deps.carryOn(chat);
  }

  /** Every past chat out of Conch (their apps keep theirs). */
  async removeAll(): Promise<number> {
    if (this.#running) throw new ChatImportError('busy', 'Wait for the chats coming in to finish.');
    const removed = await this.store.removeAll();
    this.#scan = undefined;
    this.deps.changed?.();
    return removed;
  }
}

/** The providers that carry on a chat from each app, the best first (ADR 0111). */
export const CARRY_ON_WITH: Record<ChatSourceId, readonly string[]> = {
  'claude-code': ['claude-code', 'anthropic-api'],
  codex: ['codex-cli', 'codex-agent', 'openai'],
  'gemini-cli': ['gemini-cli', 'gemini'],
  copilot: ['copilot'],
  opencode: [],
  openclaw: [],
  hermes: [],
};
