/**
 * What a chat costs, and the limits that keep it in hand (ADR 0073).
 *
 * Every turn says what it cost the way its provider charges: money on a key
 * you pay as you go, a share of the plan on a subscription, nothing on this
 * computer. A chat adds up its own turns and the tasks it sent away. It may
 * have a limit of its own, and the monthly budget (Settings → Usage) holds
 * for every chat. At either, the message waits for the person's choice.
 */
import { z } from 'zod';

import { EngineId } from './common';
import { Billing } from './routines';

/** A plan's window as a turn left it: "Current session, 42% used". */
export const PlanWindowSeen = z.object({
  label: z.string().max(80),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.number().optional(),
});
export type PlanWindowSeen = z.infer<typeof PlanWindowSeen>;

/** What one turn cost, worked out by Conch (never by the model). */
export const TurnCost = z.object({
  billing: Billing,
  /**
   * Money (USD). On a plan it's what the work would cost at list price, which
   * nobody pays: it's shown as such, and never counts toward a limit.
   */
  usd: z.number().nonnegative().optional(),
  /** `provider`: the provider said; `list`: Conch priced the tokens at list prices. */
  priced: z.enum(['provider', 'list']).optional(),
  /** What reading from the provider's cache saved, at list price (USD). */
  savedUsd: z.number().nonnegative().optional(),
  /** On a plan: who meters it, and its tightest window as last read. */
  plan: z.object({ source: z.string().max(120), window: PlanWindowSeen.optional() }).optional(),
});
export type TurnCost = z.infer<typeof TurnCost>;

/** What a chat has spent so far, its tasks and helpers included. */
export const ChatSpend = z.object({
  /** Money spent on pay-as-you-go providers (USD), tasks included. */
  usd: z.number().nonnegative().default(0),
  /** Of `usd`, what tasks and helpers sent from this chat spent. */
  tasksUsd: z.number().nonnegative().optional(),
  /** What reading from the cache saved, at list price (USD). */
  savedUsd: z.number().nonnegative().optional(),
  /** Turns answered on a plan (no money). */
  planTurns: z.number().int().nonnegative().optional(),
  /** This chat's own limit (USD), set by a person. Absent: none. */
  capUsd: z.number().positive().optional(),
});
export type ChatSpend = z.infer<typeof ChatSpend>;

/**
 * A model to carry on with at a limit: one that costs nothing more (on this
 * computer, or on a plan), else a cheaper one with a little more allowed.
 */
export const SpendModel = z.object({
  engine: EngineId,
  model: z.string().max(200),
  label: z.string().max(200),
  provider: z.string().max(200),
  /** `local`: on this computer; `plan`: on a subscription; `cheaper`: costs less. */
  why: z.enum(['local', 'plan', 'cheaper']),
  /** For `cheaper`: how much more the chat may spend with it (USD). */
  allowUsd: z.number().positive().optional(),
});
export type SpendModel = z.infer<typeof SpendModel>;

/**
 * Which limit a message met: `chat`, the chat's own; `month`, the monthly
 * budget every chat shares.
 */
export const SpendLimitKind = z.enum(['chat', 'month']);
export type SpendLimitKind = z.infer<typeof SpendLimitKind>;

/** How a message that met a limit went on. */
export const CappedOutcome = z.enum(['raised', 'switched', 'stopped']);
export type CappedOutcome = z.infer<typeof CappedOutcome>;

/** `POST /api/conversations/:id/capped`: the person's one tap at a limit. */
export const CappedChoiceBody = z.object({ choice: z.enum(['raise', 'switch', 'stop']) }).strict();
export type CappedChoiceBody = z.infer<typeof CappedChoiceBody>;

/** `PUT /api/conversations/:id/spend-limit`: this chat's own limit; `null` takes it off. */
export const ChatSpendLimitBody = z
  .object({ capUsd: z.number().positive().max(100_000).nullable() })
  .strict();
export type ChatSpendLimitBody = z.infer<typeof ChatSpendLimitBody>;

/** A spending limit near this share is worth a quiet word (and never more than once a month). */
export const BUDGET_NEAR_PERCENT = 80;
