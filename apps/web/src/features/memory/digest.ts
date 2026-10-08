import type { LearningStatus, TidyStatus } from '@conch/protocol';
import type { DigestLine } from '@conch/nacre';

/**
 * The morning's note (ADR 0107): what quiet learning applied and what the
 * nightly tidy-up changed since you last looked (at most a day back), each
 * with what Undo answers. Read from what the Memory page already has, so it
 * costs no request and no model. Only what was applied: anything held for a
 * security reason is the memory check's card, never this one (ADR 0097).
 */

export type DigestUndo =
  { from: 'learning'; entryId: string } | { from: 'tidy'; runId: string; changeId: string };

export interface DigestEntry extends DigestLine {
  at: number;
  undo: DigestUndo;
}

export interface Digest {
  title: string;
  items: DigestEntry[];
}

const DAY = 24 * 3_600_000;
const MAX = 12;
export const DIGEST_SEEN_KEY = 'conch:morning-note-seen';

export function morningDigest(input: {
  learning?: LearningStatus;
  tidy?: TidyStatus;
  /** When the person last put the note away. */
  seenAt: number;
  now: number;
  /** The hour on the person's clock, 0–23. */
  hour: number;
}): Digest | undefined {
  const since = Math.max(input.seenAt, input.now - DAY);
  const items: DigestEntry[] = [];
  for (const e of input.learning?.entries ?? []) {
    if (e.at <= since) continue;
    const state = e.state === 'applied' || e.state === 'kept' ? 'applied' : e.state;
    if (state !== 'applied' && state !== 'undone') continue;
    items.push({
      id: `l:${e.id}`,
      at: e.at,
      kind: e.change === 'superseded' ? 'replaced' : 'learned',
      text: e.after.content,
      ...(e.change === 'superseded' && e.before && { was: e.before.content }),
      state,
      undo: { from: 'learning', entryId: e.id },
    });
  }
  let overnight = false;
  for (const run of input.tidy?.runs ?? []) {
    if (run.at <= since || run.trigger !== 'nightly') continue;
    for (const c of run.changes) {
      const state = c.state === 'applied' || c.state === 'kept' ? 'applied' : c.state;
      if ((state !== 'applied' && state !== 'undone') || !c.after) continue;
      overnight = true;
      items.push({
        id: `t:${run.id}:${c.id}`,
        at: run.at,
        kind: c.kind === 'merged' ? 'merged' : c.kind === 'added' ? 'learned' : 'tidied',
        text: c.after.content,
        ...(c.kind === 'updated' && c.before[0] && { was: c.before[0].content }),
        state,
        undo: { from: 'tidy', runId: run.id, changeId: c.id },
      });
    }
  }
  // Only worth a card while something still stands.
  if (!items.some((i) => i.state === 'applied')) return undefined;
  items.sort((a, b) => b.at - a.at);
  return {
    title: overnight && input.hour < 12 ? 'While you slept' : 'Since you last looked',
    items: items.slice(0, MAX),
  };
}

export function readSeen(): number {
  try {
    const n = Number(localStorage.getItem(DIGEST_SEEN_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function writeSeen(at: number): void {
  try {
    localStorage.setItem(DIGEST_SEEN_KEY, String(at));
  } catch {
    // A browser that keeps nothing shows the note again; nothing is lost.
  }
}
