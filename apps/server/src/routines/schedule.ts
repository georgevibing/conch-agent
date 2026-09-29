import {
  MIN_INTERVAL_MINUTES,
  type Schedule,
  type SchedulePreview,
  type Weekday,
} from '@conch/protocol';
import { Cron } from 'croner';
import cronstrue from 'cronstrue';

const DAY_INDEX: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const DAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class ScheduleError extends Error {}

/** Epoch ms for a one-off time; offset-less times are read in `timezone`. */
export function onceAt(at: string, timezone: string): number {
  if (/(Z|[+-]\d\d:?\d\d)$/i.test(at)) return Date.parse(at);
  const [date = '', time = '00:00'] = at.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h = 0, mi = 0, sec = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h, mi, Math.floor(sec));
  // Offset of the timezone at that moment, applied twice to settle across DST changes.
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(t);
    const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - t;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** Cron expression for calendar schedules; undefined for `once` and `interval`. */
export function toCron(schedule: Schedule): string | undefined {
  const hm = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return `${m} ${h}`;
  };
  switch (schedule.type) {
    case 'daily':
      return `${hm(schedule.time)} * * *`;
    case 'weekly':
      return `${hm(schedule.time)} * * ${[...new Set(schedule.days)].map((d) => DAY_INDEX[d]).join(',')}`;
    case 'monthly':
      return `${hm(schedule.time)} ${schedule.day === 'last' ? 'L' : schedule.day} * *`;
    case 'cron':
      return schedule.expression.trim();
    default:
      return undefined;
  }
}

/** Throws ScheduleError with a plain-language reason if the schedule can't run. */
export function validate(schedule: Schedule, timezone: string, now = Date.now()) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ScheduleError(`“${timezone}” isn’t a timezone Conch recognises.`);
  }
  if (schedule.type === 'interval') {
    const minutes = schedule.every * (schedule.unit === 'hours' ? 60 : 1);
    if (minutes < MIN_INTERVAL_MINUTES) {
      throw new ScheduleError(`Routines can run at most every ${MIN_INTERVAL_MINUTES} minutes.`);
    }
    return;
  }
  if (schedule.type === 'once') {
    if (onceAt(schedule.at, timezone) <= now)
      throw new ScheduleError('That time has already passed.');
    return;
  }
  const expression = toCron(schedule) ?? '';
  let cron: Cron;
  try {
    cron = new Cron(expression, { timezone, paused: true });
  } catch (error) {
    throw new ScheduleError(`That schedule isn’t valid: ${(error as Error).message}`);
  }
  if (!cron.nextRun()) throw new ScheduleError('That schedule never runs.');
  const [a, b] = cron.nextRuns(2);
  if (a && b && b.getTime() - a.getTime() < MIN_INTERVAL_MINUTES * 60_000) {
    throw new ScheduleError(`Routines can run at most every ${MIN_INTERVAL_MINUTES} minutes.`);
  }
}

/**
 * The next `count` run times after `from`. Intervals are anchored to `anchor`
 * (the last run, or when the routine was created) so they don't drift.
 */
export function nextRuns(
  schedule: Schedule,
  timezone: string,
  options: { from?: number; count?: number; anchor?: number } = {},
): number[] {
  const from = options.from ?? Date.now();
  const count = options.count ?? 1;
  switch (schedule.type) {
    case 'once': {
      const at = onceAt(schedule.at, timezone);
      return at > from ? [at] : [];
    }
    case 'interval': {
      const period = schedule.every * (schedule.unit === 'hours' ? 3_600_000 : 60_000);
      const anchor = options.anchor ?? from;
      const steps = Math.max(1, Math.ceil((from - anchor) / period + 1e-9));
      const first = anchor + steps * period;
      return Array.from({ length: count }, (_, i) => first + i * period);
    }
    default: {
      try {
        const cron = new Cron(toCron(schedule) ?? '', { timezone, paused: true });
        return cron.nextRuns(count, new Date(from)).map((d) => d.getTime());
      } catch {
        return [];
      }
    }
  }
}

/** The most recent scheduled time at or before `now` (for missed-run detection). */
export function previousRun(
  schedule: Schedule,
  timezone: string,
  now: number,
  anchor?: number,
): number | undefined {
  switch (schedule.type) {
    case 'once': {
      const at = onceAt(schedule.at, timezone);
      return at <= now ? at : undefined;
    }
    case 'interval': {
      const period = schedule.every * (schedule.unit === 'hours' ? 3_600_000 : 60_000);
      if (anchor === undefined || now < anchor + period) return undefined;
      return anchor + Math.floor((now - anchor) / period) * period;
    }
    default: {
      try {
        const cron = new Cron(toCron(schedule) ?? '', { timezone, paused: true });
        return cron.previousRuns(1, new Date(now))[0]?.getTime();
      } catch {
        return undefined;
      }
    }
  }
}

/** Roughly how many times a day this runs. */
export function perDay(schedule: Schedule, timezone: string): number {
  if (schedule.type === 'interval') {
    return 1440 / (schedule.every * (schedule.unit === 'hours' ? 60 : 1));
  }
  if (schedule.type === 'once') return 0;
  const week = nextRuns(schedule, timezone, { count: 2000 }).filter(
    (t) => t < Date.now() + 7 * 86_400_000,
  );
  return Math.round((week.length / 7) * 10) / 10;
}

function formatTime(time: string, locale?: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2020, 0, 1, h, m));
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function listDays(days: Weekday[]): string {
  const sorted = ORDER.filter((d) => days.includes(d));
  const key = sorted.join(',');
  if (key === 'mon,tue,wed,thu,fri') return 'weekday';
  if (key === 'sat,sun') return 'weekend day';
  if (sorted.length === 7) return 'day';
  const names = sorted.map((d) => DAY_NAMES[d]);
  if (names.length === 1) return names[0] ?? '';
  const short = sorted.map((d) => DAY_NAMES[d].slice(0, 3));
  return `${short.slice(0, -1).join(', ')} and ${short.at(-1)}`;
}

/**
 * Plain-language description, always generated by Conch (never the model) so
 * every routine reads the same way: "Every weekday at 8:00 AM".
 */
export function describe(schedule: Schedule, timezone: string, locale?: string): string {
  switch (schedule.type) {
    case 'once':
      return `Once, ${new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      }).format(onceAt(schedule.at, timezone))}`;
    case 'daily':
      return `Every day at ${formatTime(schedule.time, locale)}`;
    case 'weekly':
      return `Every ${listDays(schedule.days)} at ${formatTime(schedule.time, locale)}`;
    case 'monthly':
      return schedule.day === 'last'
        ? `On the last day of every month at ${formatTime(schedule.time, locale)}`
        : `On the ${ordinal(schedule.day)} of every month at ${formatTime(schedule.time, locale)}`;
    case 'interval': {
      const unit = schedule.unit === 'hours' ? 'hour' : 'minute';
      return schedule.every === 1 ? `Every ${unit}` : `Every ${schedule.every} ${unit}s`;
    }
    case 'cron':
      try {
        const text = cronstrue.toString(schedule.expression, {
          verbose: false,
          use24HourTimeFormat: false,
        });
        return text.charAt(0).toUpperCase() + text.slice(1);
      } catch {
        return 'Custom schedule';
      }
  }
}

export function preview(schedule: Schedule, timezone: string, now = Date.now()): SchedulePreview {
  try {
    validate(schedule, timezone, now);
  } catch (error) {
    return {
      valid: false,
      text: describe(schedule, timezone),
      next: [],
      error: (error as Error).message,
    };
  }
  return {
    valid: true,
    text: describe(schedule, timezone),
    next: nextRuns(schedule, timezone, { from: now, count: 3, anchor: now }),
    perDay: perDay(schedule, timezone),
  };
}
