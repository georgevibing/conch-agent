/**
 * Dates and times as a question asks for them: wall-clock values with no zone.
 * The assistant may send a date, a time or a full ISO date-time (with seconds
 * or a zone); the card keeps the parts a person reads and nothing more.
 */
import { addDays, isDate, toUtc } from '../../components/DatePicker/calendar';

const DATE = /^(\d{4}-\d{2}-\d{2})/;
const TIME = /(?:^|T|\s)(\d{2}):(\d{2})/;

/** `YYYY-MM-DD`, from a date or a date-time. */
export function dateOf(raw: string | undefined): string | undefined {
  const date = raw ? DATE.exec(raw.trim())?.[1] : undefined;
  return date && isDate(date) && !Number.isNaN(toUtc(date)) ? date : undefined;
}

/** `HH:MM` (24-hour), from a time or a date-time. */
export function timeOf(raw: string | undefined): string | undefined {
  const match = raw ? TIME.exec(raw.trim()) : undefined;
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? `${match[1]}:${match[2]}` : undefined;
}

/** `HH:MM` shifted by whole hours, or nothing past the day's edges. */
export function shiftHours(time: string, hours: number): string | undefined {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const next = h + hours;
  if (next < 0 || next > 23) return undefined;
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const inRange = (value: string, min?: string, max?: string) =>
  (!min || value >= min) && (!max || value <= max);

/**
 * The days to offer at a glance: the next week from today (or from `min`),
 * never past `max`, with the suggested day added when it's further off.
 */
export function dayStrip(
  today: string,
  { min, max, suggested }: { min?: string; max?: string; suggested?: string },
  count = 7,
): string[] {
  const start = min && min > today ? min : today;
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(start, i);
    if (max && day > max) break;
    days.push(day);
  }
  if (suggested && !days.includes(suggested) && inRange(suggested, min, max)) {
    if (suggested < (days[0] ?? suggested)) days.unshift(suggested);
    else days.push(suggested);
  }
  return days;
}

/** A few times to tap: around the suggested one, or the usual hours of a working day. */
export function timeSlots({
  min,
  max,
  suggested,
}: {
  min?: string;
  max?: string;
  suggested?: string;
}): string[] {
  const around = suggested
    ? [-1, 0, 1, 2].map((h) => shiftHours(suggested, h))
    : ['09:00', '10:00', '12:00', '14:00', '16:00'];
  return around.filter((t): t is string => t !== undefined && inRange(t, min, max));
}
