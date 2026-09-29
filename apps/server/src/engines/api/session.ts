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
import type { ApiProviderId, WireMessage } from './types';

/**
 * How much transcript a turn may carry. Roughly 100k tokens of characters, and
 * a hard message cap so a tool-heavy conversation can't grow without end.
 * Past either, the oldest whole turns are dropped: cheaper and far more
 * predictable than summarising, and the user keeps their scrollback either way
 * (Conch's own event log is the record; this file is only the model's context).
 */
export const MAX_CHARS = 400_000;
export const MAX_MESSAGES = 600;
/** Never send more than this many of the user's turns back. */
export const MAX_TURNS = 40;

const Transcript = z.object({
  version: z.literal(1),
  provider: z.string(),
  /** The model that wrote most of it; only used to label the session event. */
  model: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(z.record(z.string(), z.unknown())),
});
type Transcript = z.infer<typeof Transcript>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a message opens a new turn. A user message does — unless it only
 * carries tool results, which is how Anthropic answers a tool call and is the
 * middle of a turn, not the start of one.
 */
export function startsTurn(message: WireMessage): boolean {
  if (message['role'] !== 'user') return false;
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
  const tooBig = (kept: WireMessage[], turns: number) =>
    kept.length > MAX_MESSAGES || turns > MAX_TURNS || JSON.stringify(kept).length > MAX_CHARS;
  let kept = messages;
  let turns = starts.length + 1;
  for (const start of starts) {
    if (!tooBig(kept, turns)) break;
    kept = messages.slice(start);
    turns -= 1;
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
    let raw: unknown;
    try {
      raw = await readJson(this.#path(id));
    } catch {
      return [];
    }
    if (raw === undefined) return [];
    const parsed = Transcript.safeParse(raw);
    if (!parsed.success || parsed.data.provider !== provider) return [];
    return parsed.data.messages;
  }

  /** Save the trimmed transcript and hand back exactly what was written. */
  async save(
    id: string,
    input: { provider: ApiProviderId; model?: string; messages: WireMessage[] },
  ): Promise<WireMessage[]> {
    const messages = trim(input.messages);
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
