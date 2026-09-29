export interface FormatWhenOptions {
  /** Reference "now" in epoch ms (defaults to `Date.now()`). */
  now?: number;
  locale?: string;
  timeZone?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Calendar day number (days since epoch) of `ts` in `timeZone`. */
function dayNumber(ts: number, locale: string | undefined, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  void locale;
  return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY);
}

function yearOf(ts: number, timeZone: string | undefined): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(ts));
}

/** "8:00 AM" / "08:00" depending on locale. */
export function formatTime(ts: number, options: Omit<FormatWhenOptions, 'now'> = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: options.timeZone,
  }).format(ts);
}

/** "12 Oct" (or "12 Oct 2027" when the year differs from `now`'s). */
export function formatDate(ts: number, options: FormatWhenOptions = {}): string {
  const now = options.now ?? Date.now();
  const sameYear = yearOf(ts, options.timeZone) === yearOf(now, options.timeZone);
  return new Intl.DateTimeFormat(options.locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: options.timeZone,
  }).format(ts);
}

function weekdayName(ts: number, options: FormatWhenOptions): string {
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'long',
    timeZone: options.timeZone,
  }).format(ts);
}

/**
 * Human phrasing for a moment relative to now — the way a person would say it:
 * "in 5 minutes", "Today at 8:00 AM", "Tomorrow at 8:00 AM", "Thursday at
 * 8:00 AM", "12 Oct at 8:00 AM"; and for the past "Just now", "12 minutes
 * ago", "Yesterday at 8:00 AM".
 */
export function formatWhen(ts: number, options: FormatWhenOptions = {}): string {
  const now = options.now ?? Date.now();
  const diff = ts - now;
  const abs = Math.abs(diff);

  if (abs < MINUTE) return diff >= 0 ? 'In less than a minute' : 'Just now';
  if (abs < HOUR) {
    const minutes = Math.round(abs / MINUTE);
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return diff > 0 ? `In ${minutes} ${unit}` : `${minutes} ${unit} ago`;
  }

  const days =
    dayNumber(ts, options.locale, options.timeZone) -
    dayNumber(now, options.locale, options.timeZone);
  const time = formatTime(ts, options);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days === -1) return `Yesterday at ${time}`;
  if (days > 1 && days < 7) return `${weekdayName(ts, options)} at ${time}`;
  if (days < -1 && days > -7) return `${weekdayName(ts, options)} at ${time}`;
  return `${formatDate(ts, options)} at ${time}`;
}

/** Lower-cased variant for use mid-sentence ("Next run in 5 minutes", "next: tomorrow at…"). */
export function formatWhenInline(ts: number, options: FormatWhenOptions = {}): string {
  const text = formatWhen(ts, options);
  return /^(In|Today|Tomorrow|Yesterday|Just)/.test(text)
    ? text[0]?.toLowerCase() + text.slice(1)
    : text;
}

/** "12s", "3 min", "1 h 5 min". */
export function formatRunDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / MINUTE);
  return m ? `${h} h ${m} min` : `${h} h`;
}
