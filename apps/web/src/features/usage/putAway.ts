import type { PutAwayLimit, UsageSnapshot } from '@conch/protocol';
import { headline } from '@conch/nacre';

/*
 * When the line above the composer speaks (ADR 0005). It appears once a limit
 * nears its end in a cycle (the gateway's "warning", 75% used) and stays, on
 * every new chat, until it's put away. Put away, it stays away for that
 * provider's limit until the limit resets, even if it gets closer or runs out
 * (the header's meter and the chat's own limit card still say so). The next
 * cycle starts quiet, and the line comes back only if that one nears its end too.
 */

/** Slack for a reset time read again a little differently (a provider counting in seconds). */
const DRIFT = 30 * 60_000;
/** Enough for every provider's limits, and never a list that grows. */
const KEEP = 20;

/** The limit the line would speak for right now, or `undefined` when it has nothing to say. */
export function limitInView(usage: UsageSnapshot, now = Date.now()): PutAwayLimit | undefined {
  if (usage.kind === 'unknown' || !usage.engine) return undefined;
  const head = headline(usage);
  if (head.severity === 'normal' && !usage.blocked) return undefined;
  const engine = usage.engine;
  if (usage.kind === 'plan') {
    const w = head.window;
    const window = usage.blocked?.windowId ?? w?.id;
    if (!window) return undefined;
    const resetsAt = (w?.id === window ? w.resetsAt : undefined) ?? usage.blocked?.until;
    return { engine, window, ...(resetsAt != null && { resetsAt }) };
  }
  // A budget is the calendar month's; a provider refusing sends says until when.
  if (usage.blocked) {
    const resetsAt = usage.blocked.until;
    return { engine, window: 'blocked', ...(resetsAt != null && { resetsAt }) };
  }
  const at = new Date(now);
  return {
    engine,
    window: 'budget',
    resetsAt: new Date(at.getFullYear(), at.getMonth() + 1, 1).getTime(),
  };
}

/** Whether a put-away entry still covers this limit: same provider and limit, same cycle. */
function covers(mark: PutAwayLimit, limit: PutAwayLimit, now: number): boolean {
  if (mark.engine !== limit.engine || mark.window !== limit.window) return false;
  // No reset time to go by: it holds until the limit is seen healthy again (`rearm`).
  if (mark.resetsAt == null) return true;
  if (now >= mark.resetsAt) return false;
  return limit.resetsAt == null || limit.resetsAt < mark.resetsAt + DRIFT;
}

/** Whether the line for `limit` was put away in this cycle. */
export function isPutAway(
  marks: readonly PutAwayLimit[],
  limit: PutAwayLimit,
  now = Date.now(),
): boolean {
  return marks.some((mark) => covers(mark, limit, now));
}

/** Entries whose cycle has ended, gone. */
function current(marks: readonly PutAwayLimit[], now: number): PutAwayLimit[] {
  return marks.filter((mark) => mark.resetsAt == null || now < mark.resetsAt);
}

/** The list once `limit` is put away: one entry per provider and limit, old cycles dropped. */
export function putAway(
  marks: readonly PutAwayLimit[],
  limit: PutAwayLimit,
  now = Date.now(),
): PutAwayLimit[] {
  const others = current(marks, now).filter(
    (mark) => mark.engine !== limit.engine || mark.window !== limit.window,
  );
  return [...others, limit].slice(-KEEP);
}

/**
 * The list once `usage` has been read: an entry for a limit that's healthy
 * again (it reset), or whose cycle has ended, is dropped, so the next cycle
 * can speak. Returns the same array when nothing changed.
 */
export function rearm(
  marks: readonly PutAwayLimit[],
  usage: UsageSnapshot,
  now = Date.now(),
): readonly PutAwayLimit[] {
  const healthy = new Set(
    usage.kind === 'plan' && !usage.blocked
      ? usage.windows.filter((w) => w.severity === 'normal').map((w) => w.id)
      : [],
  );
  const kept = current(marks, now).filter(
    (mark) => !(mark.engine === usage.engine && healthy.has(mark.window)),
  );
  return kept.length === marks.length ? marks : kept;
}
