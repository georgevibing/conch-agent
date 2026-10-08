/**
 * Words and numbers for product cards: prices in the person's own way of
 * writing money, a reduction as a percentage, stars in halves, and which
 * product is the better buy on each row of a comparison.
 */

/** An amount in an ISO 4217 currency. Mirrors `ProductPrice` in `@conch/protocol`. */
export interface ShelfPrice {
  amount: number;
  currency: string;
}

export type ShelfAvailability = 'in_stock' | 'out_of_stock' | 'preorder' | 'limited' | 'unknown';

/** "$149.00", "149,00 €", "¥2,980": the currency's own decimals, the locale's own way. */
export function formatPrice(price: ShelfPrice, locale?: string): string {
  try {
    const whole = Number.isInteger(price.amount);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: price.currency,
      // A whole price reads as one ("$39", not "$39.00") unless the currency always shows cents.
      ...(whole && { minimumFractionDigits: 0 }),
    }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

/** How much less than before, in whole percent; nothing when it isn't less, or can't be compared. */
export function discountOf(price?: ShelfPrice, was?: ShelfPrice): number | undefined {
  if (!price || !was || price.currency !== was.currency || was.amount <= price.amount) return;
  const off = Math.round((1 - price.amount / was.amount) * 100);
  return off >= 1 ? off : undefined;
}

/** Stars as five fills, each 0, 0.5 or 1: 4.3 → ★★★★☆, 4.6 → ★★★★½. */
export function starFills(value: number): number[] {
  const halves = Math.round(Math.min(5, Math.max(0, value)) * 2) / 2;
  return Array.from({ length: 5 }, (_, i) => Math.min(1, Math.max(0, halves - i)));
}

/** "1.8k" for a count that would crowd the stars. */
export function shortCount(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** "Rated 4.6 out of 5 by 1,840 people": what the stars say aloud. */
export function ratingWords(rating: { value: number; count?: number }, locale?: string): string {
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rating.value);
  const by =
    rating.count !== undefined
      ? ` by ${new Intl.NumberFormat(locale).format(rating.count)} ${rating.count === 1 ? 'person' : 'people'}`
      : '';
  return `Rated ${value} out of 5${by}`;
}

export const AVAILABILITY_WORDS: Record<ShelfAvailability, string> = {
  in_stock: 'In stock',
  limited: 'Only a few left',
  preorder: 'Pre-order',
  out_of_stock: 'Out of stock',
  unknown: 'Availability unknown',
};

/** Better first, for comparing. */
const AVAILABILITY_RANK: Record<ShelfAvailability, number> = {
  in_stock: 4,
  limited: 3,
  preorder: 2,
  unknown: 1,
  out_of_stock: 0,
};

interface Comparable {
  price?: ShelfPrice;
  rating?: { value: number; count?: number };
  availability?: ShelfAvailability;
}

/**
 * Which of these is best on each row, by index: the lowest price (only among
 * prices in one currency), the highest rating (more ratings break a tie),
 * the easiest to get. A row where nothing stands out (one value, or all
 * equal) has no best: marking everything says nothing.
 */
export function bestOf(items: readonly Comparable[]): {
  price?: number;
  rating?: number;
  availability?: number;
} {
  const pick = <T>(
    values: (T | undefined)[],
    better: (a: T, b: T) => number,
    same: (a: T, b: T) => boolean,
  ): number | undefined => {
    const present = values.flatMap((v, i) => (v === undefined ? [] : [{ v, i }]));
    if (present.length < 2) return undefined;
    const sorted = [...present].sort((a, b) => better(a.v, b.v));
    const [first, second] = sorted;
    if (!first || !second || same(first.v, second.v)) return undefined;
    return first.i;
  };
  const currencies = new Set(items.flatMap((i) => (i.price ? [i.price.currency] : [])));
  return {
    price:
      currencies.size === 1
        ? pick(
            items.map((i) => i.price),
            (a, b) => a.amount - b.amount,
            (a, b) => a.amount === b.amount,
          )
        : undefined,
    rating: pick(
      items.map((i) => i.rating),
      (a, b) => b.value - a.value || (b.count ?? 0) - (a.count ?? 0),
      (a, b) => a.value === b.value && (a.count ?? 0) === (b.count ?? 0),
    ),
    availability: pick(
      items.map((i) => (i.availability ? AVAILABILITY_RANK[i.availability] : undefined)),
      (a, b) => b - a,
      (a, b) => a === b,
    ),
  };
}
