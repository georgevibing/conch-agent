/**
 * How a provider charges, and what a turn cost the way it charges (ADR 0057,
 * ADR 0079). Shared by routines and chats, so both say the same thing.
 */
import type { Billing, EngineId, TurnCost, Usage, UsageWindow } from '@conch/protocol';

import type { Engine, EngineUsage } from '../engines/types';
import { costAt, priceOf } from './prices';

/** What a provider's billing is, read at most this often. */
const BILLING_MS = 60_000;

export interface BillingInfo {
  billing?: Billing;
  /** Who meters it, in words: "Claude Max". */
  source?: string;
  usage?: EngineUsage;
}

/**
 * Free (it runs on this computer), a plan (a subscription's allowance) or
 * money. Asked of the engine, never assumed from which engine it is, and kept
 * for a minute: a turn asks before it starts and again as it ends.
 */
export class Billings {
  #cache = new Map<EngineId, { at: number; value: BillingInfo }>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * The same answer without reading a plan's windows when the sign-in already
   * says it's a subscription: asked before every chat's turn, it never waits
   * on a provider's usage read (Claude Code's opens a session to ask).
   */
  async quick(engine: Engine): Promise<BillingInfo> {
    if (engine.local) return { billing: 'free' };
    const cached = this.#cache.get(engine.id);
    if (cached && this.now() - cached.at < BILLING_MS) return cached.value;
    const status = await engine.detect().catch(() => undefined);
    if (status?.state === 'ready' && status.auth?.method === 'subscription')
      return {
        billing: 'plan',
        source: status.auth.description.split(' · ')[0]?.trim() || engine.label,
      };
    return this.of(engine);
  }

  async of(engine: Engine, { fresh = false } = {}): Promise<BillingInfo> {
    if (engine.local) return { billing: 'free' };
    const cached = this.#cache.get(engine.id);
    if (!fresh && cached && this.now() - cached.at < BILLING_MS) return cached.value;
    const status = await engine.detect().catch(() => undefined);
    let value: BillingInfo = {};
    if (status?.state === 'ready') {
      const usage = engine.usage ? await engine.usage().catch(() => undefined) : undefined;
      const account = status.auth?.description.split(' · ')[0]?.trim() || engine.label;
      if (usage?.kind === 'plan') value = { billing: 'plan', source: usage.source, usage };
      else if (usage?.kind === 'metered') value = { billing: 'metered', source: usage.source };
      else if (status.auth?.method === 'subscription') value = { billing: 'plan', source: account };
      else value = { billing: 'metered', source: account };
    }
    this.#cache.set(engine.id, { at: this.now(), value });
    return value;
  }
}

/** Money for these tokens: the provider's own figure, else list price, else unknown. */
export function priceUsage(
  usage: Usage,
  model: string | undefined,
): { usd?: number; priced?: 'provider' | 'list' } {
  if (usage.costUsd !== undefined) return { usd: usage.costUsd, priced: 'provider' };
  const price = priceOf(model);
  return price ? { usd: costAt(price, usage), priced: 'list' } : {};
}

/**
 * What the cache saved, net (ADR 0081): the cached tokens at the input price
 * less what they cost as cached, less the premium paid for writing to the
 * cache (Anthropic's quarter more). Nothing when the model's price is
 * unknown, or when the cache cost more than it saved this time.
 */
export function cacheSaving(usage: Usage, model: string | undefined): number | undefined {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached);
  const price = priceOf(model);
  if (!cached || !price) return undefined;
  const read = cached * (price.input - (price.cachedInput ?? price.input));
  const premium = written * Math.max(0, (price.cacheWrite ?? price.input) - price.input);
  const saved = (read - premium) / 1_000_000;
  return saved > 0 ? saved : undefined;
}

/** The window that tells the story on a plan: the one most used. */
export function tightest(windows: readonly UsageWindow[] | undefined): UsageWindow | undefined {
  let top: UsageWindow | undefined;
  for (const w of windows ?? []) if (!top || w.usedPercent > top.usedPercent) top = w;
  return top;
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

/**
 * What one turn cost, the way its provider charges: money on a key you pay
 * as you go, the plan's window on a subscription, nothing on this computer.
 * Undefined when Conch can't say how the provider charges.
 */
export function turnCost(
  usage: Usage | undefined,
  info: BillingInfo,
  model: string | undefined,
): TurnCost | undefined {
  if (!info.billing) return undefined;
  if (info.billing === 'free') return { billing: 'free' };
  const priced = usage ? priceUsage(usage, model) : {};
  const saved = usage ? cacheSaving(usage, model) : undefined;
  const window = info.billing === 'plan' ? tightest(info.usage?.windows) : undefined;
  return {
    billing: info.billing,
    ...(priced.usd !== undefined && { usd: round(priced.usd) }),
    ...(priced.priced && { priced: priced.priced }),
    ...(saved !== undefined && { savedUsd: round(saved) }),
    ...(info.billing === 'plan' && {
      plan: {
        source: (info.source ?? 'your plan').slice(0, 120),
        ...(window && {
          window: {
            label: window.label.slice(0, 80),
            usedPercent: window.usedPercent,
            ...(window.resetsAt !== undefined && { resetsAt: window.resetsAt }),
          },
        }),
      },
    }),
  };
}
