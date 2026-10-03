/**
 * How Conch talks in a terminal.
 *
 * - **Warm and casual, a little playful.** Conch is a friend helping you set
 *   up, not a log file: "Your pearl is polished. ✨", "Hang tight, this takes
 *   a minute the first time."
 * - **Still exact.** Every line says what happened and, when something's on
 *   you, the one thing to do next. The fluff decorates the truth; it never
 *   replaces it, and it never promises what didn't happen.
 * - **Emoji sparingly.** 🐚 is Conch, ✨ is a moment worth marking (set up,
 *   approved, done). One per line at most, and never in a line you'd copy.
 * - **No exclamation spam.** One, when something genuinely good happened.
 * - **Short.** Two lines beat four. Details go dim, underneath.
 * - **Your words, not ours.** The app's own button names, plain verbs, no
 *   jargon without its plain meaning beside it.
 *
 * The status lines a long wait rotates through live here too, so they read
 * as one voice. They're colour, not information: the caller's own label is
 * what's actually happening, and it always stays on screen.
 */

/** "1 device", "3 devices"; pass `many` for irregular plurals ("1 key", "2 keys" is the default). */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "yesterday", "3 days ago", "on 2 Mar". */
export function ago(time: number, now = Date.now()): string {
  const gap = Math.max(0, now - time);
  if (gap < MINUTE) return 'just now';
  if (gap < HOUR) return `${plural(Math.floor(gap / MINUTE), 'minute')} ago`;
  if (gap < DAY) return `${plural(Math.floor(gap / HOUR), 'hour')} ago`;
  if (gap < 2 * DAY) return 'yesterday';
  if (gap < 30 * DAY) return `${Math.floor(gap / DAY)} days ago`;
  return `on ${new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** "10 minutes", "an hour", "2 hours", "3 days": how long something lasts. */
export function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(ms / HOUR);
  if (hours === 1) return 'an hour';
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.round(ms / DAY), 'day');
}

/**
 * When something runs out, the way a person says it: "for 10 minutes" when
 * it's soon, "until 14:32" later today, "until Tue 14:32" this week, and
 * "until 24 Nov" after that.
 */
export function until(time: number, now = Date.now()): string {
  const left = time - now;
  if (left <= 0) return 'no longer';
  if (left <= HOUR) return `for ${span(left)}`;
  const at = new Date(time);
  const clock = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === new Date(now).toDateString()) return `until ${clock}`;
  if (left < 6 * DAY)
    return `until ${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clock}`;
  return `until ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** A gentle hello for the time of day, for the top of a long conversation. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Up late? Let’s get you sorted.';
  if (hour < 12) return 'Good morning! Let’s get Conch settled in.';
  if (hour < 18) return 'Hey there. Let’s get Conch settled in.';
  return 'Good evening. Let’s get Conch settled in.';
}

/**
 * What a long wait says underneath its label, a few seconds in. Rotated in
 * order, so it never repeats twice in a row.
 */
export const WAITING_LINES = [
  'Polishing the pearl…',
  'Hang tight, nearly there…',
  'Asking the internet nicely…',
  'Good things, small shell…',
  'Still on it…',
  'Counting grains of sand…',
  'Worth the wait, promise…',
] as const;

/** Lines for a moment worth marking. Picked by the caller's own seed so tests stay stable. */
export const DONE_LINES = [
  'All set. ✨',
  'Done and dusted. ✨',
  'Shiny. ✨',
  'Sorted. ✨',
] as const;

/** One of `list`, picked by `seed` (a number you already have, or the time). */
export function pick<T>(list: readonly T[], seed = Date.now()): T {
  const item = list[Math.abs(Math.floor(seed)) % list.length];
  if (item === undefined) throw new Error('pick() needs a list with something in it.');
  return item;
}

/** What Conch says when you stop it with Ctrl+C partway through a question. */
export const STOPPED = 'Stopped there. Run it again whenever you’re ready.';
