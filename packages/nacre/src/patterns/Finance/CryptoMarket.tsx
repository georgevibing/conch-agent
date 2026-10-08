import type { CSSProperties, ReactNode } from 'react';

import { Sparkline } from '../../components/LiveChart';
import { cx } from '../../utils/cx';
import { clockWords, compact, count, direction, momentWords, money, percent } from './format';
import { Caret, Lettermark, RollingNumber, Tile } from './QuoteCard';
import type { CryptoMarketData, MarketCoin } from './types';
import styles from './Finance.module.css';

export interface CryptoMarketCardProps {
  market: CryptoMarketData;
  locale?: string;
  /** The card's share bar, in its footer. */
  share?: ReactNode;
  className?: string;
  ref?: React.Ref<HTMLElement>;
}

/** A move in words and a caret, never colour alone: "▲ 1.23%". */
function Move({ value, locale }: { value: number | undefined; locale?: string }) {
  if (value === undefined)
    return (
      <span className={styles.marketMove} aria-hidden>
        —
      </span>
    );
  const way = direction(value);
  return (
    <span className={styles.marketMove} data-way={way} aria-hidden>
      <Caret way={way} />
      {percent(Math.abs(value), locale, false)}
    </span>
  );
}

/**
 * A series as a shape from 0 to 100, so each small chart shows its own swing.
 * A swing of less than 4% of the price is drawn that much smaller, so a
 * stablecoin's hundredths of a cent stay a flat line instead of a mountain.
 */
function shape(values: readonly number[]): number[] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  if (!(span > 0)) return values.map(() => 50);
  const scale = Math.min(1, span / (Math.abs(high) || 1) / 0.04);
  return values.map((v) => 50 + ((v - low) / span - 0.5) * 88 * scale);
}

/** A move, spoken: "down 0.31%". */
const said = (value: number | undefined, locale?: string) =>
  value === undefined
    ? 'not given'
    : direction(value) === 'flat'
      ? 'unchanged'
      : `${direction(value)} ${percent(Math.abs(value), locale, false)}`;

/**
 * How crypto as a whole is doing, as a card in the chat: shown only when
 * someone asks.
 *
 * What every coin CoinGecko tracks is worth together, large, with its move
 * over the day beside it in a word and a caret. Then how much of that whole
 * is bitcoin, ether and everything else, as one bar split in three — each
 * share named and numbered under it, so nothing is told by colour alone. Then
 * the biggest coins as a tidy table: rank, the coin, its week's shape, its
 * price and its day. Every figure is CoinGecko's, averaged across exchanges.
 */
export function CryptoMarketCard({ market, locale, share, className, ref }: CryptoMarketCardProps) {
  const way = direction(market.change24h);
  const btc = market.dominance?.btc;
  const eth = market.dominance?.eth;
  const rest = btc !== undefined ? Math.max(0, 100 - btc - (eth ?? 0)) : undefined;
  const shares = [
    btc !== undefined && { key: 'btc', name: 'Bitcoin', value: btc, tone: 'var(--nc-chart-1)' },
    eth !== undefined && { key: 'eth', name: 'Ether', value: eth, tone: 'var(--nc-chart-2)' },
    rest !== undefined && {
      key: 'rest',
      name: 'Everything else',
      value: rest,
      tone: 'var(--nc-gray-8)',
    },
  ].filter((s): s is { key: string; name: string; value: number; tone: string } => Boolean(s));

  const summary = [
    `The crypto market: every coin CoinGecko tracks is worth ${compact(market.totalMarketCap, market.currency, locale)} together`,
    market.change24h !== undefined ? `, ${said(market.change24h, locale)} in 24 hours.` : '.',
    btc !== undefined
      ? ` Bitcoin is ${percent(btc, locale, false)} of it${eth !== undefined ? `, ether ${percent(eth, locale, false)}` : ''}.`
      : '',
    ` As of ${momentWords(market.asOf, locale)}; averages across exchanges.`,
  ].join('');

  return (
    <section
      ref={ref}
      aria-label="The crypto market"
      className={cx(styles.card, styles.market, className)}
    >
      <p className="nc-visually-hidden">{summary}</p>
      {market.notice && <p className={styles.notice}>{market.notice}.</p>}

      <header className={styles.marketHead}>
        <h3 className={styles.marketTitle}>Crypto market</h3>
        <p className={styles.where} aria-hidden>
          In {market.currency}
        </p>
      </header>

      <div className={styles.hero} aria-hidden>
        <div className={styles.priceRow}>
          <RollingNumber
            className={styles.price}
            value={compact(market.totalMarketCap, market.currency, locale)}
            way={way}
          />
          {market.change24h !== undefined && (
            <span className={styles.move} data-way={way}>
              <Caret way={way} />
              <span className={styles.moveWord}>{way === 'flat' ? 'unchanged' : way}</span>
              <span className={styles.movePercent}>
                {percent(Math.abs(market.change24h), locale, false)}
              </span>
              <span className={styles.moveSince}>in 24h</span>
            </span>
          )}
        </div>
        <p className={styles.when}>
          Every coin together · 24/7 · as of {clockWords(market.asOf, locale)}
        </p>
      </div>

      {shares.length > 0 && (
        <figure className={styles.dominance}>
          <figcaption className={styles.gaugeHead}>
            <span className={styles.gaugeLabel}>Share of the whole</span>
          </figcaption>
          <div className={styles.dominanceBar} aria-hidden>
            {shares.map((s) => (
              <span
                key={s.key}
                className={styles.dominancePart}
                data-part={s.key}
                style={{ '--share': s.value, background: s.tone } as CSSProperties}
              />
            ))}
          </div>
          <ul className={styles.dominanceKey}>
            {shares.map((s) => (
              <li key={s.key}>
                <span
                  className={styles.dominanceSwatch}
                  data-part={s.key}
                  style={{ background: s.tone }}
                  aria-hidden
                />
                <span className={styles.legendName}>{s.name}</span>
                <span className={styles.legendValue}>{percent(s.value, locale, false)}</span>
              </li>
            ))}
          </ul>
        </figure>
      )}

      {(market.volume24h !== undefined || market.coinsTracked !== undefined) && (
        <dl className={styles.tiles}>
          {market.volume24h !== undefined && (
            <Tile
              label="Traded, 24h"
              value={compact(market.volume24h, market.currency, locale)}
              detail="across exchanges"
            />
          )}
          {market.coinsTracked !== undefined && (
            <Tile
              label="Coins tracked"
              value={count(market.coinsTracked, locale)}
              detail="in the total above"
            />
          )}
        </dl>
      )}

      {market.coins.length > 0 && (
        <table className={styles.topCoins}>
          <caption className={styles.topCaption}>The biggest coins</caption>
          <thead className="nc-visually-hidden">
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Coin</th>
              <th scope="col">The last week</th>
              <th scope="col">Price</th>
              <th scope="col">24 hours</th>
            </tr>
          </thead>
          <tbody>
            {market.coins.map((coin) => (
              <CoinRow key={coin.id} coin={coin} currency={market.currency} locale={locale} />
            ))}
          </tbody>
        </table>
      )}

      <footer className={styles.foot}>
        <p className={styles.small}>
          {market.source} · averages across exchanges, not one exchange’s prices · not live · not
          financial advice
        </p>
        {share}
      </footer>
    </section>
  );
}

function CoinRow({
  coin,
  currency,
  locale,
}: {
  coin: MarketCoin;
  currency: string;
  locale?: string;
}) {
  return (
    <tr>
      <td className={styles.topRank}>{coin.rank ?? '—'}</td>
      <th scope="row" className={styles.topCoinCell}>
        <span className={styles.topCoin}>
          <Lettermark symbol={coin.symbol} coin className={styles.topMark} />
          <span className={styles.topName}>{coin.name}</span>
          <span className={styles.topSymbol}>{coin.symbol}</span>
        </span>
      </th>
      <td className={styles.topSpark}>
        {coin.spark && coin.spark.length > 1 ? (
          <>
            <Sparkline values={shape(coin.spark)} max={100} height={20} />
            <span className="nc-visually-hidden">{said(coin.change7d, locale)} over 7 days</span>
          </>
        ) : (
          <span className="nc-visually-hidden">not given</span>
        )}
      </td>
      <td className={styles.topPrice}>{money(coin.price, currency, locale)}</td>
      <td className={styles.topMove}>
        <Move value={coin.change24h} locale={locale} />
        <span className="nc-visually-hidden">, {said(coin.change24h, locale)}</span>
      </td>
    </tr>
  );
}
