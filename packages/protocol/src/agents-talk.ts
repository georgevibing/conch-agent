/**
 * Agents that talk to each other (ADR 0112).
 *
 * - **A round.** Mention agents in a message ("@Researcher find options,
 *   @Writer draft it") and they answer in turn, in the same chat, each
 *   reading what was said before. An agent hands the floor on by writing
 *   `@Name`. A round is bounded: so many turns, so many per agent, no
 *   back-and-forth, and what it may spend. Writing in the chat, or Stop,
 *   ends it.
 * - **Outside agents.** An agent somewhere else that speaks the open A2A
 *   protocol, added by pasting its address. It takes part in a round when
 *   you mention it, and what it says is someone else's words: it taints the
 *   chat and never grants a power.
 *
 * The words a person reads are here too, so the chat, a toast and the
 * documentation say the same.
 */
import { z } from 'zod';

import { AgentId } from './agents';

// ── Outside agents ─────────────────────────────────────────────────────────

/** An outside agent's id: `oa_` and a few letters, never a path. */
export const OutsideAgentId = z.string().regex(/^oa_[A-Za-z0-9_-]{4,40}$/, 'Not an outside agent.');
export type OutsideAgentId = z.infer<typeof OutsideAgentId>;

export const OUTSIDE_LIMITS = {
  /** Outside agents a Conch keeps: a handful of colleagues, never a directory. */
  count: 20,
  /** A name as its card gives it, cut to what fits beside a reply. */
  name: 60,
  description: 400,
  /** What it says in one answer: more than this is cut, and the chat says so. */
  answerChars: 20_000,
  /** How long Conch waits for one answer before it gives up. */
  answerMs: 120_000,
} as const;

/** One thing an outside agent says it can do, from its card. */
export const OutsideSkill = z.object({
  name: z.string().max(80),
  description: z.string().max(300).default(''),
});
export type OutsideSkill = z.infer<typeof OutsideSkill>;

/**
 * An agent elsewhere that speaks A2A, as Conch keeps it. Its key is never
 * here: `keyed` says there is one, kept sealed.
 */
export const OutsideAgent = z.object({
  id: OutsideAgentId,
  name: z.string().max(OUTSIDE_LIMITS.name),
  description: z.string().max(OUTSIDE_LIMITS.description).default(''),
  /** Where its card was read. */
  card: z.string().url().max(2000),
  /** Where messages go, from its card. */
  endpoint: z.string().url().max(2000),
  /** The A2A version it speaks: 1.0, or the 0.3 most agents still answer. */
  protocol: z.enum(['1.0', '0.3']),
  skills: z.array(OutsideSkill).max(12).default([]),
  /** Who runs it, as its card says (an organisation's name): unchecked. */
  by: z.string().max(80).optional(),
  /** It's sent a key with every message. */
  keyed: z.boolean().default(false),
  /** It's on this computer or your own network, not the internet. */
  private: z.boolean().default(false),
  addedAt: z.number(),
  lastUsedAt: z.number().optional(),
  /** The last thing that went wrong talking to it, in a person's words; gone once it answers. */
  problem: z.string().max(200).optional(),
});
export type OutsideAgent = z.infer<typeof OutsideAgent>;

export const OutsideAgentList = z.object({ agents: z.array(OutsideAgent) });
export type OutsideAgentList = z.infer<typeof OutsideAgentList>;

/**
 * What a paste was: an address (its card, or where it lives), and a key if one
 * came with it. One paste, whatever's in it.
 */
export const OutsidePasteBody = z.object({ paste: z.string().trim().min(1).max(4000) });
export type OutsidePasteBody = z.infer<typeof OutsidePasteBody>;

/** What a pasted address turned out to be, before it's added. */
export const OutsidePreview = z.object({
  name: z.string().max(OUTSIDE_LIMITS.name),
  description: z.string().max(OUTSIDE_LIMITS.description),
  skills: z.array(OutsideSkill).max(12),
  by: z.string().max(80).optional(),
  /** The host messages would go to, shown before anything is sent. */
  host: z.string().max(300),
  protocol: z.enum(['1.0', '0.3']),
  private: z.boolean(),
  /** It wants a key, and none came with the paste. */
  needsKey: z.boolean(),
  /** A key came with the paste. */
  keyed: z.boolean(),
  /** Already added, under this id. */
  known: OutsideAgentId.optional(),
});
export type OutsidePreview = z.infer<typeof OutsidePreview>;

// ── Rounds ─────────────────────────────────────────────────────────────────

/** Someone who can have the floor in a round: one of your agents, or an outside one. */
export const RoundSpeaker = z.object({
  id: z.union([AgentId, OutsideAgentId]),
  name: z.string().max(OUTSIDE_LIMITS.name),
  outside: z.boolean().optional(),
});
export type RoundSpeaker = z.infer<typeof RoundSpeaker>;

/**
 * How far a round goes before it stops for you. Fixed, not settings: a round
 * is a few colleagues taking turns, and these keep it that way (OpenClaw's
 * per-pair ping-pong counter missed loops of three, so the total is bounded too).
 */
export const ROUND_LIMITS = {
  /** Replies in one round, outside agents included. */
  turns: 8,
  /** Replies by any one speaker in a round. */
  perSpeaker: 3,
  /** Speakers a message can bring in. */
  speakers: 6,
  /** What one round may spend (USD) before it stops; a plan's work counts nothing. */
  spendUsd: 1,
} as const;

/** Why a round ended. */
export const RoundEnd = z.enum([
  /** Nobody was handed the floor: the last one finished. */
  'done',
  /** It reached `ROUND_LIMITS.turns`. */
  'turns',
  /** Two kept handing it back and forth, or one had spoken its share. */
  'loop',
  /** It reached `ROUND_LIMITS.spendUsd`, or a spending limit of yours. */
  'spend',
  /** You pressed Stop. */
  'stopped',
  /** You wrote in the chat. */
  'you',
  /** A reply didn't finish. */
  'failed',
  /** An agent asked for an outside agent: only you can send to one. */
  'outside',
]);
export type RoundEnd = z.infer<typeof RoundEnd>;

/** What the chat says when a round ends, in a person's words. `done` says nothing. */
export const ROUND_END_WORDS: Record<RoundEnd, string> = {
  done: '',
  turns: `That’s ${ROUND_LIMITS.turns} replies, so they’ve stopped for you. Say what’s next.`,
  loop: 'They were going back and forth, so they’ve stopped here. Over to you.',
  spend: 'This round reached what it may spend, so it stopped. Say carry on to keep going.',
  stopped: 'You stopped the round.',
  you: 'You stepped in, so the round stopped there.',
  failed: 'A reply didn’t finish, so the round stopped there.',
  outside:
    'Only you can send something to an outside agent. Mention it yourself to send it your words.',
};

// ── Mentions ───────────────────────────────────────────────────────────────

/** Anything that can be mentioned: an id and the name people type after `@`. */
export interface Mentionable {
  id: string;
  name: string;
}

/** A letter, a digit or `_`: what can't come right before `@` or right after a name. */
const WORDISH = /[\p{L}\p{N}_]/u;

/** Code is quoted, not addressed: fenced blocks and inline code are left out. */
function withoutCode(text: string): string {
  return text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/**
 * Who a message addresses, in the order it first names them: `@Name` at the
 * start of a word (not an email address), its whole name whatever its case,
 * the longest name first ("@Travel Agent" before "@Travel"). Names in code
 * don't count, and each is named once.
 */
export function mentionsIn<T extends Mentionable>(text: string, roster: readonly T[]): T[] {
  if (!text.includes('@') || !roster.length) return [];
  const plain = withoutCode(text);
  const lower = plain.toLowerCase();
  const byLength = [...roster]
    .filter((r) => r.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const found: T[] = [];
  for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
    const before = i > 0 ? plain[i - 1] : '';
    if (before && (WORDISH.test(before) || before === '@' || before === '.')) continue;
    const rest = lower.slice(i + 1);
    const hit = byLength.find((r) => {
      const name = r.name.toLowerCase();
      if (!rest.startsWith(name)) return false;
      const after = rest[name.length];
      return after === undefined || !WORDISH.test(after);
    });
    if (hit && !found.some((f) => f.id === hit.id)) found.push(hit);
  }
  return found;
}

/**
 * The `@…` being typed at the end of a draft, for the composer's list:
 * what's typed after `@` (possibly nothing), and where the `@` is. Undefined
 * when the draft doesn't end in one.
 */
export function mentionTyped(draft: string): { query: string; at: number } | undefined {
  const match = /(^|[\s(])@([^\s@`]{0,40})$/u.exec(draft);
  if (!match) return undefined;
  const query = match[2] ?? '';
  return { query, at: draft.length - query.length - 1 };
}
