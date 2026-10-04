/**
 * What the message box remembers between chats: what you were writing in
 * each one, and what you sent lately, for ↑.
 *
 * Drafts survive a reload or a restart (on this device, until you sign out
 * here). What you sent lately lasts only as long as the tab: the chats
 * themselves keep the rest.
 */

const DRAFTS_KEY = 'conch.drafts';
const SENT_KEY = 'conch.sent';
/** Drafts kept: the most recently written in. */
const MAX_DRAFTS = 50;
/** Messages ↑ reaches beyond the open chat's own. */
const MAX_SENT = 50;

type Drafts = Record<string, { text: string; at: number }>;

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

/** What was being written in this chat (`key` is the conversation, or the new chat's). */
export function loadDraft(key: string): string {
  const draft = drafts()[key];
  return typeof draft?.text === 'string' ? draft.text : '';
}

export function saveDraft(key: string, text: string) {
  const all = drafts();
  if (!text.trim() && !(key in all)) return;
  const others = Object.entries(all).filter(([k]) => k !== key);
  const kept = [...(text.trim() ? [[key, { text, at: Date.now() }] as const] : []), ...others]
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DRAFTS);
  write(local, DRAFTS_KEY, Object.fromEntries(kept));
}

/** Signing out here: nothing anyone was writing stays behind on this device. */
export function forgetDrafts() {
  try {
    localStorage.removeItem(DRAFTS_KEY);
    sessionStorage.removeItem(SENT_KEY);
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
