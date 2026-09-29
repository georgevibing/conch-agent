export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86_400 * 7) return rtf.format(Math.round(s / 86_400), 'day');
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type DayGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Earlier';

export function dayGroup(at: number, now = new Date()): DayGroup {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (at >= start.getTime()) return 'Today';
  if (at >= start.getTime() - day) return 'Yesterday';
  if (at >= start.getTime() - 7 * day) return 'Previous 7 days';
  return 'Earlier';
}
