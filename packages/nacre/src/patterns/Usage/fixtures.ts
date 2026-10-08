import type { UsageValue, UsageWindowValue } from './types';

/** Fixed clock for stories and tests: Tue 29 Sep 2026, 13:30 UTC. */
export const usageNow = Date.parse('2026-09-29T13:30:00Z');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const session = (usedPercent: number, resetsIn: number): UsageWindowValue => ({
  id: 'session',
  label: 'Current session',
  usedPercent,
  resetsAt: usageNow + resetsIn,
  severity:
    usedPercent >= 100
      ? 'exhausted'
      : usedPercent >= 90
        ? 'critical'
        : usedPercent >= 75
          ? 'warning'
          : 'normal',
});

const weekly: UsageWindowValue = {
  id: 'weekly',
  label: 'This week',
  scope: 'all models',
  usedPercent: 61,
  resetsAt: usageNow + 3 * DAY - 4 * HOUR - 30 * MIN,
  severity: 'normal',
};

const weeklyOpus: UsageWindowValue = {
  id: 'weekly-opus',
  label: 'This week',
  scope: 'Opus',
  usedPercent: 22,
  resetsAt: weekly.resetsAt,
  severity: 'normal',
};

const plan = (windows: UsageWindowValue[], rest: Partial<UsageValue> = {}): UsageValue => ({
  kind: 'plan',
  source: 'Claude Max',
  windows,
  spend: { today: 0, month: 0 },
  updatedAt: usageNow - 2 * MIN,
  ...rest,
});

export const planHealthy = plan([session(38, 2 * HOUR + 14 * MIN), weekly, weeklyOpus]);

export const planWarning = plan([session(88, HOUR + 4 * MIN), weekly, weeklyOpus]);

/** The weekly limit nearly gone, a day before it resets. */
export const planWeeklyLow = plan([
  session(20, 3 * HOUR),
  { ...weekly, usedPercent: 96, resetsAt: usageNow + 23 * HOUR + 24 * MIN, severity: 'critical' },
  weeklyOpus,
]);

export const planExhausted = plan([session(100, 38 * MIN), weekly, weeklyOpus], {
  blocked: { until: usageNow + 38 * MIN, windowId: 'session' },
  updatedAt: usageNow - 10_000,
});

export const planWithExtra = plan([session(64, 3 * HOUR + 40 * MIN), weekly, weeklyOpus], {
  extra: { enabled: true, used: 12.4, limit: 50, currency: 'USD' },
});

export const planNoWindows = plan([], {
  message: 'Sign in again to let Conch see your plan’s limits.',
});

const metered = (spend: UsageValue['spend']): UsageValue => ({
  kind: 'metered',
  source: 'Amazon Bedrock',
  windows: [],
  spend,
  updatedAt: usageNow - 20_000,
});

export const meteredNoBudget = metered({ today: 4.2, month: 38.1 });
export const meteredBudget = metered({ today: 4.2, month: 38.1, budget: 50 });
export const meteredCritical = metered({ today: 9.6, month: 46.9, budget: 50 });
export const meteredOverBudget = metered({ today: 7.35, month: 52.4, budget: 50 });

export const usageUnknown: UsageValue = {
  kind: 'unknown',
  source: 'Claude Code',
  windows: [],
  spend: { today: 0, month: 0 },
  updatedAt: usageNow,
};

export const usageFixtures = {
  planHealthy,
  planWarning,
  planWeeklyLow,
  planExhausted,
  planWithExtra,
  planNoWindows,
  meteredNoBudget,
  meteredBudget,
  meteredCritical,
  meteredOverBudget,
  usageUnknown,
} satisfies Record<string, UsageValue>;
