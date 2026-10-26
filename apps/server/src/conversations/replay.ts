/**
 * How often Auto's rules would stop real work, measured on this computer's own chats
 * (ADR 0150): `pnpm auto:replay`.
 *
 * Every tool call in every chat's log goes through the deterministic policy again, as Auto
 * would judge it at that point in the chat: the circuit breaker (`breaksCircuit`), the patterns
 * across steps (`behaviour.ts`), and the risk rules (`assessRisk`, `riskAsks`), with what the
 * chat had read by then (`heldTaints`) and the person's words as `#yourWords` would have them.
 * The questions people were really asked (`permission.requested`) are read beside it, with how
 * they answered.
 *
 * Read only, and offline: no model, no network, nothing written. A log is read a line at a
 * time, so a long chat costs only the few events the policy needs; a line that won't read is
 * counted and skipped, as the store skips it. What it reports is numbers and kinds. Examples
 * (`examples`) are the only words in it, and they go through the secret scrubbers first.
 *
 * It measures the rules, not the second look or the task-aware review (a model's): what it
 * counts after reading is the most Auto could ask, before a review lifts any of it.
 */
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { contextStart, Id, type ConversationEvent, type TaintSource } from '@conch/protocol';

import { scrubSecrets } from '../search/past';
import { Redaction } from '../trajectory/redact';
import { askReason, type AskReason } from './ask-reason';
import { watch, watchable, type Step } from './behaviour';
import { assessRisk, breaksCircuit, riskAsks } from './risk';
import { eventFromLine } from './store';
import { heldTaints } from './taint';

export interface ReplayOptions {
  /** `CONCH_HOME`: the chats are in its `conversations` folder. */
  home: string;
  /** Count only what happened from then on (ms); earlier events still set the scene. */
  since?: number;
  /** Add a few redacted examples of what would ask. */
  examples?: boolean;
  /** Examples kept per kind of reason. */
  examplesPerKind?: number;
  /** The person's home folder, for the rules and the redaction (tests). */
  userHome?: string;
}

export interface ReplayExample {
  reason: AskReason;
  reading: 'before' | 'after';
  tool: string;
  /** The step, redacted and cut short. */
  step: string;
  /** What the rule says it would do, redacted. */
  rule?: string;
}

export interface ReplayReport {
  since?: number;
  /** Chat logs read. */
  chats: number;
  lines: { read: number; unreadable: number };
  steps: {
    total: number;
    beforeReading: number;
    afterReading: number;
    /** By the mode the chat's log last set before each step; `unset` is the person's default. */
    byMode: Record<string, number>;
  };
  /** Steps the rules would ask about, before and after the chat read something. */
  asks: { beforeReading: number; afterReading: number };
  /** Steps a pattern stops in every mode (a crowd of recipients): refused, not asked. */
  stops: number;
  /** Questions per 100 steps. */
  per100: { beforeReading: number; afterReading: number; overall: number };
  /** What makes the rules ask, most first. */
  kinds: { reason: AskReason; beforeReading: number; afterReading: number }[];
  /** What people were really asked, and how they answered, by kind of reason. */
  answers: {
    reason: AskReason;
    asked: number;
    /** Of those, asked while the chat was in Auto. */
    inAuto: number;
    allowed: number;
    denied: number;
    /** Nobody answered in time, or the turn ended first. */
    unanswered: number;
  }[];
  examples?: ReplayExample[];
}

const DAY = 24 * 60 * 60 * 1000;

/** What one chat needs to be judged again, kept small while its log streams by. */
interface ChatMeta {
  /** A routine's run or a task: no words of a person here count as theirs (`#yourWords`). */
  unattended: boolean;
  mode?: string;
}

/** Everything counted across the chats. */
export class ReplayTally {
  chats = 0;
  read = 0;
  unreadable = 0;
  steps = { total: 0, beforeReading: 0, afterReading: 0, byMode: {} as Record<string, number> };
  asks = { beforeReading: 0, afterReading: 0 };
  stops = 0;
  kinds = new Map<AskReason, { beforeReading: number; afterReading: number }>();
  answers = new Map<AskReason, Omit<ReplayReport['answers'][number], 'reason'>>();
  examples: ReplayExample[] = [];
  readonly #redaction: Redaction;

  constructor(
    readonly options: ReplayOptions,
    userHome: string,
  ) {
    this.#redaction = new Redaction({ home: userHome });
  }

  /** A few words, with every secret and personal detail Conch knows how to find taken out. */
  scrub(text: string, max = 200): string {
    const clean = scrubSecrets(this.#redaction.text(text)).replace(/\s+/g, ' ').trim();
    // Cut only after scrubbing, so half a key can't slip past the shapes.
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
  }

  example(example: Omit<ReplayExample, 'step' | 'rule'>, input: unknown, rule?: string) {
    if (!this.options.examples) return;
    const per = this.options.examplesPerKind ?? 3;
    if (this.examples.filter((e) => e.reason === example.reason).length >= per) return;
    const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const step =
      typeof args.command === 'string'
        ? this.scrub(args.command)
        : this.scrub(JSON.stringify(this.#redaction.value(input) ?? null));
    this.examples.push({ ...example, step, ...(rule && { rule: this.scrub(rule, 160) }) });
  }

  report(): ReplayReport {
    const per100 = (n: number, of: number) => (of ? Math.round((1000 * n) / of) / 10 : 0);
    const { steps, asks } = this;
    return {
      ...(this.options.since !== undefined && { since: this.options.since }),
      chats: this.chats,
      lines: { read: this.read, unreadable: this.unreadable },
      steps,
      asks,
      stops: this.stops,
      per100: {
        beforeReading: per100(asks.beforeReading, steps.beforeReading),
        afterReading: per100(asks.afterReading, steps.afterReading),
        overall: per100(asks.beforeReading + asks.afterReading, steps.total),
      },
      kinds: [...this.kinds]
        .map(([reason, n]) => ({ reason, ...n }))
        .sort(
          (a, b) =>
            b.beforeReading + b.afterReading - (a.beforeReading + a.afterReading) ||
            a.reason.localeCompare(b.reason),
        ),
      answers: [...this.answers]
        .map(([reason, n]) => ({ reason, ...n }))
        .sort((a, b) => b.asked - a.asked || a.reason.localeCompare(b.reason)),
      ...(this.options.examples && { examples: this.examples }),
    };
  }
}

/** A script's call input as its log keeps it (JSON, perhaps cut short): what can be read. */
function scriptInput(kept: string): unknown {
  try {
    return JSON.parse(kept) as unknown;
  } catch {
    return {};
  }
}

/** The events `heldTaints` and `contextStart` look at, and no more of them than they read. */
function slim(event: ConversationEvent): ConversationEvent {
  const { conversationId, seq, at } = event;
  switch (event.type) {
    case 'tool.started':
      return {
        conversationId,
        seq,
        at,
        type: event.type,
        toolUseId: event.toolUseId,
        name: event.name,
        input: event.name === 'Bash' ? event.input : undefined,
      };
    case 'tool.finished':
      return {
        conversationId,
        seq,
        at,
        type: event.type,
        toolUseId: event.toolUseId,
        status: event.status,
      };
    case 'user.message':
    case 'context.cleared':
    case 'context.restored':
    case 'taint':
      return event;
    default:
      // Whatever came right after a mark, as no call's end.
      return { conversationId, seq, at, type: 'assistant.done', messageId: '' };
  }
}

/** One chat's log, judged again step by step. */
class ChatReplay {
  /** The events the policy reads back: what was said, cleared, read, and each call's start. */
  readonly #kept: ConversationEvent[] = [];
  #afterTaint = false;
  #tainted?: TaintSource[];
  #said?: string[];
  /** App steps from the last day or this turn, for the patterns across steps. */
  #window: (Omit<Step, 'thisTurn'> & { seq: number })[] = [];
  #turnFrom = -1;
  #mode?: string;
  readonly #asked = new Map<string, AskReason>();

  constructor(
    readonly meta: ChatMeta,
    readonly tally: ReplayTally,
    readonly context: { workspace: string; home: string },
  ) {}

  #taints(): TaintSource[] {
    return (this.#tainted ??= heldTaints(this.#kept));
  }

  /** The person's own words so far, as `#yourWords` reads them. */
  #words(): string[] {
    if (this.meta.unattended) return [];
    if (this.#taints().some((source) => source.kind === 'person')) return [];
    if (!this.#said) {
      const start = contextStart(this.#kept);
      this.#said = this.#kept.flatMap((e) =>
        e.type === 'user.message' && e.seq >= start ? [e.text] : [],
      );
    }
    return this.#said;
  }

  #keep(event: ConversationEvent) {
    this.#kept.push(slim(event));
    if (event.type === 'taint' || this.#afterTaint) this.#tainted = undefined;
    if (
      event.type === 'user.message' ||
      event.type === 'context.cleared' ||
      event.type === 'context.restored'
    )
      this.#said = undefined;
  }

  event(event: ConversationEvent) {
    const counted = this.tally.options.since === undefined || event.at >= this.tally.options.since;
    if (event.type === 'options') this.#mode = event.options.permissionMode ?? this.#mode;
    if (event.type === 'user.message') this.#turnFrom = event.seq;
    if (event.type === 'tool.started') this.#step(event.toolUseId, event.name, event.input, event);
    else if (event.type === 'script.call' && event.status === 'running')
      this.#step(event.callId, event.tool, scriptInput(event.input), event);
    else if (event.type === 'permission.requested' && counted) this.#question(event);
    else if (event.type === 'permission.resolved' && counted) this.#answer(event);
    const kept =
      event.type === 'user.message' ||
      event.type === 'context.cleared' ||
      event.type === 'context.restored' ||
      event.type === 'taint' ||
      event.type === 'tool.started';
    // `heldTaints` reads the event right after a mark for the call that made it.
    if (kept || this.#afterTaint) this.#keep(event);
    this.#afterTaint = event.type === 'taint';
  }

  #step(id: string, name: string, input: unknown, event: ConversationEvent) {
    const { tally, context } = this;
    const counted = tally.options.since === undefined || event.at >= tally.options.since;
    const read = this.#taints().length > 0;
    const said = this.#words();
    this.#window = this.#window.filter((s) => s.at > event.at - DAY || s.seq > this.#turnFrom);
    const window: Step[] = this.#window.map((s) => ({ ...s, thisTurn: s.seq > this.#turnFrom }));
    if (watchable(name)) this.#window.push({ id, name, input, at: event.at, seq: event.seq });
    if (!counted) return;
    const reading = read ? 'after' : 'before';
    tally.steps.total += 1;
    tally.steps[read ? 'afterReading' : 'beforeReading'] += 1;
    const mode = this.#mode ?? 'unset';
    tally.steps.byMode[mode] = (tally.steps.byMode[mode] ?? 0) + 1;

    let reason: AskReason | undefined;
    let rule: string | undefined;
    const critical = breaksCircuit(name, input, context);
    if (critical) {
      reason = 'circuit';
      rule = critical.reason;
    } else {
      const pattern = watchable(name)
        ? watch({ id, name, input }, window, { now: event.at, read, said })
        : undefined;
      if (pattern?.level === 'stop') {
        tally.stops += 1;
        return;
      }
      if (pattern) {
        reason = 'pattern';
        rule = pattern.reason;
      } else {
        const risk = assessRisk(name, input, { ...context, said });
        if (risk && riskAsks(risk, read)) {
          reason = risk.kind;
          rule = risk.reason;
        }
      }
    }
    if (!reason) return;
    tally.asks[read ? 'afterReading' : 'beforeReading'] += 1;
    const kind = tally.kinds.get(reason) ?? { beforeReading: 0, afterReading: 0 };
    kind[read ? 'afterReading' : 'beforeReading'] += 1;
    tally.kinds.set(reason, kind);
    tally.example({ reason, reading, tool: name }, input, rule);
  }

  #question(event: Extract<ConversationEvent, { type: 'permission.requested' }>) {
    const reason = askReason(
      {
        toolName: event.toolName,
        input: event.input,
        ...(event.taint && { taint: event.taint }),
        ...(event.cost && { cost: event.cost }),
        ...(event.vault && { vault: event.vault }),
        ...(event.browser && { browser: event.browser }),
      },
      this.context,
    );
    this.#asked.set(event.permissionId, reason);
    const row = this.tally.answers.get(reason) ?? {
      asked: 0,
      inAuto: 0,
      allowed: 0,
      denied: 0,
      unanswered: 0,
    };
    row.asked += 1;
    if (this.#mode === 'auto') row.inAuto += 1;
    this.tally.answers.set(reason, row);
  }

  #answer(event: Extract<ConversationEvent, { type: 'permission.resolved' }>) {
    const reason = this.#asked.get(event.permissionId);
    const row = reason && this.tally.answers.get(reason);
    if (!row) return;
    this.#asked.delete(event.permissionId);
    if (event.decision === 'allow' || event.decision === 'allow-always') row.allowed += 1;
    else if (event.decision === 'deny') row.denied += 1;
    else row.unanswered += 1;
  }
}

/** Each line of one chat's log, judged again; a line that won't read is counted and skipped. */
export async function replayLines(
  lines: AsyncIterable<string> | Iterable<string>,
  meta: ChatMeta,
  tally: ReplayTally,
  context: { workspace: string; home: string },
): Promise<void> {
  const chat = new ChatReplay(meta, tally, context);
  tally.chats += 1;
  for await (const line of lines) {
    if (!line.trim()) continue;
    tally.read += 1;
    const event = eventFromLine(line);
    if (event) chat.event(event);
    else tally.unreadable += 1;
  }
}

/** A JSON file that may be missing or damaged: undefined then, never a repair. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Replay every chat under `home`, read only. */
export async function replay(options: ReplayOptions): Promise<ReplayReport> {
  const userHome = options.userHome ?? homedir();
  const tally = new ReplayTally(options, userHome);
  const dir = join(options.home, 'conversations');
  // The work folder as Settings has it, read as it is: never through the store that repairs it.
  const settings = record(await readJson(join(options.home, 'settings.json')));
  const chosen = record(settings.preferences).workspace;
  const workspace =
    typeof chosen === 'string' && chosen.trim() ? chosen.trim() : join(options.home, 'workspace');
  // Who each chat is with, from the index, read as it is.
  const index = await readJson(join(dir, 'index.json'));
  const origins = new Map<string, string>();
  for (const entry of Array.isArray(index) ? index : []) {
    const { id, origin } = record(entry);
    const kind = record(origin).kind;
    if (typeof id === 'string' && typeof kind === 'string') origins.set(id, kind);
  }
  const names = (await readdir(dir).catch(() => [] as string[])).sort();
  for (const name of names) {
    const id = name.slice(0, -'.jsonl'.length);
    if (!name.endsWith('.jsonl') || !Id.safeParse(id).success) continue;
    const path = join(dir, name);
    // A log last written before the window has nothing to count.
    if (options.since !== undefined) {
      const changed = await stat(path).then(
        (s) => s.mtimeMs,
        () => undefined,
      );
      if (changed === undefined || changed < options.since) continue;
    }
    const origin = origins.get(id);
    const stream = createReadStream(path, { encoding: 'utf8', flags: 'r' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      await replayLines(lines, { unattended: origin === 'routine' || origin === 'task' }, tally, {
        workspace,
        home: userHome,
      });
    } catch {
      // A log that can't be read to its end (gone mid-read): what was read counts.
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  return tally.report();
}

/** `30d`, `12h`, `2w`, or a date: when counting starts, in ms. */
export function sinceFrom(text: string, now = Date.now()): number | undefined {
  const span = /^(\d+)\s*([hdw])$/i.exec(text.trim());
  if (span) {
    const n = Number(span[1]);
    const unit = { h: 3_600_000, d: DAY, w: 7 * DAY }[(span[2] ?? 'd').toLowerCase() as 'h'];
    return now - n * unit;
  }
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : undefined;
}
