import { useId, useState, type CSSProperties, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import {
  clockWords,
  coinCount,
  compact,
  dateWords,
  direction,
  momentWords,
  money,
  percent,
  share,
  signed,
} from './format';
import { PriceChart } from './PriceChart';
import { Caret, DayRange, Lettermark, RollingNumber, Tile } from './QuoteCard';
import {
  COIN_CHANGES,
  type CoinChange,
  type CoinExtreme,
  type CryptoDetails,
  type FinancePeriod,
  type PriceSeries,
  type Quote,
} from './types';
import styles from './Finance.module.css';

/** The range each change chip draws. The last hour is the end of the day's chart. */
const CHIP_PERIOD: Record<CoinChange, FinancePeriod> = {
  '1h': '1D',
  '24h': '1D',
  '7d': '1W',
  '30d': '1M',
  '1y': '1Y',
};

/** "the last 30 days", for the chart's caption. */
const CHIP_WORDS: Record<CoinChange, string> = {
  '1h': 'the last hour',
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '1y': 'the last year',
};

/** "in 30 days", beside the move. */
const CHIP_SINCE: Record<CoinChange, string> = {
  '1h': 'in an hour',
  '24h': 'in 24h',
  '7d': 'in 7 days',
  '30d': 'in 30 days',
  '1y': 'in a year',
};

/** The chip a range starts on, when one draws it. */
const chipFor = (period: FinancePeriod | undefined): CoinChange | undefined =>
  period === '1D'
    ? '24h'
    : period === '1W'
      ? '7d'
      : period === '1M'
        ? '30d'
        : period === '1Y'
          ? '1y'
          : undefined;

/** The last hour of a day's chart, when it has the instants to find it by. */
function lastHour(series: PriceSeries): PriceSeries {
  const times = series.times;
  const end = times?.at(-1);
  if (!times || !end) return series;
  const from = Date.parse(end) - 3_600_000;
  const start = times.findIndex((t) => Date.parse(t) >= from);
  if (start < 0 || series.closes.length - start < 3) return series;
  return {
    ...series,
    dates: series.dates.slice(start),
    closes: series.closes.slice(start),
    times: times.slice(start),
  };
}

/** "1st", "2nd", "23rd": a rank, spoken. */
function ordinal(n: number, locale?: string): string {
  const rule = new Intl.PluralRules(locale ?? 'en', { type: 'ordinal' }).select(n);
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th', zero: 'th', many: 'th' }[rule];
  return `${n.toLocaleString(locale)}${suffix}`;
}

export interface CoinCardProps {
  /** A coin's quote, with CoinGecko's details beside it. */
  quote: Quote & { crypto: CryptoDetails };
  series?: PriceSeries;
  locale?: string;
  /** The range the chart draws. Left out, the series' own. */
  period?: FinancePeriod;
  /** A change chip was pressed: fetch its range and hand back a new series. */
  onPeriodChange?: (period: FinancePeriod) => void;
  /** A new range is on its way: the chart holds this one, a shade quieter. */
  loading?: boolean;
  /** The card's share bar, in its footer. */
  share?: ReactNode;
  elementRef?: React.Ref<HTMLElement>;
  className?: string;
  /** The shelf of other instruments, when there is one. */
  children?: ReactNode;
}

/**
 * A coin, as a card in the chat: one of the finance family, with its own
 * character.
 *
 * The lettermark is round, in the coin's own hue, and its rank sits beside
 * it. A coin never closes, so the clock line says "24/7 · as of 21:04". The
 * moves over an hour, a day, a week, a month and a year are chips, and a
 * chip is also the range: pressing 7d draws the week. Under the chart, what
 * the whole coin is worth beside what it would be if every coin that can
 * exist did, how much of it exists (or that there is no maximum, in words),
 * and how far it is from its all-time high.
 *
 * Every figure is CoinGecko's: an average across exchanges, never one
 * exchange's price, and never live. The footer says so every time.
 */
export function CoinCard({
  quote,
  series,
  locale,
  period,
  onPeriodChange,
  loading,
  share: shareBar,
  elementRef,
  className,
  children,
}: CoinCardProps) {
  const crypto = quote.crypto;
  const range = period ?? series?.period ?? '1M';
  const [chip, setChip] = useState<CoinChange | undefined>(() => chipFor(range));
  const [at, setAt] = useState<number | undefined>(undefined);
  const id = useId();
  const currency = quote.currency ?? series?.currency;
  // The last hour is drawn from the day's chart, once it's here.
  const drawn = series && chip === '1h' && series.period === '1D' ? lastHour(series) : series;

  const scrubbed = at !== undefined && drawn ? drawn.closes[at] : undefined;
  const start = drawn?.closes[0];
  const chipMove = chip ? crypto.changes?.[chip] : undefined;
  const move: { percent?: number; change?: number; since: string } =
    scrubbed !== undefined && start !== undefined && start !== 0
      ? {
          percent: ((scrubbed - start) / start) * 100,
          change: scrubbed - start,
          since: 'since the start of the chart',
        }
      : chipMove !== undefined && chip
        ? { percent: chipMove, change: undefined, since: CHIP_SINCE[chip] }
        : {
            percent: quote.changePercent,
            change: quote.change,
            since: quote.changePercent === undefined ? '' : 'in 24h',
          };
  const way = direction(move.percent ?? move.change);
  const showing = scrubbed ?? quote.price;
  const name = quote.name ?? quote.symbol;
  const rank = crypto.rank;

  const pick = (next: string) => {
    const c = next as CoinChange;
    setChip(c);
    setAt(undefined);
    onPeriodChange?.(CHIP_PERIOD[c]);
  };

  const summary = [
    `${name} (${quote.symbol})${rank ? `, ${ordinal(rank, locale)} by market value` : ''}:`,
    `${money(quote.price, currency, locale)},`,
    quote.changePercent !== undefined
      ? `${direction(quote.changePercent) === 'flat' ? 'unchanged' : `${direction(quote.changePercent)} ${percent(Math.abs(quote.changePercent), locale, false)}`} in 24 hours.`
      : '',
    `Trades 24/7; as of ${momentWords(quote.asOf, locale)}.`,
    crypto.marketCap !== undefined
      ? `Market value ${compact(crypto.marketCap, currency, locale)}.`
      : '',
    supplyWords(crypto.supply, quote.symbol, locale),
    crypto.ath ? `${highWords(crypto.ath, quote.price, currency, locale)}.` : '',
    `${crypto.source}’s average across exchanges, not one exchange’s price.`,
  ]
    .filter(Boolean)
    .join(' ');

  const alternatives = crypto.alternatives ?? [];
  const facts = [
    crypto.genesis ? `Since ${dateWords(crypto.genesis, locale)}` : undefined,
    crypto.algorithm,
    ...(crypto.categories ?? []).slice(0, 2),
  ].filter((f): f is string => Boolean(f));

  return (
    <section
      ref={elementRef}
      aria-label={`${name} price`}
      className={cx(styles.card, styles.coin, className)}
    >
      <p className="nc-visually-hidden">{summary}</p>
      {children}
      {quote.notice && <p className={styles.notice}>{quote.notice}.</p>}

      <header className={styles.head}>
        <Lettermark symbol={quote.symbol} coin />
        <div className={styles.who}>
          <h3 className={styles.symbol}>{quote.symbol}</h3>
          <p className={styles.name}>{name}</p>
        </div>
        {rank !== undefined && (
          <p className={styles.rank} aria-hidden title="By market value">
            <span className={styles.rankHash}>#</span>
            {rank.toLocaleString(locale)}
          </p>
        )}
      </header>

      {alternatives.length > 0 && (
        <p className={styles.alternatives}>
          Also “{quote.symbol}”:{' '}
          {alternatives
            .map((a) => `${a.name}${a.rank ? ` (#${a.rank.toLocaleString(locale)})` : ''}`)
            .join(', ')}
          . This is the one worth the most.
        </p>
      )}

      <div className={styles.hero} aria-hidden>
        <div className={styles.priceRow}>
          <RollingNumber
            className={styles.price}
            value={money(showing, currency, locale)}
            way={way}
          />
          {move.percent !== undefined && (
            <span className={styles.move} data-way={way}>
              <Caret way={way} />
              <span className={styles.moveWord}>{way === 'flat' ? 'unchanged' : way}</span>
              <span className={styles.movePercent}>
                {percent(Math.abs(move.percent), locale, false)}
              </span>
              {/* An amount gives way on a phone; the stretch it's over never does. */}
              {move.change !== undefined ? (
                <span className={styles.moveAmount}>{signed(move.change, locale)}</span>
              ) : (
                <span className={styles.moveSince}>{move.since}</span>
              )}
            </span>
          )}
        </div>
        <p className={styles.when}>
          {at !== undefined && drawn
            ? `${drawn.times?.[at] ? momentWords(drawn.times[at] ?? '', locale) : dateWords(drawn.dates[at] ?? '', locale, true)} · ${move.since}`
            : `24/7 · as of ${clockWords(quote.asOf, locale)} · an average across exchanges`}
        </p>
      </div>

      {drawn && drawn.closes.length > 1 && (
        <PriceChart
          series={drawn}
          label={`${name}, prices over ${chip ? CHIP_WORDS[chip] : 'the range'}`}
          currency={currency}
          locale={locale}
          at={at}
          onAt={setAt}
          loading={loading}
        />
      )}

      {crypto.changes && (
        <Changes
          changes={crypto.changes}
          value={chip}
          onPick={onPeriodChange ? pick : undefined}
          locale={locale}
        />
      )}

      <dl className={styles.tiles}>
        {crypto.marketCap !== undefined && (
          <Tile
            label="Market value"
            value={compact(crypto.marketCap, currency, locale)}
            detail={
              crypto.supply?.circulating !== undefined ? 'of the coins in circulation' : undefined
            }
          />
        )}
        {crypto.fullyDiluted !== undefined ? (
          <Tile
            label="Fully diluted"
            value={compact(crypto.fullyDiluted, currency, locale)}
            detail={
              crypto.supply?.max !== undefined
                ? `if all ${coinCount(crypto.supply.max, locale)} existed`
                : 'if every coin made so far circulated'
            }
          />
        ) : crypto.supply?.unlimited ? (
          <Tile label="Fully diluted" value="—" detail="no maximum, so none worked out" />
        ) : null}
        {crypto.volume24h !== undefined && (
          <Tile
            label="Traded, 24h"
            value={compact(crypto.volume24h, currency, locale)}
            detail="across exchanges"
          />
        )}
      </dl>

      {quote.dayRange && (
        <DayRange quote={quote} currency={currency} locale={locale} label="24-hour range" />
      )}

      {(crypto.supply || crypto.ath) && (
        <div className={styles.gauges}>
          {crypto.supply && <Supply supply={crypto.supply} symbol={quote.symbol} locale={locale} />}
          {crypto.ath && (
            <AllTimeHigh
              ath={crypto.ath}
              atl={crypto.atl}
              price={quote.price}
              currency={currency}
              locale={locale}
            />
          )}
        </div>
      )}

      {(crypto.about || facts.length > 0) && (
        <About id={id} name={name} about={crypto.about} facts={facts} />
      )}

      <footer className={styles.foot}>
        <p className={styles.small}>
          {quote.source} · an average across exchanges, not one exchange’s price · not live · not
          financial advice
        </p>
        {shareBar}
      </footer>
    </section>
  );
}

/**
 * The moves over an hour to a year, as chips. With a way to fetch a range,
 * they're the range switch too (one segmented control, so arrows move along
 * it); without one, a quiet row of facts.
 */
function Changes({
  changes,
  value,
  onPick,
  locale,
}: {
  changes: NonNullable<CryptoDetails['changes']>;
  value: CoinChange | undefined;
  onPick?: (chip: string) => void;
  locale?: string;
}) {
  const spoken: Record<CoinChange, string> = {
    '1h': 'Last hour',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '1y': 'Last year',
  };
  const inside = (c: CoinChange) => {
    const v = changes[c];
    const way = direction(v);
    return (
      <span className={styles.change}>
        <span className={styles.changeLabel}>{c}</span>
        <span className={styles.changeValue} data-way={v === undefined ? undefined : way}>
          {v === undefined ? (
            '—'
          ) : (
            <>
              <Caret way={way} />
              {percent(Math.abs(v), locale, false)}
            </>
          )}
        </span>
      </span>
    );
  };
  const words = (c: CoinChange) => {
    const v = changes[c];
    return `${spoken[c]}: ${
      v === undefined
        ? 'not given'
        : direction(v) === 'flat'
          ? 'unchanged'
          : `${direction(v)} ${percent(Math.abs(v), locale, false)}`
    }`;
  };
  if (!onPick)
    return (
      <ul className={styles.changes} aria-label="Moves">
        {COIN_CHANGES.map((c) => (
          <li key={c} className={styles.changeStatic} aria-label={words(c)}>
            {inside(c)}
          </li>
        ))}
      </ul>
    );
  return (
    <SegmentedControl
      size="md"
      block
      aria-label="Moves, and the range the chart draws"
      className={styles.changeSwitch}
      value={value ?? ''}
      onValueChange={onPick}
    >
      {COIN_CHANGES.map((c) => (
        <SegmentedControl.Item key={c} value={c} aria-label={words(c)}>
          {inside(c)}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl>
  );
}

/** How much of a coin exists, said in words, and when there's no maximum, said so. */
function supplyWords(supply: CryptoDetails['supply'], symbol: string, locale?: string): string {
  if (!supply) return '';
  const { circulating, total, max, unlimited } = supply;
  const out =
    circulating !== undefined ? `${coinCount(circulating, locale)} ${symbol} in circulation` : '';
  if (max !== undefined)
    return `${out || 'Supply'}${out ? ',' : ':'} of at most ${coinCount(max, locale)} that can ever exist.`;
  if (unlimited) return `${out ? `${out}. ` : ''}No maximum: new coins keep being made.`;
  if (total !== undefined && out) return `${out}, of ${coinCount(total, locale)} made so far.`;
  return out ? `${out}.` : '';
}

/** A coin's supply as a meter: of its maximum, or of what's been made when there's none. */
function Supply({
  supply,
  symbol,
  locale,
}: {
  supply: NonNullable<CryptoDetails['supply']>;
  symbol: string;
  locale?: string;
}) {
  const { circulating, total, max, unlimited } = supply;
  const whole = max ?? total;
  const ratio =
    circulating !== undefined && whole !== undefined && whole > 0
      ? Math.min(1, circulating / whole)
      : undefined;
  if (circulating === undefined && whole === undefined) return null;
  const headline =
    ratio === undefined
      ? unlimited
        ? 'No maximum'
        : ''
      : max !== undefined
        ? `${share(ratio * 100, locale)} of the maximum`
        : `${share(ratio * 100, locale)} of what exists`;
  return (
    <div className={styles.gauge} data-open={(unlimited && max === undefined) || undefined}>
      <p className={styles.gaugeHead}>
        <span className={styles.gaugeLabel}>Supply</span>
        {headline && <span className={styles.gaugeValue}>{headline}</span>}
      </p>
      {ratio !== undefined && (
        <span className={styles.gaugeTrack} style={{ '--at': ratio } as CSSProperties} aria-hidden>
          <span className={styles.gaugeFill} />
        </span>
      )}
      <p className={styles.gaugeWords}>{supplyWords(supply, symbol, locale)}</p>
    </div>
  );
}

/** "38% below its high of $109,000, 21 Jan 2025". */
function highWords(
  ath: CoinExtreme,
  price: number,
  currency: string | undefined,
  locale?: string,
): string {
  const from = ath.fromPercent ?? ((price - ath.price) / ath.price) * 100;
  const high = `${money(ath.price, currency, locale)}, ${dateWords(ath.date, locale)}`;
  return from >= -0.05
    ? `At its all-time high of ${high}`
    : `${share(-from, locale)} below its high of ${high}`;
}

/** How far the price is from the coin's all-time high: a track from nothing to that high. */
function AllTimeHigh({
  ath,
  atl,
  price,
  currency,
  locale,
}: {
  ath: CoinExtreme;
  atl?: CoinExtreme;
  price: number;
  currency?: string;
  locale?: string;
}) {
  const ratio = ath.price > 0 ? Math.min(1, Math.max(0, price / ath.price)) : 0;
  const from = ath.fromPercent ?? ((price - ath.price) / ath.price) * 100;
  return (
    <div className={styles.gauge}>
      <p className={styles.gaugeHead}>
        <span className={styles.gaugeLabel}>All-time high</span>
        <span className={styles.gaugeValue} data-way={from >= -0.05 ? 'up' : undefined}>
          {from >= -0.05 ? 'At its high' : `${share(-from, locale)} below`}
        </span>
      </p>
      <span
        className={cx(styles.gaugeTrack, styles.highTrack)}
        style={{ '--at': ratio } as CSSProperties}
        aria-hidden
      >
        <span className={styles.gaugeFill} />
        <span className={styles.highMark} />
      </span>
      <p className={styles.gaugeWords}>
        {highWords(ath, price, currency, locale)}.
        {atl && (
          <span className={styles.gaugeAside}>
            {' '}
            Lowest {money(atl.price, currency, locale)}, {dateWords(atl.date, locale)}.
          </span>
        )}
      </p>
    </div>
  );
}

/** What the coin is: its own description, clipped, and a few facts. */
function About({
  id,
  name,
  about,
  facts,
}: {
  id: string;
  name: string;
  about?: string;
  facts: string[];
}) {
  const [open, setOpen] = useState(false);
  const long = (about?.length ?? 0) > 160;
  return (
    <div className={styles.about}>
      <h4 className={styles.aboutHead}>About {name}</h4>
      {about && (
        <p id={`${id}-about`} className={styles.aboutText} data-open={open || !long || undefined}>
          {about}
        </p>
      )}
      {(facts.length > 0 || long) && (
        <div className={styles.aboutFoot}>
          {facts.length > 0 && (
            <ul className={styles.aboutFacts}>
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {long && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.aboutMore}
              aria-expanded={open}
              aria-controls={`${id}-about`}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Less' : 'More'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
