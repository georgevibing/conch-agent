/**
 * The gate (ADR 0088 § 4): each change the review proposes is applied by
 * itself, waits for the person's OK, or is dropped. Dropped first, so nothing
 * unsafe even waits:
 *
 * - not resting on words the person wrote (a model's guess, or a page's);
 * - a secret, a health or money detail;
 * - about the assistant, or an order to it;
 * - a power: acting without asking, trust;
 * - something the person took back once.
 *
 * Only a previous refusal or replacing a waiting memory needs review. Owner
 * evidence survives reading outside material; the store still checks every
 * write for instructions, new destinations and other security signals.
 */
import type { Memory } from '@conch/protocol';

import { tokens } from '../memory/embed';
import { gistIn } from '../memory/guard';
import { SECRET } from '../skills/learn';
import type { Change } from './review';

const HEALTH_OR_MONEY =
  /\b(?:diagnos\w*|medication\w*|prescri\w*|therap(?:y|ist)\w*|depress\w*|anxiety|disorder|illness|disease|pregnan\w*|hiv|cancer|surgery|salary|salaries|income|debt\w*|loan\w*|mortgage|bank account|account number|credit card|card number|iban|ssn|social security|net worth|password\w*|passcode|pin code)\b/i;
/** About the assistant, or an order to it: never a memory about the person. */
const ABOUT_ASSISTANT =
  /\b(?:the assistant|assistant should|you should|you must|you will|system prompt|from now on|going forward|ignore (?:all|any|previous|the)|previous instructions|jailbreak|developer mode)\b/i;
/** An imperative ("Always say…", "Use…"), not a statement about the person ("Always uses metric"). */
const ORDER =
  /^\s*(?:(?:always|never|please)\s+)?(?:do|don'?t|use|reply|respond|answer|write|say|ignore|remember|forget|send|open|run|delete|mention|include|call|ask|tell)\b/i;
/** A power: what would let something act without the person. */
const POWER =
  /\b(?:without asking|don'?t ask|no need to ask|never ask|skip (?:the )?(?:confirm\w*|approval|asking|check\w*)|auto[- ]?approve\w*|full trust|trust(?:ed)? (?:this|the|all|every)|allowed to|permission to|grant\w*|bypass\w*|disable (?:the )?(?:guard|safety|check\w*|sandbox))\b/i;

/** Permission for the current job belongs to that job, never future chats. */
export function taskPermission(text: string): boolean {
  return /\b(?:authoriz\w*|approv\w*|permission)\b.{0,120}\b(?:push|commit|merge|send|delete|install|run|agents?)\b/i.test(
    text,
  );
}

export type Verdict =
  | { verdict: 'apply' }
  | { verdict: 'wait'; waits: string }
  | { verdict: 'drop'; why: string }
  /** Already known: nothing new, counted as seen again. */
  | { verdict: 'seen'; memory: Memory };

export interface GateContext {
  /** The person's own words in the stretch: what a quote must come from. */
  said: readonly string[];
  /** The chat read something from outside: `describeTaint`'s sentence. */
  untrusted?: string;
  /** Someone sees this chat (not a chat app, not another app through Conch). */
  watched: boolean;
  /** Live and waiting memories, by id. */
  memories: ReadonlyMap<string, Memory>;
  /**
   * It's on the never-list: the very same thing (`exact`, dropped), or only
   * close to something there (it waits, saying what).
   */
  refused?: { exact: boolean; text: string };
  /** A live or waiting memory that already says it. */
  duplicate?: Memory;
  appliedThisLook: number;
  appliedToday: number;
  /** Takes saved passwords out of text (ADR 0025): a change it alters is dropped. */
  redact?: (text: string) => string;
}

/** Lowercased letters and digits: quotes compared the way people read them. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

/** A quote long enough to say something: three words, or a dozen letters. */
const QUOTE_WORDS = 3;
const QUOTE_CHARS = 12;

/**
 * Whether a quote is words the person wrote, and what's learned rests on it:
 * whole words of one message (exactly, or nearly for a longer quote), long
 * enough to say something, sharing a word that matters with what's learned.
 * "the" in "there is a bug" grounds nothing.
 */
export function grounded(quote: string, said: readonly string[], text?: string): boolean {
  const q = fold(quote);
  const words = q.split(' ').filter((w) => w.length > 1);
  if (words.length < QUOTE_WORDS && q.length < QUOTE_CHARS) return false;
  // What's learned shares a word that matters with the words it rests on.
  if (text !== undefined) {
    const theirs = new Set(tokens(quote));
    if (!tokens(text).some((t) => t.length >= 3 && theirs.has(t))) return false;
  }
  for (const s of said) {
    const f = fold(s);
    if (` ${f} `.includes(` ${q} `)) return true;
    if (words.length >= QUOTE_WORDS + 1) {
      const have = new Set(f.split(' '));
      if (words.filter((w) => have.has(w)).length / words.length >= 0.8) return true;
    }
  }
  return false;
}

/** "This chat read news.example, which could…" → "Learned in a chat that read news.example." */
export function learnedIn(untrusted: string): string {
  return `Learned in a chat that ${untrusted
    .replace(/^This chat /, '')
    .replace(/, which could be trying to steer me\.?$/, '')
    .replace(/\.$/, '')}.`;
}

/** Why a change can't be kept at all, or nothing when it can. */
export function dropWhy(
  change: Change,
  ctx: GateContext,
  options: { observed?: boolean } = {},
): string | undefined {
  const text = change.text;
  // Facts about this computer are written by code from a template, not quoted.
  if (
    !options.observed &&
    (!grounded(change.quote, ctx.said, text) || gistIn(text, ctx.said) < 0.5)
  )
    return 'it doesn’t rest on words you wrote';
  if (SECRET.test(text) || (ctx.redact && ctx.redact(text) !== text)) return 'something secret';
  if (HEALTH_OR_MONEY.test(text)) return 'health or money';
  if (ABOUT_ASSISTANT.test(text) || ORDER.test(text)) return 'about the assistant, or an order';
  if (POWER.test(text) || taskPermission(text)) return 'a power';
  if (ctx.refused?.exact) return 'you took it back once';
  if (change.op === 'supersede') {
    const target = ctx.memories.get(change.id);
    if (!target) return 'nothing to replace';
    if (target.content.trim().toLowerCase() === text.trim().toLowerCase()) return 'nothing changed';
  }
  return undefined;
}

/** Apply, wait or drop one change (ADR 0088 § 4). */
export function gate(
  change: Change,
  ctx: GateContext,
  options: { observed?: boolean } = {},
): Verdict {
  const why = dropWhy(change, ctx, options);
  if (why) return { verdict: 'drop', why };
  if (change.op === 'add' && ctx.duplicate) return { verdict: 'seen', memory: ctx.duplicate };
  // Close to something you took back: maybe the correction that came next, so you say.
  if (ctx.refused)
    return {
      verdict: 'wait',
      waits: `You took back “${ctx.refused.text.slice(0, 120)}” before, so this waits for your OK.`,
    };
  if (change.op === 'supersede') {
    const target = ctx.memories.get(change.id);
    if (target?.pending)
      return { verdict: 'wait', waits: 'It would replace something still waiting for your OK.' };
  }
  return { verdict: 'apply' };
}
