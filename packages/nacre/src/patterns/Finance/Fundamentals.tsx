import { Info } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import {
  compact,
  dateWords,
  filedValue,
  filedWords,
  growth,
  margin,
  money,
  percent,
} from './format';
import { Lettermark } from './QuoteCard';
import type { CompanyFigures, FiledFigure, FiledSeries } from './types';
import styles from './Finance.module.css';
import { META_SEP } from '../../components/MetaList';

export interface FundamentalsCardProps {
  companies: CompanyFigures[];
  /** Whose filings these are: "SEC EDGAR". */
  source?: string;
  locale?: string;
  /** TODO(share): the shared card share bar mounts in the footer. */
  share?: ReactNode;
  elementRef?: React.Ref<HTMLElement>;
  className?: string;
}

type Measure = 'revenue' | 'grossProfit' | 'netIncome';

/** The measures the card draws as bars, in the order it draws them. */
const MEASURES: { key: Measure; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'netIncome', label: 'Net income' },
];

/**
 * How a company is doing, out of its own filings — or two to four side by
 * side.
 *
 * Revenue and income are small bars, one per period, with the growth on the
 * last one labelled in words. Margins are meters, and say they were worked out
 * from the two figures above them. Every figure can tell you where it came
 * from: the period it covers, the form it was filed on and the day it was
 * filed, one press away.
 *
 * A company that doesn't file with the regulator says so, plainly, instead of
 * showing numbers from somewhere else.
 */
export function FundamentalsCard({
  companies,
  source = 'SEC EDGAR',
  locale,
  share,
  elementRef,
  className,
}: FundamentalsCardProps) {
  const many = companies.length > 1;
  /**
   * Companies being compared share one scale per measure, so a bigger
   * company's bars really are taller. Each company's own bars would make two
   * very different revenues look alike — a chart that misstates its data.
   */
  const scale: Partial<Record<Measure, Span>> = {};
  for (const { key } of MEASURES) {
    const all = companies.flatMap((c) => c[key]?.points.map((p) => p.value) ?? []);
    if (all.length) scale[key] = spanOf(all);
  }
  const summary = companies
    .map((company) => {
      if (company.unavailable) return `${company.name}: ${company.unavailable}`;
      const revenue = company.revenue?.points.at(-1);
      const income = company.netIncome?.points.at(-1);
      const net = margin(income?.value, revenue?.value);
      return [
        `${company.name} (${company.symbol}),`,
        revenue
          ? `revenue ${compact(revenue.value, company.currency, locale)} in ${revenue.period}${
              revenue.filed ? `, filed ${dateWords(revenue.filed, locale)}` : ''
            }.`
          : 'no revenue filed.',
        income ? `Net income ${compact(income.value, company.currency, locale)}.` : '',
        net !== undefined ? `Net margin ${percent(net, locale, false)}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
    })
    .join(' ');

  return (
    <section
      ref={elementRef}
      aria-label={`${companies.map((c) => c.name).join(' and ')} from filings`}
      className={cx(styles.card, styles.fundamentals, className)}
      data-many={many || undefined}
    >
      <p className="nc-visually-hidden">{summary}</p>

      <header className={styles.compareHead}>
        <h3 className={styles.compareTitle}>
          {companies.map((c) => c.symbol).join(META_SEP)}
          <span className={styles.compareKicker}>
            {companies[0]?.basis === 'quarterly' ? 'by quarter' : 'by financial year'}
          </span>
        </h3>
        <p className={styles.small}>From {source} filings — as filed, nothing worked back.</p>
      </header>

      <div className={styles.columns}>
        {companies.map((company) => (
          <Column
            key={company.symbol}
            company={company}
            locale={locale}
            many={many}
            scale={scale}
          />
        ))}
      </div>

      <footer className={styles.foot}>
        <p className={styles.small}>
          {source} · figures as filed, with the period and filing date on each · not financial
          advice
        </p>
        {/* TODO(share): agent C's <CardShare> mounts right here. */}
        {share}
      </footer>
    </section>
  );
}

function Column({
  company,
  locale,
  many,
  scale,
}: {
  company: CompanyFigures;
  locale?: string;
  many: boolean;
  /** The shared span for each measure, so columns can be read against each other. */
  scale: Partial<Record<Measure, Span>>;
}) {
  const revenue = company.revenue?.points.at(-1);
  const income = company.netIncome?.points.at(-1);
  const gross = company.grossProfit?.points.at(-1);
  const net = margin(income?.value, revenue?.value);
  const grossMargin = margin(gross?.value, revenue?.value);
  const eps = company.eps?.points.at(-1);
  const dividend = company.dividendPerShare?.points.at(-1);

  return (
    <article className={styles.column}>
      <div className={styles.columnHead}>
        <Lettermark symbol={company.symbol} className={styles.columnMark} />
        <div className={styles.who}>
          <h4 className={styles.columnName}>{company.name}</h4>
          <p className={styles.columnSymbol}>
            {company.symbol}
            {company.cik && ` · CIK ${company.cik}`}
          </p>
        </div>
      </div>

      {company.unavailable ? (
        <p className={styles.unavailable}>{company.unavailable}</p>
      ) : (
        <>
          {MEASURES.map(({ key, label }) => {
            const series = company[key];
            return series ? (
              <Bars
                key={key}
                label={label}
                series={series}
                currency={company.currency}
                locale={locale}
                compactBars={many}
                {...(many && scale[key] && { span: scale[key] })}
              />
            ) : null;
          })}

          {(grossMargin !== undefined || net !== undefined) && (
            <div className={styles.margins}>
              {grossMargin !== undefined && (
                <Meter label="Gross margin" value={grossMargin} locale={locale} />
              )}
              {net !== undefined && <Meter label="Net margin" value={net} locale={locale} />}
              <p className={styles.marginNote}>
                Worked out from the revenue and the profit of the same period
                {revenue ? ` (${revenue.period})` : ''}.
              </p>
            </div>
          )}

          <dl className={styles.facts}>
            {eps && (
              <Fact
                label="Earnings per share"
                value={money(eps.value, company.currency, locale, 2)}
                figure={eps}
                tag={company.eps?.tag}
                locale={locale}
              />
            )}
            {company.priceEarnings && (
              <Fact
                label="Price to earnings"
                value={company.priceEarnings.value.toFixed(1)}
                note={`Worked out: a delayed price of ${money(
                  company.priceEarnings.price,
                  company.currency,
                  locale,
                )} divided by ${company.priceEarnings.period} earnings per share.`}
                locale={locale}
              />
            )}
            {dividend && (
              <Fact
                label="Dividend per share"
                value={money(dividend.value, company.currency, locale, 2)}
                figure={dividend}
                tag={company.dividendPerShare?.tag}
                locale={locale}
              />
            )}
            {company.employees && (
              <Fact
                label="Employees"
                value={compact(company.employees.value, undefined, locale)}
                figure={company.employees}
                locale={locale}
              />
            )}
          </dl>
        </>
      )}
    </article>
  );
}

/** One measure per period, as bars on a shared scale, with the last one's growth in words. */
function Bars({
  label,
  series,
  currency,
  locale,
  compactBars,
  span: shared,
}: {
  label: string;
  series: FiledSeries;
  currency?: string;
  locale?: string;
  compactBars?: boolean;
  /** A span shared with the other companies, when several are compared. */
  span?: Span;
}) {
  const points = series.points.slice(compactBars ? -6 : -12);
  const values = points.map((p) => p.value);
  const span = shared ?? spanOf(values);
  const last = points.at(-1);
  const before = points.at(-2);
  const rise = growth(before?.value, last?.value);
  /** A loss that shrinks is income going up; say it the way a reader thinks of it. */
  const bothLosses = (before?.value ?? 0) < 0 && (last?.value ?? 0) < 0;
  return (
    <section className={styles.bars} aria-label={`${label} by period`}>
      <div className={styles.barsHead}>
        <h5 className={styles.barsLabel}>{label}</h5>
        {rise !== undefined && (
          <p className={styles.barsGrowth} data-way={rise >= 0 ? 'up' : 'down'}>
            {bothLosses ? `loss ${rise >= 0 ? 'narrowed' : 'widened'}` : rise >= 0 ? 'up' : 'down'}{' '}
            {percent(Math.abs(rise), locale, false)} on {before?.period}
          </p>
        )}
        {last && (
          <p className={styles.barsValue}>
            {filedValue(last.value, series.unit, currency, locale)}
            <span className={styles.barsPeriod}>{last.period}</span>
          </p>
        )}
      </div>
      <ol
        className={styles.barsList}
        data-negative={span.lo < 0 || undefined}
        style={{ '--zero': span.zero } as CSSProperties}
      >
        {points.map((point) => (
          <li key={`${point.period}-${point.periodEnd ?? ''}`} className={styles.bar}>
            <span className="nc-visually-hidden">
              {point.period}: {filedValue(point.value, series.unit, currency, locale)}
              {point.filed ? `, ${filedWords(point, locale)}` : ''}.
            </span>
            <span
              className={styles.barTrack}
              aria-hidden
              title={[
                `${point.period}: ${filedValue(point.value, series.unit, currency, locale)}`,
                point.filed ? filedWords(point, locale) : undefined,
                series.tag,
              ]
                .filter(Boolean)
                .join(META_SEP)}
            >
              <span
                className={styles.barFill}
                data-way={point.value < 0 ? 'down' : 'up'}
                style={
                  {
                    '--top':
                      point.value < 0 ? span.zero : span.zero - point.value / (span.hi - span.lo),
                    '--h': Math.abs(point.value) / (span.hi - span.lo),
                  } as CSSProperties
                }
              />
            </span>
            <span className={styles.barPeriod} aria-hidden>
              {point.period.replace(/^(?:CY|FY)/, '’').slice(0, 5)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * How wide a bar chart's scale is. Bars always start at zero, so the span
 * includes it: a company that lost money gets a zero line with its bars
 * hanging below it, never a bar that starts somewhere flattering.
 */
interface Span {
  lo: number;
  hi: number;
  /** Where zero sits, as a share from the top. */
  zero: number;
}

function spanOf(values: readonly number[]): Span {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const total = hi - lo || 1;
  return { lo, hi: hi === lo ? hi + 1 : hi, zero: hi / total };
}

/**
 * A margin as a meter, with its percentage in words beside it. A negative
 * margin gets no meter — a bar that can't go backwards would misstate it —
 * only the number and the word for it.
 */
function Meter({ label, value, locale }: { label: string; value: number; locale?: string }) {
  const level = Math.min(1, Math.max(0, value / 60));
  return (
    <div className={styles.meterRow} data-way={value < 0 ? 'down' : 'up'}>
      <span className={styles.meterLabel}>{label}</span>
      {value < 0 ? (
        <span className={styles.meterLoss}>a loss</span>
      ) : (
        <span className={styles.meterTrack} aria-hidden>
          <span className={styles.meterFill} style={{ '--at': level } as CSSProperties} />
        </span>
      )}
      <span className={styles.meterValue}>{percent(value, locale, false)}</span>
    </div>
  );
}

/** One figure, with where it came from one press away. */
function Fact({
  label,
  value,
  figure,
  tag,
  note,
  locale,
}: {
  label: string;
  value: string;
  figure?: FiledFigure;
  tag?: string;
  note?: string;
  locale?: string;
}) {
  const where = note ?? (figure ? filedWords(figure, locale) : undefined);
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>
        {value}
        {figure && <span className={styles.factPeriod}>{figure.period}</span>}
        {where && (
          <Popover.Root>
            <Popover.Trigger
              className={styles.factWhere}
              aria-label={`Where ${label.toLowerCase()} came from`}
            >
              <Info aria-hidden />
            </Popover.Trigger>
            <Popover.Content className={styles.factPanel}>
              <p>{where}</p>
              {tag && <p className={styles.factTag}>{tag}</p>}
            </Popover.Content>
          </Popover.Root>
        )}
      </dd>
    </div>
  );
}
