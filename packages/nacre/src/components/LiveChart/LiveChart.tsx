import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import { monotonePath, niceCeiling, runs, type Point } from './curve';
import styles from './LiveChart.module.css';
import { useGlide } from './useGlide';

export interface LiveSeries {
  id: string;
  /** Its name in the legend, the tooltip and the words for screen readers. */
  label: string;
  /** One per time in `times`; `null` is a gap (no reading), never a zero. */
  values: readonly (number | null)[];
  /** A colour; by default the chart series in their fixed order (`--nc-chart-1…`). */
  color?: string;
}

export interface LiveChartProps extends Omit<ComponentProps<'figure'>, 'children' | 'title'> {
  /** A word or two: "Processor". */
  title: string;
  /** When each reading was taken (ms), oldest first. */
  times: readonly number[];
  /** One to three series. Two or more get a legend with their current values. */
  series: readonly LiveSeries[];
  /** How a value reads: `12%`, `1.2 MB/s`. */
  format: (value: number) => string;
  /** The top of the scale (100 for a share). Left out, it fits the readings with a clean top. */
  max?: number;
  /**
   * The most time the chart spans. Default three minutes. Until it has that
   * much, it spans what it has, so a chart fills from its first readings.
   */
  windowMs?: number;
  /** How often a reading comes, so the line glides exactly that far in that time. */
  intervalMs?: number;
  /** The plot's height in pixels (the time labels sit under it). */
  height?: number;
  /** A quiet line beside the title: "Load 2.4". */
  detail?: ReactNode;
  /** In words, for the summary: "the last three minutes". */
  windowLabel?: string;
}

const color = (series: LiveSeries, i: number) => series.color ?? `var(--nc-chart-${i + 1})`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(120, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return 'Now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s ago` : `${m} min ago`;
}

function windowWords(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 2) return `the last ${minutes} minutes`;
  if (minutes === 1) return 'the last minute';
  return `the last ${Math.round(ms / 1000)} seconds`;
}

/** Now, the average and the highest, in a sentence: the chart for anyone who can't see it. */
export function describeSeries(
  series: LiveSeries,
  format: (value: number) => string,
  window: string,
): string {
  const known = series.values.filter((v): v is number => v != null);
  const last = known.at(-1);
  if (last === undefined) return `${series.label}: no readings yet.`;
  const average = known.reduce((sum, v) => sum + v, 0) / known.length;
  const highest = Math.max(...known);
  return `${series.label} over ${window}: now ${format(last)}, average ${format(average)}, highest ${format(highest)}.`;
}

/**
 * A live reading over the last few minutes: a soft area under a smooth 2 px
 * line, the newest reading marked with a ringed dot at the right edge. As
 * readings arrive the line glides left like a conveyor, at exactly the pace
 * time passes (`useGlide`), and holds still with reduced motion.
 *
 * The current value is always in words in the header (a legend with values
 * for two or more series), so the hover layer only adds: a crosshair that
 * snaps to the nearest reading with every series' value at that moment. For
 * screen readers the picture is one sentence per series: now, the average
 * and the highest.
 */
export function LiveChart({
  title,
  times,
  series,
  format,
  max,
  windowMs = 180_000,
  intervalMs = 2000,
  height = 112,
  detail,
  windowLabel,
  className,
  style,
  ...props
}: LiveChartProps) {
  const titleId = useId();
  const summaryId = useId();
  const clipId = useId();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [pointer, setPointer] = useState<number>();
  const latest = times.at(-1);
  const pad = { top: 6, bottom: 2 };
  const plotH = height - pad.top - pad.bottom;

  const top = useMemo(() => {
    if (max !== undefined) return max;
    const highest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
    return niceCeiling(highest * 1.1);
  }, [max, series]);

  // Room at the right for the newest dot, which leads the line in as it glides.
  const inner = width - 6;
  // A new page has seconds of history, not minutes: span what there is (at
  // least a few readings' worth) and say so, so the line fills either way.
  const range = (latest ?? 0) - (times[0] ?? latest ?? 0);
  const span = Math.min(windowMs, Math.max(intervalMs, range));
  const start = (latest ?? 0) - span;
  const x = (t: number) => ((t - start) / span) * inner;
  const y = (v: number) => pad.top + plotH - (Math.min(Math.max(v, 0), top) / top) * plotH;
  const baseline = pad.top + plotH;

  // While the history is still growing the chart stretches to fit it, so the
  // line fills from the first readings; once it spans its whole window, each
  // reading glides it left instead.
  const glide = useGlide<SVGGElement>(
    range >= windowMs ? latest : undefined,
    (ms) => (ms / span) * inner,
    intervalMs,
    inner / 3,
  );

  const drawn = series.map((s, k) => {
    const pieces = runs(
      s.values.map((v, i) => (v == null ? null : ([x(times[i] ?? 0), y(v)] as Point))),
    );
    const lines = pieces.map((piece) => monotonePath(piece.items));
    const areas = pieces.map((piece, i) => {
      const firstX = piece.items[0]?.[0] ?? 0;
      const lastX = piece.items.at(-1)?.[0] ?? 0;
      return `${lines[i]}L${lastX.toFixed(2)},${baseline}L${firstX.toFixed(2)},${baseline}Z`;
    });
    const lastIndex = s.values.findLastIndex((v) => v != null);
    const end =
      lastIndex >= 0
        ? ([x(times[lastIndex] ?? 0), y(s.values[lastIndex] ?? 0)] as Point)
        : undefined;
    return { s, k, lines, areas, end, lastValue: lastIndex >= 0 ? s.values[lastIndex] : undefined };
  });

  // The reading nearest the pointer, by time.
  let hovered: number | undefined;
  if (pointer !== undefined && times.length) {
    const t = start + (pointer / inner) * span;
    let best = Infinity;
    times.forEach((time, i) => {
      const d = Math.abs(time - t);
      if (d < best) {
        best = d;
        hovered = i;
      }
    });
  }
  const hoverX = hovered !== undefined ? x(times[hovered] ?? 0) : undefined;
  const multi = series.length > 1;
  const words = windowLabel ?? windowWords(span);
  const ticks = [top / 2, top];

  return (
    <figure
      className={cx(styles.chart, className)}
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      style={{ '--lc-height': `${height}px`, ...style } as CSSProperties}
      {...props}
    >
      <div className={styles.head}>
        <figcaption id={titleId} className={styles.title}>
          {title}
          {detail != null && <span className={styles.detail}>{detail}</span>}
        </figcaption>
        {multi ? (
          <ul className={styles.legend} aria-hidden>
            {drawn.map(({ s, k, lastValue }) => (
              <li key={s.id}>
                <span className={styles.key} style={{ background: color(s, k) }} />
                <span className={styles.legendLabel}>{s.label}</span>
                <span className={styles.legendValue}>
                  {lastValue != null ? format(lastValue) : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={styles.value} aria-hidden>
            {drawn[0]?.lastValue != null ? format(drawn[0].lastValue) : '—'}
          </span>
        )}
      </div>
      <p id={summaryId} className="nc-visually-hidden">
        {series.map((s) => describeSeries(s, format, words)).join(' ')}
      </p>
      {/* Hover only adds a crosshair; the values are in the header and the summary. */}
      <div
        ref={ref}
        className={styles.plot}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setPointer(Math.min(inner, Math.max(0, e.clientX - box.left)));
        }}
        onPointerLeave={() => setPointer(undefined)}
        onPointerCancel={() => setPointer(undefined)}
      >
        <svg width={width} height={height} aria-hidden className={styles.svg}>
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={width} height={height} />
            </clipPath>
            {drawn.map(({ s, k }) => (
              <linearGradient key={s.id} id={`${clipId}-${k}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color(s, k)} stopOpacity={multi ? 0.12 : 0.18} />
                <stop offset="100%" stopColor={color(s, k)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <line key={t} x1={0} x2={inner} y1={y(t)} y2={y(t)} className={styles.grid} />
          ))}
          <line x1={0} x2={inner} y1={baseline} y2={baseline} className={styles.base} />
          <g clipPath={`url(#${clipId})`}>
            <g ref={glide} className={styles.glide}>
              {drawn.map(({ s, k, areas }) =>
                areas.map((d, i) => (
                  <path key={`${s.id}-a${i}`} d={d} fill={`url(#${clipId}-${k})`} />
                )),
              )}
              {drawn.map(({ s, k, lines }) =>
                lines.map((d, i) => (
                  <path
                    key={`${s.id}-l${i}`}
                    d={d}
                    className={styles.line}
                    style={{ stroke: color(s, k) }}
                  />
                )),
              )}
              {drawn.map(({ s, k, end }) =>
                end ? (
                  <circle
                    key={`${s.id}-end`}
                    cx={end[0]}
                    cy={end[1]}
                    r={4}
                    className={styles.dot}
                    style={{ fill: color(s, k) }}
                  />
                ) : null,
              )}
            </g>
          </g>
          {/* Over the fills, with a halo of the surface, so a number is readable
              wherever the line happens to be. */}
          {ticks.map((t) => (
            <text key={t} x={0} y={y(t) + 11} className={styles.tick}>
              {format(t)}
            </text>
          ))}
          {hovered !== undefined && hoverX !== undefined && (
            <g>
              <line x1={hoverX} x2={hoverX} y1={pad.top} y2={baseline} className={styles.cross} />
              {drawn.map(({ s, k }) => {
                const v = s.values[hovered ?? 0];
                return v == null ? null : (
                  <circle
                    key={s.id}
                    cx={hoverX}
                    cy={y(v)}
                    r={4}
                    className={styles.dot}
                    style={{ fill: color(s, k) }}
                  />
                );
              })}
            </g>
          )}
        </svg>
        {hovered !== undefined && hoverX !== undefined && (
          <div
            className={styles.tip}
            data-side={hoverX > inner / 2 ? 'left' : 'right'}
            style={{ '--lc-x': `${hoverX}px` } as CSSProperties}
            aria-hidden
          >
            {drawn.map(({ s, k }) => {
              const v = s.values[hovered ?? 0];
              return (
                <div key={s.id} className={styles.tipRow}>
                  <span className={styles.tipKey} style={{ background: color(s, k) }} />
                  <strong>{v == null ? '—' : format(v)}</strong>
                  {multi && <span>{s.label}</span>}
                </div>
              );
            })}
            <div className={styles.tipWhen}>{ago((latest ?? 0) - (times[hovered] ?? 0))}</div>
          </div>
        )}
      </div>
      <div className={styles.axis} aria-hidden>
        <span>{ago(span).replace(/^./, (c) => c.toUpperCase())}</span>
        <span>Now</span>
      </div>
    </figure>
  );
}
