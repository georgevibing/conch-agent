/**
 * The transcript, because a plain model API has no memory.
 *
 * Claude Code keeps sessions on disk and resumes them by id; an HTTP API is
 * given the whole conversation on every request. So Conch keeps one file per
 * conversation — `~/.conch/api-sessions/<id>.json`, mode 0600, the provider's
 * own messages verbatim — and `TurnInput.resumeId` is that id.
 *
 * Verbatim matters: Anthropic verifies the signature on a thinking block when
 * it comes back, and silently breaks if `redacted_thinking` blocks are filtered
 * out. So nothing here looks inside a message except to count characters and to
 * find where a turn begins.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Id } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, safeJoin, writeJson } from '../../lib/fs';
import { newId } from '../../lib/ids';
import { isToolPictures } from './pictures';
import type { ApiProviderId, WireMessage } from './types';

/**
 * A safety net for the file itself, far past anything the engine keeps: the
 * engine fits each request to the model's window and summarises what it folds
 * (`context.ts`, ADR 0055), so this only ever bites on a file from somewhere
 * else. The person keeps their scrollback either way (Conch's own event log is
 * the record; this file is only the model's context).
 */
export const MAX_CHARS = 16_000_000;
export const MAX_MESSAGES = 4_000;

const Summary = z.object({
  /** What the model keeps of the turns folded so far. */
  text: z.string(),
  /** How many turns it stands for, in all. */
  turns: z.number().int().nonnegative(),
  at: z.number(),
});

const Transcript = z.object({
  version: z.literal(1),
  provider: z.string(),
  /** The model that wrote most of it; only used to label the session event. */
  model: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(z.record(z.string(), z.unknown())),
  /**
   * The start of the chat, summarised (ADR 0055). Added after version 1 was
   * first written: a version before reads the file without it, as before.
   */
  summary: Summary.optional(),
  /** Where each turn's message sits in the chat's log, one per turn in `messages`. */
  seqs: z.array(z.number().int().nullable()).optional(),
  /** The provider's real token count over Conch's estimate, for this chat. */
  factor: z.number().positive().optional(),
  /** The last turn paused to check in, and why (ADR 0069): the next one is told, so it carries on. */
  paused: z.enum(['steps', 'tokens', 'time', 'loop']).optional(),
  /** Tools this chat has loaded in lean mode (ADR 0070), kept so they stay loaded. */
  revealed: z.array(z.string()).optional(),
});
type Transcript = z.infer<typeof Transcript>;

/** A chat's transcript as the engine works with it. */
export interface Session {
  messages: WireMessage[];
  summary?: { text: string; turns: number; at: number };
  /** One per turn start in `messages`: its place in the chat's log, when known. */
  seqs: (number | null)[];
  factor?: number;
  paused?: Transcript['paused'];
  revealed?: string[];
}

/** How many messages start a turn. */
function turnsIn(messages: readonly WireMessage[]): number {
  let n = 0;
  for (const message of messages) if (startsTurn(message)) n++;
  return n;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a message opens a new turn. A user message does — unless it only
 * carries tool results, which is how Anthropic answers a tool call, or a
 * tool's pictures (ADR 0070): both are the middle of a turn, not the start.
 */
export function startsTurn(message: WireMessage): boolean {
  if (message['role'] !== 'user') return false;
  if (isToolPictures(message)) return false;
  const content = message['content'];
  if (!Array.isArray(content)) return true;
  return !content.every((block) => isRecord(block) && block['type'] === 'tool_result');
}

/**
 * Drop whole turns from the front until the transcript fits the budget. Whole
 * turns, because a lone tool result (or an assistant's tool call with no answer)
 * is not a conversation either provider will accept.
 */
export function trim(messages: WireMessage[]): WireMessage[] {
  const starts = messages.map((m, i) => (startsTurn(m) ? i : -1)).filter((i) => i > 0);
  const tooBig = (kept: WireMessage[]) =>
    kept.length > MAX_MESSAGES || JSON.stringify(kept).length > MAX_CHARS;
  let kept = messages;
  for (const start of starts) {
    if (!tooBig(kept)) break;
    kept = messages.slice(start);
  }
  return kept;
}

export class TranscriptStore {
  #mutex = new Mutex();

  constructor(private readonly dir: string) {}

  /** A fresh conversation id, safe as a file name by construction. */
  static newId(): string {
    return newId('api');
  }

  #path(id: string): string {
    // Belt and braces: the id is validated at the edge, checked here, and
    // `safeJoin` still refuses anything that isn't a plain file name.
    if (!Id.safeParse(id).success) throw new Error('That conversation id isn’t one Conch made.');
    return safeJoin(this.dir, `${id}.json`);
  }

  /** Whether an id is one this store could hold. */
  static valid(id: string): boolean {
    return Id.safeParse(id).success && !id.includes('.');
  }

  /**
   * The messages to replay. A file that's missing, corrupt, or written by the
   * other provider reads as an empty transcript: a new chat is a better outcome
   * than a turn that can't start.
   */
  async load(id: string, provider: ApiProviderId): Promise<WireMessage[]> {
    return (await this.open(id, provider)).messages;
  }

  /**
   * The whole session: messages, the summary of what was folded, and where
   * each turn sits in the chat. Places that don't line up with the turns (a
   * file a version before wrote) read as unknown rather than wrong.
   */
  async open(id: string, provider: ApiProviderId): Promise<Session> {
    let raw: unknown;
    try {
      raw = await readJson(this.#path(id));
    } catch {
      return { messages: [], seqs: [] };
    }
    if (raw === undefined) return { messages: [], seqs: [] };
    const parsed = Transcript.safeParse(raw);
    if (!parsed.success || parsed.data.provider !== provider) return { messages: [], seqs: [] };
    const { messages, summary, seqs, factor, paused, revealed } = parsed.data;
    const turns = turnsIn(messages);
    return {
      messages,
      ...(summary && { summary }),
      seqs: seqs?.length === turns ? seqs : Array.from({ length: turns }, () => null),
      ...(factor && { factor }),
      ...(paused && { paused }),
      ...(revealed?.length && { revealed: revealed.filter((n) => n.length <= 128).slice(-64) }),
    };
  }

  /** Save the transcript and hand back exactly the messages written. */
  async save(
    id: string,
    input: {
      provider: ApiProviderId;
      model?: string;
      messages: WireMessage[];
      summary?: Session['summary'];
      seqs?: Session['seqs'];
      factor?: number;
      paused?: Session['paused'];
      revealed?: string[];
    },
  ): Promise<WireMessage[]> {
    const messages = trim(input.messages);
    const dropped = turnsIn(input.messages) - turnsIn(messages);
    const seqs =
      input.seqs?.length === turnsIn(input.messages) ? input.seqs.slice(dropped) : undefined;
    await this.#mutex.run(async () => {
      const path = this.#path(id);
      const existing = Transcript.safeParse(await readJson(path));
      const now = Date.now();
      const next: Transcript = {
        version: 1,
        provider: input.provider,
        ...(input.model && { model: input.model }),
        createdAt: existing.success ? existing.data.createdAt : now,
        updatedAt: now,
        messages,
        ...(input.summary && { summary: input.summary }),
        ...(seqs && { seqs }),
        ...(input.factor && { factor: input.factor }),
        ...(input.paused && { paused: input.paused }),
        ...(input.revealed?.length && { revealed: input.revealed.slice(-64) }),
      };
      // `writeJson` is atomic and 0600 — a transcript is as private as a chat.
      await writeJson(path, next);
    });
    return messages;
  }
}

/** Where transcripts live for a given Conch home. */
export function sessionsDir(home: string): string {
  return join(home, 'api-sessions');
}

/**
 * Conch's home, for a variant nobody passed one to. `services.ts` has the real
 * value (`config.CONCH_HOME`, which `CONCH_HOME` can move) and should pass it;
 * this is the same default that config uses, so a stray engine still writes
 * somewhere sensible.
 */
export function defaultHome(): string {
  return join(homedir(), '.conch');
}
