/**
 * What a chat spends, and its two limits (ADR 0073): the chat's own (set by
 * a person, off until then) and the monthly budget every chat shares (Settings
 * → Usage). Only money counts: a turn on a plan or on this computer spends
 * nothing here. The manager asks before a turn and watches it as it goes; at
 * a limit the message waits for the person's one tap.
 */
import type {
  ChatSpend,
  EngineId,
  SpendLimitKind,
  SpendModel,
  TurnCost,
  Usage,
} from '@conch/protocol';

import type { Engine } from '../engines/types';
import type { BillingInfo } from '../usage/billing';

/** What the chat needs from the rest of Conch to count and hold spending. */
export interface SpendDesk {
  /** How the provider charges (asked, never assumed; kept for a minute). */
  billing(engine: Engine): Promise<BillingInfo>;
  /** This month's money through Conch, and the budget when one is set. */
  month(): Promise<{ usd: number; budgetUsd?: number }>;
  /**
   * Count what a turn (or naming a chat) cost against the month. Says so in
   * one sentence, once a month, when the month passes most of its budget.
   */
  record(
    cost: TurnCost | undefined,
    usage: Usage | undefined,
    options?: { tell?: boolean },
  ): Promise<string | undefined>;
  /** Price a turn the way its provider charges. */
  cost(
    usage: Usage | undefined,
    info: BillingInfo,
    model: string | undefined,
    engine: EngineId,
  ): TurnCost | undefined;
  /** Money for these tokens on this model, when Conch can say (USD). */
  usd(usage: Usage, model: string | undefined): number | undefined;
  /** A model that costs less than this one, to carry on with at a limit. */
  cheaper(
    from: { engine: Engine; model?: string },
    limit: SpendLimitKind,
  ): Promise<SpendModel | undefined>;
  /** The person raised the monthly budget, from a message at it. */
  raiseBudget(usd: number): Promise<void>;
  /** The chat a task was sent from (ADR 0033): its spending is that chat's. */
  parentOf(taskId: string): Promise<string | undefined>;
  /**
   * One sentence when a model just picked makes each reply of a long chat
   * cost a lot more than the last one did; nothing otherwise.
   */
  estimate(input: {
    to: { engine: Engine; model?: string };
    last: { usage: Usage; cost?: TurnCost };
  }): Promise<string | undefined>;
}

/** A limit a message (or a reply as it goes) has met. */
export interface Capped {
  limit: SpendLimitKind;
  spentUsd: number;
  limitUsd: number;
}

/**
 * Which limit `adding` more would cross, given what's spent: the chat's own
 * first (it's the tighter promise), then the month's. `strict`: only past it
 * (a reply on its way); otherwise reaching it is enough (a new message).
 */
export function overLimit(
  spent: { chat: ChatSpend | undefined; month: { usd: number; budgetUsd?: number } },
  adding: number,
  strict: boolean,
): Capped | undefined {
  const past = (total: number, limit: number) => (strict ? total > limit : total >= limit);
  const cap = spent.chat?.capUsd;
  const chat = (spent.chat?.usd ?? 0) + adding;
  if (cap !== undefined && past(chat, cap))
    return { limit: 'chat', spentUsd: round2(chat), limitUsd: cap };
  const budget = spent.month.budgetUsd;
  const month = spent.month.usd + adding;
  if (budget !== undefined && past(month, budget))
    return { limit: 'month', spentUsd: round2(month), limitUsd: budget };
  return undefined;
}

/**
 * A round amount at or above `usd`: 1, 2, 2.5, 5 and their tens. Limits read
 * as numbers a person would have picked.
 */
export function niceUp(usd: number): number {
  if (usd <= 0.5) return 0.5;
  const scale = 10 ** Math.floor(Math.log10(usd));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * scale >= usd - 1e-9) return step * scale;
  return 10 * scale;
}

/**
 * What "Raise it" sets a limit to: twice a chat's, half as much again for the
 * month, and always well above what's already spent.
 */
export function raiseTo(capped: Capped): number {
  const grown = capped.limit === 'chat' ? capped.limitUsd * 2 : capped.limitUsd * 1.5;
  return niceUp(Math.max(grown, capped.spentUsd * (capped.limit === 'chat' ? 1.5 : 1.1)));
}

/** A cheaper model at a chat's limit may spend this much more: a quarter of it, at least 50¢. */
export function allowance(limitUsd: number): number {
  return niceUp(Math.max(0.5, limitUsd / 4));
}

/** A chat's spending with one more turn (or one more of its tasks' turns) in it. */
export function addTurn(
  spend: ChatSpend | undefined,
  cost: TurnCost | undefined,
  { task = false } = {},
): ChatSpend | undefined {
  if (!cost) return spend;
  const money = cost.billing === 'metered' ? (cost.usd ?? 0) : 0;
  const saved = cost.savedUsd ?? 0;
  const plan = cost.billing === 'plan' && !task ? 1 : 0;
  if (!money && !saved && !plan) return spend;
  const before = spend ?? { usd: 0 };
  return {
    ...before,
    usd: round6(before.usd + money),
    ...(task && money && { tasksUsd: round6((before.tasksUsd ?? 0) + money) }),
    ...(saved &&
      cost.billing === 'metered' && {
        savedUsd: round6((before.savedUsd ?? 0) + saved),
      }),
    ...(plan && { planTurns: (before.planTurns ?? 0) + plan }),
  };
}

/** A reply stopped at a limit carries on with these words, once the person chose. */
export const CARRY_ON =
  'You were stopped part way through at a spending limit, and the person has chosen to carry on. Pick up where you left off, without repeating what you already did.';

const round2 = (usd: number) => Math.round(usd * 100) / 100;
const round6 = (usd: number) => Math.round(usd * 1e6) / 1e6;
