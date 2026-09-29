import type { SDKControlGetUsageResponse, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { severityFor, type EngineStatus, type UsageWindow } from '@conch/protocol';

import type { EngineUsage, LimitSignal } from '../types';

type RateLimits = NonNullable<SDKControlGetUsageResponse['rate_limits']>;
type Bucket = { utilization: number | null; resets_at: string | null } | null | undefined;

const PLAN_NAMES: Record<string, string> = {
  pro: 'Claude Pro',
  max: 'Claude Max',
  team: 'Claude Team',
  enterprise: 'Claude Enterprise',
};

export function planName(subscriptionType: string | null | undefined): string {
  if (!subscriptionType) return 'Claude subscription';
  const known = PLAN_NAMES[subscriptionType.toLowerCase()];
  return known ?? `Claude ${subscriptionType[0]?.toUpperCase()}${subscriptionType.slice(1)}`;
}

/** Rate-limit headers carry epoch seconds; ISO strings and ms pass through. */
export function toEpochMs(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function window(id: string, label: string, bucket: Bucket, scope?: string): UsageWindow[] {
  if (!bucket || bucket.utilization == null) return [];
  const usedPercent = Math.min(100, Math.max(0, bucket.utilization));
  return [
    {
      id,
      label,
      ...(scope && { scope }),
      usedPercent,
      resetsAt: toEpochMs(bucket.resets_at),
      severity: severityFor(usedPercent),
    },
  ];
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Claude Code's plan windows in display order: session, weekly, then per-model weekly. */
export function planWindows(limits: RateLimits): UsageWindow[] {
  const windows = [
    ...window('session', 'Current session', limits.five_hour),
    ...window('weekly', 'This week', limits.seven_day, 'all models'),
    ...window('weekly-opus', 'This week', limits.seven_day_opus, 'Opus'),
    ...window('weekly-sonnet', 'This week', limits.seven_day_sonnet, 'Sonnet'),
  ];
  const scopes = new Set(windows.map((w) => w.scope?.toLowerCase()));
  for (const row of limits.model_scoped ?? []) {
    if (scopes.has(row.display_name.toLowerCase())) continue;
    scopes.add(row.display_name.toLowerCase());
    windows.push(...window(`model:${slug(row.display_name)}`, 'This week', row, row.display_name));
  }
  return windows;
}

/** Extra-usage amounts arrive in minor units (cents for USD). */
function extraUsage(limits: RateLimits): EngineUsage['extra'] {
  const extra = limits.extra_usage;
  if (!extra) return undefined;
  return {
    enabled: extra.is_enabled,
    ...(extra.used_credits != null && { used: extra.used_credits / 100 }),
    ...(extra.monthly_limit != null && { limit: extra.monthly_limit / 100 }),
    currency: extra.currency ?? 'USD',
  };
}

/** Auth methods billed per token, where no plan ceiling exists. */
const METERED: Partial<Record<string, string>> = {
  'api-key': 'Anthropic API',
  console: 'Anthropic Console',
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
};

/** What we can say without asking Claude Code: `undefined` means "ask it". */
export function usageFromStatus(status: EngineStatus): EngineUsage | undefined {
  if (status.state !== 'ready') {
    return { kind: 'unknown', source: status.label, windows: [] };
  }
  const method = status.auth?.method;
  const metered = method && METERED[method];
  if (metered) return { kind: 'metered', source: metered, windows: [] };
  return undefined;
}

export function usageFromResponse(response: SDKControlGetUsageResponse): EngineUsage {
  const limits = response.rate_limits;
  if (response.rate_limits_available && limits) {
    return {
      kind: 'plan',
      source: planName(response.subscription_type),
      windows: planWindows(limits),
      extra: extraUsage(limits),
    };
  }
  if (response.subscription_type) {
    return {
      kind: 'plan',
      source: planName(response.subscription_type),
      windows: [],
      message:
        "Claude Code can't read your plan's limits with this sign-in. Signing in again usually fixes it.",
    };
  }
  return { kind: 'metered', source: 'Anthropic API', windows: [] };
}

const WINDOW_IDS: Partial<Record<NonNullable<SDKRateLimitInfo['rateLimitType']>, string>> = {
  five_hour: 'session',
  seven_day: 'weekly',
  seven_day_opus: 'weekly-opus',
  seven_day_sonnet: 'weekly-sonnet',
};

export function limitSignal(info: SDKRateLimitInfo): LimitSignal {
  return {
    status:
      info.status === 'rejected'
        ? 'rejected'
        : info.status === 'allowed_warning'
          ? 'warning'
          : 'allowed',
    windowId: info.rateLimitType && WINDOW_IDS[info.rateLimitType],
    resetsAt: toEpochMs(info.resetsAt),
  };
}
