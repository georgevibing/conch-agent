import type { CommandItem } from './CommandMenu';

export interface CommandMatch {
  item: CommandItem;
  score: number;
  /** Indices in `item.name` to highlight. */
  hits: number[];
}

function range(start: number, length: number) {
  return Array.from({ length }, (_, i) => start + i);
}

/**
 * Ranks a command against what's been typed after "/":
 * name prefix → name substring → keyword/description substring → name
 * subsequence ("cmt" → commit). Lower scores are better; `null` = no match.
 */
export function matchCommand(item: CommandItem, query: string): CommandMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { item, score: 0, hits: [] };
  const name = item.name.toLowerCase();
  if (name.startsWith(q)) return { item, score: 0, hits: range(0, q.length) };
  const at = name.indexOf(q);
  if (at !== -1) return { item, score: 1, hits: range(at, q.length) };
  const haystack = [...(item.keywords ?? []), item.description ?? ''].join(' ').toLowerCase();
  if (haystack.includes(q)) return { item, score: 2, hits: [] };
  const hits: number[] = [];
  let i = 0;
  for (const ch of q) {
    i = name.indexOf(ch, i);
    if (i === -1) return null;
    hits.push(i++);
  }
  return { item, score: 3, hits };
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
