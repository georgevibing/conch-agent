import { useState, type CSSProperties, type ReactNode } from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import {
  CLASS_WORDS,
  coinHue,
  changeWords,
  monthWords,
  compact,
  count,
  dateWords,
  direction,
  MARKET_WORDS,
  money,
  momentWords,
  percent,
  PERIOD_WORDS,
  signed,
} from './format';
import { PriceChart } from './PriceChart';
import { FINANCE_PERIODS, type FinancePeriod, type PriceSeries, type Quote } from './types';
import styles from './Finance.module.css';

/** A letter tile instead of a logo: nothing is ever fetched from a brand's site. */
export function Lettermark({
  symbol,
  coin,
  className,
}: {
  symbol: string;
  /** A coin: round like one, in the coin's own hue, with up to three letters of its symbol. */
  coin?: boolean;
  className?: string;
}) {
  const letters =
    symbol
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, coin ? (symbol.length <= 3 ? 3 : 1) : 2)
      .toUpperCase() || '·';
  // The same symbol always gets the same tint, from its own letters (a coin, its own colour).
  const hue = coin
    ? coinHue(symbol)
    : [...symbol].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={cx(styles.mark, className)}
      data-coin={coin || undefined}
      data-long={letters.length > 2 || undefined}
      data-one={(coin && letters.length === 1) || undefined}
      style={{ '--fm-h': hue } as CSSProperties}
    >
      {letters}
    </span>
  );
}

/** ▲ or ▼, drawn so it sits on the text's baseline at any size. */
export function Caret({ way }: { way: 'up' | 'down' | 'flat' }) {
  if (way === 'flat')
    return (
      <svg className={styles.caret} viewBox="0 0 10 10" aria-hidden focusable="false">
        <rect x="1" y="4.2" width="8" height="1.6" rx="0.8" />
      </svg>
    );
  return (
    <svg className={styles.caret} viewBox="0 0 10 10" aria-hidden focusable="false">
      <path d={way === 'up' ? 'M5 1.5 9 8.5H1Z' : 'M5 8.5 1 1.5h8Z'} />
    </svg>
  );
}

/**
 * A number whose digits roll when it changes: each character that changed is
 * remounted and rises into place from the direction the price moved, clipped
 * to its own slot. Reduced motion simply shows the new number.
 */
export function RollingNumber({
  value,
  way,
  className,
}: {
  value: string;
  way: 'up' | 'down' | 'flat';
  className?: string;
}) {
  return (
    <span className={cx(styles.roll, className)} data-way={way}>
      {[...value].map((character, i) => (
        <span className={styles.rollSlot} key={`${i}-${character}`}>
          {character === ' ' ? ' ' : character}
        </span>
      ))}
    </span>
  );
}

export interface QuoteCardProps {
  quote: Quote;
  /** Its daily closes, when they were fetched. */
  series?: PriceSeries;
  locale?: string;
  /** The range the chart draws. Left out, the series' own. */
  period?: FinancePeriod;
  /** The person pressed another range: fetch it and hand back a new series. */
  onPeriodChange?: (period: FinancePeriod) => void;
  /** A new range is on its way: the chart holds this one, a shade quieter. */
  loading?: boolean;
  /**
   * TODO(share): the shared card share bar (Save as image / Copy / Send to a
   * chat app) mounts here, in the card's footer — `patterns/CardShare/`, with
   * a ref to the element this card's `elementRef` gives it. Nothing else in
   * the footer moves when it lands.
   */
  share?: ReactNode;
  /** The card's own element, for whatever rasterises it. */
  elementRef?: React.Ref<HTMLElement>;
  className?: string;
  /** Drawn above the price: the shelf of other instruments, when there is one. */
  children?: ReactNode;
}

/**
 * One instrument's price, as a card in the chat (ADR 0060 §7).
 *
 * The price is large and rolls when it changes; the move beside it carries a
 * triangle *and* the word ("up 0.67%"), so direction is never colour alone.
 * Under it, the price over time: a line you can drag, hover or arrow through,
 * with the headline following the point you're on and springing back to the
 * latest when you let go. Then the day's range with this price marked on it,
 * the open, the previous close, the volume and what the whole company is
 * worth — each saying where it came from.
 *
 * Nothing here is live: the footer says whose price it is, when it's from, and
 * that it's delayed, every time.
 */
export function QuoteCard({
  quote,
  series,
  locale,
  period,
  onPeriodChange,
  loading,
  share,
  elementRef,
  className,
  children,
}: QuoteCardProps) {
  const [at, setAt] = useState<number | undefined>(undefined);
  const range = period ?? series?.period ?? quote.spark?.period ?? '1M';
  const currency = quote.currency ?? series?.currency;
  const scrubbed = at !== undefined && series ? series.closes[at] : undefined;
  const start = series?.closes[0];
  const showing = scrubbed ?? quote.price;
  const way = direction(
    scrubbed !== undefined && start !== undefined ? scrubbed - start : (quote.change ?? 0),
  );
  const move =
    scrubbed !== undefined && start !== undefined && start !== 0
      ? {
          change: scrubbed - start,
          percent: ((scrubbed - start) / start) * 100,
          since: `since ${dateWords(series?.dates[0] ?? '', locale)}`,
        }
      : {
          change: quote.change,
          percent: quote.changePercent,
          since: quote.previousClose === undefined ? '' : 'on the previous close',
        };
  const words = changeWords(move.change, move.percent, currency, locale);
  const kind = CLASS_WORDS[quote.class ?? 'unknown'];
  const state = MARKET_WORDS[quote.dayState ?? 'unknown'];

  const summary = [
    `${quote.name ?? quote.symbol} (${quote.symbol}): ${money(quote.price, currency, locale)},`,
    `${changeWords(quote.change, quote.changePercent, currency, locale)}`,
    quote.previousClose !== undefined
      ? `on a previous close of ${money(quote.previousClose, currency, locale)}.`
      : '.',
    `${state ? `${state}, ` : ''}as of ${momentWords(quote.asOf, locale)}.`,
    quote.delayed === false ? '' : 'Delayed, from',
    `${quote.source}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      ref={elementRef}
      aria-label={`${quote.name ?? quote.symbol} price`}
      className={cx(styles.card, className)}
    >
      <p className="nc-visually-hidden">{summary}</p>
      {children}
      {quote.notice && <p className={styles.notice}>{quote.notice}.</p>}

      <header className={styles.head}>
        <Lettermark symbol={quote.symbol} coin={quote.class === 'crypto'} />
        <div className={styles.who}>
          <h3 className={styles.symbol}>{quote.symbol}</h3>
          {quote.name && <p className={styles.name}>{quote.name}</p>}
        </div>
        <p className={styles.where} aria-hidden>
          {[kind, quote.exchange, currency].filter(Boolean).join(' · ')}
        </p>
      </header>

      <div className={styles.hero} aria-hidden>
        <div className={styles.priceRow}>
          <RollingNumber
            className={styles.price}
            value={money(showing, currency, locale)}
            way={way}
          />
          {/* Nobody sent a previous close, so there is no move to show — not
              "unchanged", which would be a figure nobody read. */}
          {(move.change !== undefined || move.percent !== undefined) && (
            <span className={styles.move} data-way={way}>
              <Caret way={way} />
              <span className={styles.moveWord}>{way === 'flat' ? 'unchanged' : way}</span>
              {move.percent !== undefined && (
                <span className={styles.movePercent}>
                  {percent(Math.abs(move.percent), locale, false)}
                </span>
              )}
              {move.change !== undefined && (
                <span className={styles.moveAmount}>{signed(move.change, locale)}</span>
              )}
            </span>
          )}
        </div>
        <p className={styles.when}>
          {at !== undefined && series?.dates[at]
            ? `${dateWords(series.dates[at] ?? '', locale, true)} · ${move.since}`
            : [
                state,
                `as of ${momentWords(quote.asOf, locale)}`,
                quote.delayed === false ? undefined : 'delayed',
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </div>

      {series && series.closes.length > 1 && (
        <PriceChart
          series={series}
          label={`${quote.name ?? quote.symbol}, daily closes over ${PERIOD_WORDS[range]}`}
          currency={currency}
          locale={locale}
          at={at}
          onAt={setAt}
          loading={loading}
        />
      )}

      {onPeriodChange && (
        <SegmentedControl
          size="sm"
          block
          aria-label="Range"
          className={styles.range}
          value={range}
          onValueChange={(next) => onPeriodChange(next as FinancePeriod)}
        >
          {FINANCE_PERIODS.map((p) => (
            <SegmentedControl.Item key={p} value={p}>
              {p}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      )}

      {quote.dayRange && <DayRange quote={quote} currency={currency} locale={locale} />}

      <dl className={styles.tiles}>
        {quote.open !== undefined && (
          <Tile label="Open" value={money(quote.open, currency, locale)} />
        )}
        {quote.previousClose !== undefined && (
          <Tile
            label="Previous close"
            value={money(quote.previousClose, currency, locale)}
            detail={quote.change !== undefined ? words : undefined}
          />
        )}
        {quote.volume !== undefined && (
          <Tile
            label="Volume"
            value={compact(quote.volume, undefined, locale)}
            detail={`${count(quote.volume, locale)} shares`}
          />
        )}
        {quote.marketCap && (
          <Tile
            label="Market cap"
            value={compact(quote.marketCap.value, currency, locale)}
            detail={`× ${compact(quote.marketCap.shares, undefined, locale)} shares${
              quote.marketCap.filed ? `, filed ${monthWords(quote.marketCap.filed, locale)}` : ''
            }`}
          />
        )}
      </dl>

      <footer className={styles.foot}>
        <p className={styles.small}>
          {quote.source}
          {quote.delayed === false ? '' : ' · delayed, not live'} ·{' '}
          {series ? 'daily closes' : 'last session'} · not financial advice
        </p>
        {/* TODO(share): agent C's <CardShare> mounts right here, after the
            small print, as the footer's trailing element. */}
        {share}
      </footer>
    </section>
  );
}

/** Where today's price sits between the day's low and its high. */
export function DayRange({
  quote,
  currency,
  locale,
  label = 'Day range',
}: {
  quote: Quote;
  currency?: string;
  locale?: string;
  /** "Day range"; a coin's is "24-hour range". */
  label?: string;
}) {
  const range = quote.dayRange;
  if (!range) return null;
  const span = range.high - range.low;
  const place = (value: number) =>
    span <= 0 ? 0.5 : Math.min(1, Math.max(0, (value - range.low) / span));
  const previous =
    quote.previousClose !== undefined &&
    quote.previousClose >= range.low &&
    quote.previousClose <= range.high
      ? place(quote.previousClose)
      : undefined;
  return (
    <div className={styles.dayRange}>
      <p className={styles.dayRangeLabel}>
        {label}
        <span className="nc-visually-hidden">
          : {money(range.low, currency, locale)} to {money(range.high, currency, locale)}, now{' '}
          {money(quote.price, currency, locale)}
        </span>
      </p>
      <div className={styles.dayRangeRow} aria-hidden>
        <span className={styles.dayRangeEnd}>{money(range.low, currency, locale)}</span>
        <span
          className={styles.dayRangeTrack}
          style={{ '--to': place(quote.price) } as CSSProperties}
        >
          <span className={styles.dayRangeFill} />
          {previous !== undefined && (
            <span
              className={styles.dayRangePrev}
              style={{ '--at': previous } as CSSProperties}
              title="Previous close"
            />
          )}
          <span
            className={styles.dayRangeNow}
            style={{ '--at': place(quote.price) } as CSSProperties}
          />
        </span>
        <span className={styles.dayRangeEnd}>{money(range.high, currency, locale)}</span>
      </div>
    </div>
  );
}

export function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className={styles.tile}>
      <dt className={styles.tileLabel}>{label}</dt>
      <dd className={styles.tileValue}>
        {value}
        {detail && <span className={styles.tileDetail}>{detail}</span>}
      </dd>
    </div>
  );
}
