/**
 * Calendar maths on plain `YYYY-MM-DD` strings. Everything runs in UTC so a
 * date never drifts across the reader's timezone; strings compare
 * lexicographically in date order.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

const pad = (n: number) => String(n).padStart(2, '0');

export function toUtc(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUtc(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtc(value));
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Same day next/previous month, clamped (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const d = new Date(toUtc(date));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return fromUtc(target.getTime());
}

export function weekday(date: string): Weekday {
  return new Date(toUtc(date)).getUTCDay() as Weekday;
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function startOfWeek(date: string, weekStart: Weekday): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/** Six full weeks covering `month`, so the grid never changes height. */
export function monthGrid(month: string, weekStart: Weekday): string[][] {
  const first = startOfWeek(startOfMonth(month), weekStart);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
  );
}

export function clampDate(date: string, min?: string, max?: string): string {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

/** Today's date in the reader's own timezone. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** First day of the week for a locale (Sunday in en-US, Monday in de-DE). */
export function localeWeekStart(locale?: string): Weekday {
  try {
    const loc = new Intl.Locale(
      locale ?? new Intl.DateTimeFormat().resolvedOptions().locale,
    ) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    if (firstDay) return (firstDay % 7) as Weekday;
  } catch {
    // fall through
  }
  return 1;
}
