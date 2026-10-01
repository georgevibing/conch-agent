import { vaultSourceName } from '@conch/nacre';
import type { VaultItemSummary, VaultItemType, VaultProblem, VaultSourceId } from '@conch/protocol';

/** What the list shows. One at a time, like Apple Passwords' sidebar. */
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

/**
 * Every word must appear somewhere ("gmail work" finds the work Gmail);
 * a site matches with or without its dots ("netflix" finds netflix.com).
 */
export function matches(item: VaultItemSummary, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = haystack(item);
  return words.every((w) => hay.includes(w));
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

export function visibleItems(
  items: VaultItemSummary[],
  options: { query: string; filter: VaultFilter; sort: VaultSort },
): VaultItemSummary[] {
  const list = items.filter((i) => inFilter(i, options.filter) && matches(i, options.query));
  const byName = (a: VaultItemSummary, b: VaultItemSummary) => collator.compare(a.title, b.title);
  if (options.filter.kind === 'deleted')
    return list.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  if (options.sort === 'recent')
    return list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a, b));
  if (options.sort === 'used')
    return list.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0) || byName(a, b));
  // Favourites first, then A–Z.
  return list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || byName(a, b));
}

/** Counts for the filter menu. */
export function counts(items: VaultItemSummary[]) {
  const live = items.filter((i) => !i.deletedAt);
  const types = new Map<VaultItemType, number>();
  const tags = new Map<string, number>();
  for (const i of live) {
    types.set(i.type, (types.get(i.type) ?? 0) + 1);
    for (const t of i.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  return {
    all: live.length,
    favorites: live.filter((i) => i.favorite).length,
    codes: live.filter((i) => i.totp).length,
    deleted: items.length - live.length,
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
