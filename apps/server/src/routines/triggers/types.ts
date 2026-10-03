/**
 * The shape every When… source has (ADR 0056). A source finds out whether
 * something new happened without a model; the pulse (`pulse.ts`) does the
 * rest: once each, bursts into one run, the only-if check, health.
 */
import type { TaintSource, Trigger, TriggerKind, Usage } from '@conch/protocol';

/** One thing that happened. */
export interface Happening {
  /** Stable for the same thing, so it's only ever acted on once. */
  id: string;
  at: number;
  /** A few words for the run's history: "Anna Smith’s email". */
  label: string;
  /** Where it is, when it has an address (Gmail, the calendar, the page). */
  link?: string;
  /**
   * What it says, written by someone else: given to the run as data, never
   * as instructions (and never to the system prompt). Kept short.
   */
  detail: string;
  /** For a run another routine's run started: the routines before it, oldest first. */
  chain?: string[];
}

/** What only a person can fix, or a failure that keeps happening. */
export class SourceError extends Error {
  constructor(
    /**
     * `needs-you`: only a person can fix it (signed out, turned off, gone);
     * `retry`: it usually passes (offline, the server busy): try again later.
     */
    readonly kind: 'needs-you' | 'retry',
    message: string,
    /** For `needs-you`: one place to fix it. */
    readonly fix?: { label: string; place: string; focus?: string },
  ) {
    super(message);
  }
}

/** A trigger that can't be saved, and why, in plain words. */
export class TriggerError extends Error {}

export type TriggerOf<K extends TriggerKind> = Extract<Trigger, { kind: K }>;

export interface SourceContext<T extends Trigger = Trigger> {
  routineId: string;
  title: string;
  trigger: T;
  /** When it was turned on: nothing older counts. */
  since: number;
  /** The source's own bookkeeping, kept across restarts (JSON). */
  state: Record<string, unknown>;
  now: number;
  signal: AbortSignal;
}

export interface CheckResult {
  happenings: Happening[];
  /** The source's bookkeeping to keep. */
  state?: Record<string, unknown>;
  /** Look again sooner than usual (a page change to confirm), in ms. */
  again?: number;
}

/** Something pushed: a file changed, a task finished, a delivery. */
export type Arrive = (happenings: Happening[]) => void;

export interface WatchHandle {
  stop(): void;
}

export interface TriggerSource<K extends TriggerKind = TriggerKind> {
  readonly kind: K;
  /** Check, tidy and complete a trigger before it's saved. Throws `TriggerError`. */
  validate?(trigger: TriggerOf<K>, ctx: { routineId?: string }): Promise<TriggerOf<K>>;
  /** "When Anna Smith emails you": Conch's words, never the model's. */
  describe(trigger: TriggerOf<K>): string;
  /** How it looks, in a sentence, for the editor. */
  note?(trigger: TriggerOf<K>): string;
  /** What it brings in, for the guard after reading (ADR 0028). */
  taint(trigger: TriggerOf<K>): TaintSource;
  /** Polled sources: how often to look (ms). */
  every?(trigger: TriggerOf<K>): number;
  check?(ctx: SourceContext<TriggerOf<K>>): Promise<CheckResult>;
  /** Pushed sources: start listening. Problems are reported with `problem`. */
  watch?(
    ctx: Omit<SourceContext<TriggerOf<K>>, 'signal' | 'now'>,
    arrive: Arrive,
    problem: (error?: SourceError) => void,
  ): WatchHandle;
  /** The most recent matching thing, for “Try it now”. */
  sample?(ctx: SourceContext<TriggerOf<K>>): Promise<Happening | undefined>;
  /** A failure that lasts this long becomes a problem on the card (default 30 min). */
  readonly patience?: number;
}

/**
 * Routine spending (ADR 0057) as the pulse sees it: asked before an only-if
 * check, told what the check cost. Event runs themselves are guarded where
 * every run is (`RoutineService.fire`). Without it, everything is allowed.
 */
export interface PulseSpend {
  allow(routineId: string): Promise<boolean>;
  record(routineId: string, usage: Usage | undefined, model?: string): void;
}
