/**
 * Days and times for what a tool found, in the reader's own words and locale.
 * Every function takes the locale and time zone explicitly, so a view reads
 * the same in a test as on the person's screen.
 */
export interface WhenOptions {
  /** Reference "now" in epoch ms (defaults to `Date.now()`). */
  now?: number;
  /** BCP 47 locale; the browser's when left out. */
  locale?: string;
  /** IANA time zone; the browser's when left out. */
  timeZone?: string;
}

const DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-10-03`, the calendar day `ts` falls on in `timeZone`. */
export function dayKey(ts: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ts);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Noon UTC on a day key: a moment that lies on that day in every time zone's calendar. */
const noonOf = (key: string) => Date.parse(`${key}T12:00:00Z`);

/** The day after (or before) `key`. */
export function addDays(key: string, days: number): string {
  return new Date(noonOf(key) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((noonOf(b) - noonOf(a)) / DAY);
}

/** A date-only value (`2026-10-03`) is a calendar day, not a moment. */
export const isDateOnly = (value: string) => DATE_ONLY.test(value);

/**
 * The day a written moment falls on: a date-only value is that day; a
 * date-time is read in `timeZone`. `exclusive` reads an end (the day before
 * a midnight end, or a date-only end).
 */
export function dayOf(value: string, timeZone?: string, exclusive = false): string | undefined {
  if (isDateOnly(value)) return exclusive ? addDays(value, -1) : value;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return dayKey(exclusive ? ts - 1 : ts, timeZone);
}

/** Whether this locale writes a 12-hour clock ("9:00 AM") or a 24-hour one ("09:00"). */
export function usesTwelveHours(locale?: string): boolean {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h12' || cycle === 'h11';
}

/** "9:00 AM" / "09:00". */
export function timeOf(ts: number, options: WhenOptions = {}): string {
  // A 24-hour clock lines up in a column: "09:05", whatever the platform's default.
  return new Intl.DateTimeFormat(options.locale, {
    hour: usesTwelveHours(options.locale) ? 'numeric' : '2-digit',
    minute: '2-digit',
    timeZone: options.timeZone,
  }).format(ts);
}

/** "Today", "Tomorrow", "Yesterday", else the weekday ("Thursday"). */
export function dayName(key: string, options: WhenOptions = {}): string {
  const today = dayKey(options.now ?? Date.now(), options.timeZone);
  const offset = daysBetween(today, key);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return new Intl.DateTimeFormat(options.locale, { weekday: 'long', timeZone: 'UTC' }).format(
    noonOf(key),
  );
}

/**
 * "Fri 3 Oct" (with the year when it isn't this year's). Beside a name that
 * is already the weekday ("Friday"), `weekday: false` says the date alone,
 * "9 Oct", so the day is named once.
 */
export function dayDate(
  key: string,
  options: WhenOptions = {},
  { weekday = true }: { weekday?: boolean } = {},
): string {
  const thisYear = dayKey(options.now ?? Date.now(), options.timeZone).slice(0, 4);
  // The parts in the locale's order, without its commas: "Fri 3 Oct", "Fri Oct 3".
  return new Intl.DateTimeFormat(options.locale, {
    ...(weekday && { weekday: 'short' as const }),
    day: 'numeric',
    month: 'short',
    ...(key.slice(0, 4) !== thisYear && { year: 'numeric' }),
    timeZone: 'UTC',
  })
    .formatToParts(noonOf(key))
    .filter((p) => p.type !== 'literal')
    .map((p) => p.value)
    .join(' ');
}

/**
 * When something arrived, as a list of mail says it: the time today,
 * "Yesterday", the weekday this week, else the date.
 */
export function shortWhen(value: string, options: WhenOptions = {}): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '';
  const now = options.now ?? Date.now();
  const day = isDateOnly(value) ? value : dayKey(ts, options.timeZone);
  const ago = daysBetween(day, dayKey(now, options.timeZone));
  if (ago === 0 && !isDateOnly(value)) return timeOf(ts, options);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago > 1 && ago < 7)
    return new Intl.DateTimeFormat(options.locale, { weekday: 'short', timeZone: 'UTC' }).format(
      noonOf(day),
    );
  return new Intl.DateTimeFormat(options.locale, {
    day: 'numeric',
    month: 'short',
    ...(day.slice(0, 4) !== dayKey(now, options.timeZone).slice(0, 4) && { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(noonOf(day));
}

/** The full moment, for a tooltip or a screen reader: "Friday 3 October 2026 at 09:00". */
export function fullWhen(value: string, options: WhenOptions = {}): string {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  if (isDateOnly(value))
    return new Intl.DateTimeFormat(options.locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
      noonOf(value),
    );
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: options.timeZone,
  }).format(ts);
}
