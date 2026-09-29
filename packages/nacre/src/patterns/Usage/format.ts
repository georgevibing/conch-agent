import type { UsageSeverity, UsageValue, UsageWindowValue } from './types';

/*
 * Pure formatting for the usage gauge. Everything that depends on the clock
 * takes an explicit `now` so stories and tests are deterministic.
 *
 * The battery metaphor runs through all of it: we always talk about what's
 * *left*, never what's used.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Same thresholds as the gateway: warning ≥ 75, critical ≥ 90, exhausted ≥ 100. */
export function usageSeverityFor(usedPercent: number): UsageSeverity {
  if (usedPercent >= 100) return 'exhausted';
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 75) return 'warning';
  return 'normal';
}

/** Share left, 0–100, rounded. */
export function percentLeft(usedPercent: number): number {
  return Math.round(clamp(100 - usedPercent, 0, 100));
}

/** "62% left". */
export function formatLeft(usedPercent: number): string {
  return `${percentLeft(usedPercent)}% left`;
}

/** "in 38 min", "in 2 h 14 min", "in 3 days", or "now" once it has passed. */
export function formatResetIn(resetsAt: number, now: number): string {
  const diff = resetsAt - now;
  if (diff <= 0) return 'now';
  if (diff < DAY) {
    const minutes = Math.ceil(diff / MINUTE);
    if (minutes < 60) return `in ${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
  }
  const days = Math.round(diff / DAY);
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Calendar parts of an instant in a given time zone. */
function dayNumber(epoch: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(epoch);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day')) / DAY;
}

/** ICU uses narrow no-break spaces before AM/PM; normalise to a plain no-break space. */
const tidy = (s: string) => s.replace(/[\u202f\u00a0]/g, '\u00a0');

/** "4:10 PM" today, "tomorrow 9:00 AM", "Tue 9:00 AM" within a week, else "Oct 12". */
export function formatResetAt(
  resetsAt: number,
  now: number,
  locale = 'en-US',
  timeZone?: string,
): string {
  const days = dayNumber(resetsAt, timeZone) - dayNumber(now, timeZone);
  const time = tidy(
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
      resetsAt,
    ),
  );
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days > 1 && days <= 6) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(
      resetsAt,
    );
    return `${weekday} ${time}`;
  }
  return tidy(
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(resetsAt),
  );
}

/** "$4.20", "$0.03", "<$0.01", "$50", "$1,240". */
export function formatMoney(amount: number, currency = 'USD', locale = 'en-US'): string {
  const abs = Math.abs(amount);
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  if (abs > 0 && abs < 0.005) return `<${fmt(0.01, 2)}`;
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  return fmt(amount, abs >= 1000 || whole ? 0 : 2);
}

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function formatUpdated(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  const days = Math.floor(diff / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * The window that tells the story: the one named in `blocked`, else the most
 * used (ties keep display order).
 */
export function headlineWindow(value: UsageValue): UsageWindowValue | undefined {
  const blockedId = value.blocked?.windowId;
  if (blockedId) {
    const hit = value.windows.find((w) => w.id === blockedId);
    if (hit) return hit;
  }
  let top: UsageWindowValue | undefined;
  for (const w of value.windows) if (!top || w.usedPercent > top.usedPercent) top = w;
  return top;
}

export interface UsageHeadline {
  /** Share left for the ring, 0–100. Undefined when there's no ceiling. */
  percentLeft?: number;
  /** The one thing the chip says. */
  text: string;
  severity: UsageSeverity;
  /** The window the headline describes, for plans. */
  window?: UsageWindowValue;
}

/** The single number: what the header chip shows. */
export function headline(value: UsageValue): UsageHeadline {
  const window = value.kind === 'plan' ? headlineWindow(value) : undefined;
  if (value.kind !== 'unknown' && value.blocked) {
    return { percentLeft: 0, text: 'Limit reached', severity: 'exhausted', window };
  }
  if (value.kind === 'plan') {
    if (!window) return { text: value.source, severity: 'normal' };
    return {
      percentLeft: percentLeft(window.usedPercent),
      text: formatLeft(window.usedPercent),
      severity: window.severity,
      window,
    };
  }
  if (value.kind === 'metered') {
    const { budget, month, today } = value.spend;
    if (budget) {
      const spent = (month / budget) * 100;
      const left = budget - month;
      return {
        percentLeft: percentLeft(spent),
        text: left >= 0 ? `${formatMoney(left)} left` : `${formatMoney(-left)} over`,
        severity: usageSeverityFor(spent),
      };
    }
    return { text: `${formatMoney(today)} today`, severity: 'normal' };
  }
  return { text: value.source || 'Usage', severity: 'normal' };
}

/** Lowercase a label for mid-sentence use, leaving acronyms ("API") alone. */
export function lowerFirst(label: string): string {
  const second = label.charAt(1);
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * A window as a noun phrase: "current session", "weekly limit",
 * "Opus weekly limit". With `limit`, non-weekly windows get " limit" too.
 */
export function windowPhrase(w: UsageWindowValue, { limit = false } = {}): string {
  const scope = w.scope && !/^all\b/i.test(w.scope) ? w.scope : undefined;
  if (/^this week\b/i.test(w.label)) return `${scope ? `${scope} ` : ''}weekly limit`;
  if (/^today\b/i.test(w.label)) return `${scope ? `${scope} ` : ''}daily limit`;
  const base = lowerFirst(w.label) + (limit && !/limit$/i.test(w.label) ? ' limit' : '');
  return scope ? `${base} (${scope})` : base;
}

/** "This week · Opus" */
export function windowTitle(w: UsageWindowValue): string {
  return w.scope ? `${w.label} · ${w.scope}` : w.label;
}

/** One sentence for the meter's accessible name. */
export function describeUsage(value: UsageValue, now: number): string {
  const head = headline(value);
  const { window } = head;
  if (value.kind === 'unknown') return 'Usage: not available yet';
  if (value.blocked) {
    const until = value.blocked.until ?? window?.resetsAt;
    return `Usage: limit reached${window ? ` for ${windowPhrase(window)}` : ''}${
      until != null ? `, sending works again ${formatResetIn(until, now)}` : ''
    }`;
  }
  if (value.kind === 'plan') {
    if (!window) return `Usage: ${value.source}`;
    return `Usage: ${head.text} of ${windowPhrase(window)}${
      window.resetsAt != null ? `, resets ${formatResetIn(window.resetsAt, now)}` : ''
    }`;
  }
  const { budget, today, month } = value.spend;
  if (budget) return `Usage: ${head.text} of ${formatMoney(budget)} monthly budget`;
  return `Usage: ${formatMoney(today)} today, ${formatMoney(month)} this month`;
}
