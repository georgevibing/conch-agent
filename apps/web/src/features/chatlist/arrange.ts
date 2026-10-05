import { isUnread, type ChatFolder, type ConversationSummary } from '@conch/protocol';

import { isChat } from '../archive/useArchive';

/** What the list shows: everything, only what's new, or only chats from chat apps. */
export type ChatFilter = 'all' | 'unread' | 'apps';

export interface DatedGroup {
  /** Stable for keys and remembering what's folded: `today`, `2026-08`. */
  key: string;
  label: string;
  chats: ConversationSummary[];
}

export interface Arranged {
  /** Waiting for your answer: lifted to the top until you give it. */
  needsYou: ConversationSummary[];
  pinned: ConversationSummary[];
  folders: { folder: ChatFolder; chats: ConversationSummary[] }[];
  dated: DatedGroup[];
  /** Every chat in the list, in the order it's shown (for ⌥↑/⌥↓ and Select). */
  order: ConversationSummary[];
  /** How many chats there are before the filter, so an empty filter can say so. */
  total: number;
}

const DAY = 86_400_000;

/**
 * Where a chat falls by when it last moved: Today, Yesterday, the last week,
 * the last month, then one group per month — never one bucket for everything
 * older, which is what makes a long list unreadable.
 */
export function datedGroup(at: number, now = new Date()): { key: string; label: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (at >= today) return { key: 'today', label: 'Today' };
  if (at >= today - DAY) return { key: 'yesterday', label: 'Yesterday' };
  if (at >= today - 7 * DAY) return { key: 'week', label: 'Previous 7 days' };
  if (at >= today - 30 * DAY) return { key: 'month', label: 'Previous 30 days' };
  const date = new Date(at);
  const sameYear = date.getFullYear() === now.getFullYear();
  const label = date.toLocaleDateString(undefined, {
    month: 'long',
    ...(!sameYear && { year: 'numeric' }),
  });
  return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label };
}

export function matchesFilter(chat: ConversationSummary, filter: ChatFilter): boolean {
  if (filter === 'unread') return isUnread(chat) || chat.status === 'awaiting-permission';
  if (filter === 'apps') return chat.origin?.kind === 'channel';
  return true;
}

/**
 * The chat list, arranged (ADR 0089): what needs you, what you pinned, your
 * folders, then the rest by when. A chat is in exactly one place.
 */
export function arrange(
  conversations: readonly ConversationSummary[] | undefined,
  folders: readonly ChatFolder[] | undefined,
  { filter = 'all', now = new Date() }: { filter?: ChatFilter; now?: Date } = {},
): Arranged {
  const listed = (conversations ?? []).filter((c) => isChat(c) && !c.archivedAt);
  const shown = listed.filter((c) => matchesFilter(c, filter));
  const byRecent = [...shown].sort((a, b) => b.updatedAt - a.updatedAt);
  const known = new Set((folders ?? []).map((f) => f.id));

  const needsYou = byRecent.filter((c) => c.status === 'awaiting-permission');
  const rest = byRecent.filter((c) => c.status !== 'awaiting-permission');
  const pinned = rest
    .filter((c) => c.pinned !== undefined)
    .sort((a, b) => (a.pinned ?? 0) - (b.pinned ?? 0));
  const unpinned = rest.filter((c) => c.pinned === undefined);
  const inFolders = [...(folders ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((folder) => ({ folder, chats: unpinned.filter((c) => c.folderId === folder.id) }));
  const loose = unpinned.filter((c) => !c.folderId || !known.has(c.folderId));

  const dated: DatedGroup[] = [];
  for (const chat of loose) {
    const { key, label } = datedGroup(chat.updatedAt, now);
    const last = dated.at(-1);
    if (last?.key === key) last.chats.push(chat);
    else dated.push({ key, label, chats: [chat] });
  }

  return {
    needsYou,
    pinned,
    // A filter hides folders it leaves empty; without one, an empty folder still shows.
    folders: filter === 'all' ? inFolders : inFolders.filter((f) => f.chats.length > 0),
    dated,
    order: [...needsYou, ...pinned, ...inFolders.flatMap((f) => f.chats), ...loose],
    total: listed.length,
  };
}

/** A chat untouched this long is offered for tidying away. */
export const TIDY_AFTER_DAYS = 30;
/** Fewer than this and there's nothing worth tidying. */
export const TIDY_FROM = 8;

/**
 * The chats nobody's touched in a month that you haven't kept on purpose —
 * not pinned, not in a folder, not working, not waiting for you. Offered for
 * archiving together, the way a browser puts away tabs you've stopped using.
 */
export function staleChats(
  conversations: readonly ConversationSummary[] | undefined,
  now = Date.now(),
): ConversationSummary[] {
  const before = now - TIDY_AFTER_DAYS * DAY;
  const stale = (conversations ?? []).filter(
    (c) =>
      isChat(c) &&
      !c.archivedAt &&
      c.pinned === undefined &&
      !c.folderId &&
      c.status === 'idle' &&
      !isUnread(c) &&
      c.updatedAt < before,
  );
  return stale.length >= TIDY_FROM ? stale : [];
}
