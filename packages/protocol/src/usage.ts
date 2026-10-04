/**
 * Usage limits — how much you have left, whatever you're signed in with.
 *
 * Two shapes of "limit" exist and Conch shows whichever applies:
 *  - `plan`: a subscription with rolling windows (e.g. a 5-hour session and a
 *    weekly allowance). Each window is a percentage used and a reset time.
 *  - `metered`: pay-as-you-go (API key, Bedrock, Vertex, …). There's no
 *    ceiling from the provider, so Conch tracks what you've spent through it
 *    and, if you set one, how much of your own monthly budget is left.
 */
import { z } from 'zod';

/**
 * How close a limit is. `exhausted` means sends will be refused until it
 * resets; the others are graded from the share used (see `severityFor`).
 */
export const UsageSeverity = z.enum(['normal', 'warning', 'critical', 'exhausted']);
export type UsageSeverity = z.infer<typeof UsageSeverity>;

export const UsageWindow = z.object({
  /** Stable id, e.g. `session`, `weekly`, `weekly-opus`, `model:fable`. */
  id: z.string(),
  /** What the window is, in plain words: "Current session", "This week". */
  label: z.string(),
  /** Scope qualifier shown after the label, e.g. "Opus" or "all models". */
  scope: z.string().optional(),
  /** Share of the window used, 0–100. */
  usedPercent: z.number().min(0).max(100),
  /** Epoch ms when the window resets, when known. */
  resetsAt: z.number().optional(),
  severity: UsageSeverity,
});
export type UsageWindow = z.infer<typeof UsageWindow>;

/** Pay-as-you-go top-up some plans allow once a window runs out. */
export const ExtraUsage = z.object({
  enabled: z.boolean(),
  /** Spent this billing period, in major units of `currency`. */
  used: z.number().nonnegative().optional(),
  /** Monthly cap in major units, when one is set. */
  limit: z.number().nonnegative().optional(),
  currency: z.string().default('USD'),
});
export type ExtraUsage = z.infer<typeof ExtraUsage>;

/** Spend Conch has observed through this gateway (USD, local calendar). */
export const UsageSpend = z.object({
  today: z.number().nonnegative(),
  month: z.number().nonnegative(),
  /** Your own monthly budget, if you set one. Conch never blocks on it. */
  budget: z.number().positive().optional(),
});
export type UsageSpend = z.infer<typeof UsageSpend>;

export const UsageKind = z.enum([
  /** Subscription with rolling windows. */
  'plan',
  /** Pay-as-you-go; no provider ceiling. */
  'metered',
  /** The engine isn't ready or can't say. */
  'unknown',
]);
export type UsageKind = z.infer<typeof UsageKind>;

export const UsageSnapshot = z.object({
  /** The provider these limits are for. */
  engine: z.string().max(200).optional(),
  kind: UsageKind,
  /** Who meters you: "Claude Max", "Anthropic API", "Amazon Bedrock". */
  source: z.string(),
  /** Display order: session, then weekly, then per-model. Empty for `metered`. */
  windows: z.array(UsageWindow).default([]),
  extra: ExtraUsage.optional(),
  spend: UsageSpend,
  /** Set while the provider is refusing sends. */
  blocked: z
    .object({
      /** Epoch ms when sending should work again, when known. */
      until: z.number().optional(),
      /** Window that ran out, e.g. `session`. */
      windowId: z.string().optional(),
    })
    .optional(),
  /** One sentence explaining an odd state (e.g. why plan limits aren't visible). */
  message: z.string().optional(),
  /** Epoch ms the provider's numbers were last read. */
  updatedAt: z.number(),
});
export type UsageSnapshot = z.infer<typeof UsageSnapshot>;

export const UsageBudgetBody = z.object({
  /** Monthly budget in USD; `null` clears it. */
  budget: z.number().positive().max(1_000_000).nullable(),
});
export type UsageBudgetBody = z.infer<typeof UsageBudgetBody>;

/** Thresholds shared by server and web so both grade a window the same way. */
export function severityFor(usedPercent: number): UsageSeverity {
  if (usedPercent >= 100) return 'exhausted';
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 75) return 'warning';
  return 'normal';
}
