/**
 * Structural mirror of `@conch/protocol`'s usage snapshot. Nacre doesn't
 * depend on the protocol package, so apps pass their parsed snapshot straight
 * through — the shapes are identical.
 */

/** How close a limit is. `exhausted` means sends are refused until it resets. */
export type UsageSeverity = 'normal' | 'warning' | 'critical' | 'exhausted';

export interface UsageWindowValue {
  /** Stable id, e.g. `session`, `weekly`, `weekly-opus`. */
  id: string;
  /** Plain words: "Current session", "This week". */
  label: string;
  /** Qualifier shown after the label, e.g. "Opus" or "all models". */
  scope?: string;
  /** Share of the window used, 0–100. */
  usedPercent: number;
  /** Epoch ms when the window resets, when known. */
  resetsAt?: number;
  severity: UsageSeverity;
}

export interface UsageValue {
  kind: 'plan' | 'metered' | 'unknown';
  /** Who meters you: "Claude Max", "Amazon Bedrock", "Anthropic API". */
  source: string;
  /**
   * Stable display order (session, then weekly, then per-model) — not sorted
   * by pressure. The headline is the most-used window (see `headline`).
   * Empty for `metered`.
   */
  windows: UsageWindowValue[];
  /** Pay-as-you-go top-up some plans allow once a window runs out. */
  extra?: { enabled: boolean; used?: number; limit?: number; currency: string };
  /** Spend observed through the gateway, USD. `budget` is the user's own cap. */
  spend: { today: number; month: number; budget?: number };
  /** Set while the provider is refusing sends. */
  blocked?: { until?: number; windowId?: string };
  /** One sentence explaining an odd state. */
  message?: string;
  /** Epoch ms the numbers were last read. */
  updatedAt: number;
}
