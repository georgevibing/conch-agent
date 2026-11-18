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
  /**
   * Your own monthly budget, if you set one. At it, a chat on a key you pay as
   * you go asks before spending more (ADR 0079).
   */
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

/**
 * The model a turn runs on, as its provider names it: the id it's sent with
 * (`fable`, `claude-opus-4-8`, `opus[1m]`) and, when known, its name
 * ("Fable 5.1").
 */
export interface UsageModelRef {
  id?: string;
  label?: string;
}

/** Words of a name, lowercased: "Opus 5.5 (1M context)" → opus, 5, 5, 1m, context. */
const nameWords = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whether `part` appears in `whole` as a run of whole words. */
function hasRun(whole: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0 || part.length > whole.length) return false;
  for (let i = 0; i + part.length <= whole.length; i++)
    if (part.every((word, j) => whole[i + j] === word)) return true;
  return false;
}

/**
 * Whether a window counts for one model only ("Opus", "Fable"), not for every
 * model ("all models", or no scope). Nacre's `isModelScoped` mirrors this.
 */
export function isModelScoped(w: Pick<UsageWindow, 'scope'>): boolean {
  const scope = w.scope?.trim();
  return Boolean(scope) && !/^all\b/i.test(scope ?? '');
}

/**
 * Whether a window limits this model. A window for every model always does;
 * one for a single model only when the model is that one, by id or name, as
 * whole words and case-insensitively. With no model known (`default`, or
 * none), a model's own window limits nothing.
 */
export function windowAppliesTo(
  w: Pick<UsageWindow, 'scope'>,
  model: UsageModelRef | undefined,
): boolean {
  if (!isModelScoped(w)) return true;
  const scope = nameWords(w.scope);
  return hasRun(nameWords(model?.id), scope) || hasRun(nameWords(model?.label), scope);
}

/** The windows that limit this model, in display order. */
export function windowsFor<W extends Pick<UsageWindow, 'scope'>>(
  windows: readonly W[] | undefined,
  model: UsageModelRef | undefined,
): W[] {
  return (windows ?? []).filter((w) => windowAppliesTo(w, model));
}

/**
 * Whether a provider is at its limit for this model: refusing every send (a
 * block that names no window, or a shared one), or this model's own window is
 * used up. Another model's own limit ("Fable" while the turn is on Opus)
 * doesn't count.
 */
export function atLimitFor(
  snapshot: Pick<UsageSnapshot, 'windows' | 'blocked'> | undefined,
  model: UsageModelRef | undefined,
): boolean {
  if (!snapshot) return false;
  const { blocked, windows } = snapshot;
  if (blocked) {
    const w = blocked.windowId ? windows.find((x) => x.id === blocked.windowId) : undefined;
    if (!w || windowAppliesTo(w, model)) return true;
  }
  return windows.some((w) => w.usedPercent >= 100 && windowAppliesTo(w, model));
}
