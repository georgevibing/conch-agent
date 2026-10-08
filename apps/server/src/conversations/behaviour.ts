/**
 * Watching what a chat does, not only what each step is (ADR 0117).
 *
 * The risk policy (`risk.ts`) reads one step at a time. Some harm only shows
 * in many: one email is a message, a thousand is a spam campaign; one delete
 * is tidying, fifty in a row is a wipe; the same change made again and again
 * is a loop. And some only shows against what came before: an address nobody
 * in the chat gave, right after it read a stranger's page.
 *
 * So each app step is also counted against the chat's own log (it survives a
 * restart, and costs nothing to read): this turn, the last day, by kind. Plain
 * counters and thresholds, no model: the answer is the same every time, and
 * cheap enough to run before every step. It can only add a question or a
 * stop, never lift one.
 *
 * - **ask**: said in plain words, this once, in Auto and the modes below it.
 *   The ones marked `trust` ask in Full trust too.
 * - **stop**: refused in every mode, with the reason and one next step.
 *   Nobody's trust reaches five hundred people with one message.
 *
 * A count asks at each multiple (the 20th send in a turn, the 40th…), so a
 * person who says yes lets the next batch through instead of being asked at
 * every step.
 */
import type { ConversationEvent } from '@conch/protocol';

import { DELETES, PAYS, SPEAKS } from './risk';

/** One step, as the log has it. */
export interface Step {
  id?: string;
  name: string;
  input: unknown;
  at: number;
  /** In the turn running now. */
  thisTurn: boolean;
}

export interface Pattern {
  level: 'ask' | 'stop';
  kind: 'bulk-send' | 'send-rate' | 'mass-delete' | 'repeat' | 'money' | 'new-recipient';
  /** After "This would " (ask) or "I stopped: this would " (stop). */
  reason: string;
  /** Full trust asks too. */
  trust?: boolean;
  /** For a stop: the one thing the person can do instead. */
  next?: string;
}

/** The numbers, in one place, so the ADR and the tests read the same ones. */
export const LIMITS = {
  /** One step to this many people asks. */
  recipientsAsk: 20,
  /** One step to this many people asks in Full trust too. */
  recipientsTrust: 100,
  /** One step to this many people stops, in every mode. */
  recipientsStop: 500,
  /** Every this-many sends in one turn asks. */
  sendsPerTurn: 20,
  /** Every this-many sends in a chat's day asks, in Full trust too. */
  sendsPerDay: 100,
  /** This many sends in a chat's day stops, in every mode. */
  sendsPerDayStop: 500,
  /** Every this-many things deleted in one turn asks, even with a tool set to Allow. */
  deletesPerTurn: 10,
  /** Every this-many things deleted in one turn asks in Full trust too. */
  deletesPerTurnTrust: 50,
  /** Things one delete names that make it a mass delete, in every mode. */
  itemsAtOnce: 25,
  /** The same change, word for word, every this-many times in one turn asks. */
  sameChange: 5,
  /** A payment of this much or more asks in Full trust too. */
  bigAmount: 1000,
  /** Every this-many payments in a chat's day asks, in Full trust too. */
  paymentsPerDay: 5,
} as const;

const DAY = 24 * 60 * 60 * 1000;

/** The tool's own name: `mcp__conch__app_yazio__add_food` is `add_food`. */
const toolOf = (name: string) =>
  name
    .replace(/^mcp__conch__/, '')
    .replace(/^mcp__[a-z0-9_-]+?__/, '')
    .replace(/^app_[a-z0-9_]+?__/, '');

/** A step in an app (yours, Conch's Google and Slack, an MCP server): what this watches. */
const inApp = (name: string) =>
  /^mcp__(?!conch__)/.test(name) ||
  /^(?:google|slack|app)_/.test(name.replace(/^mcp__conch__/, ''));

/** Whether a step is one this watches. */
export const watchable = (name: string) => inApp(name);

/** Its first word says it only looks: `get_diary`, `search_foods`, `read_message`. */
const LOOK_VERBS = new Set(
  'get read list search find fetch show look lookup view query status describe check count preview summary summarise summarize'.split(
    ' ',
  ),
);
const looks = (tool: string) => LOOK_VERBS.has(tool.split(/[_-]/)[0]?.toLowerCase() ?? '');

/** Fields that name who a step goes to. */
const WHO =
  /^(?:to|cc|bcc|recipients?|emails?|addresses|attendees|invitees|members|users|people|contacts|phones?|phone_?numbers|numbers)$/i;

const ADDRESS = /[^\s<>,;"']+@[^\s<>,;"']+\.[a-z]{2,}/gi;

/** Everyone a step goes to, lower-cased, each once. */
export function recipientsOf(input: unknown): string[] {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: string[] = [];
  const add = (value: unknown, depth: number) => {
    if (out.length > 100_000 || depth > 3) return;
    if (typeof value === 'string') {
      const found = value.match(ADDRESS);
      if (found) out.push(...found.map((a) => a.toLowerCase()));
      else
        out.push(
          ...value
            .split(/[,;\n]+/)
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean),
        );
    } else if (Array.isArray(value)) for (const v of value) add(v, depth + 1);
    else if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      add(o.email ?? o.address ?? o.id ?? o.name, depth + 1);
    }
  };
  for (const [key, value] of Object.entries(args)) if (WHO.test(key)) add(value, 0);
  return [...new Set(out)];
}

/** It goes to other people: a message, an email, an invitation. */
export function sends(name: string, input: unknown): boolean {
  if (!inApp(name)) return false;
  const tool = toolOf(name);
  if (/^(?:google_mail_send|slack_send_message)$/.test(tool)) return true;
  if (looks(tool)) return false;
  return SPEAKS.test(tool) || recipientsOf(input).some((r) => r.includes('@'));
}

/** It deletes in an app. */
export const deletes = (name: string) =>
  inApp(name) && !looks(toolOf(name)) && DELETES.test(toolOf(name));

/** It pays or moves money in an app. */
export const pays = (name: string) =>
  inApp(name) && !looks(toolOf(name)) && PAYS.test(toolOf(name));

/** A change, not a look: what a loop of the same thing matters for. */
const changes = (name: string) => inApp(name) && !looks(toolOf(name));

/** How many things one step names (ids, items, messages…), at least one. */
function itemsOf(input: unknown): number {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  let most = 1;
  for (const value of Object.values(args))
    if (Array.isArray(value)) most = Math.max(most, value.length);
  return most;
}

/** The amount a payment names, when it names one. */
function amountOf(input: unknown): number | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(args)) {
    if (!/^(?:amount|total|price|value|sum|cost)$/i.test(key)) continue;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && String(value).trim()) return n;
  }
  return undefined;
}

const same = (name: string, input: unknown) => `${toolOf(name)}\n${JSON.stringify(input ?? {})}`;

/** The steps a chat's log holds; those after `turnFrom` (a seq) are this turn's. */
export function stepsOf(events: readonly ConversationEvent[], turnFrom: number): Step[] {
  return events.flatMap((e) =>
    e.type === 'tool.started'
      ? [{ id: e.toolUseId, name: e.name, input: e.input, at: e.at, thisTurn: e.seq > turnFrom }]
      : [],
  );
}

const counted = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The count crossed a multiple of `every` with this step's `added`. */
const crossed = (total: number, added: number, every: number) =>
  Math.floor(total / every) > Math.floor((total - added) / every);

/**
 * What this step looks like beside what came before it in the chat, when
 * that's worth a question or a stop. Undefined: carry on.
 *
 * `read`: the chat read something from outside. `said`: the person's own
 * words in it (empty where they could be someone else's), to tell an address
 * they gave from one that came from somewhere else.
 */
export function watch(
  step: { id?: string; name: string; input: unknown },
  earlier: readonly Step[],
  context: { now: number; read: boolean; said: readonly string[] },
): Pattern | undefined {
  if (!inApp(step.name)) return undefined;
  const before = earlier.filter((s) => !step.id || s.id !== step.id);
  const today = before.filter((s) => s.at > context.now - DAY);
  const turn = before.filter((s) => s.thisTurn);

  if (sends(step.name, step.input)) {
    const who = recipientsOf(step.input);
    if (who.length >= LIMITS.recipientsStop)
      return {
        level: 'stop',
        kind: 'bulk-send',
        reason: `send one message to ${counted(who.length, 'person', 'people')} at once, which looks like a spam campaign`,
        next: 'For a real mailing list, a mailing service made for it lets people unsubscribe.',
      };
    const sentToday = today.filter((s) => sends(s.name, s.input)).length + 1;
    if (sentToday >= LIMITS.sendsPerDayStop)
      return {
        level: 'stop',
        kind: 'send-rate',
        reason: `send its ${ordinal(sentToday)} message today from this chat, which looks like a spam campaign`,
        next: 'If it’s meant, a mailing service made for it can send the rest.',
      };
    if (who.length >= LIMITS.recipientsAsk)
      return {
        level: 'ask',
        kind: 'bulk-send',
        reason: `send one message to ${counted(who.length, 'person', 'people')} at once`,
        trust: who.length >= LIMITS.recipientsTrust,
      };
    if (sentToday % LIMITS.sendsPerDay === 0)
      return {
        level: 'ask',
        kind: 'send-rate',
        reason: `send its ${ordinal(sentToday)} message today from this chat`,
        trust: true,
      };
    const sentThisTurn = turn.filter((s) => sends(s.name, s.input)).length + 1;
    if (sentThisTurn % LIMITS.sendsPerTurn === 0)
      return {
        level: 'ask',
        kind: 'send-rate',
        reason: `send ${counted(sentThisTurn, 'message')} in a row`,
      };
    // After reading, an address nobody gave in the chat and it never wrote to before: where an
    // injected "send this to …" points.
    if (context.read) {
      const known = new Set(
        before.filter((s) => sends(s.name, s.input)).flatMap((s) => recipientsOf(s.input)),
      );
      const words = context.said.join('\n').toLowerCase();
      const stranger = who.find((r) => r.includes('@') && !known.has(r) && !words.includes(r));
      if (stranger)
        return {
          level: 'ask',
          kind: 'new-recipient',
          reason: `send to ${stranger.slice(0, 80)}, an address you haven’t given in this chat, after it read something from outside`,
        };
    }
  }

  if (deletes(step.name)) {
    const items = itemsOf(step.input);
    const deleted =
      turn.filter((s) => deletes(s.name)).reduce((n, s) => n + itemsOf(s.input), 0) + items;
    if (items >= LIMITS.itemsAtOnce)
      return {
        level: 'ask',
        kind: 'mass-delete',
        reason: `delete ${counted(items, 'thing')} at once, and that can’t be undone`,
        trust: true,
      };
    if (crossed(deleted, items, LIMITS.deletesPerTurn))
      return {
        level: 'ask',
        kind: 'mass-delete',
        reason: `delete ${counted(deleted, 'thing')} in a row, and that can’t be undone`,
        trust: crossed(deleted, items, LIMITS.deletesPerTurnTrust),
      };
  }

  if (pays(step.name)) {
    const amount = amountOf(step.input);
    if (amount !== undefined && amount >= LIMITS.bigAmount)
      return {
        level: 'ask',
        kind: 'money',
        reason: `pay ${amount.toLocaleString('en')} in one go`,
        trust: true,
      };
    const paidToday = today.filter((s) => pays(s.name)).length + 1;
    if (paidToday % LIMITS.paymentsPerDay === 0)
      return {
        level: 'ask',
        kind: 'money',
        reason: `make its ${ordinal(paidToday)} payment today from this chat`,
        trust: true,
      };
  }

  if (changes(step.name)) {
    const mine = same(step.name, step.input);
    const times = turn.filter((s) => same(s.name, s.input) === mine).length + 1;
    if (times % LIMITS.sameChange === 0)
      return {
        level: 'ask',
        kind: 'repeat',
        reason: `make the very same change for the ${ordinal(times)} time this turn, which looks like a loop`,
        trust: times >= LIMITS.sameChange * 4,
      };
  }
  return undefined;
}

/** The card's words for a pattern that asks. */
export const patternWords = (pattern: Pattern) =>
  `This would ${pattern.reason}. So I’m checking first.`;

/** The refusal's words for a stop: what, why, and the one next step. */
export const stopWords = (pattern: Pattern) =>
  `I stopped: this would ${pattern.reason}.${pattern.next ? ` ${pattern.next}` : ''} Nothing was sent. Tell the person in your own words; don’t try another way round it.`;
