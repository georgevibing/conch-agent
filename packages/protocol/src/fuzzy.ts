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
  // Subsequence ("pmw" → "Plan my week"). Tried from each place the first letter
  // is, two ways (jumping to word starts, or taking the next letter), and the
  // best kept: "vstrs" marks "Visitors", not "Visi·t(his)…(ve)rs(ion)".
  let best: FuzzyMatch | null = null;
  let tries = 0;
  for (
    let start = text.indexOf(token[0] ?? '');
    start !== -1 && tries < 24;
    start = text.indexOf(token[0] ?? '', start + 1), tries++
  ) {
    for (const words of [true, false]) {
      const found = subsequence(text, token, start, words);
      if (found && (!best || found.score > best.score)) best = found;
    }
  }
  return best;
}

/** `token` in `text` from `start`, a letter at a time; `words` jumps ahead to word starts. */
function subsequence(
  text: string,
  token: string,
  start: number,
  words: boolean,
): FuzzyMatch | null {
  const ranges: TextRange[] = [[start, start + 1]];
  let score = boundary(text, start) ? 8 : 1;
  let prev = start;
  // Every jump lands on a word's start: an acronym ("pmw" → "Plan my week").
  let acronym = boundary(text, start);
  for (const ch of token.slice(1)) {
    let i = -1;
    for (let j = text.indexOf(ch, prev + 1); j !== -1; j = text.indexOf(ch, j + 1)) {
      if (i === -1) i = j;
      if (!words || j === prev + 1 || boundary(text, j)) {
        i = j;
        break;
      }
    }
    if (i === -1) return null;
    score += i === prev + 1 ? 6 : boundary(text, i) ? 8 : 1;
    if (i !== prev + 1 && !boundary(text, i)) acronym = false;
    ranges.push([i, i + 1]);
    prev = i;
  }
  // Loose only as an acronym; otherwise the letters keep close together.
  const span = prev + 1 - start;
  if (span > (acronym ? token.length * 4 + 8 : token.length * 3)) return null;
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
