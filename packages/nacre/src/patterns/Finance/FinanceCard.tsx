import { useCallback, useRef, useState, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { CoinCard } from './CoinCard';
import { CompareChart } from './CompareChart';
import { CryptoMarketCard } from './CryptoMarket';
import { FundamentalsCard } from './Fundamentals';
import { QuoteCard } from './QuoteCard';
import { MissingSymbols, QuoteShelf } from './QuoteShelf';
import type {
  CryptoMarketData,
  FinancePeriod,
  FundamentalsData,
  PriceSeries,
  QuotesData,
} from './types';
import styles from './Finance.module.css';

/** Asks the app for another range of closes. `undefined` when nobody has them. */
export type RangeFetcher = (
  symbol: string,
  period: FinancePeriod,
) => Promise<PriceSeries | undefined>;

export interface QuotesCardProps {
  quotes: QuotesData;
  locale?: string;
  /**
   * The range switch's re-fetch. Left out, the card shows the range it was
   * given and no switch, rather than offering a button that can't work.
   */
  onRange?: RangeFetcher;
  /** TODO(share): the shared card share bar, mounted in each card's footer. */
  share?: ReactNode;
  className?: string;
}

/**
 * Prices in the chat: one instrument as a card, several as a shelf of chips
 * with the chosen one large, or two to four overlaid when the person is
 * comparing them.
 *
 * It holds the range for whichever view is showing, asks the app for another
 * one when the switch is pressed, and keeps the chart it has on screen while
 * the new closes land — no skeleton, no jump.
 */
export function QuotesCard({ quotes, locale, onRange, share, className }: QuotesCardProps) {
  const first = quotes.items[0];
  const given = quotes.series?.[0]?.period ?? first?.spark?.period ?? '1M';
  const [period, setPeriod] = useState<FinancePeriod>(given);
  const [selected, setSelected] = useState(first?.symbol ?? '');
  const [fetched, setFetched] = useState<Record<string, PriceSeries>>({});
  const [loading, setLoading] = useState(false);
  const asking = useRef(0);

  const seriesFor = useCallback(
    (symbol: string): PriceSeries | undefined =>
      fetched[`${symbol}:${period}`] ??
      quotes.series?.find((s) => s.symbol === symbol && s.period === period) ??
      quotes.series?.find((s) => s.symbol === symbol),
    [fetched, period, quotes.series],
  );

  const compare = Boolean(quotes.compare) && quotes.items.length > 1 && !!quotes.series?.length;

  const choose = useCallback(
    (next: FinancePeriod) => {
      setPeriod(next);
      if (!onRange) return;
      const wanted = compare ? quotes.items.map((q) => q.symbol) : [selected];
      const missing = wanted.filter((symbol) => !fetched[`${symbol}:${next}`]);
      if (!missing.length) return;
      const run = ++asking.current;
      setLoading(true);
      void Promise.all(
        missing.map(async (symbol) => {
          const series = await onRange(symbol, next).catch(() => undefined);
          return [symbol, series] as const;
        }),
      ).then((answers) => {
        // A range pressed after this one has already taken over: drop this answer.
        if (asking.current !== run) return;
        setFetched((held) => {
          const grown = { ...held };
          for (const [symbol, series] of answers) if (series) grown[`${symbol}:${next}`] = series;
          return grown;
        });
        setLoading(false);
      });
    },
    [compare, fetched, onRange, quotes.items, selected],
  );

  if (!first) return null;

  const onPeriodChange = onRange ? choose : undefined;
  const card = (symbol: string) => {
    const quote = quotes.items.find((q) => q.symbol === symbol) ?? first;
    const { crypto } = quote;
    // A coin with CoinGecko's figures gets its own card; a coin Stooq stood in for is priced as any other.
    if (crypto)
      return (
        <CoinCard
          quote={{ ...quote, crypto }}
          series={seriesFor(quote.symbol)}
          locale={locale}
          period={period}
          onPeriodChange={onPeriodChange}
          loading={loading}
          share={share}
        />
      );
    return (
      <QuoteCard
        quote={quote}
        series={seriesFor(quote.symbol)}
        locale={locale}
        period={period}
        onPeriodChange={onPeriodChange}
        loading={loading}
        share={share}
      />
    );
  };

  return (
    <div className={cx(styles.root, className)}>
      {quotes.missing?.length ? <MissingSymbols missing={quotes.missing} /> : null}
      {compare ? (
        <CompareChart
          series={quotes.items.flatMap((q) => seriesFor(q.symbol) ?? [])}
          names={quotes.items.map((q) => q.name ?? q.symbol)}
          locale={locale}
          period={period}
          onPeriodChange={onPeriodChange}
          loading={loading}
          share={share}
        />
      ) : quotes.items.length > 1 ? (
        <QuoteShelf
          quotes={quotes.items}
          value={selected || first.symbol}
          onValueChange={setSelected}
          locale={locale}
        >
          {card}
        </QuoteShelf>
      ) : (
        card(first.symbol)
      )}
    </div>
  );
}

export interface FundamentalsCardViewProps {
  fundamentals: FundamentalsData;
  locale?: string;
  share?: ReactNode;
  className?: string;
}

/** Filed figures in the chat: one company, or two to four side by side. */
export function Fundamentals({
  fundamentals,
  locale,
  share,
  className,
}: FundamentalsCardViewProps) {
  if (!fundamentals.items.length) return null;
  return (
    <FundamentalsCard
      companies={fundamentals.items}
      source={fundamentals.source}
      locale={locale}
      share={share}
      className={className}
    />
  );
}

export interface CryptoMarketProps {
  market: CryptoMarketData;
  locale?: string;
  share?: ReactNode;
  className?: string;
}

/** Crypto as a whole in the chat: the total, its day, the dominance and the biggest coins. */
export function CryptoMarket({ market, locale, share, className }: CryptoMarketProps) {
  return (
    <div className={cx(styles.root, className)}>
      <CryptoMarketCard market={market} locale={locale} share={share} />
    </div>
  );
}
