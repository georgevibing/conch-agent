/**
 * What a label may say (ADR 0121). Every label Conch puts on a number is in
 * this table, and is one of two things:
 *
 * - **a word** from a fixed list (`origin`, `outcome`, `decision`): anything
 *   else becomes `_OTHER`;
 * - **a name** Conch's own code gave it (a provider, a model, a tool): short,
 *   plain characters only, and only so many different ones per label before
 *   the rest are `_other`, so a dashboard never grows a series per chat.
 *
 * And it never carries what looks personal: a value shaped like an email
 * address, a file path or a key is `_redacted`, whatever label it's on.
 */

type Rule = { kind: 'word'; values: ReadonlySet<string> } | { kind: 'name'; max: number };

const word = (...values: string[]): Rule => ({ kind: 'word', values: new Set(values) });
const name = (max: number): Rule => ({ kind: 'name', max });

export const LABEL_RULES: Record<string, Rule> = {
  'conch.provider': name(64),
  'gen_ai.provider.name': name(48),
  'gen_ai.request.model': name(96),
  'conch.agent': name(32),
  'conch.origin': word('chat', 'routine', 'task', 'channel', 'other_app', 'agent', 'app_page'),
  'conch.outcome': word(
    // turns
    'success',
    'interrupted',
    'error',
    'paused',
    // tool calls
    'declined',
    'expired',
    'refused',
    // routine runs
    'succeeded',
    'nothing-to-do',
    'failed',
    'skipped',
    'missed',
    'stopped',
    // tasks
    'done',
    'unverified',
    // sending
    'ok',
  ),
  'gen_ai.operation.name': word('invoke_agent', 'chat', 'execute_tool'),
  'error.type': name(32),
  'gen_ai.token.type': word('input', 'output'),
  'conch.token.type': word('input', 'output', 'cache_read', 'cache_write'),
  'conch.billing': word('free', 'plan', 'metered'),
  'conch.state': word(
    'running',
    'waiting',
    'checking',
    'ok',
    'fixed',
    'info',
    'warning',
    'needs-you',
    'off',
    'healthy',
    'busy',
    'critical',
  ),
  'gen_ai.tool.name': name(256),
  'gen_ai.tool.type': word('function', 'extension'),
  'conch.decision': word('allowed', 'always', 'denied', 'expired'),
  'conch.verdict': word('went_ahead', 'asked'),
  'conch.risk': name(32),
  'conch.trigger': word('schedule', 'manual', 'catch-up', 'event'),
  'conch.task.kind': name(16),
  'conch.channel': name(48),
  'conch.direction': word('in', 'out'),
  'conch.area': name(48),
  'conch.signal': word('metrics', 'traces', 'logs'),
  'conch.reason': word('queue_full', 'rejected', 'failed'),
  // OpenTelemetry's own, for the one series a full metric folds the rest into.
  'otel.metric.overflow': word('true'),
};

export const OTHER = '_other';
export const OTHER_WORD = '_OTHER';
export const REDACTED = '_redacted';

const EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/;
/** A path on a computer: `/Users/ada`, `~/x`, `C:\x`, `\\server`. */
const PATH = /^(?:[/~]|[A-Za-z]:[\\/]|\\\\)|[\\]/;
/** A long run of key-like characters with nothing to read in it. */
const KEYLIKE = /[A-Za-z0-9+/=_-]{32,}/;

/** Is this value safe to put on a label at all? */
export function looksPersonal(value: string): boolean {
  if (EMAIL.test(value) || PATH.test(value)) return true;
  // A key has letters and digits mixed all through it; a model's name has words and dashes.
  const run = KEYLIKE.exec(value)?.[0];
  return Boolean(run && /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run));
}

/**
 * Holds every label to its rule. One per process, so the limit on how many
 * names a label may hold is shared by every metric that uses it.
 */
export class Labels {
  readonly #seen = new Map<string, Set<string>>();

  /** One value, as it may leave: a word from the list, a bounded name, or a placeholder. */
  value(key: string, raw: unknown): string | undefined {
    const rule = LABEL_RULES[key];
    if (!rule || raw === undefined || raw === null || raw === '') return undefined;
    const text = String(raw).slice(0, 200);
    if (rule.kind === 'word') return rule.values.has(text) ? text : OTHER_WORD;
    if (looksPersonal(text)) return REDACTED;
    const clean = text
      .replace(/[^A-Za-z0-9._:/@+-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 80);
    if (!clean) return undefined;
    let seen = this.#seen.get(key);
    if (!seen) this.#seen.set(key, (seen = new Set()));
    if (seen.has(clean)) return clean;
    if (seen.size >= rule.max) return OTHER;
    seen.add(clean);
    return clean;
  }

  /** A whole set, keeping only what the metric declares. */
  pick(allowed: readonly string[], raw: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of allowed) {
      const value = this.value(key, raw[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
}
