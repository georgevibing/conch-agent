/**
 * Whether a place is open now, read from OpenStreetMap's `opening_hours`
 * on the place's own clock.
 *
 * Only the forms most places use are read: `24/7`, weekday ranges and lists
 * (`Mo-Fr`, `Mo,We`, `Sa-Su`), one or more times a day (`08:00-12:00,13:00-18:00`),
 * times past midnight (`18:00-02:00`), `off`/`closed`, rules after `;` (or
 * `, ` before a weekday) that override earlier ones for their days, and a
 * `PH …` rule, which is set aside. Anything else (months, weeks, sunrise,
 * comments, `||`) gives no answer rather than a wrong one: the card then just
 * shows the hours as written.
 */
import type { PlaceOpen } from '@conch/protocol';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_OF: Record<string, number> = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const WEEK_MINUTES = 7 * 24 * 60;

/** Minutes into the week (Monday 00:00 is 0), as spans that may run past Sunday night. */
type Span = [start: number, end: number];

function days(selector: string): number[] | undefined {
  const out = new Set<number>();
  for (const part of selector.split(',')) {
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!range?.[1]) return undefined;
    const from = DAY_OF[range[1]] ?? 0;
    const to = range[2] ? (DAY_OF[range[2]] ?? 0) : from;
    for (let d = from; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === to) break;
    }
  }
  return [...out];
}

function minutes(clock: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!m) return undefined;
  const h = Number(m[1]),
    min = Number(m[2]);
  if (h > 48 || min > 59) return undefined;
  return h * 60 + min;
}

/** The week's opening times, or `undefined` when the hours use a form this doesn't read. */
export function weekOf(hours: string): Span[][] | 'always' | undefined {
  const text = hours.trim();
  if (!text || text.length > 400) return undefined;
  if (/^24\/7$/.test(text)) return 'always';
  if (
    /["|]|sunrise|sunset|dawn|dusk|\bweek\b|\[|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|SH\b|easter/i.test(
      text,
    )
  )
    return undefined;
  const week: Span[][] = DAYS.map(() => []);
  const rules = text
    .split(';')
    .flatMap((rule) => rule.split(/,\s+(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/))
    .map((r) => r.trim())
    .filter(Boolean);
  if (!rules.length) return undefined;
  for (const rule of rules) {
    if (/^PH\b/.test(rule)) continue;
    const m =
      /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?(?:,?PH)?\s*(.*)$/.exec(
        rule,
      );
    if (!m) return undefined;
    const which = m[1] ? days(m[1].replace(/,$/, '')) : [0, 1, 2, 3, 4, 5, 6];
    if (!which) return undefined;
    const rest = (m[2] ?? '').trim();
    if (/^(off|closed)$/i.test(rest)) {
      for (const d of which) week[d] = [];
      continue;
    }
    const spans: [number, number][] = [];
    for (const time of (rest || '00:00-24:00').split(',')) {
      const t = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(time.trim());
      const start = t?.[1] ? minutes(t[1]) : undefined;
      let end = t?.[2] ? minutes(t[2]) : undefined;
      if (start === undefined || end === undefined || start >= 24 * 60) return undefined;
      if (end <= start) end += 24 * 60;
      spans.push([start, end]);
    }
    for (const d of which) week[d] = spans.map(([s, e]) => [d * 1440 + s, d * 1440 + e]);
  }
  return week;
}

/** Where `at` falls on the place's clock: the weekday (Monday 0) and minutes into it. */
export function clockAt(at: Date, timeZone: string): { day: number; minute: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = SHORT.indexOf(get('weekday') as (typeof SHORT)[number]);
    if (day < 0) return undefined;
    return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    return undefined;
  }
}

const hhmm = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Open now or not, and when that changes, on the place's own clock: or
 * `undefined` when its hours or its time zone can't be read.
 */
export function openNow(
  hours: string | undefined,
  timeZone: string | undefined,
  at = new Date(),
): PlaceOpen | undefined {
  if (!hours || !timeZone) return undefined;
  const week = weekOf(hours);
  if (!week) return undefined;
  if (week === 'always') return { open: true, always: true };
  const clock = clockAt(at, timeZone);
  if (!clock) return undefined;
  const now = clock.day * 1440 + clock.minute;
  // Every span this week and the same again a week on, so last night's late hours and next week count.
  const spans = week
    .flat()
    .flatMap(([s, e]) => [
      [s - WEEK_MINUTES, e - WEEK_MINUTES],
      [s, e],
      [s + WEEK_MINUTES, e + WEEK_MINUTES],
    ])
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)) as Span[];
  if (!spans.length) return { open: false };
  const current = spans.find(([s, e]) => s <= now && now < e);
  // A span that ends where the next begins (Mo-Su 00:00-24:00) runs on into it.
  const until = (end: number): number => {
    const next = spans.find(([s, e]) => s <= end && e > end);
    return next && next[1] - now < WEEK_MINUTES ? until(next[1]) : end;
  };
  // The day it happens on, when that isn't today: an opening tomorrow says so; a closing
  // after midnight is still tonight.
  const day = (minute: number, closing: boolean) => {
    const d = Math.floor((((minute % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES) / 1440);
    const today = d === clock.day && minute - now < 1440;
    return today || (closing && minute - now < 1440) ? undefined : SHORT[d];
  };
  if (current) {
    const end = until(current[1]);
    if (end - now >= WEEK_MINUTES - 1440) return { open: true, always: true };
    const on = day(end, true);
    return { open: true, at: hhmm(end), ...(on && { day: on }) };
  }
  const next = spans.find(([s]) => s > now);
  if (!next) return { open: false };
  const on = day(next[0], false);
  return { open: false, at: hhmm(next[0]), ...(on && { day: on }) };
}
