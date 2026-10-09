import type { Attachment, TurnOptions } from '@conch/protocol';

/**
 * What the message box remembers between chats: what you were writing in
 * each one, and what you sent lately, for ↑.
 *
 * Drafts are kept by Conch itself (`drafts.ts`, ADR 0124), so they follow
 * you to another browser and your phone; the copy here is what the box shows
 * at once, before Conch has answered, and what's kept while it can't be
 * reached. What you sent lately lasts only as long as the tab: the chats
 * themselves keep the rest. So do the messages waiting their turn above the
 * box: Conch restarting for an update reloads the page, and they still go,
 * one at a time, once the reply it carried on is over.
 */

const DRAFTS_KEY = 'conch.drafts';
const SENT_KEY = 'conch.sent';
const QUEUED_KEY = 'conch.queued';
/** Drafts kept: the most recently written in. */
const MAX_DRAFTS = 50;
/** Messages ↑ reaches beyond the open chat's own. */
const MAX_SENT = 50;

/** A draft as this device keeps it. */
export interface LocalDraft {
  text: string;
  /** What's attached, as Conch described it, so the cards show before it answers. */
  attachments?: Attachment[];
  /** A new chat's choices: model, mode… */
  options?: TurnOptions;
  /** When it was last written here. */
  at: number;
  /** Conch has this exact draft. False while a change is on its way, or couldn't go. */
  synced?: boolean;
}

type Drafts = Record<string, LocalDraft>;

function read<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Full, or turned off (a private window): the box just doesn't remember.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

function drafts(): Drafts {
  const all = read<unknown>(local, DRAFTS_KEY, {});
  return all && typeof all === 'object' && !Array.isArray(all) ? (all as Drafts) : {};
}

const isEmpty = (d: Pick<LocalDraft, 'text' | 'attachments'>) =>
  !d.text.trim() && !d.attachments?.length;

/** The whole draft this device keeps for a chat (`key` is the conversation, or the new chat's). */
export function loadLocalDraft(key: string): LocalDraft | undefined {
  const draft = drafts()[key];
  if (!draft || typeof draft.text !== 'string') return undefined;
  return {
    text: draft.text,
    at: typeof draft.at === 'number' ? draft.at : 0,
    ...(Array.isArray(draft.attachments) && { attachments: draft.attachments }),
    ...(draft.options && typeof draft.options === 'object' && { options: draft.options }),
    // Written by an older Conch, before drafts were kept by Conch itself: it still has to go.
    synced: draft.synced === true,
  };
}

/** What was being written in this chat. */
export function loadDraft(key: string): string {
  return loadLocalDraft(key)?.text ?? '';
}

/** Keep the draft here. An empty one Conch already knows is empty is forgotten. */
export function saveLocalDraft(key: string, draft: Omit<LocalDraft, 'at'>) {
  const all = drafts();
  const gone = isEmpty(draft) && draft.synced !== false;
  if (gone && !(key in all)) return;
  const others = Object.entries(all).filter(([k]) => k !== key);
  const kept = [...(gone ? [] : [[key, { ...draft, at: Date.now() }] as const]), ...others]
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DRAFTS);
  write(local, DRAFTS_KEY, Object.fromEntries(kept));
}

/** Just the words, keeping what's attached (messages waiting their turn, kept as you leave). */
export function saveDraft(key: string, text: string) {
  const { at: _at, ...before } = loadLocalDraft(key) ?? { at: 0 };
  saveLocalDraft(key, { ...before, text, synced: false });
}

/** The chats this device has something unsent for. */
export function localDraftKeys(): string[] {
  return Object.entries(drafts())
    .filter(([, d]) => typeof d?.text === 'string' && !isEmpty(d))
    .map(([k]) => k);
}

/** Signing out here: nothing anyone was writing stays behind on this device. */
export function forgetDrafts() {
  try {
    localStorage.removeItem(DRAFTS_KEY);
    sessionStorage.removeItem(SENT_KEY);
    sessionStorage.removeItem(QUEUED_KEY);
  } catch {
    // Nothing was kept.
  }
}

function sentLately(): string[] {
  const all = read<unknown>(session, SENT_KEY, []);
  return Array.isArray(all) ? all.filter((s): s is string => typeof s === 'string') : [];
}

/** A message went: ↑ finds it from any chat in this tab. */
export function rememberSent(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const all = sentLately().filter((s) => s !== trimmed);
  all.push(trimmed);
  write(session, SENT_KEY, all.slice(-MAX_SENT));
}

/**
 * What ↑ walks through, oldest first: this chat's own messages last (so they
 * come first), and before them what you sent lately in other chats. A message
 * sent twice in a row is one step.
 */
export function composerHistory(own: readonly string[]): string[] {
  const mine = own.map((s) => s.trim()).filter(Boolean);
  const here = new Set(mine);
  const elsewhere = sentLately().filter((s) => !here.has(s));
  return [...elsewhere, ...mine].filter((s, i, all) => s !== all[i - 1]);
}

/** A message waiting its turn above the box. */
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: Attachment[];
}

function queues(): Record<string, QueuedMessage[]> {
  const all = read<unknown>(session, QUEUED_KEY, {});
  return all && typeof all === 'object' && !Array.isArray(all)
    ? (all as Record<string, QueuedMessage[]>)
    : {};
}

/** What was waiting its turn in this chat, in this tab (a reload, Conch restarting). */
export function loadQueue(key: string): QueuedMessage[] {
  const list = queues()[key];
  return Array.isArray(list)
    ? list.filter(
        (q): q is QueuedMessage =>
          typeof q?.id === 'string' && typeof q.text === 'string' && Array.isArray(q.attachments),
      )
    : [];
}

export function saveQueue(key: string, queued: readonly QueuedMessage[]) {
  const all = queues();
  if (!queued.length && !(key in all)) return;
  const { [key]: _was, ...others } = all;
  write(session, QUEUED_KEY, queued.length ? { ...others, [key]: queued } : others);
}
