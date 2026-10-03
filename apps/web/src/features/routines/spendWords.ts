import type { RoutineSpend, RunCost } from '@conch/protocol';
import { formatMoney } from '@conch/nacre';

/** What one run cost, in a few words: “$0.61”, “4% of your plan”, “Free”. */
export function runCostText(cost: RunCost | undefined): string | undefined {
  if (!cost) return undefined;
  if (cost.billing === 'free') return 'Free';
  if (cost.billing === 'plan') {
    if (cost.planPercent === undefined) return undefined;
    return cost.planPercent < 1
      ? 'A little of your plan'
      : `${Math.round(cost.planPercent)}% of your plan`;
  }
  return cost.usd === undefined ? undefined : formatMoney(cost.usd);
}

/** What one run may use before it stops: “$1.83”, “900 thousand tokens”. */
export function runLimitText(limit: RoutineSpend['runLimit']): string | undefined {
  if (!limit) return undefined;
  if (limit.usd !== undefined) return formatMoney(limit.usd);
  if (limit.tokens !== undefined)
    return `${Math.round(limit.tokens / 1000).toLocaleString('en-US')} thousand tokens`;
  return undefined;
}

/**
 * “Let it use more”: three times what a run may use now, in whole dollars —
 * enough for a run that really is bigger, still a limit for one that loops.
 */
export function moreRoom(limit: RoutineSpend['runLimit'], spent?: number): number {
  const now = Math.max(limit?.usd ?? 3, spent ?? 0);
  return Math.min(1000, Math.max(1, Math.ceil(now * 3)));
}
