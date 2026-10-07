/**
 * What unattended runs spend, and the three guards that keep it in hand (ADR 0057):
 *
 * - **A run's limit.** A run that uses about three times what this routine
 *   usually does (or, before it has a history, what a typical briefing costs
 *   on its model) stops cleanly and asks for a look.
 * - **A monthly limit** on the money everything unattended spends: routine
 *   runs, whatever starts them, and the checks some routines make before
 *   they run. It counts only pay-as-you-go money; a plan or a model on this
 *   computer costs nothing here. At the limit, runs that cost money pause
 *   until the 1st, and the person hears about it once.
 * - **Room on a plan.** A subscription's window that's nearly used up (80%,
 *   or what the person chose, or never) is left to the person's own chats: a
 *   run waits until it resets, unless its routine is set to run regardless.
 *
 * The ledger is `~/.conch/routine-spend.json`. Changing the limit is a
 * person's action in the UI (`PUT /api/routines/spending`); no tool the
 * agent has can reach it.
 */
import { join } from 'node:path';

import { PLAN_ROOM_DEFAULT } from '@conch/protocol';
import type {
  Billing,
  EngineId,
  RoutineRun,
  RoutineSpend as RoutineSpendView,
  RoutineSpending,
  RunCost,
  Schedule,
  Usage,
  UsageWindow,
} from '@conch/protocol';
import { z } from 'zod';

import type { Engine } from '../engines/types';
import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { Billings, priceUsage, type BillingInfo } from '../usage/billing';
import { costAt, priceOf, TYPICAL_RUN } from '../usage/prices';
import { perDay } from './schedule';

/** The monthly limit until a person sets one: a daily briefing on a mid-priced model fits. */
export const DEFAULT_MONTHLY_USD = 20;
/** A run may use this many times what's usual for it… */
export const RUN_LIMIT_TIMES = 3;
/** …and never less than this. */
export const RUN_LIMIT_MIN_USD = 1;
/** With nothing to go on but the provider's word after the fact. */
export const RUN_LIMIT_FALLBACK_USD = 3;
/** With no price at all: three typical runs' worth of tokens. */
export const RUN_LIMIT_TOKENS =
  RUN_LIMIT_TIMES * (TYPICAL_RUN.inputTokens + TYPICAL_RUN.outputTokens);
export const RUN_LIMIT_MIN_TOKENS = 300_000;
/** A plan window this full is left to the person, until they choose otherwise. */
export const PLAN_ROOM_PERCENT = PLAN_ROOM_DEFAULT;
const DAYS_PER_MONTH = 30.4;
/** How many recent runs say what's usual. */
const RECENT = 5;

const SpendFile = z.object({
  version: z.literal(1).default(1),
  /** USD per month; `null`: no limit; absent: the default. */
  limit: z.number().positive().nullable().optional(),
  /** Local calendar month (YYYY-MM) → USD that unattended runs spent. */
  months: z.record(z.string(), z.number().nonnegative()).default({}),
  /** The month whose pause the person was told about (push, chat apps): once a month. */
  told: z.string().optional(),
  /** The month the person chose “Keep paused”. */
  dismissed: z.string().optional(),
  /** How full a plan gets before routines wait; `null`: never; absent: the default. */
  planRoom: z.number().int().min(50).max(99).nullable().optional(),
});
type SpendFile = z.infer<typeof SpendFile>;

/** What a run that costs money may do right now. */
export type Allowed =
  | {
      ok: true;
      billing?: Billing;
      /** On a plan: its tightest window before the run, to measure the run's share. */
      before?: UsageWindow;
    }
  | { ok: false; guard: 'month' | 'plan-room'; until?: number; message: string };

/** What one run may use before it stops. */
export interface RunLimit {
  usd?: number;
  tokens?: number;
  custom: boolean;
}

/**
 * The ledger after a restore: for every month the larger amount, so money
 * already spent stays counted, and the backup's limit (a restore preview
 * names a limit that lets routines spend more, `backup/powers.ts`).
 */
export function mergeRoutineSpend(current: Buffer | undefined, restored: Buffer): SpendFile {
  const read = (bytes: Buffer | undefined): SpendFile => {
    try {
      const parsed = SpendFile.safeParse(bytes ? JSON.parse(bytes.toString('utf8')) : {});
      return parsed.success ? parsed.data : SpendFile.parse({});
    } catch {
      return SpendFile.parse({});
    }
  };
  const now = read(current);
  const back = read(restored);
  const months: Record<string, number> = { ...now.months };
  for (const [month, usd] of Object.entries(back.months))
    months[month] = Math.max(months[month] ?? 0, usd);
  return {
    version: 1,
    ...(back.limit !== undefined && { limit: back.limit }),
    ...(back.planRoom !== undefined && { planRoom: back.planRoom }),
    months,
    ...(now.told && { told: now.told }),
    ...(now.dismissed && { dismissed: now.dismissed }),
  };
}

export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Midnight on the 1st of next month, local time. */
export function nextMonth(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** Money already spent, to the cent: "$20.40". */
export function cents(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** "$0.42", "$3.10", "$37", "less than a cent": an amount that's about, not exact. */
export function money(usd: number): string {
  if (usd < 0.005) return 'less than a cent';
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

/** The one thing said when routines pause at the monthly limit (a notification, a chat app). */
export function pausedWords(spending: RoutineSpending): { title: string; body: string } {
  const until = spending.paused?.until ?? nextMonth(Date.now());
  return {
    title: 'Your routines are paused',
    body: `Your routines have used ${cents(spending.monthUsd)} this month, so the ones that cost money are paused until ${dateWords(until)}. You can raise the limit in Conch.`,
  };
}

function dateWords(at: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(at);
}

function clockWords(at: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(at);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Runs a month on this schedule (`once`: one, ever). */
export function runsPerMonth(schedule: Schedule, timezone: string): number {
  if (schedule.type === 'once') return 1;
  try {
    return perDay(schedule, timezone) * DAYS_PER_MONTH;
  } catch {
    return 0;
  }
}

/** Runs that say what's usual: they finished, on this model, and no guard cut them short. */
function usual(runs: readonly RoutineRun[], model: string | undefined): RoutineRun[] {
  return runs
    .filter(
      (r) =>
        r.cost &&
        !r.guard &&
        (r.status === 'succeeded' || r.status === 'nothing-to-do' || r.status === 'needs-you') &&
        (!model || !r.cost.model || r.cost.model === model),
    )
    .slice(0, RECENT);
}

export class RoutineSpend {
  #mutex = new Mutex();
  #file?: SpendFile;
  #billings: Billings;

  constructor(
    private readonly deps: {
      home: string;
      /** The provider a routine names, else the default. */
      engine: (id?: EngineId) => Engine;
      /** What routines spent changed. */
      changed?: (spending: RoutineSpending) => void;
      /** Routines just paused at the monthly limit: tell the person, once a month. */
      paused?: (spending: RoutineSpending) => void;
      now?: () => number;
      heal?: Heal;
      /** How providers charge, shared with chats (ADR 0079). */
      billings?: Billings;
    },
  ) {
    this.#billings = deps.billings ?? new Billings(() => this.#now);
  }

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  get #path() {
    return join(this.deps.home, 'routine-spend.json');
  }

  // ── How a provider charges ─────────────────────────────────────────────

  /**
   * Free (it runs on this computer), a plan (a subscription's allowance) or
   * money. Asked of the engine, never assumed from which engine it is.
   */
  billing(engine: Engine, { fresh = false } = {}): Promise<BillingInfo> {
    return this.#billings.of(engine, { fresh });
  }

  /** Money for these tokens: the provider's own figure, else list price, else unknown. */
  price(usage: Usage, model: string | undefined): { usd?: number; priced?: 'provider' | 'list' } {
    return priceUsage(usage, model);
  }

  /** What a run (or a check before one) cost. */
  async cost(
    usage: Usage | undefined,
    from: { engine: Engine | EngineId; model?: string },
    before?: UsageWindow,
  ): Promise<RunCost> {
    const engine = typeof from.engine === 'string' ? this.deps.engine(from.engine) : from.engine;
    const { billing = 'metered' } = await this.billing(engine);
    const base = { billing, engine: engine.id, ...(from.model && { model: from.model }) };
    if (billing === 'free') return base;
    const priced = usage ? this.price(usage, from.model) : {};
    const share = billing === 'plan' && before ? await this.#planShare(engine, before) : undefined;
    return {
      ...base,
      ...(priced.usd !== undefined && { usd: Math.round(priced.usd * 1e6) / 1e6 }),
      ...(priced.priced && { priced: priced.priced }),
      ...(share !== undefined && { planPercent: share }),
    };
  }

  /** How much of the window a run took: the window after, less before (same window, no reset). */
  async #planShare(engine: Engine, before: UsageWindow): Promise<number | undefined> {
    const after = await engine.usage?.({ force: true }).catch(() => undefined);
    const now = after?.windows.find((w) => w.id === before.id);
    if (!now) return undefined;
    if (before.resetsAt && now.resetsAt && Math.abs(now.resetsAt - before.resetsAt) > 10 * 60_000)
      return undefined;
    const delta = now.usedPercent - before.usedPercent;
    return delta >= 0 && delta <= 100 ? Math.round(delta * 10) / 10 : undefined;
  }

  // ── The ledger ─────────────────────────────────────────────────────────

  /**
   * Count what something unattended spent: a routine run, whatever started
   * it, or a check a routine makes before it runs (`only if…`). Only money
   * counts against the month; a plan's or this computer's runs are free here.
   */
  async record(
    routineId: string,
    usage: Usage | undefined,
    from: { engine: Engine | EngineId; model?: string },
  ): Promise<RunCost> {
    const cost = await this.cost(usage, from);
    await this.count(routineId, cost);
    return cost;
  }

  /** Count a cost already worked out (a run's, with its plan share). */
  async count(_routineId: string, cost: RunCost): Promise<void> {
    if (cost.billing !== 'metered' || !cost.usd) return;
    const usd = cost.usd;
    const crossed = await this.#mutex.run(async () => {
      const file = await this.#load();
      const month = monthKey(this.#now);
      const was = this.#pausedIn(file, month);
      file.months[month] = (file.months[month] ?? 0) + usd;
      // A year of months is plenty (keys sort by date).
      file.months = Object.fromEntries(
        Object.entries(file.months)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-13),
      );
      const now = this.#pausedIn(file, month);
      const tell = now && !was && file.told !== month;
      if (tell) file.told = month;
      await writeJson(this.#path, file);
      return tell;
    });
    const state = await this.state();
    this.deps.changed?.(state);
    if (crossed) this.deps.paused?.(state);
  }

  /**
   * May a run start now? A run that costs money waits at the monthly limit;
   * one on a nearly-used plan waits for it to reset. Free runs always go.
   */
  async allow(
    _routineId: string,
    engine?: Engine,
    /** `planRoom: false`: this routine runs even on a nearly-used plan (a person chose it). */
    { planRoom = true }: { planRoom?: boolean } = {},
  ): Promise<Allowed> {
    const target = engine ?? this.deps.engine();
    const info = await this.billing(target);
    if (info.billing === 'metered') {
      const file = await this.#mutex.run(() => this.#load());
      const month = monthKey(this.#now);
      if (this.#pausedIn(file, month)) {
        const limit = this.#limitOf(file) ?? 0;
        const until = nextMonth(this.#now);
        return {
          ok: false,
          guard: 'month',
          until,
          message: `Paused: your routines have used ${cents(file.months[month] ?? 0)} of this month’s ${money(limit)}, so this waits until ${dateWords(until)}.`,
        };
      }
    }
    if (info.billing === 'plan') {
      // Read again now: a window fills while nobody's looking.
      const usage = (await this.billing(target, { fresh: true })).usage;
      const room = planRoom ? await this.#planRoom() : null;
      const full = usage?.windows
        .filter((w) => room !== null && w.usedPercent >= room)
        .sort((a, b) => (b.resetsAt ?? Infinity) - (a.resetsAt ?? Infinity))[0];
      if (full) {
        const source = info.source ?? target.label;
        return {
          ok: false,
          guard: 'plan-room',
          ...(full.resetsAt && { until: full.resetsAt }),
          message: `Waited so your own chats have room: your ${source} plan is ${Math.round(full.usedPercent)}% used.${full.resetsAt ? ` It runs when it resets${full.resetsAt - this.#now < 20 * 3_600_000 ? ` at ${clockWords(full.resetsAt)}` : ` on ${dateWords(full.resetsAt)}`}.` : ' It runs once there’s room.'}`,
        };
      }
      return { ok: true, billing: 'plan', ...(usage?.windows[0] && { before: usage.windows[0] }) };
    }
    return { ok: true, ...(info.billing && { billing: info.billing }) };
  }

  // ── One run's limit ────────────────────────────────────────────────────

  /**
   * What one run may use: a person's choice, else three times what this
   * routine usually costs, else three times a typical briefing on its model,
   * never under a dollar. With no price at all, it's counted in tokens.
   */
  runLimit(
    routine: { runLimitUsd?: number },
    runs: readonly RoutineRun[],
    model: string | undefined,
  ): RunLimit {
    if (routine.runLimitUsd) return { usd: routine.runLimitUsd, custom: true };
    const recent = usual(runs, model);
    const usd = median(recent.flatMap((r) => (r.cost?.usd !== undefined ? [r.cost.usd] : [])));
    const tokens = median(
      recent.flatMap((r) => (r.usage ? [r.usage.inputTokens + r.usage.outputTokens] : [])),
    );
    const known = recent.filter((r) => r.cost?.usd !== undefined).length >= 2;
    const price = priceOf(model);
    const typical = known ? usd : price ? costAt(price, TYPICAL_RUN) : undefined;
    return {
      usd:
        typical !== undefined
          ? Math.max(RUN_LIMIT_MIN_USD, Math.round(RUN_LIMIT_TIMES * typical * 100) / 100)
          : RUN_LIMIT_FALLBACK_USD,
      tokens:
        tokens !== undefined && recent.length >= 2
          ? Math.max(RUN_LIMIT_MIN_TOKENS, Math.round(RUN_LIMIT_TIMES * tokens))
          : RUN_LIMIT_TOKENS,
      custom: false,
    };
  }

  /**
   * Watches one run: given what it has used so far, says why it should stop
   * once it's past its limit (money when it's priced, else tokens).
   */
  over(
    limit: RunLimit,
    billing: Billing | undefined,
    usage: Usage,
    model: string | undefined,
  ): string | undefined {
    if (billing === 'free') return undefined;
    const { usd } = this.price(usage, model);
    const plan = billing === 'plan';
    if (usd !== undefined && limit.usd !== undefined) {
      if (usd <= limit.usd) return undefined;
      return plan
        ? `This run stopped because it was doing far more than usual (about ${money(usd)} of work, when a run may do ${money(limit.usd)}).`
        : `This run stopped at its spending limit: it had used about ${money(usd)}, and a run may use ${money(limit.usd)}.`;
    }
    if (limit.tokens === undefined) return undefined;
    const tokens = usage.inputTokens + usage.outputTokens;
    if (tokens <= limit.tokens) return undefined;
    return `This run stopped because it was doing far more than usual (about ${Math.round(tokens / 1000).toLocaleString('en-US')} thousand tokens, when a run may use ${Math.round(limit.tokens / 1000).toLocaleString('en-US')} thousand).`;
  }

  // ── A routine at a glance ──────────────────────────────────────────────

  /** What a routine costs, in one honest line, from its schedule and its runs. */
  async view(
    routine: {
      schedule: Schedule;
      timezone: string;
      runLimitUsd?: number;
      options: { engine?: EngineId; model?: string };
    },
    runs: readonly RoutineRun[],
  ): Promise<RoutineSpendView> {
    const engine = this.deps.engine(routine.options.engine);
    const info = await this.billing(engine);
    if (!info.billing) return {};
    if (info.billing === 'free') return { billing: 'free', text: 'Free on this computer' };
    // The model it ran with last says more than a default nobody named.
    const model = routine.options.model ?? runs.find((r) => r.cost?.model)?.cost?.model;
    const recent = usual(runs, model);
    const runLimit = this.runLimit(routine, runs, model);
    const once = routine.schedule.type === 'once';
    const perMonth = runsPerMonth(routine.schedule, routine.timezone);
    const source = info.source ?? engine.label;

    if (info.billing === 'plan') {
      const share = median(
        recent.flatMap((r) => (r.cost?.planPercent !== undefined ? [r.cost.planPercent] : [])),
      );
      const text =
        share === undefined
          ? `Runs on your ${source} plan`
          : share < 1
            ? `Uses a little of your ${source} plan`
            : `About ${Math.round(share)}% of your ${source} limit${once ? '' : ' a run'}`;
      return { billing: 'plan', text, runLimit };
    }

    const known = recent.flatMap((r) => (r.cost?.usd !== undefined ? [r.cost.usd] : []));
    const fromRuns = median(known);
    const price = priceOf(model);
    const perRun = fromRuns ?? (price ? costAt(price, TYPICAL_RUN) : undefined);
    if (perRun === undefined) return { billing: 'metered', runLimit };
    const basis = fromRuns !== undefined ? 'runs' : 'estimate';
    const total = once ? perRun : perRun * perMonth;
    const about = basis === 'runs' ? 'About' : 'Roughly';
    const amount = money(total);
    const text =
      amount === 'less than a cent'
        ? `Less than a cent${once ? '' : ' a month'}`
        : `${about} ${amount}${once ? '' : ' a month'}`;
    return {
      billing: 'metered',
      text,
      ...(!once && { monthlyUsd: Math.round(total * 100) / 100 }),
      basis,
      runLimit,
    };
  }

  // ── The month ──────────────────────────────────────────────────────────

  async state(projectedUsd?: number): Promise<RoutineSpending> {
    const file = await this.#mutex.run(() => this.#load());
    const month = monthKey(this.#now);
    const limit = this.#limitOf(file);
    return {
      limitUsd: limit,
      isDefault: file.limit === undefined,
      monthUsd: Math.round((file.months[month] ?? 0) * 100) / 100,
      ...(projectedUsd !== undefined && { projectedUsd: Math.round(projectedUsd * 100) / 100 }),
      planRoomPercent: file.planRoom === undefined ? PLAN_ROOM_PERCENT : file.planRoom,
      ...(this.#pausedIn(file, month) && {
        paused: { until: nextMonth(this.#now), dismissed: file.dismissed === month },
      }),
    };
  }

  /** A person set the monthly limit (`null`: none). Never reachable by the agent. */
  async setLimit(limitUsd: number | null): Promise<RoutineSpending> {
    await this.#mutex.run(async () => {
      const file = await this.#load();
      file.limit = limitUsd;
      file.dismissed = undefined;
      await writeJson(this.#path, file);
    });
    const state = await this.state();
    this.deps.changed?.(state);
    return state;
  }

  /**
   * A person chose how full a plan gets before routines wait for it to
   * reset (`null`: they never wait). Never reachable by the agent.
   */
  async setPlanRoom(percent: number | null): Promise<RoutineSpending> {
    await this.#mutex.run(async () => {
      const file = await this.#load();
      file.planRoom = percent;
      await writeJson(this.#path, file);
    });
    const state = await this.state();
    this.deps.changed?.(state);
    return state;
  }

  async #planRoom(): Promise<number | null> {
    const file = await this.#mutex.run(() => this.#load());
    return file.planRoom === undefined ? PLAN_ROOM_PERCENT : file.planRoom;
  }

  /** “Keep paused”: the card goes away until next month. */
  async keepPaused(): Promise<RoutineSpending> {
    await this.#mutex.run(async () => {
      const file = await this.#load();
      file.dismissed = monthKey(this.#now);
      await writeJson(this.#path, file);
    });
    const state = await this.state();
    this.deps.changed?.(state);
    return state;
  }

  #limitOf(file: SpendFile): number | null {
    return file.limit === undefined ? DEFAULT_MONTHLY_USD : file.limit;
  }

  #pausedIn(file: SpendFile, month: string): boolean {
    const limit = this.#limitOf(file);
    return limit !== null && (file.months[month] ?? 0) >= limit;
  }

  async #load(): Promise<SpendFile> {
    if (this.#file) return this.#file;
    const read = await readStore(this.#path, SpendFile, {
      onRepair: () =>
        this.deps.heal?.('routines', 'Restarted this month’s routine spend. A copy is kept.'),
    });
    this.#file = read.value;
    return this.#file;
  }
}
