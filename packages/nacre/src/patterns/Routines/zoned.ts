/**
 * Tiny timezone helpers for turning a wall-clock date + time in an IANA zone
 * into an ISO string with offset (and back), without a date library.
 */

/** Offset of `timeZone` at instant `ts`, in minutes (e.g. +120 for CEST). */
export function offsetMinutes(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60_000);
}

function pad(n: number) {
  return String(Math.abs(n)).padStart(2, '0');
}

/** `2025-10-17` + `08:00` in `Europe/Berlin` → `2025-10-17T08:00:00+02:00`. */
export function toZonedIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  // Two passes settle the offset across DST boundaries.
  let offset = offsetMinutes(naive, timeZone);
  offset = offsetMinutes(naive - offset * 60_000, timeZone);
  const sign = offset >= 0 ? '+' : '-';
  return `${date}T${time}:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** ISO instant → `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` as seen in `timeZone`. */
export function fromZonedIso(iso: string, timeZone: string): { date: string; time: string } {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return { date: '', time: '09:00' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ts);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Today's date (`YYYY-MM-DD`) in `timeZone`, optionally shifted by whole days. */
export function zonedDate(timeZone: string, addDays = 0, now = Date.now()): string {
  return fromZonedIso(new Date(now + addDays * 86_400_000).toISOString(), timeZone).date;
}
