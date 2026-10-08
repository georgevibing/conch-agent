/**
 * Every number on a finance card goes through here, so a price, a percentage
 * and a billion read the way the person's own locale writes them
 * (`Intl.NumberFormat`), and so the words that carry direction are written in
 * exactly one place.
 */
import type { FinancePeriod, MarketState } from './types';

/** Formatters are expensive to build and cheap to keep. */
const cache = new Map<string, Intl.NumberFormat>();
function formatter(locale: string | undefined, options: Intl.NumberFormatOptions) {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.NumberFormat(locale, options);
    cache.set(key, found);
  }
  return found;
}

/** A currency code the runtime will accept; anything else is drawn as a plain number. */
const isCurrency = (code: string | undefined): code is string => !!code && /^[A-Z]{3}$/.test(code);

/**
 * How many decimals a price wants. Two for most things; four for a small
 * price that really has them (a currency pair at 1.0842, a penny share), so
 * no precision the source gave is thrown away; none once a figure is into the
 * ten-thousands, where pennies are noise.
 */
export function priceDigits(value: number): number {
  const size = Math.abs(value);
  if (size === 0) return 2;
  if (size >= 10_000) return 0;
  if (size < 10 && !Number.isInteger(Math.round(value * 10_000) / 100)) return 4;
  return 2;
}

/** A price, in its own currency where there is one: "$257.20", "214.30". */
export function money(value: number, currency?: string, locale?: string, digits?: number): string {
  const places = digits ?? priceDigits(value);
  if (isCurrency(currency))
    return formatter(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(value);
  return formatter(locale, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(value);
}

/** A big amount, short: "$3.82T", "416.2B", "41.2M". */
export function compact(value: number, currency?: string, locale?: string): string {
  const options: Intl.NumberFormatOptions = {
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 2 : 1,
  };
  if (isCurrency(currency))
    return formatter(locale, {
      ...options,
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(value);
  return formatter(locale, options).format(value);
}

/** A plain count: "41,234,567". */
export function count(value: number, locale?: string): string {
  return formatter(locale, { maximumFractionDigits: 0 }).format(value);
}

/** A percentage, signed where it's a change: "+0.67%", "0.67%". */
export function percent(value: number, locale?: string, signed = true): string {
  return formatter(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...(signed && { signDisplay: 'exceptZero' }),
  }).format(value / 100);
}

/** A percentage for an axis, where the ticks are already round: "+10%". */
export function percentTick(value: number, locale?: string): string {
  return formatter(locale, {
    style: 'percent',
    maximumFractionDigits: Math.abs(value) < 1 ? 2 : 0,
    signDisplay: 'exceptZero',
  }).format(value / 100);
}

/** A signed amount: "+1.70", "−1.70" (a real minus sign, as Intl writes it). */
export function signed(value: number, locale?: string, digits?: number): string {
  const places = digits ?? priceDigits(value);
  return formatter(locale, {
    signDisplay: 'exceptZero',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(value);
}

/** "up" / "down" / "unchanged": direction in words, so it's never colour alone. */
export function direction(change: number | undefined): 'up' | 'down' | 'flat' {
  if (change === undefined || Math.abs(change) < 1e-9) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** "up 0.67%" — the sentence a screen reader and a label both use. */
export function changeWords(
  change: number | undefined,
  changePercent: number | undefined,
  currency: string | undefined,
  locale?: string,
): string {
  const way = direction(change ?? changePercent);
  if (way === 'flat') return 'unchanged';
  const parts = [
    change !== undefined ? money(Math.abs(change), currency, locale) : undefined,
    changePercent !== undefined ? percent(Math.abs(changePercent), locale, false) : undefined,
  ].filter(Boolean);
  return `${way} ${parts.join(' / ')}`;
}

/** A calendar date, as the reader writes one: "7 Oct 2026". */
export function dateWords(date: string, locale?: string, long = false): string {
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString(locale, {
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
    ...(/^\d{4}-\d{2}-\d{2}$/.test(date) && { timeZone: 'UTC' }),
  });
}

/** A month and a year, for a quiet caption: "Oct 2025". */
export function monthWords(date: string, locale?: string): string {
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A date and time, as the reader's own clock shows it: "7 Oct 2026, 22:00". */
export function momentWords(when: string, locale?: string): string {
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return when;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  return at.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A short axis label for a date, chosen for how far the chart reaches. */
export function axisDate(date: string, period: FinancePeriod, locale?: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  const options: Intl.DateTimeFormatOptions =
    period === '1W'
      ? { weekday: 'short', timeZone: 'UTC' }
      : period === '1M' || period === '3M'
        ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
        : period === '6M' || period === '1Y'
          ? { month: 'short', timeZone: 'UTC' }
          : { year: 'numeric', timeZone: 'UTC' };
  return at.toLocaleDateString(locale, options);
}

/** What the market's state says, in plain words. */
export const MARKET_WORDS: Record<MarketState, string> = {
  open: 'Open',
  closed: 'Closed',
  pre: 'Before the open',
  post: 'After the close',
  unknown: '',
};

/** The period in words, for a caption: "the last three months". */
export const PERIOD_WORDS: Record<FinancePeriod, string> = {
  '1W': 'the last week',
  '1M': 'the last month',
  '3M': 'the last three months',
  '6M': 'the last six months',
  '1Y': 'the last year',
  '5Y': 'the last five years',
  MAX: 'as far back as the source goes',
};

/** What to call an instrument, when it isn't a company: "index", "coin". */
export const CLASS_WORDS: Record<string, string> = {
  stock: 'Share',
  etf: 'Fund',
  index: 'Index',
  crypto: 'Coin',
  fx: 'Currency pair',
  commodity: 'Commodity',
};

/** A clean top and bottom for an axis, a touch outside the values. */
export function niceBounds(values: readonly number[]): { lo: number; hi: number } {
  const known = values.filter((v) => Number.isFinite(v));
  if (!known.length) return { lo: 0, hi: 1 };
  const low = Math.min(...known);
  const high = Math.max(...known);
  if (high === low)
    return { lo: low - Math.abs(low) * 0.01 - 1, hi: high + Math.abs(high) * 0.01 + 1 };
  const pad = (high - low) * 0.08;
  return { lo: low - pad, hi: high + pad };
}

/**
 * Round numbers for an axis, inside the bounds: 0 / 250 / 500, never
 * 243.98 / 250.22. Zero always lands on one when the range crosses it, so a
 * comparison's baseline is a real tick.
 */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / (count + 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step)
    out.push(Math.round(v / step) * step);
  return out;
}

/** A growth figure between two filed periods, as a percentage, or nothing. */
export function growth(from: number | undefined, to: number | undefined): number | undefined {
  if (from === undefined || to === undefined || from === 0) return undefined;
  const value = ((to - from) / Math.abs(from)) * 100;
  return Number.isFinite(value) ? value : undefined;
}

/** A margin as a percentage of revenue, or nothing when either figure is missing. */
export function margin(part: number | undefined, whole: number | undefined): number | undefined {
  if (part === undefined || whole === undefined || whole <= 0) return undefined;
  const value = (part / whole) * 100;
  return Number.isFinite(value) ? value : undefined;
}

/** How a filed figure reads, by what it measures. */
export function filedValue(
  value: number,
  unit: FiledUnit,
  currency: string | undefined,
  locale?: string,
): string {
  switch (unit) {
    case 'currency':
      return compact(value, currency, locale);
    case 'perShare':
      return money(value, currency, locale, 2);
    case 'people':
    case 'shares':
      return compact(value, undefined, locale);
    case 'percent':
      return percent(value, locale, false);
  }
}

export type FiledUnit = 'currency' | 'shares' | 'perShare' | 'people' | 'percent';

/** "10-K filed 30 Oct 2025": where a figure came from, in a few words. */
export function filedWords(
  figure: { form?: string; filed?: string; periodEnd?: string },
  locale?: string,
): string {
  const parts = [
    figure.form,
    figure.filed ? `filed ${dateWords(figure.filed, locale)}` : undefined,
    figure.periodEnd ? `period ended ${dateWords(figure.periodEnd, locale)}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}
