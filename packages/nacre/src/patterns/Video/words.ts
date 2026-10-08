/** How a video's numbers are said and shown. */

/** "11:53", "1:02:03": as the chip on a poster shows it. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "12 minutes", "1 hour 4 minutes", "45 seconds": as a label says it. */
export function lengthWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  const mins = `${m} minute${m === 1 ? '' : 's'}`;
  if (!h) return mins;
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${mins}` : ''}`;
}

/** "3.3M views", "1 view", "No views". */
export function viewsWords(views: number): string {
  if (views === 0) return 'No views';
  if (views === 1) return '1 view';
  const n = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    views,
  );
  return `${n} views`;
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * When it came out: an ISO date as "2 years ago", or the site's own words as
 * they were ("2 years ago" already). Nothing for what can't be read.
 */
export function publishedWords(
  published: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!published) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(published)) return published;
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return undefined;
  const ago = Math.max(0, (now - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of STEPS)
    if (ago >= size) return rtf.format(-Math.floor(ago / size), unit);
  return 'Just now';
}
