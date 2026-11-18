import type { UsageModel, UsageSeverity, UsageValue, UsageWindowValue } from './types';

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

/**
 * "in under a minute", "in 38 min", "in 2 h 14 min", "in 3 days", or "now"
 * once it has passed (a reading from before the reset, soon read again).
 */
export function formatResetIn(resetsAt: number, now: number): string {
  const diff = resetsAt - now;
  if (diff <= 0) return 'now';
  if (diff < MINUTE) return 'in under a minute';
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

/**
 * The same, rounded for a narrow line: "in 38 min", "in 23 h", "in 3 days".
 * Hours drop their minutes (rounded down, so it never promises late).
 */
export function formatResetInShort(resetsAt: number, now: number): string {
  const diff = resetsAt - now;
  if (diff > 0 && diff < DAY && diff >= HOUR) return `in ${Math.floor(diff / HOUR)} h`;
  return formatResetIn(resetsAt, now);
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

/** Words of a name, lowercased: "Opus 5.5 (1M context)" → opus, 5, 5, 1m, context. */
const words = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whether `part` appears in `whole` as a run of whole words. */
function hasRun(whole: string[], part: string[]): boolean {
  if (part.length === 0 || part.length > whole.length) return false;
  for (let i = 0; i + part.length <= whole.length; i++)
    if (part.every((word, j) => whole[i + j] === word)) return true;
  return false;
}

/**
 * Whether a window counts for one model only ("Opus", "Fable"), not for every
 * model ("all models", or no scope at all).
 */
export function isModelScoped(w: UsageWindowValue): boolean {
  return Boolean(w.scope?.trim()) && !/^all\b/i.test(w.scope?.trim() ?? '');
}

/**
 * Whether a window limits the chat's model. A window for every model always
 * does; one for a single model ("Fable") only when the chat's model is that
 * one, by its id (`fable`, `claude-opus-4-8`, `opus[1m]`) or its name
 * ("Fable 5.1"), as whole words and case-insensitively. With no model known,
 * a model's own window limits nothing.
 */
export function windowAppliesTo(w: UsageWindowValue, model?: UsageModel): boolean {
  if (!isModelScoped(w)) return true;
  const scope = words(w.scope);
  return hasRun(words(model?.id), scope) || hasRun(words(model?.label), scope);
}

/**
 * Whether the provider's refusal holds for this model. One named for another
 * model's own window ("Fable" used up while the chat is on Opus) doesn't.
 */
export function blockedFor(value: UsageValue, model?: UsageModel): boolean {
  if (!value.blocked) return false;
  const id = value.blocked.windowId;
  const w = id ? value.windows.find((x) => x.id === id) : undefined;
  return !w || windowAppliesTo(w, model);
}

/** The most used of `windows` (ties keep display order). */
function mostUsed(windows: readonly UsageWindowValue[]): UsageWindowValue | undefined {
  let top: UsageWindowValue | undefined;
  for (const w of windows) if (!top || w.usedPercent > top.usedPercent) top = w;
  return top;
}

/**
 * The window that tells the story for the chat's model: the one named in
 * `blocked` when that holds for it, else the most used of those that limit it
 * (ties keep display order). Another model's own window never leads.
 */
export function headlineWindow(
  value: UsageValue,
  model?: UsageModel,
): UsageWindowValue | undefined {
  const blockedId = value.blocked?.windowId;
  if (blockedId && blockedFor(value, model)) {
    const hit = value.windows.find((w) => w.id === blockedId);
    if (hit) return hit;
  }
  return mostUsed(value.windows.filter((w) => windowAppliesTo(w, model)));
}

/**
 * When the chat's model leads on its own window ("Fable: 1% left"), the
 * window every other model goes by, if it has more room: what switching
 * model would give. Undefined otherwise.
 */
export function otherModelsWindow(
  value: UsageValue,
  model?: UsageModel,
): UsageWindowValue | undefined {
  if (value.kind !== 'plan') return undefined;
  const lead = headlineWindow(value, model);
  if (!lead || !isModelScoped(lead)) return undefined;
  const others = mostUsed(value.windows.filter((w) => !isModelScoped(w)));
  if (!others || others.severity === 'exhausted' || others.usedPercent >= lead.usedPercent)
    return undefined;
  return others;
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

/** The single number: what the header chip shows, for the chat's model when given. */
export function headline(value: UsageValue, model?: UsageModel): UsageHeadline {
  const window = value.kind === 'plan' ? headlineWindow(value, model) : undefined;
  const blocked = value.kind === 'plan' ? blockedFor(value, model) : Boolean(value.blocked);
  if (value.kind !== 'unknown' && blocked) {
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
export function describeUsage(value: UsageValue, now: number, model?: UsageModel): string {
  const head = headline(value, model);
  const { window } = head;
  if (value.kind === 'unknown') return 'Usage: not available yet';
  if (value.kind === 'plan' ? blockedFor(value, model) : value.blocked) {
    const until = value.blocked?.until ?? window?.resetsAt;
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
