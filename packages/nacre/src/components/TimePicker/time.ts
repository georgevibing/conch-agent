/** Pure helpers for `HH:MM` (24-hour) wall-clock strings. */

export type HourCycle = 'h12' | 'h23';

export interface Clock {
  hour: number; // 0–23
  minute: number; // 0–59
}

export function parseTime(value: string | undefined): Clock {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  const hour = Number(match?.[1] ?? 9);
  const minute = Number(match?.[2] ?? 0);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime({ hour, minute }: Clock): string {
  return `${pad(hour)}:${pad(minute)}`;
}

export function wrap(n: number, min: number, max: number): number {
  const span = max - min + 1;
  return ((((n - min) % span) + span) % span) + min;
}

/** 0–23 → 1–12 on a 12-hour clock. */
export function to12(hour: number): number {
  return hour % 12 || 12;
}

/** 1–12 + period → 0–23. */
export function from12(hour12: number, pm: boolean): number {
  return (hour12 % 12) + (pm ? 12 : 0);
}

/** The hour cycle the reader's locale uses, e.g. `h12` for en-US, `h23` for de-DE. */
export function localeHourCycle(locale?: string): HourCycle {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12' ? 'h12' : 'h23';
  } catch {
    return 'h23';
  }
}

/** Localised AM/PM labels ("AM"/"PM", "vorm."/"nachm." …). */
export function dayPeriods(locale?: string): [string, string] {
  const label = (hour: number) =>
    new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2020, 0, 1, hour)))
      .find((part) => part.type === 'dayPeriod')?.value ?? (hour < 12 ? 'AM' : 'PM');
  try {
    return [label(9), label(21)];
  } catch {
    return ['AM', 'PM'];
  }
}

/**
 * A time as the picker shows it, for anything beside it (a chip, a line):
 * "9:00 AM" on a 12-hour clock, "08:30" on a 24-hour one.
 */
export function readTime(value: string, locale?: string): string {
  const { hour, minute } = parseTime(value);
  if (localeHourCycle(locale) === 'h23') return formatTime({ hour, minute });
  const [am, pm] = dayPeriods(locale);
  return `${to12(hour)}:${pad(minute)} ${hour < 12 ? am : pm}`;
}
