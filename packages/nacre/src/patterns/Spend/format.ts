import { formatMoney } from '../Usage/format';

/** How the provider charges: nothing, a subscription's allowance, or money. */
export type SpendBilling = 'free' | 'plan' | 'metered';

/** What one reply cost, as Conch worked it out (the gateway's `TurnCost`). */
export interface TurnCostValue {
  billing: SpendBilling;
  /** Money (USD). On a plan, what the work would cost at list price: nobody pays it. */
  usd?: number;
  /** `provider`: the provider said; `list`: Conch priced it at list prices. */
  priced?: 'provider' | 'list';
  /** What reading from the cache saved (USD). */
  savedUsd?: number;
  plan?: { source: string; window?: { label: string; usedPercent: number; resetsAt?: number } };
}

/** The tokens behind it, when the provider said. */
export interface TurnTokens {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** What a chat has spent (the gateway's `ChatSpend`). */
export interface ChatSpendValue {
  usd: number;
  tasksUsd?: number;
  savedUsd?: number;
  planTurns?: number;
  capUsd?: number;
}

/** "18,200". */
const count = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

/**
 * What the reply's actions show, in a word: "$0.04", "<$0.01", or "Plan".
 * Nothing on this computer, or when Conch can't say.
 */
export function costShort(cost: TurnCostValue, locale = 'en-US'): string | undefined {
  if (cost.billing === 'plan') return 'Plan';
  if (cost.billing === 'metered' && cost.usd !== undefined)
    return formatMoney(cost.usd, 'USD', locale);
  return undefined;
}

/** One sentence for the reply's cost, for its button's name and the top of its detail. */
export function costSentence(cost: TurnCostValue, locale = 'en-US'): string {
  if (cost.billing === 'free') return 'This reply was free, on this computer.';
  if (cost.billing === 'plan')
    return `This reply was on your ${cost.plan?.source ? `${cost.plan.source} ` : ''}plan: nothing to pay.`;
  if (cost.usd === undefined) return 'Conch doesn’t know this model’s price.';
  const amount = formatMoney(cost.usd, 'USD', locale);
  return cost.priced === 'provider'
    ? `This reply cost ${amount}.`
    : `This reply cost about ${amount}, at list prices.`;
}

/** The lines under it: the cache, the tokens, the plan's window. */
export function costDetail(
  cost: TurnCostValue,
  tokens: TurnTokens | undefined,
  locale = 'en-US',
): string[] {
  const lines: string[] = [];
  const window = cost.plan?.window;
  if (cost.billing === 'plan' && window)
    lines.push(`${window.label}: ${Math.round(window.usedPercent)}% used`);
  if (cost.billing === 'plan' && cost.usd !== undefined && cost.usd >= 0.005)
    lines.push(`About ${formatMoney(cost.usd, 'USD', locale)} of work at list prices`);
  if (cost.billing === 'metered' && cost.savedUsd && cost.savedUsd >= 0.005)
    lines.push(`Reading from the cache saved about ${formatMoney(cost.savedUsd, 'USD', locale)}`);
  if (tokens && (tokens.inputTokens || tokens.outputTokens)) {
    const cached = tokens.cachedInputTokens
      ? ` (${count(tokens.cachedInputTokens, locale)} from the cache)`
      : '';
    lines.push(
      `${count(tokens.inputTokens, locale)} tokens read${cached} · ${count(tokens.outputTokens, locale)} written`,
    );
  }
  return lines;
}

/** The chat's chip: "$0.31", or "$0.31 of $2" with a limit. */
export function chatShort(spend: ChatSpendValue, locale = 'en-US'): string {
  const spent = formatMoney(spend.usd, 'USD', locale);
  return spend.capUsd ? `${spent} of ${formatMoney(spend.capUsd, 'USD', locale)}` : spent;
}
