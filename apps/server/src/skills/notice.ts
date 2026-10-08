/**
 * The words on a "Save how I did this" card (ADR 0058): a short headline the
 * draft's model writes (what the skill would do), and where it was learned,
 * which code writes from the chat's taint marks.
 *
 * Where it was learned is never a model's: the model read the same work a
 * page could have steered, so the one line that says "check the steps" is
 * written here, from the marks alone.
 */
import type { TaintSource } from '@conch/protocol';

import { placesRead } from '../conversations/provenance';

export { sourceNames } from '../conversations/provenance';

/**
 * Where a skill was learned, in one short sentence:
 * "Learned from Yazio and GitHub content.", "Learned from trains.example.",
 * "Learned from news.example, Gmail content and 2 more sources."
 */
export function learnedFrom(sources: readonly TaintSource[]): string {
  const places = placesRead(sources);
  return places ? `Learned from ${places}.` : 'Learned from something it read outside Conch.';
}

/** Control and format characters out, runs of space as one. */
function plain(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── The headline ──────────────────────────────────────────────────────────

const HEADLINE_MAX_CHARS = 48;
const HEADLINE_MAX_WORDS = 7;
const WRAP = /^["'“”‘’`*_#\s-]+|["'“”‘’`*_\s]+$/g;
const NOT_WORDS = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.|[<>{}[\]|\\/$`]|\p{Extended_Pictographic}/u;
const REFUSAL = /\b(?:i can(?:no|')t|i cannot|i'm sorry|as an ai|i'm unable|skill)\b/i;

/**
 * A model's headline for the card, or undefined when it isn't one: a short
 * phrase in plain words that says what the skill would do ("Log a meal in
 * Yazio"). Nothing secret, no address or path, nothing particular to this one
 * time, one line.
 */
export function cleanHeadline(
  raw: string | undefined,
  context: {
    specifics?: readonly string[];
    redact?: (text: string) => string;
    secret?: RegExp;
  } = {},
): string | undefined {
  if (!raw || /[\r\n]/.test(raw.trim())) return undefined;
  const text = plain(raw)
    .replace(WRAP, '')
    .replace(/[.!?:;,。]+$/u, '')
    .trim();
  if (text.length < 3 || text.length > HEADLINE_MAX_CHARS) return undefined;
  if (text.split(' ').length > HEADLINE_MAX_WORDS) return undefined;
  if (!/^\p{L}/u.test(text) || NOT_WORDS.test(text) || REFUSAL.test(text.replace(/[‘’ʼ]/g, "'")))
    return undefined;
  if (context.secret?.test(text)) return undefined;
  if (context.redact && context.redact(text) !== text) return undefined;
  if (context.specifics?.some((s) => s.length >= 4 && text.includes(s))) return undefined;
  return `${text.charAt(0).toLocaleUpperCase()}${text.slice(1)}`;
}
