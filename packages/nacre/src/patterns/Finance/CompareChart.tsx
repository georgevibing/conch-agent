import { Slider as SliderPrimitive } from 'radix-ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import {
  axisDate,
  dateWords,
  money,
  niceTicks,
  percent,
  percentTick,
  PERIOD_WORDS,
  signed,
} from './format';
import { FINANCE_PERIODS, type FinancePeriod, type PriceSeries } from './types';
import styles from './Finance.module.css';
import { META_SEP } from '../../components/MetaList';

const W = 1000;
const H = 220;
/**
 * Room at the right for the end labels, as a share of the plot: the lines stop
 * short of the edge so each label sits beside its own line's end, never over
 * it. `.compare .scrub` and `.ends` in the CSS hold the same share.
 */
const END_ROOM = 0.09;
/** The series colours, in Nacre's fixed order: never cycled, never by rank. */
const COLOURS = [1, 2, 3, 4].map((n) => `var(--nc-chart-${n})`);

export interface CompareChartProps {
  /** Two to four instruments, each with the same range. */
  series: PriceSeries[];
  /** A name per series, in the same order; the symbol by default. */
  names?: (string | undefined)[];
  locale?: string;
  period?: FinancePeriod;
  onPeriodChange?: (period: FinancePeriod) => void;
  loading?: boolean;
  /** TODO(share): the shared card share bar mounts in the footer. */
  share?: ReactNode;
  elementRef?: React.Ref<HTMLElement>;
  className?: string;
}

/** One series as the chart holds it: normalised, so two prices can share one axis. */
interface Drawn {
  series: PriceSeries;
  name: string;
  colour: string;
  /** Percent from the range's start, one per date on the shared axis. */
  shifts: (number | null)[];
  start?: number;
  end?: number;
  total?: number;
}

/**
 * Two to four instruments on one axis, each **normalised to the percentage it
 * has moved since the range's start** — so a £5 share and a £500 share can be
 * read against each other without a second y-axis, which would invent a
 * relationship the data hasn't got.
 *
 * Each line is labelled at its own end, so identity never depends on matching
 * a colour to a legend. Dragging, hovering or arrowing through it puts a
 * crosshair on the shared dates and reads every series at that day. Under it,
 * a table: where each started, where it ended, how far it moved, and which
 * did best and worst — in words.
 */
export function CompareChart({
  series,
  names,
  locale,
  period,
  onPeriodChange,
  loading,
  share,
  elementRef,
  className,
}: CompareChartProps) {
  const range = period ?? series[0]?.period ?? '1M';
  const [at, setAt] = useState<number | undefined>(undefined);
  const pressing = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  const { dates, drawn, lo, hi } = useMemo(() => {
    // One shared axis of dates: every date any series closed on.
    const all = [...new Set(series.flatMap((s) => s.dates))].sort();
    const kept = series.slice(0, 4).map((s, k): Drawn => {
      const by = new Map(s.dates.map((date, i) => [date, s.closes[i]]));
      const base = s.closes[0];
      let held: number | undefined;
      const shifts = all.map((date) => {
        const close = by.get(date) ?? held;
        held = close;
        if (close === undefined || base === undefined || base === 0) return null;
        return ((close - base) / base) * 100;
      });
      return {
        series: s,
        name: names?.[k] ?? s.symbol,
        colour: COLOURS[k] ?? COLOURS[0] ?? 'var(--nc-chart-1)',
        shifts,
        start: base,
        end: s.closes.at(-1),
        total: shifts.at(-1) ?? undefined,
      };
    });
    const values = kept.flatMap((d) => d.shifts.filter((v): v is number => v !== null));
    const low = values.length ? Math.min(0, ...values) : 0;
    const high = values.length ? Math.max(0, ...values) : 1;
    const pad = Math.max(1, (high - low) * 0.12);
    return { dates: all, drawn: kept, lo: low - pad, hi: high + pad };
  }, [series, names]);

  const n = dates.length;
  const span = hi - lo || 1;
  const ticks = niceTicks(lo, hi, 3);
  const yOf = (value: number) => ((hi - value) / span) * H;
  const plotted = W * (1 - END_ROOM);
  const xOf = (i: number) => (n <= 1 ? plotted / 2 : (i / (n - 1)) * plotted);
  const index = at === undefined ? n - 1 : Math.min(n - 1, Math.max(0, at));
  /** Where a point sits across the plot, for the overlays drawn in HTML. */
  const pct = (i: number) => `${(n <= 1 ? 0.5 : i / (n - 1)) * (1 - END_ROOM) * 100}%`;
  const away = at !== undefined && at !== n - 1;
  const best = drawn.reduce<Drawn | undefined>(
    (top, d) => (d.total !== undefined && (!top || (top.total ?? -Infinity) < d.total) ? d : top),
    undefined,
  );
  const worst = drawn.reduce<Drawn | undefined>(
    (low, d) => (d.total !== undefined && (!low || (low.total ?? Infinity) > d.total) ? d : low),
    undefined,
  );

  const say = (i: number) => {
    const day = dates[i];
    if (!day) return 'Comparison';
    const each = drawn
      .map((d) => {
        const shift = d.shifts[i];
        return `${d.name} ${shift === null || shift === undefined ? 'no close' : percent(shift, locale)}`;
      })
      .join(', ');
    return `${dateWords(day, locale, true)}: ${each}`;
  };

  const summary = drawn
    .map(
      (d) =>
        `${d.name} went from ${money(d.start ?? 0, d.series.currency, locale)} to ${money(
          d.end ?? 0,
          d.series.currency,
          locale,
        )}, ${d.total === undefined ? 'unchanged' : percent(d.total, locale)} over ${PERIOD_WORDS[range]}.`,
    )
    .join(' ');

  return (
    <section
      ref={elementRef}
      aria-label={`${drawn.map((d) => d.name).join(' and ')} compared`}
      className={cx(styles.card, styles.compare, className)}
    >
      <header className={styles.compareHead}>
        <h3 className={styles.compareTitle}>{drawn.map((d) => d.series.symbol).join(META_SEP)}</h3>
        <p className={styles.small}>
          Each line is how far it has moved since {dateWords(dates[0] ?? '', locale)} — percentages,
          not prices, so they share one scale.
        </p>
      </header>

      <figure className={styles.chart} data-loading={loading || undefined}>
        <figcaption className="nc-visually-hidden">
          {summary}{' '}
          {best && worst && best !== worst ? `${best.name} did best and ${worst.name} worst.` : ''}
        </figcaption>

        {/* A legend is always present for two or more series, beside the end labels. */}
        <ul className={styles.legend}>
          {drawn.map((d) => (
            <li key={d.series.symbol}>
              <span className={styles.legendKey} style={{ background: d.colour }} aria-hidden />
              <span className={styles.legendName}>{d.name}</span>
              <span className={styles.legendValue}>
                {(() => {
                  const shift = away ? d.shifts[index] : d.total;
                  return shift === null || shift === undefined ? '—' : percent(shift, locale);
                })()}
              </span>
            </li>
          ))}
        </ul>

        <div className={styles.plot} style={{ '--pc-h': '200px' } as CSSProperties}>
          <div className={styles.yAxis} aria-hidden>
            {ticks.map((value) => (
              <span
                key={value}
                className={styles.yTick}
                style={{ '--y': yOf(value) / H } as CSSProperties}
              >
                {percentTick(value, locale)}
              </span>
            ))}
          </div>
          <div className={styles.plotArea}>
            <svg
              className={styles.plotSvg}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden
              focusable="false"
            >
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  className={styles.grid}
                  x1={0}
                  x2={plotted}
                  y1={H * f}
                  y2={H * f}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Zero is where everything started: the one line that means something. */}
              <line
                className={styles.zero}
                x1={0}
                x2={plotted}
                y1={yOf(0)}
                y2={yOf(0)}
                vectorEffect="non-scaling-stroke"
              />
              {drawn.map((d) => (
                <path
                  key={`${d.series.symbol}-${range}`}
                  className={styles.line}
                  style={{ stroke: d.colour }}
                  pathLength={1}
                  vectorEffect="non-scaling-stroke"
                  d={pathOf(d.shifts, xOf, yOf)}
                />
              ))}
            </svg>

            {/* End labels: identity on the line itself, never colour-matching alone. */}
            <div className={styles.ends} aria-hidden>
              {spread(
                drawn.map((d) => ({
                  key: d.series.symbol,
                  y: d.shifts.at(-1) === null ? 0.5 : yOf(d.shifts.at(-1) ?? 0) / H,
                  colour: d.colour,
                  label: d.series.symbol,
                })),
              ).map((item) => (
                <span
                  key={item.key}
                  className={styles.end}
                  style={{ '--y': item.y } as CSSProperties}
                >
                  <span className={styles.endKey} style={{ background: item.colour }} />
                  {item.label}
                </span>
              ))}
            </div>

            {away && (
              <span
                className={styles.cross}
                data-away
                style={{ '--x': pct(index) } as CSSProperties}
                aria-hidden
              >
                <span className={styles.crossLine} />
              </span>
            )}
            {drawn.map((d) => {
              const shift = d.shifts[index];
              return shift === null || shift === undefined ? null : (
                <span
                  key={`${d.series.symbol}-dot`}
                  className={styles.endDot}
                  style={
                    {
                      '--x': pct(index),
                      '--y': yOf(shift) / H,
                      background: d.colour,
                    } as CSSProperties
                  }
                  aria-hidden
                />
              );
            })}

            {n > 1 && (
              <SliderPrimitive.Root
                className={styles.scrub}
                min={0}
                max={n - 1}
                step={1}
                value={[index]}
                onValueChange={([next = n - 1]) => {
                  clearTimeout(settle.current);
                  setAt(next);
                }}
                onPointerDown={() => {
                  pressing.current = true;
                  clearTimeout(settle.current);
                }}
                onPointerMove={(event: PointerEvent<HTMLElement>) => {
                  if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  if (!box.width) return;
                  const f = (event.clientX - box.left) / box.width;
                  const next = Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))));
                  if (next !== index) setAt(next);
                }}
                onPointerLeave={(event: PointerEvent<HTMLElement>) => {
                  if (event.pointerType === 'mouse' && event.buttons === 0) setAt(undefined);
                }}
                onPointerUp={(event: PointerEvent<HTMLElement>) => {
                  if (!pressing.current) return;
                  pressing.current = false;
                  if (event.pointerType === 'mouse') return;
                  clearTimeout(settle.current);
                  settle.current = setTimeout(() => setAt(undefined), 900);
                }}
              >
                <SliderPrimitive.Track className={styles.scrubTrack} />
                <SliderPrimitive.Thumb
                  className={styles.scrubThumb}
                  aria-label="Compare day by day"
                  aria-valuetext={say(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && away) {
                      event.stopPropagation();
                      setAt(undefined);
                    }
                  }}
                  onBlur={() => {
                    if (!pressing.current) setAt(undefined);
                  }}
                />
              </SliderPrimitive.Root>
            )}
          </div>
        </div>

        <div className={styles.xAxis} aria-hidden>
          <span>{dates[0] ? axisDate(dates[0], range, locale) : ''}</span>
          {away && dates[index] && (
            <span className={styles.xAt}>{dateWords(dates[index] ?? '', locale)}</span>
          )}
          <span>{dates.at(-1) ? axisDate(dates.at(-1) ?? '', range, locale) : ''}</span>
        </div>
      </figure>

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

      <table className={styles.table}>
        <caption className="nc-visually-hidden">Each instrument over {PERIOD_WORDS[range]}</caption>
        <thead>
          <tr>
            <th scope="col">Instrument</th>
            <th scope="col">Start</th>
            <th scope="col">Latest</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {drawn.map((d) => (
            <tr key={d.series.symbol}>
              <th scope="row">
                <span className={styles.legendKey} style={{ background: d.colour }} aria-hidden />
                {d.series.symbol}
                {best && worst && best !== worst && (d === best || d === worst) && (
                  <span className={styles.tableNote}>{d === best ? 'best' : 'worst'}</span>
                )}
              </th>
              <td>{money(d.start ?? 0, d.series.currency, locale)}</td>
              <td>{money(d.end ?? 0, d.series.currency, locale)}</td>
              <td>
                {d.total === undefined
                  ? '—'
                  : `${percent(d.total, locale)} (${signed((d.end ?? 0) - (d.start ?? 0), locale)})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className={styles.foot}>
        <p className={styles.small}>
          {[...new Set(series.map((s) => s.source))].join(META_SEP)} · delayed, not live · not
          financial advice
        </p>
        {/* TODO(share): agent C's <CardShare> mounts right here. */}
        {share}
      </footer>
    </section>
  );
}

/** A line through the shifts, broken where a series had no close. */
function pathOf(
  shifts: readonly (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
): string {
  let d = '';
  let open = false;
  shifts.forEach((value, i) => {
    if (value === null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${xOf(i).toFixed(2)},${yOf(value).toFixed(2)}`;
    open = true;
  });
  return d;
}

/**
 * End labels nudged apart only as far as they must be, so each stays on its
 * own line. Past four series they'd detach from their lines, which is why the
 * chart takes at most four.
 */
function spread<T extends { key: string; y: number }>(items: T[]): T[] {
  const gap = 0.1;
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const above = sorted[i - 1];
    const here = sorted[i];
    if (above && here && here.y - above.y < gap) here.y = Math.min(1, above.y + gap);
  }
  return sorted;
}
