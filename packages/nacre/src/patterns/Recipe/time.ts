/** Lengths of time, as a recipe says them (`1 hr 20 min`) and as a timer shows them (`19:42`). */

/** `45 min`, `1 hr 20 min`, `2 days`, `30 sec`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const days = Math.floor(s / 86400);
  if (days >= 1 && s % 86400 < 3600) return days === 1 ? '1 day' : `${days} days`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

/** A timer's words for its range: `20–25 min`, `1–2 hr`, or just `20 min`. */
export function formatSpan(seconds: number, upTo?: number): string {
  if (!upTo || upTo <= seconds) return formatDuration(seconds);
  if (upTo < 3600) return `${Math.round(seconds / 60)}–${Math.round(upTo / 60)} min`;
  if (seconds % 3600 === 0 && upTo % 3600 === 0) return `${seconds / 3600}–${upTo / 3600} hr`;
  return `${formatDuration(seconds)}–${formatDuration(upTo)}`;
}

/** What's left on a timer, as a clock: `4:05`, `1:02:30`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** What's left, for a screen reader: `4 minutes 5 seconds left`. */
export function spokenLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  return [part(h, 'hour'), part(m, 'minute'), h ? '' : part(s, 'second')]
    .filter(Boolean)
    .join(' ')
    .concat(' left')
    .trim();
}
