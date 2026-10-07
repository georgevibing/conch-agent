import { join } from 'node:path';

import {
  BUDGET_NEAR_PERCENT,
  type EngineId,
  type TurnCost,
  type Usage,
  type UsageSnapshot,
} from '@conch/protocol';
import { z } from 'zod';

import type { Engine, EngineUsage, LimitSignal } from '../engines/types';
import { Emitter } from '../lib/emitter';
import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';

/** Subscriptions are re-read this often even when nothing happens here (you may use claude.ai too). */
const POLL_MS = 5 * 60_000;
/** Coalesce bursts (a turn ending, several rate-limit events) into one provider read. */
const DEBOUNCE_MS = 1_500;
/** Forced reads from the browser are throttled to this. */
const MIN_FORCE_MS = 15_000;
/** Longest delay Node timers accept reliably. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const KEEP_DAYS = 400;

const LedgerFile = z.object({
  version: z.literal(1).default(1),
  budget: z.number().positive().optional(),
  /** The month (YYYY-MM) a chat said it was most of the way to the budget: once a month. */
  warned: z.string().optional(),
  /** Local calendar day (YYYY-MM-DD) → USD spent through Conch. */
  days: z.record(z.string(), z.number().nonnegative()).default({}),
});
type Ledger = z.infer<typeof LedgerFile>;

export function dayKey(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function spendOf(ledger: Ledger, now: number): UsageSnapshot['spend'] {
  const today = dayKey(now);
  const month = today.slice(0, 7);
  let monthTotal = 0;
  for (const [day, usd] of Object.entries(ledger.days))
    if (day.startsWith(month)) monthTotal += usd;
  return {
    today: ledger.days[today] ?? 0,
    month: monthTotal,
    ...(ledger.budget && { budget: ledger.budget }),
  };
}

const METERED_NOTE = "Spend counts what you've run through Conch, at list prices.";

/** "$41.20", "$50". */
function usd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** What Conch knows about one provider's limits. */
interface Meter {
  engine: Engine;
  usage?: EngineUsage;
  readAt: number;
  blocked?: UsageSnapshot['blocked'];
  snapshot?: UsageSnapshot;
  reading?: Promise<UsageSnapshot>;
  debounce?: NodeJS.Timeout;
  resetTimer?: NodeJS.Timeout;
}

/**
 * One answer to "how much do I have left?", for each provider, whatever the
 * sign-in. A chat shows the limits of the provider answering it, so every
 * provider has a meter of its own.
 *
 * Plan windows come from the engine (and are refreshed after every turn it
 * answers, on its live rate-limit hints, when a window resets, and every few
 * minutes); spend is Conch's own ledger in `~/.conch/usage.json`. Every change
 * is pushed through `changed`, naming its provider, so the browser never has
 * to poll.
 */
export class UsageService {
  readonly changed = new Emitter<UsageSnapshot>();
  #mutex = new Mutex();
  #ledger?: Ledger;
  #meters = new Map<string, Meter>();
  #poll?: NodeJS.Timeout;
  #offLimits: (() => void)[] = [];

  constructor(
    private readonly deps: {
      home: string;
      /** A provider by id; no id is the default provider. */
      engine: (id?: EngineId) => Engine;
      /** Every provider, to hear each one's live limit hints. Defaults to the default one. */
      engines?: () => Engine[];
      /** Past turns, used once to seed the ledger so spend is right from day one. */
      history?: () => Promise<{ at: number; costUsd: number }[]>;
      now?: () => number;
      /** Note a repair, e.g. a damaged ledger rebuilt from the chats. */
      heal?: Heal;
    },
  ) {}

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  get #path() {
    return join(this.deps.home, 'usage.json');
  }

  #meter(id?: EngineId): Meter {
    const engine = this.deps.engine(id);
    // A test double may have no id: it's the one provider there is.
    const key = engine.id ?? '';
    let meter = this.#meters.get(key);
    if (!meter) this.#meters.set(key, (meter = { engine, readAt: 0 }));
    return meter;
  }

  /** Begin listening for live hints and polling. Idempotent. */
  start(): void {
    if (this.#poll) return;
    // Seed the ledger now, before any new turn could be counted twice.
    void this.#mutex.run(() => this.#load()).catch(() => undefined);
    for (const engine of this.deps.engines?.() ?? [this.deps.engine()]) {
      const off = engine.onLimits?.((signal) => this.#onSignal(engine.id, signal));
      if (off) this.#offLimits.push(off);
    }
    this.#poll = setInterval(() => {
      for (const meter of this.#meters.values())
        if (meter.usage?.kind === 'plan') void this.#refresh(meter, true);
    }, POLL_MS);
    this.#poll.unref();
  }

  stop(): void {
    clearInterval(this.#poll);
    for (const meter of this.#meters.values()) {
      clearTimeout(meter.debounce);
      clearTimeout(meter.resetTimer);
    }
    for (const off of this.#offLimits.splice(0)) off();
    this.#poll = undefined;
  }

  /**
   * The latest snapshot of a provider (the default one when none is named);
   * reads the provider on first use or when `force`d.
   */
  async snapshot({ force = false, engine }: { force?: boolean; engine?: EngineId } = {}) {
    const meter = this.#meter(engine);
    if (meter.snapshot && !force) return meter.snapshot;
    return this.#refresh(meter, force);
  }

  /** Re-read a provider and broadcast the result. Concurrent calls share one read. */
  refresh({ force = false, engine }: { force?: boolean; engine?: EngineId } = {}) {
    return this.#refresh(this.#meter(engine), force);
  }

  #refresh(meter: Meter, force: boolean): Promise<UsageSnapshot> {
    meter.reading ??= this.#read(meter, force).finally(() => {
      meter.reading = undefined;
    });
    return meter.reading;
  }

  /**
   * Called when a turn finishes: add its money, then look again at the
   * provider that answered (`engine`; the default one when not named). With
   * `priced` (ADR 0079), only money counts: a turn on a plan or on this
   * computer costs nothing here, and list prices fill in for a provider that
   * doesn't say. Returns one sentence, once a month, when this turn took the
   * month past most of its budget (`tell`: someone will read it).
   */
  async recordTurn(
    usage: Usage | undefined,
    priced?: TurnCost,
    { tell = false, engine }: { tell?: boolean; engine?: EngineId } = {},
  ): Promise<string | undefined> {
    const cost = priced
      ? priced.billing === 'metered'
        ? (priced.usd ?? 0)
        : 0
      : (usage?.costUsd ?? 0);
    let near: string | undefined;
    if (cost > 0) {
      near = await this.#mutex.run(async () => {
        const ledger = await this.#load();
        const now = this.#now;
        const day = dayKey(now);
        const before = spendOf(ledger, now).month;
        ledger.days[day] = (ledger.days[day] ?? 0) + cost;
        // Keep the most recent days only (keys sort chronologically).
        ledger.days = Object.fromEntries(
          Object.entries(ledger.days)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-KEEP_DAYS),
        );
        const month = day.slice(0, 7);
        const after = before + cost;
        const budget = ledger.budget;
        const line = budget ? (budget * BUDGET_NEAR_PERCENT) / 100 : undefined;
        const said =
          tell &&
          budget &&
          line !== undefined &&
          before < line &&
          after >= line &&
          after < budget &&
          ledger.warned !== month
            ? `This month you’ve spent ${usd(after)} of your ${usd(budget)} budget. When it’s used up, a chat asks before spending more.`
            : undefined;
        if (said) ledger.warned = month;
        await writeJson(this.#path, ledger);
        return said;
      });
    }
    this.#scheduleRefresh(this.#meter(engine));
    return near;
  }

  /** A provider's plan windows as last read; never a new read. */
  seen(engine: EngineId): EngineUsage | undefined {
    const usage = this.#meters.get(this.deps.engine(engine).id ?? '')?.usage;
    return usage?.kind === 'plan' ? usage : undefined;
  }

  /** This month's money through Conch, and the budget when one is set. */
  async month(): Promise<{ usd: number; budgetUsd?: number }> {
    const ledger = await this.#mutex.run(() => this.#load());
    const spend = spendOf(ledger, this.#now);
    return { usd: spend.month, ...(spend.budget && { budgetUsd: spend.budget }) };
  }

  /** Your own monthly budget. Spend is Conch-wide, so every meter says it again. */
  async setBudget(budget: number | null): Promise<UsageSnapshot> {
    await this.#mutex.run(async () => {
      const ledger = await this.#load();
      if (budget === null) delete ledger.budget;
      else ledger.budget = budget;
      // A new budget gets its own word when it's nearly used.
      delete ledger.warned;
      await writeJson(this.#path, ledger);
    });
    const main = this.#meter();
    for (const meter of this.#meters.values())
      if (meter !== main && meter.usage) await this.#publish(meter);
    return main.usage ? this.#publish(main) : this.#refresh(main, false);
  }

  async #load(): Promise<Ledger> {
    if (this.#ledger) return this.#ledger;
    const read = await readStore(this.#path, LedgerFile, {
      onRepair: (state) =>
        this.deps.heal?.(
          'usage',
          state === 'salvaged'
            ? 'Filled in your spending record from your chats. A copy is kept.'
            : 'Rebuilt your spending record from your chats. A copy is kept.',
        ),
    });
    const ledger = read.value;
    // A new ledger, or one that lost days, is filled in from past turns;
    // what the ledger still had (chats deleted since included) wins.
    if (read.state !== 'read' && this.deps.history) {
      const seeded: Record<string, number> = {};
      for (const turn of await this.deps.history().catch(() => [])) {
        const day = dayKey(turn.at);
        seeded[day] = (seeded[day] ?? 0) + turn.costUsd;
      }
      ledger.days = { ...seeded, ...ledger.days };
      await writeJson(this.#path, ledger);
    }
    this.#ledger = ledger;
    return ledger;
  }

  async #read(meter: Meter, force: boolean): Promise<UsageSnapshot> {
    const { engine } = meter;
    const throttled = force && this.#now - meter.readAt < MIN_FORCE_MS;
    try {
      meter.usage = engine.usage
        ? await engine.usage({ force: force && !throttled })
        : { kind: 'metered', source: engine.label, windows: [] };
      meter.readAt = this.#now;
    } catch (error) {
      // Keep the last good numbers; say why they may be stale.
      meter.usage = {
        ...(meter.usage ?? { kind: 'unknown', source: engine.label, windows: [] }),
        message: `Couldn't refresh usage: ${(error as Error).message}`,
      };
    }
    return this.#publish(meter);
  }

  async #publish(meter: Meter): Promise<UsageSnapshot> {
    const now = this.#now;
    const usage = meter.usage ?? { kind: 'unknown', source: '', windows: [] };
    const spend = spendOf(await this.#load(), now);

    // A window at 100% blocks just as surely as a rejected request does.
    const full = usage.windows.find((w) => w.usedPercent >= 100);
    if (full) meter.blocked = { until: full.resetsAt, windowId: full.id };
    if (meter.blocked?.until !== undefined && meter.blocked.until <= now) meter.blocked = undefined;
    if (usage.kind !== 'plan') meter.blocked = undefined;

    const message = usage.message ?? (usage.kind === 'metered' ? METERED_NOTE : undefined);
    const snapshot: UsageSnapshot = {
      ...(meter.engine.id && { engine: meter.engine.id }),
      kind: usage.kind,
      source: usage.source,
      windows: usage.windows.map((w) =>
        w.id === meter.blocked?.windowId ? { ...w, severity: 'exhausted' } : w,
      ),
      ...(usage.extra && { extra: usage.extra }),
      spend,
      ...(meter.blocked && { blocked: meter.blocked }),
      ...(message && { message }),
      updatedAt: meter.readAt || now,
    };
    meter.snapshot = snapshot;
    this.#scheduleReset(meter, snapshot);
    this.changed.emit(snapshot);
    return snapshot;
  }

  #onSignal(id: EngineId, signal: LimitSignal) {
    const meter = this.#meter(id);
    if (signal.status === 'rejected') {
      meter.blocked = { until: signal.resetsAt, windowId: signal.windowId };
      void this.#publish(meter);
    } else if (meter.blocked && signal.status === 'allowed') {
      meter.blocked = undefined;
    }
    this.#scheduleRefresh(meter);
  }

  #scheduleRefresh(meter: Meter) {
    clearTimeout(meter.debounce);
    meter.debounce = setTimeout(() => void this.#refresh(meter, true), DEBOUNCE_MS);
    meter.debounce.unref();
  }

  /** Re-read the moment the next window (or block) resets, so meters refill on time. */
  #scheduleReset(meter: Meter, snapshot: UsageSnapshot) {
    clearTimeout(meter.resetTimer);
    const now = this.#now;
    const times = [...snapshot.windows.map((w) => w.resetsAt), snapshot.blocked?.until].filter(
      (t): t is number => t !== undefined && t > now,
    );
    if (times.length === 0) return;
    const delay = Math.min(MAX_TIMER_MS, Math.min(...times) - now + 2_000);
    meter.resetTimer = setTimeout(() => {
      meter.blocked = undefined;
      void this.#refresh(meter, true);
    }, delay);
    meter.resetTimer.unref();
  }
}
