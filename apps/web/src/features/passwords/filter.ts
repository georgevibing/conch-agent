import { vaultSourceName } from '@conch/nacre';
import {
  sameAccountKey,
  type VaultItemSummary,
  type VaultItemType,
  type VaultProblem,
  type VaultSourceId,
} from '@conch/protocol';

/** What the list shows. One filter at a time, chosen in the sidebar. */
export type VaultFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'codes' }
  | { kind: 'type'; type: VaultItemType }
  | { kind: 'problem'; problem: VaultProblem }
  | { kind: 'source'; source: VaultSourceId }
  | { kind: 'tag'; tag: string }
  | { kind: 'deleted' };

export type VaultSort = 'name' | 'recent' | 'used';

/** Whose items the list shows: everyone's, Conch's own, or one password manager's. */
export type VaultFrom = VaultSourceId | 'all';

export const TYPE_NAMES: Record<VaultItemType, { one: string; many: string }> = {
  login: { one: 'Login', many: 'Logins' },
  card: { one: 'Card', many: 'Cards' },
  identity: { one: 'Identity', many: 'Identities' },
  note: { one: 'Note', many: 'Notes' },
  apiKey: { one: 'API key', many: 'API keys' },
  wifi: { one: 'Wi-Fi', many: 'Wi-Fi' },
  bank: { one: 'Bank account', many: 'Bank accounts' },
  sshKey: { one: 'SSH key', many: 'SSH keys' },
  server: { one: 'Server', many: 'Servers' },
  database: { one: 'Database', many: 'Databases' },
  document: { one: 'ID document', many: 'ID documents' },
  license: { one: 'Licence', many: 'Licences' },
  wallet: { one: 'Crypto wallet', many: 'Crypto wallets' },
};

export const PROBLEM_NAMES: Record<VaultProblem, string> = {
  compromised: 'In a data breach',
  reused: 'Reused',
  weak: 'Weak',
  expired: 'Expired',
  insecure: 'Not secure',
  no2fa: 'Two-factor available',
};

/** Words a person types, matched against everything they'd remember an item by. */
function haystack(item: VaultItemSummary): string {
  return [
    item.title,
    item.subtitle,
    ...item.domains,
    ...item.tags,
    item.container,
    TYPE_NAMES[item.type].one,
    TYPE_NAMES[item.type].many,
    item.source === 'conch' ? '' : item.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function wordsOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every word must appear somewhere ("gmail work" finds the work Gmail);
 * a site matches with or without its dots ("netflix" finds netflix.com).
 */
export function matches(item: VaultItemSummary, query: string): boolean {
  const words = wordsOf(query);
  if (!words.length) return true;
  const hay = haystack(item);
  return words.every((w) => hay.includes(w));
}

/** An item with its words ready, so a keystroke only compares strings. */
export interface IndexedItem {
  item: VaultItemSummary;
  hay: string;
  /** The title, lower-cased, for ranking. */
  title: string;
}

export function inFilter(item: VaultItemSummary, filter: VaultFilter): boolean {
  if (filter.kind === 'deleted') return Boolean(item.deletedAt);
  if (item.deletedAt) return false;
  switch (filter.kind) {
    case 'all':
      return true;
    case 'favorites':
      return item.favorite;
    case 'codes':
      return item.totp;
    case 'type':
      return item.type === filter.type;
    case 'problem':
      return item.problems.includes(filter.problem);
    case 'source':
      return item.source === filter.source;
    case 'tag':
      return item.tags.includes(filter.tag);
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The list read once, when it arrives: each item's words lower-cased, in A–Z
 * order. Every sort after this is stable, so A–Z is the tie-break for free
 * and typing never sorts by name again.
 */
export function indexItems(items: VaultItemSummary[]): IndexedItem[] {
  return items
    .map((item) => ({ item, hay: haystack(item), title: item.title.toLowerCase() }))
    .sort((a, b) => collator.compare(a.item.title, b.item.title));
}

function startsWord(title: string, word: string): boolean {
  for (let at = title.indexOf(word); at !== -1; at = title.indexOf(word, at + 1))
    if (at === 0 || !/[\p{L}\p{N}]/u.test(title[at - 1] ?? '')) return true;
  return false;
}

/** How well a title answers what was typed: 0 starts with it … 3 found elsewhere (a site, a tag). */
function rank(title: string, words: string[]): number {
  if (title.startsWith(words.join(' '))) return 0;
  if (words.every((w) => startsWord(title, w))) return 1;
  if (words.every((w) => title.includes(w))) return 2;
  return 3;
}

export function visibleItems(
  index: IndexedItem[],
  options: { query: string; filter: VaultFilter; sort: VaultSort; from?: VaultFrom },
): VaultItemSummary[] {
  const words = wordsOf(options.query);
  const from = options.from ?? 'all';
  const found = index.filter(
    (e) =>
      (from === 'all' || e.item.source === from) &&
      inFilter(e.item, options.filter) &&
      words.every((w) => e.hay.includes(w)),
  );
  const order = (a: VaultItemSummary, b: VaultItemSummary) =>
    options.filter.kind === 'deleted'
      ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
      : options.sort === 'recent'
        ? (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
        : options.sort === 'used'
          ? (b.usedAt ?? 0) - (a.usedAt ?? 0)
          : // Favourites first, then A–Z.
            Number(b.favorite) - Number(a.favorite);
  if (!words.length) return found.map((e) => e.item).sort(order);
  // A search puts the best answer first: the title that starts with what was typed.
  return found
    .map((e) => ({ item: e.item, rank: rank(e.title, words) }))
    .sort((a, b) => a.rank - b.rank || order(a.item, b.item))
    .map((e) => e.item);
}

/** The parts of a title that match what was typed, for marking them: `[start, end)`, in order. */
export function titleRanges(title: string, query: string): [number, number][] {
  const lower = title.toLowerCase();
  const found: [number, number][] = [];
  for (const word of wordsOf(query))
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1))
      found.push([at, at + word.length]);
  found.sort((a, b) => a[0] - b[0]);
  const ranges: [number, number][] = [];
  for (const [start, end] of found) {
    const last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

/** A row of the list: an item, or the heading over a group of them. */
export type VaultListRow =
  | { kind: 'header'; id: string; label: string }
  /** `position` is its place among the items, from 1: headings don't count. */
  | { kind: 'item'; item: VaultItemSummary; position: number };

/** A short list reads at a glance; headings only earn their place in a long one. */
const GROUPS_FROM = 20;

function letter(title: string): string {
  // "Émile" files under E.
  const first = title.trim().normalize('NFD')[0] ?? '';
  return /\p{L}/u.test(first) ? first.toLocaleUpperCase() : '#';
}

function age(at: number | undefined, none: string, now: number): string {
  if (!at) return none;
  if (new Date(at).toDateString() === new Date(now).toDateString() || at > now) return 'Today';
  const days = (now - at) / 86_400_000;
  return days < 7 ? 'Previous 7 days' : days < 30 ? 'Previous 30 days' : 'Earlier';
}

/**
 * The list with a heading over each group, the way it's sorted: Favourites
 * and then each letter, or how long ago. A search has none (its order is
 * "best first"), nor has Recently deleted.
 */
export function listRows(
  shown: VaultItemSummary[],
  options: { query: string; filter: VaultFilter; sort: VaultSort; now?: number },
): VaultListRow[] {
  const items = shown.map((item, i): VaultListRow => ({ kind: 'item', item, position: i + 1 }));
  if (options.query.trim() || options.filter.kind === 'deleted' || shown.length < GROUPS_FROM)
    return items;
  const now = options.now ?? Date.now();
  const group = (item: VaultItemSummary) =>
    options.sort === 'recent'
      ? age(item.updatedAt, 'No edit date', now)
      : options.sort === 'used'
        ? age(item.usedAt, 'Not used yet', now)
        : item.favorite
          ? 'Favourites'
          : letter(item.title);
  const rows: VaultListRow[] = [];
  let last: string | undefined;
  for (const [i, item] of shown.entries()) {
    const label = group(item);
    if (label !== last) rows.push({ kind: 'header', id: `group:${rows.length}:${label}`, label });
    last = label;
    rows.push({ kind: 'item', item, position: i + 1 });
  }
  return rows;
}

/**
 * Counts for the filter menu, within one place's items (`from`). `sources`
 * counts every place, for the row of places itself.
 */
export function counts(items: VaultItemSummary[], from: VaultFrom = 'all') {
  const sources = new Map<VaultSourceId, number>();
  for (const i of items) if (!i.deletedAt) sources.set(i.source, (sources.get(i.source) ?? 0) + 1);
  const mine = from === 'all' ? items : items.filter((i) => i.source === from);
  const live = mine.filter((i) => !i.deletedAt);
  const types = new Map<VaultItemType, number>();
  const tags = new Map<string, number>();
  for (const i of live) {
    types.set(i.type, (types.get(i.type) ?? 0) + 1);
    for (const t of i.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  return {
    sources,
    everywhere: [...sources.values()].reduce((a, b) => a + b, 0),
    all: live.length,
    favorites: live.filter((i) => i.favorite).length,
    codes: live.filter((i) => i.totp).length,
    deleted: items.filter((i) => i.deletedAt).length,
    types,
    tags: [...tags.entries()].sort((a, b) => collator.compare(a[0], b[0])),
  };
}

export function filterName(filter: VaultFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'All items';
    case 'favorites':
      return 'Favourites';
    case 'codes':
      return 'One-time codes';
    case 'type':
      return TYPE_NAMES[filter.type].many;
    case 'problem':
      return PROBLEM_NAMES[filter.problem];
    case 'source':
      return vaultSourceName(filter.source);
    case 'tag':
      return filter.tag;
    case 'deleted':
      return 'Recently deleted';
  }
}

/** "3 days ago", "today". */
export function ago(at: number | undefined, now = Date.now()): string {
  if (!at) return 'never';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 6 * 60) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0 && new Date(at).getDate() === new Date(now).getDate()) return 'today';
  if (days <= 0) return 'yesterday';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The same account in two places, by the key Copy to uses too (`sameAccountKey`). */
export function twinKey(item: VaultItemSummary): string {
  return sameAccountKey({
    type: item.type,
    title: item.title,
    site: item.domains[0],
    account: item.subtitle,
  });
}

/** Each item's twins in other places, by id. */
export function twins(items: VaultItemSummary[]): Map<string, VaultItemSummary[]> {
  const byKey = new Map<string, VaultItemSummary[]>();
  for (const i of items) {
    if (i.deletedAt || i.source === 'system') continue;
    const key = twinKey(i);
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  const out = new Map<string, VaultItemSummary[]>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const i of group) {
      const others = group.filter((o) => o.source !== i.source);
      if (others.length) out.set(i.id, others);
    }
  }
  return out;
}

/** The ids from `from` to `to` in the list's order, both included, for Shift-click. */
export function range(shown: VaultItemSummary[], from: string, to: string): string[] {
  const a = shown.findIndex((i) => i.id === from);
  const b = shown.findIndex((i) => i.id === to);
  if (a === -1 || b === -1) return b === -1 ? [] : [to];
  return shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id);
}
