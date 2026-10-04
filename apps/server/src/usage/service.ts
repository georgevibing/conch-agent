import { join } from 'node:path';

import type { Usage, UsageSnapshot } from '@conch/protocol';
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

/**
 * One answer to "how much do I have left?", whatever the engine or sign-in.
 *
 * Plan windows come from the engine (and are refreshed after every turn, on
 * the provider's live rate-limit hints, when a window resets, and every few
 * minutes); spend is Conch's own ledger in `~/.conch/usage.json`. Every change
 * is pushed through `changed`, so the browser never has to poll.
 */
export class UsageService {
  readonly changed = new Emitter<UsageSnapshot>();
  #mutex = new Mutex();
  #ledger?: Ledger;
  #engineUsage?: EngineUsage;
  #readAt = 0;
  #blocked?: UsageSnapshot['blocked'];
  #snapshot?: UsageSnapshot;
  #reading?: Promise<UsageSnapshot>;
  #debounce?: NodeJS.Timeout;
  #resetTimer?: NodeJS.Timeout;
  #poll?: NodeJS.Timeout;
  #offLimits?: () => void;

  constructor(
    private readonly deps: {
      home: string;
      engine: () => Engine;
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

  /** Begin listening for live hints and polling. Idempotent. */
  start(): void {
    if (this.#poll) return;
    // Seed the ledger now, before any new turn could be counted twice.
    void this.#mutex.run(() => this.#load()).catch(() => undefined);
    this.#offLimits = this.deps.engine().onLimits?.((signal) => this.#onSignal(signal));
    this.#poll = setInterval(() => {
      if (this.#engineUsage?.kind === 'plan') void this.refresh({ force: true });
    }, POLL_MS);
    this.#poll.unref();
  }

  stop(): void {
    clearInterval(this.#poll);
    clearTimeout(this.#debounce);
    clearTimeout(this.#resetTimer);
    this.#offLimits?.();
    this.#poll = undefined;
  }

  /** The latest snapshot; reads the provider on first use or when `force`d. */
  async snapshot({ force = false } = {}): Promise<UsageSnapshot> {
    if (this.#snapshot && !force) return this.#snapshot;
    return this.refresh({ force });
  }

  /** Re-read the provider and broadcast the result. Concurrent calls share one read. */
  refresh({ force = false } = {}): Promise<UsageSnapshot> {
    this.#reading ??= this.#read(force).finally(() => {
      this.#reading = undefined;
    });
    return this.#reading;
  }

  /** What's been spent through Conch, from the ledger alone: no provider read, nothing published. */
  async spend(): Promise<UsageSnapshot['spend']> {
    return spendOf(await this.#mutex.run(() => this.#load()), this.#now);
  }

  /** Called when a turn finishes: add its cost, then look at the provider again. */
  async recordTurn(usage: Usage | undefined): Promise<void> {
    const cost = usage?.costUsd ?? 0;
    if (cost > 0) {
      await this.#mutex.run(async () => {
        const ledger = await this.#load();
        const day = dayKey(this.#now);
        ledger.days[day] = (ledger.days[day] ?? 0) + cost;
        // Keep the most recent days only (keys sort chronologically).
        ledger.days = Object.fromEntries(
          Object.entries(ledger.days)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-KEEP_DAYS),
        );
        await writeJson(this.#path, ledger);
      });
    }
    this.#scheduleRefresh();
  }

  async setBudget(budget: number | null): Promise<UsageSnapshot> {
    await this.#mutex.run(async () => {
      const ledger = await this.#load();
      if (budget === null) delete ledger.budget;
      else ledger.budget = budget;
      await writeJson(this.#path, ledger);
    });
    return this.#engineUsage ? this.#publish() : this.refresh();
  }

  async #load(): Promise<Ledger> {
    if (this.#ledger) return this.#ledger;
    const read = await readStore(this.#path, LedgerFile, {
      onRepair: (state) =>
        this.deps.heal?.(
          'usage',
          state === 'salvaged'
            ? 'Part of your spending record couldn’t be read, so Conch kept a copy and filled it in from your chats.'
            : 'Your spending record couldn’t be read, so Conch kept a copy and rebuilt it from your chats.',
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

  async #read(force: boolean): Promise<UsageSnapshot> {
    const engine = this.deps.engine();
    const throttled = force && this.#now - this.#readAt < MIN_FORCE_MS;
    try {
      this.#engineUsage = engine.usage
        ? await engine.usage({ force: force && !throttled })
        : { kind: 'metered', source: engine.label, windows: [] };
      this.#readAt = this.#now;
    } catch (error) {
      // Keep the last good numbers; say why they may be stale.
      this.#engineUsage = {
        ...(this.#engineUsage ?? { kind: 'unknown', source: engine.label, windows: [] }),
        message: `Couldn't refresh usage: ${(error as Error).message}`,
      };
    }
    return this.#publish();
  }

  async #publish(): Promise<UsageSnapshot> {
    const now = this.#now;
    const usage = this.#engineUsage ?? { kind: 'unknown', source: '', windows: [] };
    const spend = spendOf(await this.#load(), now);

    // A window at 100% blocks just as surely as a rejected request does.
    const full = usage.windows.find((w) => w.usedPercent >= 100);
    if (full) this.#blocked = { until: full.resetsAt, windowId: full.id };
    if (this.#blocked?.until !== undefined && this.#blocked.until <= now) this.#blocked = undefined;
    if (usage.kind !== 'plan') this.#blocked = undefined;

    const message = usage.message ?? (usage.kind === 'metered' ? METERED_NOTE : undefined);
    const snapshot: UsageSnapshot = {
      kind: usage.kind,
      source: usage.source,
      windows: usage.windows.map((w) =>
        w.id === this.#blocked?.windowId ? { ...w, severity: 'exhausted' } : w,
      ),
      ...(usage.extra && { extra: usage.extra }),
      spend,
      ...(this.#blocked && { blocked: this.#blocked }),
      ...(message && { message }),
      updatedAt: this.#readAt || now,
    };
    this.#snapshot = snapshot;
    this.#scheduleReset(snapshot);
    this.changed.emit(snapshot);
    return snapshot;
  }

  #onSignal(signal: LimitSignal) {
    if (signal.status === 'rejected') {
      this.#blocked = { until: signal.resetsAt, windowId: signal.windowId };
      void this.#publish();
    } else if (this.#blocked && signal.status === 'allowed') {
      this.#blocked = undefined;
    }
    this.#scheduleRefresh();
  }

  #scheduleRefresh() {
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.refresh({ force: true }), DEBOUNCE_MS);
    this.#debounce.unref();
  }

  /** Re-read the moment the next window (or block) resets, so meters refill on time. */
  #scheduleReset(snapshot: UsageSnapshot) {
    clearTimeout(this.#resetTimer);
    const now = this.#now;
    const times = [...snapshot.windows.map((w) => w.resetsAt), snapshot.blocked?.until].filter(
      (t): t is number => t !== undefined && t > now,
    );
    if (times.length === 0) return;
    const delay = Math.min(MAX_TIMER_MS, Math.min(...times) - now + 2_000);
    this.#resetTimer = setTimeout(() => {
      this.#blocked = undefined;
      void this.refresh({ force: true });
    }, delay);
    this.#resetTimer.unref();
  }
}
