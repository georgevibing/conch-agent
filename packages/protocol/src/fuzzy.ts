import { foldText, mergeRanges, type TextRange } from './search';

export interface FuzzyMatch {
  score: number;
  ranges: TextRange[];
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const boundary = (text: string, i: number) => i === 0 || !isWordChar(text[i - 1]);

/** One token against folded text: substring first, then a tight subsequence. */
function matchToken(text: string, token: string): FuzzyMatch | null {
  let at = text.indexOf(token);
  if (at !== -1) {
    // Prefer an occurrence that starts a word ("plan" in "My plan", not "airplane").
    let best = at;
    while (at !== -1 && !boundary(text, at)) at = text.indexOf(token, at + 1);
    if (at !== -1) best = at;
    const score = 100 + (boundary(text, best) ? 40 : 0) + (best === 0 ? 25 : 0) - best * 0.2;
    return { score, ranges: [[best, best + token.length]] };
  }
  // Subsequence ("pmw" → "Plan my week"), greedy but preferring word starts.
  const ranges: TextRange[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of token) {
    let i = -1;
    for (let j = text.indexOf(ch, from); j !== -1; j = text.indexOf(ch, j + 1)) {
      if (i === -1) i = j;
      if (j === prev + 1 || boundary(text, j)) {
        i = j;
        break;
      }
    }
    if (i === -1) return null;
    score += i === prev + 1 ? 6 : boundary(text, i) ? 8 : 1;
    ranges.push([i, i + 1]);
    prev = i;
    from = i + 1;
  }
  const span = (ranges.at(-1)?.[1] ?? 0) - (ranges[0]?.[0] ?? 0);
  if (span > token.length * 4 + 8) return null;
  return { score: score - span * 0.5, ranges: mergeRanges(ranges) };
}

/**
 * Fuzzy match for short strings like chat titles. Every whitespace-separated
 * token must match (in any order); returns a score (higher is better) and the
 * ranges to highlight.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const tokens = foldText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, ranges: [] };
  const folded = foldText(text);
  let score = 0;
  const ranges: TextRange[] = [];
  for (const token of tokens) {
    const m = matchToken(folded, token);
    if (!m) return null;
    score += m.score;
    ranges.push(...m.ranges);
  }
  return { score: score - text.length * 0.05, ranges: mergeRanges(ranges) };
}

/** Rank `items` by `fuzzyMatch` on `key`, best first, at most `limit`. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
  limit = 8,
): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch; index: number }[] = [];
  items.forEach((item, index) => {
    const match = fuzzyMatch(key(item), query);
    if (match) out.push({ item, match, index });
  });
  return out.sort((a, b) => b.match.score - a.match.score || a.index - b.index).slice(0, limit);
}
