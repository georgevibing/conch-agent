/**
 * Search — finding anything you've ever said to (or heard from) Conch.
 *
 * The gateway keeps a full-text index of every conversation; the web app asks
 * it for ranked, grouped hits with ready-to-render snippets. Text folding and
 * query parsing live here so both ends agree on what "matches" means.
 */
import { z } from 'zod';

// ── Wire schemas ────────────────────────────────────────────────────────────

export const SearchRole = z.enum(['user', 'assistant', 'tool']);
export type SearchRole = z.infer<typeof SearchRole>;

/** `[start, end)` offsets into a string, to highlight. */
export const TextRange = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
export type TextRange = z.infer<typeof TextRange>;

export const SearchQuery = z.object({
  q: z.string().max(400).default(''),
  /** Only search this conversation. */
  in: z.string().max(128).optional(),
  /** Most conversations to return. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z.object({
  conversationId: z.string(),
  /** DOM anchor of the message: its `messageId` (or a tool call's `toolUseId`). */
  anchor: z.string(),
  role: SearchRole,
  at: z.number(),
  snippet: z.string(),
  ranges: z.array(TextRange),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchGroup = z.object({
  conversationId: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  /** Matching messages in this conversation (a floor when `capped`). */
  matches: z.number().int().nonnegative(),
  /** The best few, best first. */
  hits: z.array(SearchHit),
});
export type SearchGroup = z.infer<typeof SearchGroup>;

export const SearchResults = z.object({
  query: z.string(),
  /**
   * `exact` — every term appears; `fuzzy` — nothing matched exactly, these are
   * close (typo-tolerant); `short` — the query is too short to search messages.
   */
  mode: z.enum(['exact', 'fuzzy', 'short']),
  groups: z.array(SearchGroup),
  /** Total matching messages seen (a floor when `capped`). */
  total: z.number().int().nonnegative(),
  capped: z.boolean(),
  tookMs: z.number().nonnegative(),
  /**
   * The index is still being filled from the chats (just started, or rebuilt
   * after it broke): these are the results so far, and more may come.
   */
  catchingUp: z.boolean().optional(),
});
export type SearchResults = z.infer<typeof SearchResults>;

/**
 * How search is: `catching-up` while the index fills from the chats (at start,
 * or rebuilt after it broke), `ready`, or `unavailable` when it broke again
 * after a rebuild (`GET /api/search` answers 503 `search-unavailable`).
 */
export const SearchState = z.enum(['catching-up', 'ready', 'unavailable']);
export type SearchState = z.infer<typeof SearchState>;

/** `POST /api/search/repair`: rebuild the index from the chats, because a person asked. */
export const SearchRepairResult = z.object({ state: SearchState });
export type SearchRepairResult = z.infer<typeof SearchRepairResult>;

export const SearchPreviewQuery = z.object({
  conversationId: z.string().max(128),
  anchor: z.string().max(256).optional(),
  q: z.string().max(400).default(''),
});

export const PreviewMessage = z.object({
  anchor: z.string(),
  role: SearchRole,
  at: z.number(),
  text: z.string(),
  ranges: z.array(TextRange),
  /** The message the preview is centred on. */
  focus: z.boolean().default(false),
  /** Text was cut at the start / end. */
  clippedStart: z.boolean().default(false),
  clippedEnd: z.boolean().default(false),
});
export type PreviewMessage = z.infer<typeof PreviewMessage>;

export const SearchPreview = z.object({
  conversationId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Messages in the conversation (the preview may show only some). */
  messageCount: z.number().int().nonnegative(),
  messages: z.array(PreviewMessage),
});
export type SearchPreview = z.infer<typeof SearchPreview>;

// ── Text folding & matching (shared by gateway and web app) ────────────────

const MARKS = /\p{M}/gu;
const folded = new Map<string, string>();

function foldUnit(unit: string): string {
  let out = folded.get(unit);
  if (out === undefined) {
    const lower = unit.toLowerCase();
    const bare = lower.normalize('NFD').replace(MARKS, '');
    // Keep folding 1:1 so offsets into folded text are offsets into the original.
    out = bare.length === 1 ? bare : lower.length === 1 ? lower : unit;
    folded.set(unit, out);
  }
  return out;
}

/**
 * Case- and accent-insensitive form of `text` with the **same length**, so a
 * match at `i` in the folded text is a match at `i` in the original.
 */
export function foldText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
    else out += foldUnit(text[i] as string);
  }
  return out;
}

/**
 * Splits a query into folded terms. `"quoted phrases"` stay together;
 * duplicates and terms contained in longer ones are dropped.
 */
export function parseQuery(query: string): string[] {
  const terms: string[] = [];
  for (const [, phrase, word] of query.matchAll(/"([^"]*)"?|(\S+)/g)) {
    const term = foldText((phrase ?? word ?? '').replace(/\s+/g, ' ').trim());
    if (term) terms.push(term);
  }
  const unique = [...new Set(terms)].sort((a, b) => b.length - a.length);
  return unique.filter((t, i) => !unique.slice(0, i).some((longer) => longer.includes(t)));
}

/** Every occurrence of every term in already-folded text, merged and sorted. */
export function findRanges(foldedText: string, terms: string[], max = 200): TextRange[] {
  const ranges: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    let at = foldedText.indexOf(term);
    while (at !== -1 && ranges.length < max) {
      ranges.push([at, at + term.length]);
      at = foldedText.indexOf(term, at + term.length);
    }
  }
  return mergeRanges(ranges);
}

export function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Collapses whitespace runs to single spaces (and trims), keeping `ranges`
 * pointing at the same characters.
 */
export function flatten(text: string, ranges: TextRange[]): { text: string; ranges: TextRange[] } {
  const map: number[] = [];
  let out = '';
  let pendingSpace = false;
  // Per UTF-16 unit (not code point) so offsets line up with String indices.
  for (const ch of text.split('')) {
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
      pendingSpace = out.length > 0;
      map.push(out.length + (pendingSpace ? 1 : 0));
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    map.push(out.length);
    out += ch;
  }
  map.push(out.length);
  const mapped = ranges
    .map(([s, e]): TextRange => [
      Math.min(map[s] ?? out.length, out.length),
      // The end is exclusive: map the last included character, then step past it.
      e > s ? Math.min((map[e - 1] ?? out.length) + 1, out.length) : 0,
    ])
    .filter(([s, e]) => e > s);
  return { text: out, ranges: mapped };
}

/**
 * A window of `text` around its densest cluster of `ranges`, cut at word
 * boundaries, with `…` where it was cut and the ranges shifted to match.
 */
export function excerpt(
  source: string,
  sourceRanges: TextRange[],
  width = 160,
): { text: string; ranges: TextRange[]; clippedStart: boolean; clippedEnd: boolean } {
  const { text, ranges } = flatten(source, sourceRanges);
  if (text.length <= width) return { text, ranges, clippedStart: false, clippedEnd: false };
  const lead = Math.min(48, Math.floor(width / 3));
  let start = 0;
  let bestCount = -1;
  for (const [s] of ranges) {
    const from = Math.max(0, s - lead);
    let count = 0;
    for (const [a, b] of ranges) if (a >= from && b <= from + width) count++;
    if (count > bestCount) {
      bestCount = count;
      start = from;
    }
  }
  start = Math.min(start, text.length - width);
  let end = start + width;
  const firstHit = ranges.find(([, e]) => e > start)?.[0] ?? end;
  if (start > 0) {
    const space = text.indexOf(' ', start - 1);
    if (space !== -1 && space < firstHit && space - start < 16) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start && end - space < 16) end = space;
  }
  const clippedStart = start > 0;
  const clippedEnd = end < text.length;
  const prefix = clippedStart ? '…' : '';
  const body = text.slice(start, end);
  const shift = prefix.length - start;
  return {
    text: `${prefix}${body}${clippedEnd ? '…' : ''}`,
    ranges: ranges
      .filter(([s, e]) => e > start && s < end)
      .map(([s, e]): TextRange => [Math.max(start, s) + shift, Math.min(end, e) + shift]),
    clippedStart,
    clippedEnd,
  };
}
