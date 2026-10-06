import type { CommandItem } from './CommandMenu';

export interface CommandMatch {
  item: CommandItem;
  score: number;
  /** Indices to highlight in what's shown: `item.title` when it has one, else `item.name`. */
  hits: number[];
}

function range(start: number, length: number) {
  return Array.from({ length }, (_, i) => start + i);
}

/** Each letter of `q` in order in `text` ("cmt" → commit), or undefined. */
function subsequence(text: string, q: string): number[] | undefined {
  const hits: number[] = [];
  let i = 0;
  for (const ch of q) {
    i = text.indexOf(ch, i);
    if (i === -1) return undefined;
    hits.push(i++);
  }
  return hits;
}

/**
 * Ranks a command (or one of its values) against what's been typed:
 * prefix → substring → keyword/description substring → loose letters ("cmt"
 * → commit). What's shown (`title`, else `name`) is matched first, then what's
 * typed (`name`, a model's id). Lower scores are better; `null` = no match.
 */
export function matchCommand(item: CommandItem, query: string): CommandMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { item, score: 0, hits: [] };
  const shown = (item.title ?? item.name).toLowerCase();
  const typed = item.name.toLowerCase();
  if (shown.startsWith(q)) return { item, score: 0, hits: range(0, q.length) };
  if (typed !== shown && typed.startsWith(q)) return { item, score: 0, hits: [] };
  // A word inside the name ("opus" in "Claude Opus 4") is nearly as good as its start.
  const word = shown.search(new RegExp(`(?:^|[\\s\\-_.:/])${escapeRegExp(q)}`));
  if (word > 0) return { item, score: 0.5, hits: range(word + 1, q.length) };
  const at = shown.indexOf(q);
  if (at !== -1) return { item, score: 1, hits: range(at, q.length) };
  if (typed !== shown && typed.includes(q)) return { item, score: 1, hits: [] };
  const haystack = [...(item.keywords ?? []), item.description ?? ''].join(' ').toLowerCase();
  if (haystack.includes(q)) return { item, score: 2, hits: [] };
  const hits = subsequence(shown, q);
  return hits ? { item, score: 3, hits } : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Filter and order: groups keep their given order, matches rank within a group. */
export function filterCommands(items: CommandItem[], query: string): CommandMatch[] {
  const groups: string[] = [];
  for (const item of items) if (!groups.includes(item.group)) groups.push(item.group);
  const matches = items
    .map((item, index) => ({ match: matchCommand(item, query), index }))
    .filter((m): m is { match: CommandMatch; index: number } => m.match !== null);
  return matches
    .sort(
      (a, b) =>
        groups.indexOf(a.match.item.group) - groups.indexOf(b.match.item.group) ||
        a.match.score - b.match.score ||
        a.index - b.index,
    )
    .map((m) => m.match);
}
