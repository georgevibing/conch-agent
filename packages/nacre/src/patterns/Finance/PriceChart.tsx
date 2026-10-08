import { Slider as SliderPrimitive } from 'radix-ui';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';

import {
  axisDate,
  axisMoment,
  dateWords,
  momentWords,
  money,
  niceBounds,
  niceTicks,
  percent,
  signed,
} from './format';
import type { PriceSeries } from './types';
import styles from './Finance.module.css';

/** The plot's own box; the SVG stretches to the card, strokes don't. */
const W = 1000;
const H = 200;

export interface PriceChartProps {
  series: PriceSeries;
  /** What it is, for the figure's caption and the summary: "Apple, daily closes". */
  label: string;
  currency?: string;
  locale?: string;
  /** The point being read, oldest-first index. Left out, the latest. */
  at?: number;
  /** Someone scrubbed to a point, or let go (`undefined`). */
  onAt?: (index: number | undefined) => void;
  /** The line's colour. One series, so it never changes with the value. */
  color?: string;
  /** New data is on its way: hold this render, a shade quieter. */
  loading?: boolean;
  /** Drawn under the plot, beside the dates. */
  footer?: ReactNode;
  /** Plot height in pixels. */
  height?: number;
}

/** Roughly this many y-axis labels; round numbers, so they read at a glance. */
const TICKS = 3;

/**
 * A price over time: a 2 px line over a wash of its own colour, drawn in from
 * the left on arrival, with a crosshair that snaps to the nearest close.
 *
 * It is a slider, so every way of reading it is the same: drag with a finger,
 * pass over it with a mouse, or use the arrow keys (Home and End for the ends,
 * Escape to let go). Each point says its date, its price and how far it is
 * from the range's start, in words, so nothing needs hovering to be read.
 */
export function PriceChart({
  series,
  label,
  currency,
  locale,
  at,
  onAt,
  color = 'var(--nc-chart-1)',
  loading,
  footer,
  height = 152,
}: PriceChartProps) {
  const id = `pc-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const n = series.closes.length;
  const geometry = useMemo(() => {
    const { lo, hi } = niceBounds(series.closes);
    const span = hi - lo || 1;
    const yOf = (value: number) => ((hi - value) / span) * H;
    const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
    const line = series.closes
      .map((value, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(2)},${yOf(value).toFixed(2)}`)
      .join('');
    const area = n > 1 ? `${line}L${W},${H}L0,${H}Z` : '';
    const ticks = niceTicks(lo, hi, TICKS);
    return { lo, hi, yOf, xOf, line, area, ticks };
  }, [series.closes, n]);

  const index = at === undefined ? n - 1 : Math.min(n - 1, Math.max(0, at));
  const first = series.closes[0];
  const value = series.closes[index];
  const date = series.dates[index];
  const pressing = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  const indexAt = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || n < 2) return 0;
    const f = (event.clientX - box.left) / box.width;
    return Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))));
  };

  /** A point's moment in words: its time when the chart has times (a coin's day), else its date. */
  const when = (i: number, long = false) => {
    const instant = series.times?.[i];
    return instant ? momentWords(instant, locale) : dateWords(series.dates[i] ?? '', locale, long);
  };
  const axis = (i: number) => {
    const instant = series.times?.[i];
    return instant
      ? axisMoment(instant, series.period, locale)
      : axisDate(series.dates[i] ?? '', series.period, locale);
  };

  const say = (i: number) => {
    const point = series.closes[i];
    const day = series.dates[i];
    if (point === undefined || day === undefined) return label;
    const from =
      first !== undefined && first !== 0
        ? `, ${percent(((point - first) / first) * 100, locale)} from the start of the range`
        : '';
    return `${when(i, true)}: ${money(point, currency, locale)}${from}`;
  };

  const last = series.closes.at(-1);
  const high = n ? Math.max(...series.closes) : undefined;
  const low = n ? Math.min(...series.closes) : undefined;
  const summary =
    first !== undefined && last !== undefined && series.dates[0]
      ? `${label}. ${money(first, currency, locale)} on ${when(0, true)} to ${money(last, currency, locale)} on ${when(n - 1, true)}, ${
          first === 0 ? 'unchanged' : percent(((last - first) / first) * 100, locale)
        } over the range. Highest ${money(high ?? last, currency, locale)}, lowest ${money(low ?? last, currency, locale)}. ${series.source}.`
      : `${label}. No closes to draw.`;

  const pct = (i: number) => `${(n <= 1 ? 0.5 : i / (n - 1)) * 100}%`;
  const onX = index === n - 1;
  const away = at !== undefined && at !== n - 1;

  return (
    <figure className={styles.chart} data-loading={loading || undefined}>
      <figcaption className="nc-visually-hidden">{summary}</figcaption>
      <div className={styles.plot} style={{ '--pc-h': `${height}px` } as CSSProperties}>
        {/* The axis keeps its own gutter, so a price label never sits under the line. */}
        <div className={styles.yAxis} aria-hidden>
          {geometry.ticks.map((tick) => (
            <span
              key={tick}
              className={styles.yTick}
              style={{ '--y': geometry.yOf(tick) / H } as CSSProperties}
            >
              {money(tick, currency, locale, tick >= 10_000 ? 0 : 2)}
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
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {geometry.ticks.map((tick) => (
              <line
                key={tick}
                className={styles.grid}
                x1={0}
                x2={W}
                y1={geometry.yOf(tick)}
                y2={geometry.yOf(tick)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {geometry.area && (
              <path
                key={`${series.symbol}-${series.period}-a`}
                className={styles.area}
                d={geometry.area}
                fill={`url(#${id}-fill)`}
              />
            )}
            <path
              key={`${series.symbol}-${series.period}-l`}
              className={styles.line}
              d={geometry.line}
              style={{ stroke: color }}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* The latest close, as a round cap on a zero-length stroke so it stays
            a circle however wide the card is. */}
          {value !== undefined && (
            <span
              className={styles.cross}
              data-away={away || undefined}
              style={
                {
                  '--x': pct(index),
                  '--y': geometry.yOf(value) / H,
                } as CSSProperties
              }
              aria-hidden
            >
              <span className={styles.crossLine} />
              <span className={styles.crossDot} style={{ background: color }} />
            </span>
          )}
          {!onX && last !== undefined && (
            <span
              className={styles.endDot}
              style={
                { '--x': '100%', '--y': geometry.yOf(last) / H, background: color } as CSSProperties
              }
              aria-hidden
            />
          )}

          {n > 1 && (
            <SliderPrimitive.Root
              className={styles.scrub}
              min={0}
              max={n - 1}
              step={1}
              value={[index]}
              onValueChange={([next = n - 1]) => {
                clearTimeout(settle.current);
                onAt?.(next);
              }}
              onPointerDown={() => {
                pressing.current = true;
                clearTimeout(settle.current);
              }}
              onPointerMove={(event) => {
                // A mouse reads a day by passing over it; a finger has to press.
                if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
                clearTimeout(settle.current);
                const next = indexAt(event);
                if (next !== index) onAt?.(next);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse' && event.buttons === 0) onAt?.(undefined);
              }}
              onPointerUp={(event) => {
                if (!pressing.current) return;
                pressing.current = false;
                if (event.pointerType === 'mouse') return;
                clearTimeout(settle.current);
                settle.current = setTimeout(() => onAt?.(undefined), 900);
              }}
            >
              <SliderPrimitive.Track className={styles.scrubTrack} />
              <SliderPrimitive.Thumb
                className={styles.scrubThumb}
                aria-label={`${label}, day by day`}
                aria-valuetext={say(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && away) {
                    event.stopPropagation();
                    onAt?.(undefined);
                  }
                }}
                onBlur={() => {
                  if (!pressing.current) onAt?.(undefined);
                }}
              />
            </SliderPrimitive.Root>
          )}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden>
        <span>{n ? axis(0) : ''}</span>
        {date && away && <span className={styles.xAt}>{when(index)}</span>}
        <span>{n ? axis(n - 1) : ''}</span>
      </div>
      {footer}

      {/* Tooltips never gate a value: every close is in the table too. */}
      <table className="nc-visually-hidden">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Close</th>
            <th scope="col">From the start</th>
          </tr>
        </thead>
        <tbody>
          {tableRows(series).map(({ i, close }) => (
            <tr key={i}>
              <th scope="row">{when(i)}</th>
              <td>{money(close, currency, locale)}</td>
              <td>
                {first === undefined || first === 0 || i === 0
                  ? '—'
                  : signed(close - first, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** At most forty rows for the table: enough to read the shape, not a wall. */
function tableRows(series: PriceSeries) {
  const n = series.closes.length;
  const most = 40;
  const step = n <= most ? 1 : Math.ceil(n / most);
  const rows: { i: number; day: string; close: number }[] = [];
  for (let i = 0; i < n; i += step) {
    const day = series.dates[i];
    const close = series.closes[i];
    if (day !== undefined && close !== undefined) rows.push({ i, day, close });
  }
  const lastDay = series.dates.at(-1);
  const lastClose = series.closes.at(-1);
  if (lastDay !== undefined && lastClose !== undefined && rows.at(-1)?.day !== lastDay)
    rows.push({ i: n - 1, day: lastDay, close: lastClose });
  return rows;
}
