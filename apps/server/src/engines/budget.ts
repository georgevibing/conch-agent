/**
 * How much one turn may do before it checks in (ADR 0085).
 *
 * A turn used to stop after 24 tool steps, which cut long browser tasks off
 * halfway. Now each turn has a generous budget in steps, fresh tokens and
 * time, and a watch for the one thing that really goes wrong: getting nowhere.
 * That's the same call coming back with the same answer, again and again, in
 * quick succession. A changed answer is progress (a test run that's further
 * along, a page that moved), and so is time: a check made every half a minute
 * is waiting for something, not looping. Failures in a row are how debugging
 * goes, so they earn a word to the model, never a pause.
 * The model hears about it first (a nudge in the tool result), twice; only a
 * plain, fast run of the very same thing pauses the turn. A pause is never a
 * failure: it ends with one plain sentence and a **Carry on** that picks up
 * exactly where it stopped.
 *
 * Pure: no I/O and an injectable clock, so every rule is a test.
 */
import { createHash } from 'node:crypto';

import type { TurnLimits, TurnPause, Usage } from '@conch/protocol';

/** What one turn may use before it pauses to check in. `Infinity` is no limit. */
export interface TurnBudget {
  /** Rounds of tool calls (one model request that asked for tools is one step). */
  steps: number;
  /** Fresh tokens: input not read from the provider's cache, plus output. */
  tokens: number;
  /** Wall-clock time for the whole turn. */
  ms: number;
}

const MINUTE = 60_000;

/**
 * The budget for a turn. Someone watching gets a generous one and a Carry on;
 * a routine or a task (nobody watching) gets more room, since nobody is there
 * to press it. A chat someone is watching has no budget at all until they turn
 * one on (`limits`, Settings → Usage): then over the monthly budget the person
 * set (ADR 0005), fresh tokens are halved: it never blocks, but it checks in
 * sooner. A model on this computer costs nothing, so only steps and time count,
 * and it's slower.
 */
export function turnBudget(input: {
  unattended?: boolean;
  overBudget?: boolean;
  local?: boolean;
  limits?: TurnLimits;
}): TurnBudget {
  if (!input.unattended && !input.limits?.on)
    return { steps: Infinity, tokens: Infinity, ms: Infinity };
  const base = input.unattended
    ? { steps: 200, tokens: 4_000_000, ms: 60 * MINUTE }
    : {
        steps: input.limits?.steps ?? 100,
        tokens: input.limits?.tokens ?? 2_000_000,
        ms: (input.limits?.minutes ?? 30) * MINUTE,
      };
  return {
    steps: base.steps,
    tokens: input.local
      ? Number.POSITIVE_INFINITY
      : input.overBudget
        ? Math.round(base.tokens / 2)
        : base.tokens,
    ms: input.local ? Math.round(base.ms * 1.5) : base.ms,
  };
}

/** What the watch says about the next thing the turn does. */
export type Verdict =
  | { kind: 'go' }
  /** Tell the model this, in the result it's about to read. */
  | { kind: 'nudge'; note: string }
  /** Pause the turn here. */
  | { kind: 'stop'; pause: TurnPause };

const GO: Verdict = { kind: 'go' };

/** The same call with the same answer this many times: tell the model; again at twice that. */
export const LOOP_NUDGE = 3;
/** And this many, each hard on the last: pause. */
export const LOOP_STOP = 10;
/** How many recent outcomes a loop is counted in. */
const WINDOW = 30;
/** Repeats this far apart are waiting (a test run, a build, a download), not a loop. */
export const PATIENT_MS = 20_000;
/** Failures in a row before the model is told to step back (it's never paused for them). */
export const ERRORS_NUDGE = 4;
/** The same long answer from different calls, in a row: nothing they do is changing anything. */
export const SAME_NUDGE = 4;
export const SAME_STOP = 12;
/** Answers shorter than this are confirmations, not a page or a listing that should change. */
const SAME_MIN_CHARS = 200;
/** Near the end of the budget, the model is asked to wrap up so the pause lands well. */
const WRAP_UP = 0.85;

/** JSON with sorted keys, so `{a,b}` and `{b,a}` are the same call. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const digest = (text: string) => createHash('sha256').update(text).digest('base64url').slice(0, 16);

/**
 * An answer as it bears on progress: times, clocks and durations change on
 * every run of the same thing, so they don't make it a different answer.
 */
export function steady(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\b/g, '<clock>')
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|seconds?|m|min|minutes?)\b/gi, '<took>');
}

/** The words a person reads when a turn pauses. */
export function pauseFor(reason: TurnPause['reason'], budget: TurnBudget, count?: number) {
  const minutes = Math.max(1, Math.round(budget.ms / MINUTE));
  const message: Record<TurnPause['reason'], string> = {
    steps: `Paused after ${count ?? budget.steps} steps, so this doesn’t run on without you.`,
    tokens:
      'Paused: this has read and written a lot for one message, so it’s checking in before it spends more.',
    time: `Paused after ${minutes} minute${minutes === 1 ? '' : 's'} of work, so this doesn’t run on without you.`,
    loop: 'Paused: the same step kept coming back with the same answer, so it’s checking in before trying again.',
  };
  return { reason, message: message[reason] } satisfies TurnPause;
}

/**
 * One turn's watch. The engine tells it what happens — each round of tool
 * calls, each call and its answer, what's been spent — and it answers with a
 * verdict. It never throws and never acts: the engine decides how to nudge
 * and how to stop.
 */
export class TurnWatch {
  readonly started: number;
  #steps = 0;
  #calls = 0;
  #fresh = 0;
  /** Recent outcomes (a call and its answer), with how many times each came straight back. */
  #outcomes: { key: string; at: number; run: number }[] = [];
  #errors = 0;
  #same = { key: '', count: 0, at: 0 };
  #wrapped = false;

  constructor(
    readonly budget: TurnBudget,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
  }

  get steps() {
    return this.#steps;
  }

  get calls() {
    return this.#calls;
  }

  /** What the turn has used so far, as a running total. */
  used(usage: Pick<Usage, 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>): void {
    const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
    this.#fresh = usage.inputTokens - cached + usage.outputTokens;
  }

  /** Before the next request to the model: is there room for it? */
  next(): Verdict {
    if (this.now() - this.started >= this.budget.ms)
      return { kind: 'stop', pause: pauseFor('time', this.budget) };
    if (this.#fresh >= this.budget.tokens)
      return { kind: 'stop', pause: pauseFor('tokens', this.budget) };
    if (this.#steps >= this.budget.steps)
      return { kind: 'stop', pause: pauseFor('steps', this.budget, this.#steps) };
    return GO;
  }

  /** A round of tool calls finished. Near the end of the budget, ask the model to wrap up. */
  round(): Verdict {
    this.#steps++;
    if (this.#wrapped) return GO;
    const share = Math.max(
      this.#steps / this.budget.steps,
      this.#fresh / this.budget.tokens,
      (this.now() - this.started) / this.budget.ms,
    );
    if (share < WRAP_UP) return GO;
    this.#wrapped = true;
    return {
      kind: 'nudge',
      note: '[From Conch: this turn is close to its limit and will pause soon. Finish the step you’re on, then say plainly what’s done and what’s left, so the person can tell you to carry on.]',
    };
  }

  /** A tool is about to run with these arguments. */
  call(_name: string, _args: unknown): Verdict {
    this.#calls++;
    return GO;
  }

  /**
   * What the tool answered. A loop is the same call coming back with the same
   * answer, each time hard on the last; anything else is progress or patience.
   */
  result(name: string, args: unknown, text: string, isError: boolean): Verdict {
    const at = this.now();
    const answer = steady(text);
    const key = `${name}\u0000${stableJson(args ?? {})}\u0000${digest(answer)}`;
    const before = this.#outcomes.findLast((o) => o.key === key);
    const run = before && at - before.at < PATIENT_MS ? before.run + 1 : 1;
    this.#outcomes.push({ key, at, run });
    if (this.#outcomes.length > WINDOW) this.#outcomes.shift();

    this.#errors = isError ? this.#errors + 1 : 0;
    // A short answer ("Saved.") is a confirmation, the same every time by design; the same
    // error to different tries is still trying (only the very same call counts, above).
    const same =
      !isError && answer.length >= SAME_MIN_CHARS ? `${name}\u0000${digest(answer)}` : '';
    this.#same =
      same && this.#same.key === same && at - this.#same.at < PATIENT_MS
        ? { key: same, count: this.#same.count + 1, at }
        : { key: same, count: 1, at };

    if (run >= LOOP_STOP || this.#same.count >= SAME_STOP)
      return { kind: 'stop', pause: pauseFor('loop', this.budget) };
    if (run === LOOP_NUDGE || run === LOOP_NUDGE * 2)
      return {
        kind: 'nudge',
        note: `[From Conch: this exact ${name} call has given the same answer ${run} times in a row. Don’t run it again as it is: change something, try a different way, or tell the person what’s in the way. If you’re waiting on something, wait longer between checks.]`,
      };
    if (this.#errors === ERRORS_NUDGE)
      return {
        kind: 'nudge',
        note: `[From Conch: the last ${ERRORS_NUDGE} tool calls failed. Step back: read what the errors say and try another way, or tell the person what’s blocking you.]`,
      };
    if (this.#same.count === SAME_NUDGE)
      return {
        kind: 'nudge',
        note: `[From Conch: ${name} has given the same answer ${SAME_NUDGE} times in a row, so nothing is changing. Try something different, or tell the person what’s in the way.]`,
      };
    return GO;
  }

  /**
   * The ceiling for an agent that runs its own loop (Codex, the ACP programs):
   * Conch only sees its tool calls, not its requests, so calls stand in for
   * steps, two to a step.
   */
  outside(): Verdict {
    const time = this.next();
    if (time.kind === 'stop' && time.pause.reason !== 'steps') return time;
    if (this.#calls > this.budget.steps * 2)
      return { kind: 'stop', pause: pauseFor('steps', this.budget, this.#calls) };
    return GO;
  }
}

/** A note appended to a tool's answer, kept apart from it. */
export function withNote(text: string, note: string): string {
  return `${text}\n\n${note}`;
}
