import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { Sparkline } from '../../components/LiveChart';
import { cx } from '../../utils/cx';
import { changeWords, direction, money, percent } from './format';
import { Lettermark } from './QuoteCard';
import type { Quote } from './types';
import styles from './Finance.module.css';

export interface QuoteShelfProps {
  quotes: Quote[];
  /** The symbol shown large. */
  value: string;
  onValueChange: (symbol: string) => void;
  locale?: string;
  /** The big card for the chosen instrument. */
  children: (symbol: string) => ReactNode;
  className?: string;
}

/**
 * Two to eight instruments as a row of compact chips — symbol, name, the
 * shape of the last month and the move in words — with the chosen one shown
 * large underneath.
 *
 * It is Radix's tab list, so the keyboard works without being invented:
 * arrows move along the row, Home and End jump to its ends, and the big card
 * is the chosen chip's panel. The row scroll-snaps, so a thumb swipes from
 * one instrument to the next.
 */
export function QuoteShelf({
  quotes,
  value,
  onValueChange,
  locale,
  children,
  className,
}: QuoteShelfProps) {
  return (
    <TabsPrimitive.Root
      className={cx(styles.shelf, className)}
      value={value}
      onValueChange={onValueChange}
      activationMode="automatic"
    >
      <TabsPrimitive.List className={styles.chips} aria-label="Instruments">
        {quotes.map((quote) => {
          const way = direction(quote.change ?? quote.changePercent);
          return (
            <TabsPrimitive.Trigger
              key={quote.symbol}
              value={quote.symbol}
              className={styles.chip}
              data-way={way}
            >
              <span className={styles.chipHead}>
                <Lettermark symbol={quote.symbol} className={styles.chipMark} />
                <span className={styles.chipSymbol}>{quote.symbol}</span>
              </span>
              <span className={styles.chipName}>{quote.name ?? ' '}</span>
              <span className={styles.chipSpark} aria-hidden>
                {quote.spark && quote.spark.values.length > 1 && (
                  /* The shape, not the level: each chip is its own small chart,
                     so they share one colour and each fills its own height. */
                  <Sparkline values={shape(quote.spark.values)} max={100} height={22} />
                )}
              </span>
              <span className={styles.chipPrice}>{money(quote.price, quote.currency, locale)}</span>
              <span className={styles.chipMove}>
                {quote.changePercent === undefined
                  ? '—'
                  : `${way === 'up' ? '▲' : way === 'down' ? '▼' : '–'} ${percent(
                      Math.abs(quote.changePercent),
                      locale,
                      false,
                    )}`}
              </span>
              <span className="nc-visually-hidden">
                , {changeWords(quote.change, quote.changePercent, quote.currency, locale)}
              </span>
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>
      {quotes.map((quote) => (
        <TabsPrimitive.Content
          key={quote.symbol}
          value={quote.symbol}
          className={styles.panel}
          // The panel is a card, not a focus stop: its own controls are reachable.
          tabIndex={-1}
          // Every panel stays in the page, so each chip's `aria-controls`
          // always names an element that exists; the CSS hides the rest.
          forceMount
        >
          {children(quote.symbol)}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

/** A series as a shape from 0 to 100, so a small chart shows its own swing. */
function shape(values: readonly number[]): number[] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  if (!(span > 0)) return values.map(() => 50);
  return values.map((v) => 6 + ((v - low) / span) * 88);
}

/** Symbols nobody had a price for, said plainly rather than quietly dropped. */
export function MissingSymbols({ missing, className }: { missing: string[]; className?: string }) {
  if (!missing.length) return null;
  return (
    <p className={cx(styles.missing, className)}>
      No price was found for {missing.map((m) => `“${m}”`).join(', ')}. The exact ticker usually
      finds it — AAPL, ^SPX, BTC-USD, or AIR.PA for a Paris listing.
    </p>
  );
}
