import { useEffect, useId, useMemo, useRef, useState, type ComponentProps } from 'react';

import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import styles from './Artifacts.module.css';

export interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  unit?: string;
  stacked?: boolean;
}

export interface ArtifactChartProps extends Omit<ComponentProps<'figure'>, 'children'> {
  chart: ChartData;
  /** Drawn height in pixels (the width follows the space). */
  height?: number;
  /** Start on the table instead of the picture. */
  defaultView?: 'chart' | 'table';
}

const PAD = { top: 12, right: 16, bottom: 28, left: 48 };
const BAR_MAX = 24;
const color = (i: number) => `var(--nc-chart-${(i % 8) + 1})`;

/** Clean ticks: 0, 50, 100… covering the range. */
export function niceTicks(max: number, min = 0, count = 4): number[] {
  const span = Math.max(max - min, 1e-9);
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  if ((out.at(-1) ?? 0) < max) out.push(Number(((out.at(-1) ?? 0) + step).toFixed(10)));
  return out;
}

const format = (v: number, unit?: string) => {
  const text =
    Math.abs(v) >= 10_000
      ? v.toLocaleString('en', { maximumFractionDigits: 0 })
      : v.toLocaleString('en', { maximumFractionDigits: 2 });
  if (!unit) return text;
  return /^[€$£¥%]$/.test(unit)
    ? unit === '%'
      ? `${text}%`
      : `${unit}${text}`
    : `${text} ${unit}`;
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

interface Tip {
  x: number;
  y: number;
  label: string;
  rows: { name: string; value: number | null; i: number }[];
}

/**
 * A chart the assistant made, drawn by Conch so it always looks like Conch
 * (ADR 0034): bars, lines, areas or a donut, a legend for two or more series,
 * a tooltip on every mark, and the same numbers as a table one press away.
 * Series colours come in a fixed, colour-blind-checked order.
 */
export function ArtifactChart({
  chart,
  height = 260,
  defaultView = 'chart',
  className,
  ...props
}: ArtifactChartProps) {
  const [view, setView] = useState(defaultView);
  const [tip, setTip] = useState<Tip>();
  const { ref, width } = useWidth();
  const titleId = useId();
  const multi = chart.series.length > 1;

  const geometry = useMemo(() => {
    const inner = { w: width - PAD.left - PAD.right, h: height - PAD.top - PAD.bottom };
    const stacked = Boolean(chart.stacked) && chart.type !== 'line';
    const totals = chart.labels.map((_, i) =>
      stacked
        ? chart.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0)
        : Math.max(...chart.series.map((s) => s.values[i] ?? 0)),
    );
    const min = Math.min(0, ...chart.series.flatMap((s) => s.values.map((v) => v ?? 0)));
    const ticks = niceTicks(Math.max(...totals, 0), min);
    const top = ticks.at(-1) ?? 1;
    const bottom = ticks[0] ?? 0;
    const y = (v: number) => PAD.top + inner.h - ((v - bottom) / (top - bottom || 1)) * inner.h;
    const band = inner.w / chart.labels.length;
    const x = (i: number) => PAD.left + band * i + band / 2;
    return { inner, ticks, y, band, x, stacked };
  }, [chart, width, height]);

  const { inner, ticks, y, band, x, stacked } = geometry;
  const labelEvery = Math.max(
    1,
    Math.ceil(chart.labels.length / Math.max(1, Math.floor(inner.w / 64))),
  );
  const tipFor = (i: number, at: { x: number; y: number }): Tip => ({
    ...at,
    label: chart.labels[i] ?? '',
    rows: chart.series.map((s, k) => ({ name: s.name, value: s.values[i] ?? null, i: k })),
  });

  const pie = chart.type === 'pie';
  const total = pie
    ? (chart.series[0]?.values.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0) ?? 0)
    : 0;

  return (
    <figure
      className={cx(styles.chart, className)}
      aria-labelledby={chart.title ? titleId : undefined}
      {...props}
    >
      <div className={styles.chartHead}>
        {chart.title && (
          <figcaption id={titleId} className={styles.chartTitle}>
            {chart.title}
          </figcaption>
        )}
        <SegmentedControl
          size="sm"
          value={view}
          onValueChange={(v) => setView(v as 'chart' | 'table')}
          aria-label="Show as"
          className={styles.chartViews}
        >
          <SegmentedControl.Item value="chart">Chart</SegmentedControl.Item>
          <SegmentedControl.Item value="table">Table</SegmentedControl.Item>
        </SegmentedControl>
      </div>
      {(multi || pie) && view === 'chart' && (
        <ul className={styles.legend} aria-label="Legend">
          {(pie ? chart.labels : chart.series.map((s) => s.name)).map((name, i) => (
            <li key={name + i}>
              <span className={styles.swatch} style={{ background: color(i) }} aria-hidden />
              {name}
            </li>
          ))}
        </ul>
      )}
      {view === 'table' ? (
        <div
          className={styles.tableWrap}
          // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label="The chart as a table"
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">
                  <span className="nc-visually-hidden">Label</span>
                </th>
                {chart.series.map((s) => (
                  <th key={s.name} scope="col">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.labels.map((label, i) => (
                <tr key={label + i}>
                  <th scope="row">{label}</th>
                  {chart.series.map((s) => (
                    <td key={s.name}>
                      {s.values[i] == null ? '—' : format(s.values[i] ?? 0, chart.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Hover only adds a tooltip; the same numbers are one press away in Table.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div ref={ref} className={styles.plot} onMouseLeave={() => setTip(undefined)}>
          <svg
            width={width}
            height={pie ? Math.min(height, 260) : height}
            role="img"
            aria-label={`${chart.title ?? 'Chart'}: ${chart.type} chart of ${chart.series.map((s) => s.name).join(', ')} across ${chart.labels.length} ${chart.labels.length === 1 ? 'point' : 'points'}. Choose Table to read the numbers.`}
          >
            {pie ? (
              (() => {
                const r = Math.min(Math.min(height, 260) / 2 - 8, width / 2 - 8);
                const cx0 = width / 2;
                const cy0 = Math.min(height, 260) / 2;
                let angle = -Math.PI / 2;
                return (chart.series[0]?.values ?? []).map((v, i) => {
                  const share = total ? Math.max(0, v ?? 0) / total : 0;
                  const a0 = angle;
                  const a1 = angle + share * Math.PI * 2;
                  angle = a1;
                  const large = a1 - a0 > Math.PI ? 1 : 0;
                  const p = (a: number, rr: number) =>
                    `${cx0 + rr * Math.cos(a)} ${cy0 + rr * Math.sin(a)}`;
                  const inner0 = r * 0.6;
                  const d =
                    share >= 0.9999
                      ? `M ${p(0, r)} A ${r} ${r} 0 1 1 ${p(Math.PI, r)} A ${r} ${r} 0 1 1 ${p(0, r)} M ${p(0, inner0)} A ${inner0} ${inner0} 0 1 0 ${p(Math.PI, inner0)} A ${inner0} ${inner0} 0 1 0 ${p(0, inner0)}`
                      : `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner0)} A ${inner0} ${inner0} 0 ${large} 0 ${p(a0, inner0)} Z`;
                  return (
                    <path
                      key={i}
                      d={d}
                      fill={color(i)}
                      className={styles.slice}
                      onMouseMove={(e) =>
                        setTip({
                          x: e.nativeEvent.offsetX,
                          y: e.nativeEvent.offsetY,
                          label: chart.labels[i] ?? '',
                          rows: [{ name: `${Math.round(share * 100)}%`, value: v, i }],
                        })
                      }
                    />
                  );
                });
              })()
            ) : (
              <>
                {ticks.map((t) => (
                  <g key={t}>
                    <line
                      x1={PAD.left}
                      x2={width - PAD.right}
                      y1={y(t)}
                      y2={y(t)}
                      className={styles.grid}
                    />
                    <text
                      x={PAD.left - 8}
                      y={y(t)}
                      className={styles.tick}
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      {format(t, chart.unit === '%' ? '%' : undefined)}
                    </text>
                  </g>
                ))}
                {chart.labels.map((label, i) =>
                  i % labelEvery === 0 ? (
                    <text
                      key={label + i}
                      x={x(i)}
                      y={height - 8}
                      className={styles.tick}
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  ) : null,
                )}
                {chart.type === 'bar' &&
                  chart.labels.map((_, i) => {
                    const groups = stacked ? 1 : chart.series.length;
                    const slot = Math.min(BAR_MAX, (band * 0.7) / groups);
                    let base = 0;
                    return chart.series.map((s, k) => {
                      const v = s.values[i] ?? 0;
                      const from = stacked ? base : 0;
                      const to = from + v;
                      if (stacked) base = to;
                      const left = stacked
                        ? x(i) - slot / 2
                        : x(i) - (slot * groups) / 2 + slot * k;
                      const top = Math.min(y(to), y(from));
                      const h = Math.max(0, Math.abs(y(from) - y(to)) - (stacked && k > 0 ? 2 : 0));
                      const last = !stacked || k === chart.series.length - 1;
                      return (
                        <path
                          key={`${i}-${k}`}
                          d={roundedTop(
                            left + (stacked ? 0 : 1),
                            top,
                            slot - (stacked ? 0 : 2),
                            h,
                            last ? 4 : 0,
                          )}
                          fill={color(k)}
                          className={styles.bar}
                          onMouseMove={() => setTip(tipFor(i, { x: x(i), y: top }))}
                        />
                      );
                    });
                  })}
                {(chart.type === 'line' || chart.type === 'area') &&
                  (() => {
                    let below = chart.labels.map(() => 0);
                    return chart.series.map((s, k) => {
                      const tops = s.values.map((v, i) =>
                        stacked ? (below[i] ?? 0) + (v ?? 0) : (v ?? 0),
                      );
                      const points = tops.map((v, i) => `${x(i)},${y(v)}`);
                      const area =
                        chart.type === 'area'
                          ? `M ${points.join(' L ')} L ${[...below.map((b, i) => `${x(i)},${y(stacked ? b : 0)}`)].reverse().join(' L ')} Z`
                          : undefined;
                      if (stacked) below = tops;
                      return (
                        <g key={s.name}>
                          {area && <path d={area} fill={color(k)} className={styles.area} />}
                          <polyline
                            points={points.join(' ')}
                            stroke={color(k)}
                            className={styles.line}
                          />
                          {tops.length <= 40 &&
                            tops.map((v, i) => (
                              <circle
                                key={i}
                                cx={x(i)}
                                cy={y(v)}
                                r={4}
                                fill={color(k)}
                                className={styles.dot}
                              />
                            ))}
                        </g>
                      );
                    });
                  })()}
                {(chart.type === 'line' || chart.type === 'area') && (
                  <rect
                    x={PAD.left}
                    y={PAD.top}
                    width={inner.w}
                    height={inner.h}
                    fill="transparent"
                    onMouseMove={(e) => {
                      const i = Math.max(
                        0,
                        Math.min(
                          chart.labels.length - 1,
                          Math.floor((e.nativeEvent.offsetX - PAD.left) / band),
                        ),
                      );
                      setTip(tipFor(i, { x: x(i), y: PAD.top }));
                    }}
                  />
                )}
                {tip && (chart.type === 'line' || chart.type === 'area') && (
                  <line
                    x1={tip.x}
                    x2={tip.x}
                    y1={PAD.top}
                    y2={PAD.top + inner.h}
                    className={styles.crosshair}
                  />
                )}
              </>
            )}
          </svg>
          {tip && (
            <div
              className={styles.tip}
              style={{ left: Math.min(tip.x + 12, width - 160), top: Math.max(0, tip.y - 8) }}
              role="status"
            >
              <div className={styles.tipLabel}>{tip.label}</div>
              {tip.rows.map((r) => (
                <div key={r.name} className={styles.tipRow}>
                  <span className={styles.swatch} style={{ background: color(r.i) }} aria-hidden />
                  <span>{r.name}</span>
                  <strong>{r.value == null ? '—' : format(r.value, chart.unit)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** A bar with a rounded data end and a square foot on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}
