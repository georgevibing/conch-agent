/**
 * What learning may spend (ADR 0088 § 8): a small monthly cap on the money
 * the quiet looks at your chats cost. Only pay-as-you-go money counts; a plan
 * or a model on this computer costs nothing here, though a plan that's
 * nearly used up is left to your own chats. At the cap, learning that costs
 * money pauses until the 1st, and one note under "Fixed on its own" says so.
 *
 * The record is `~/.conch/learning-spend.json`. A person changes the cap in
 * Settings → Usage (`PUT /api/learning/spending`); no tool the agent has can
 * reach it, and `lib/protect.ts` keeps the file from its shell.
 */
import { join } from 'node:path';

import type { LearningSpending, Usage } from '@conch/protocol';
import { z } from 'zod';

import type { Engine } from '../engines/types';
import { Mutex, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { monthKey, nextMonth, PLAN_ROOM_PERCENT } from '../routines/spend';
import { Billings, priceUsage } from '../usage/billing';
import { costAt, type Price } from '../usage/prices';

/** The cap until a person sets one: a few hundred cheap looks a month. */
export const DEFAULT_LEARNING_USD = 1;

/**
 * What a pay-as-you-go look costs when neither the provider nor the price
 * list can say (a model Conch doesn't know, the provider's own default): the
 * dearest price Conch knows, so the cap can only trip early, never late.
 */
export const UNKNOWN_PRICE: Price = { input: 10, output: 50 };

const SpendFile = z.object({
  version: z.literal(1).default(1),
  /** USD a month; `null`: no limit; absent: the default. */
  limit: z.number().positive().nullable().optional(),
  /** Local calendar month (YYYY-MM) → USD learning spent. */
  months: z.record(z.string(), z.number().nonnegative()).default({}),
  /** The month whose pause was noted: once a month. */
  told: z.string().optional(),
});
type SpendFile = z.infer<typeof SpendFile>;

export type LearningAllowed =
  { ok: true } | { ok: false; reason: 'cap' | 'plan-room'; until?: number };

/**
 * The record after a restore: for every month the larger amount, so money
 * already spent stays counted, and the backup's cap (a restore preview names
 * a cap above the default, `backup/powers.ts`).
 */
export function mergeLearningSpend(current: Buffer | undefined, restored: Buffer): SpendFile {
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
    months,
    ...(now.told && { told: now.told }),
  };
}

export class LearningSpend {
  readonly #mutex = new Mutex();
  #file?: SpendFile;
  readonly #billings: Billings;

  constructor(
    private readonly deps: {
      home: string;
      /** How providers charge, shared with chats and routines (ADR 0079). */
      billings?: Billings;
      heal?: Heal;
      now?: () => number;
      /** What learning may spend changed. */
      changed?: (spending: LearningSpending) => void;
    },
  ) {
    this.#billings = deps.billings ?? new Billings(() => this.#now);
  }

  get #now() {
    return (this.deps.now ?? Date.now)();
  }

  get #path() {
    return join(this.deps.home, 'learning-spend.json');
  }

  async #load(): Promise<SpendFile> {
    this.#file ??= (
      await readStore(this.#path, SpendFile, {
        onRepair: () =>
          this.deps.heal?.('usage', 'Restarted this month’s learning spend. A copy is kept.'),
      })
    ).value;
    return this.#file;
  }

  #limitOf(file: SpendFile): number | null {
    return file.limit === undefined ? DEFAULT_LEARNING_USD : file.limit;
  }

  #pausedIn(file: SpendFile, month: string): boolean {
    const limit = this.#limitOf(file);
    return limit !== null && (file.months[month] ?? 0) >= limit;
  }

  /**
   * May a look at a chat ask this provider now? At the cap, one that costs
   * money waits until the 1st; a plan that's nearly used up waits for it to
   * reset. A model on this computer always may.
   */
  async allow(engine: Engine): Promise<LearningAllowed> {
    const info = await this.#billings.of(engine);
    if (info.billing === 'free') return { ok: true };
    if (info.billing === 'plan') return this.room(engine);
    const file = await this.#mutex.run(() => this.#load());
    return this.#pausedIn(file, monthKey(this.#now))
      ? { ok: false, reason: 'cap', until: nextMonth(this.#now) }
      : { ok: true };
  }

  /**
   * Has this provider's plan room for a small job? One nearly used up is left
   * to your own chats until it resets; a provider without a plan always has.
   */
  async room(engine: Engine): Promise<LearningAllowed> {
    const info = await this.#billings.of(engine);
    if (info.billing !== 'plan') return { ok: true };
    const usage = (await this.#billings.of(engine, { fresh: true })).usage;
    const full = usage?.windows.find((w) => w.usedPercent >= PLAN_ROOM_PERCENT);
    return full
      ? { ok: false, reason: 'plan-room', ...(full.resetsAt && { until: full.resetsAt }) }
      : { ok: true };
  }

  /** Whether this provider costs money (not a plan, not this computer): the month's budget applies. */
  async costsMoney(engine: Engine): Promise<boolean> {
    const info = await this.#billings.of(engine).catch(() => ({ billing: undefined }));
    return info.billing !== 'free' && info.billing !== 'plan';
  }

  /** Count what one look cost: only money counts. Returns it, in USD. */
  async record(usage: Usage | undefined, engine: Engine, model?: string): Promise<number> {
    if (!usage) return 0;
    const info = await this.#billings.of(engine);
    if (info.billing === 'free' || info.billing === 'plan') return 0;
    const usd = priceUsage(usage, model).usd ?? costAt(UNKNOWN_PRICE, usage);
    if (usd <= 0) return 0;
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
    if (crossed)
      this.deps.heal?.(
        'usage',
        'Paused learning until the 1st. It reached this month’s limit; change it in Settings → Usage.',
      );
    this.deps.changed?.(await this.state());
    return usd;
  }

  async state(): Promise<LearningSpending> {
    const file = await this.#mutex.run(() => this.#load());
    const month = monthKey(this.#now);
    return {
      limitUsd: this.#limitOf(file),
      isDefault: file.limit === undefined,
      monthUsd: Math.round((file.months[month] ?? 0) * 100) / 100,
      ...(this.#pausedIn(file, month) && { paused: { until: nextMonth(this.#now) } }),
    };
  }

  /** A person set the cap (`null`: none). Never reachable by the agent. */
  async setLimit(limitUsd: number | null): Promise<LearningSpending> {
    await this.#mutex.run(async () => {
      const file = await this.#load();
      file.limit = limitUsd;
      await writeJson(this.#path, file);
    });
    const state = await this.state();
    this.deps.changed?.(state);
    return state;
  }
}
