/**
 * List prices, so Conch can say what a run cost when the provider only says
 * how many tokens it used (ADR 0057). The provider's own figure always wins
 * (`Usage.costUsd`: Claude Code, OpenRouter); this is the fallback.
 *
 * USD per million tokens, matched on the model id (any prefix, like
 * `anthropic/` or `us.anthropic.`). Only families whose price is published
 * and stable are here. A model that matches nothing has no price, and Conch
 * says nothing about money for it rather than guess.
 */
import type { Usage } from '@conch/protocol';

export interface Price {
  input: number;
  output: number;
  /** Input read from the provider's cache. Unset: the input price. */
  cachedInput?: number;
  /** Input written to the provider's cache (Anthropic: a quarter more). Unset: the input price. */
  cacheWrite?: number;
}

/** Most specific first: the first match wins. */
const PRICES: readonly { match: RegExp; price: Price }[] = [
  // Anthropic, first-party API (checked 2026-09).
  {
    match: /claude-(?:fable|mythos)-5[-.]1/,
    price: { input: 10, output: 50, cachedInput: 0.25, cacheWrite: 12.5 },
  },
  {
    match: /claude-(?:fable|mythos)/,
    price: { input: 10, output: 50, cachedInput: 1, cacheWrite: 12.5 },
  },
  { match: /claude-opus-5[-.]5/, price: { input: 4, output: 20, cachedInput: 0.2, cacheWrite: 5 } },
  { match: /claude-opus/, price: { input: 5, output: 25, cachedInput: 0.5, cacheWrite: 6.25 } },
  { match: /claude-sonnet-5/, price: { input: 2, output: 10, cachedInput: 0.2, cacheWrite: 2.5 } },
  { match: /claude-sonnet/, price: { input: 3, output: 15, cachedInput: 0.3, cacheWrite: 3.75 } },
  { match: /claude-haiku/, price: { input: 1, output: 5, cachedInput: 0.1, cacheWrite: 1.25 } },
  // OpenAI.
  { match: /gpt-5(?:[.-]\d+)?-nano/, price: { input: 0.05, output: 0.4, cachedInput: 0.005 } },
  { match: /gpt-5(?:[.-]\d+)?-mini/, price: { input: 0.25, output: 2, cachedInput: 0.025 } },
  { match: /gpt-5(?![\d])/, price: { input: 1.25, output: 10, cachedInput: 0.125 } },
  { match: /gpt-4\.1-nano/, price: { input: 0.1, output: 0.4, cachedInput: 0.025 } },
  { match: /gpt-4\.1-mini/, price: { input: 0.4, output: 1.6, cachedInput: 0.1 } },
  { match: /gpt-4\.1/, price: { input: 2, output: 8, cachedInput: 0.5 } },
  { match: /gpt-4o-mini/, price: { input: 0.15, output: 0.6, cachedInput: 0.075 } },
  { match: /gpt-4o/, price: { input: 2.5, output: 10, cachedInput: 1.25 } },
  { match: /\bo4-mini/, price: { input: 1.1, output: 4.4, cachedInput: 0.275 } },
  { match: /\bo3(?!-)/, price: { input: 2, output: 8, cachedInput: 0.5 } },
  // Google.
  { match: /gemini-2\.5-flash-lite/, price: { input: 0.1, output: 0.4, cachedInput: 0.025 } },
  { match: /gemini-2\.5-flash/, price: { input: 0.3, output: 2.5, cachedInput: 0.075 } },
  { match: /gemini-2\.5-pro/, price: { input: 1.25, output: 10, cachedInput: 0.31 } },
  // DeepSeek.
  { match: /deepseek-(?:chat|reasoner)/, price: { input: 0.28, output: 0.42, cachedInput: 0.028 } },
  // xAI.
  { match: /grok-code-fast/, price: { input: 0.2, output: 1.5, cachedInput: 0.02 } },
  { match: /grok-4-fast/, price: { input: 0.2, output: 0.5, cachedInput: 0.05 } },
  { match: /grok-4(?![.-]?\d)/, price: { input: 3, output: 15, cachedInput: 0.75 } },
];

/** The list price of a model, if Conch knows it. */
export function priceOf(model: string | undefined): Price | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  return PRICES.find((p) => p.match.test(id))?.price;
}

/** What these tokens cost at list price (USD). */
export function costAt(
  price: Price,
  usage: Pick<Usage, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteTokens'>,
): number {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached);
  const fresh = usage.inputTokens - cached - written;
  return (
    (fresh * price.input +
      cached * (price.cachedInput ?? price.input) +
      written * (price.cacheWrite ?? price.input) +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

/**
 * A typical routine run, measured (ADR 0057): a morning briefing takes about
 * four requests (the calendar, the mail, the weather, the answer), and each
 * request carries Conch's instructions and tools — about 72,000 tokens — again.
 * Used to say what a routine will roughly cost before it has run.
 */
export const TYPICAL_RUN: Pick<Usage, 'inputTokens' | 'outputTokens'> = {
  inputTokens: 290_000,
  outputTokens: 3_000,
};
