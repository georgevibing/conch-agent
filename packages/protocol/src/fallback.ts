/**
 * Who carries on when a provider reaches its usage limit (ADR 0023, ADR 0126).
 *
 * By default it's **Automatic**: at the moment of the limit, the next plan or
 * key with room answers, in an order the person can change. The person's own
 * plans come first (they cost nothing more), then keys by what a reply costs,
 * and never one past its own limit or the month's budget. **Wait** waits for
 * the reset; a provider's id always carries on with that one.
 */
import { z } from 'zod';

import { EngineId } from './common';

/** `auto`: the next with room. `wait`: until it resets. A provider: always that one. */
export const LimitFallback = z.union([z.literal('auto'), z.literal('wait'), EngineId]);
export type LimitFallback = z.infer<typeof LimitFallback>;

/** Whether a choice could answer right now. */
export const FallbackRoom = z.enum([
  /** It has room. */
  'room',
  /** Nearly used up (90% or more of its tightest window). */
  'low',
  /** At its own limit, or past a spending limit. Automatic passes it over. */
  'none',
  /** It can't say (no plan windows to read): it's tried, and a refusal counts as a limit. */
  'unknown',
]);
export type FallbackRoom = z.infer<typeof FallbackRoom>;

/** One account that could carry on: a plan or a key, with what it would cost and say. */
export const FallbackChoice = z.object({
  /** The provider that would answer. */
  id: EngineId,
  /**
   * Every way into the same account (Codex and Codex CLI share one ChatGPT
   * sign-in): one choice, never two. The first is `id`.
   */
  engines: z.array(EngineId).min(1),
  /** "Codex", or "Codex · ada@example.com" when another choice has the same name. */
  name: z.string().max(200),
  /** Who it is, in words: "ChatGPT Plus · ada@example.com", "Key …4f2c". */
  account: z.string().max(200).optional(),
  /** `plan`: included in what you already pay for. `metered`: pay per use. */
  billing: z.enum(['plan', 'metered']),
  room: FallbackRoom,
  /** Share left of its tightest window, 0–100, when known. */
  leftPercent: z.number().min(0).max(100).optional(),
  /** When it has room again (at its limit) or its tightest window resets. */
  resetsAt: z.number().optional(),
  /** About what a reply costs at list price, on a key. Absent: included, or unknown. */
  perReplyUsd: z.number().nonnegative().optional(),
  /** The model it answers with. */
  model: z.object({ id: z.string().max(200), label: z.string().max(200) }).optional(),
  /** Why Automatic passes it over right now, in a few words. */
  skip: z.string().max(200).optional(),
});
export type FallbackChoice = z.infer<typeof FallbackChoice>;

/** What Settings shows under "At a usage limit", for one provider. */
export const FallbackPlan = z.object({
  /** The provider whose limit this is about. */
  from: EngineId,
  fromName: z.string(),
  /** When its own limit resets, when it's at one now. */
  fromResetsAt: z.number().optional(),
  /** In Automatic's order: the person's, then the rest ranked. */
  choices: z.array(FallbackChoice),
  /** The model on this computer: the last resort, when it's ready. */
  local: z.object({ id: EngineId, name: z.string() }).optional(),
});
export type FallbackPlan = z.infer<typeof FallbackPlan>;

/** "Switch back" on the line a limit left in the chat: this chat waits for its own provider. */
export const LimitBackBody = z.object({ engine: EngineId }).strict();
export type LimitBackBody = z.infer<typeof LimitBackBody>;
