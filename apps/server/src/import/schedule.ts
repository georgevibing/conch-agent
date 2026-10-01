/**
 * Another agent's schedules, as Conch routine schedules (ADR 0035).
 * OpenClaw's cron jobs say `{ kind: 'cron', expr, tz }`, `{ kind: 'every',
 * everyMs }` or `{ kind: 'at', atMs }`; Hermes says "every 2h", "30m", a cron
 * line or a time. What can't be read becomes nothing, and the routine
 * isn't offered.
 */
import { MIN_INTERVAL_MINUTES, type Schedule } from '@conch/protocol';

const CRON = /^(\S+\s+){4}\S+$/;

function interval(minutes: number): Schedule | undefined {
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  // Conch's shortest interval: an accidental "every minute" mustn't burn a plan.
  const m = Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes));
  return m % 60 === 0 && m / 60 <= 1000
    ? { type: 'interval', every: m / 60, unit: 'hours' }
    : m <= 1000
      ? { type: 'interval', every: m, unit: 'minutes' }
      : { type: 'interval', every: Math.round(m / 60), unit: 'hours' };
}

/** "every 2h", "30m", "1d", "every 15 minutes". */
function fromWords(text: string): Schedule | undefined {
  const t = text.trim().toLowerCase();
  if (CRON.test(t)) return { type: 'cron', expression: t };
  const m = /^(?:every\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(
    t,
  );
  if (m?.[1]) {
    const n = Number(m[1]);
    const unit = m[2] ?? 'm';
    return interval(unit.startsWith('d') ? n * 1440 : unit.startsWith('h') ? n * 60 : n);
  }
  const at = Date.parse(text);
  if (Number.isFinite(at) && at > Date.now())
    return { type: 'once', at: new Date(at).toISOString() };
  return undefined;
}

export function scheduleFrom(value: unknown): Schedule | undefined {
  if (typeof value === 'string') return fromWords(value);
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const kind = String(v.kind ?? v.type ?? '').toLowerCase();
  const expr = v.expr ?? v.expression ?? v.cron;
  if ((kind === 'cron' || (!kind && typeof expr === 'string')) && typeof expr === 'string')
    return CRON.test(expr.trim()) ? { type: 'cron', expression: expr.trim() } : undefined;
  if (kind === 'every' || kind === 'interval') {
    const ms = Number(v.everyMs ?? v.ms ?? NaN);
    if (Number.isFinite(ms)) return interval(ms / 60_000);
    const minutes = Number(v.minutes ?? v.everyMinutes ?? NaN);
    if (Number.isFinite(minutes)) return interval(minutes);
    if (typeof v.every === 'string') return fromWords(v.every);
  }
  if (kind === 'at' || kind === 'once') {
    const ms = Number(v.atMs ?? NaN);
    const when = Number.isFinite(ms) ? ms : Date.parse(String(v.at ?? v.run_at ?? v.runAt ?? ''));
    return Number.isFinite(when) && when > Date.now()
      ? { type: 'once', at: new Date(when).toISOString() }
      : undefined;
  }
  if (typeof v.display === 'string') return fromWords(v.display);
  return undefined;
}

/** A timezone Intl knows, or this computer's. */
export function zoneOr(value: unknown): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return value.trim();
  } catch {
    return fallback;
  }
}
