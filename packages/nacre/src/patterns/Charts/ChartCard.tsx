import { Table2 } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { Button } from '../../components/Button';
import { runs } from '../../components/LiveChart/curve';
import { cx } from '../../utils/cx';
import styles from './Charts.module.css';
import {
  cartesianLayout,
  edgeCentre,
  roundLayout,
  sliceAt,
  type CartesianLayout,
  type RoundLayout,
} from './geometry';
import {
  AXIS,
  CROSS,
  GOAL,
  GRID,
  INK,
  SOFT,
  SUBTLE,
  SURFACE,
  paint,
  token,
  useExportablePaints,
} from './paints';
import {
  arcPath,
  axisLabels,
  describeChart,
  fromBaseline,
  isRound,
  pathLength,
  sharePercent,
  shortValue,
  slicesOf,
  valueFormatter,
  type Slice,
} from './scale';
import type { ChartSpec } from './types';

export interface ChartCardProps extends Omit<ComponentProps<'section'>, 'children' | 'title'> {
  chart: ChartSpec;
  /** How the reader writes numbers and dates; the browser's own by default. */
  locale?: string;
  /** The plot's height in pixels. Bars lying down grow with their categories. */
  height?: number;
  /**
   * The plot's own `<svg>`. It is self-contained — one background rectangle in
   * the card's surface colour, every mark's colour a presentation attribute,
   * no external font — so serialising it gives a picture that still looks
   * right. The card's share bar (Save as image / Copy / Send) uses this.
   */
  svgRef?: Ref<SVGSVGElement>;
  /** Mounted in the footer beside **Show the numbers**: the card's share bar. */
  actions?: ReactNode;
  /** Start with the table of numbers open. */
  defaultNumbers?: boolean;
}

const MIN_WIDTH = 240;
/** Thin marks: a bar never fills its slot (24 px ceiling). */
const BAR_MAX = 24;
/** A 2 px gap of surface, never a stroke, separates touching marks. */
const GAP = 2;
/** How far a slice lifts out of the pie when it's read. */
const LIFT = 7;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;

const f2 = (n: number) => Number(n.toFixed(2));

/** A rectangle with a radius per corner, clockwise from the top left. */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): string {
  const r = (v: number) => Math.max(0, Math.min(v, w / 2, h / 2));
  const [a, b, c, d] = [r(tl), r(tr), r(br), r(bl)];
  return [
    `M ${f2(x + a)} ${f2(y)}`,
    `H ${f2(x + w - b)}`,
    b ? `A ${f2(b)} ${f2(b)} 0 0 1 ${f2(x + w)} ${f2(y + b)}` : '',
    `V ${f2(y + h - c)}`,
    c ? `A ${f2(c)} ${f2(c)} 0 0 1 ${f2(x + w - c)} ${f2(y + h)}` : '',
    `H ${f2(x + d)}`,
    d ? `A ${f2(d)} ${f2(d)} 0 0 1 ${f2(x)} ${f2(y + h - d)}` : '',
    `V ${f2(y + a)}`,
    a ? `A ${f2(a)} ${f2(a)} 0 0 1 ${f2(x + a)} ${f2(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The 4 px rounded data-end, square where the mark stands on the baseline. */
function dataEnd(grow: 'up' | 'down' | 'right' | 'left', r = 4): [number, number, number, number] {
  if (grow === 'up') return [r, r, 0, 0];
  if (grow === 'down') return [0, 0, r, r];
  if (grow === 'right') return [0, r, r, 0];
  return [r, 0, 0, r];
}

interface Mark {
  /** Which series it belongs to; the pie's slices use their own slot. */
  k: number;
  i: number;
  value: number;
  d: string;
  grow: 'up' | 'down' | 'right' | 'left';
  /** Where its value would sit if it's labelled. */
  label?: {
    x: number;
    y: number;
    anchor: 'middle' | 'start' | 'end';
    text: string;
    inside: boolean;
  };
}

/**
 * A chart in the chat (ADR 0105): the numbers the assistant already has, as a
 * picture you can read with a pointer or the arrow keys, pick a part out of,
 * and take away as an image.
 *
 * The colours are the one validated categorical order every Conch chart uses
 * (`--nc-chart-1…8`, never cycled), so a chart here and the same chart
 * exported for a deck read as one family. Nothing is told by colour alone:
 * two or more series always get a legend, the read-out gives every value at
 * once, and **Show the numbers** opens the same data as a real table — which
 * is also the path a screen reader takes.
 */
export function ChartCard({
  chart,
  locale,
  height,
  svgRef,
  actions,
  defaultNumbers = false,
  className,
  style,
  ...props
}: ChartCardProps) {
  const root = useRef<HTMLElement>(null);
  // The plot's palette is frozen onto the `<svg>` itself, so a picture taken
  // of this card carries its colours with no stylesheet to go looking for.
  useExportablePaints(root);
  const { ref: plotRef, width } = useWidth<HTMLDivElement>();
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '');

  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [cursor, setCursor] = useState<number>();
  const [selected, setSelected] = useState<number>();
  const [numbers, setNumbers] = useState(defaultNumbers);
  const [lifted, setLifted] = useState<number>();

  const round = isRound(chart.type);
  const horizontal = chart.horizontal ?? chart.type === 'bar';
  const bars = chart.type === 'bar' || chart.type === 'column';
  const stacked = Boolean(chart.stacked) && (bars || chart.type === 'area');

  const format = useMemo(
    () => valueFormatter(locale, { unit: chart.unit, prefix: chart.prefix }),
    [locale, chart.unit, chart.prefix],
  );
  const short = useMemo(
    () => (v: number) => shortValue(v, chart.unit, chart.prefix, locale),
    [chart.unit, chart.prefix, locale],
  );
  const labels = useMemo(() => axisLabels(chart.labels, locale), [chart.labels, locale]);

  const pie = useMemo(
    () => (round ? slicesOf(chart.labels, chart.series[0]?.values ?? []) : undefined),
    [round, chart.labels, chart.series],
  );

  const series = chart.series;
  const shown = useMemo(
    () => series.map((s, i) => ({ s, i })).filter(({ i }) => !hidden.has(i)),
    [series, hidden],
  );
  const steps = round ? (pie?.slices.length ?? 0) : chart.labels.length;
  const empty =
    steps === 0 ||
    (round
      ? !pie?.total
      : !series.some((s) => s.values.some((v) => v != null && Number.isFinite(v))));

  const plotHeight =
    height ??
    (round ? 212 : horizontal ? Math.max(130, Math.min(440, chart.labels.length * 30 + 30)) : 216);

  // ── The value axis, and every mark on it ─────────────────────────────────
  const scatterX = useMemo(() => {
    if (chart.type !== 'scatter') return undefined;
    const numbers = chart.labels.map((l) => Number(l));
    return numbers.every((n) => Number.isFinite(n)) ? numbers : undefined;
  }, [chart.type, chart.labels]);

  const axisValues = useMemo(() => {
    const out: number[] = [];
    if (stacked)
      for (let i = 0; i < chart.labels.length; i++) {
        let up = 0;
        let down = 0;
        for (const { s } of shown) {
          const v = s.values[i];
          if (v == null || !Number.isFinite(v)) continue;
          if (v >= 0) up += v;
          else down += v;
        }
        out.push(up, down);
      }
    else
      for (const { s } of shown)
        for (const v of s.values) if (v != null && Number.isFinite(v)) out.push(v);
    if (chart.goal) out.push(chart.goal.value);
    return out;
  }, [stacked, shown, chart.labels.length, chart.goal]);

  const tickChars = useMemo(() => {
    const probe = axisValues.length ? Math.max(...axisValues.map(Math.abs)) : 1;
    return Math.max(3, short(probe).length, short(-probe / 2).length);
  }, [axisValues, short]);

  const layout = useMemo(
    () =>
      round
        ? undefined
        : cartesianLayout({
            width,
            height: plotHeight,
            horizontal,
            values: axisValues,
            labels: labels.text,
            zero: fromBaseline(chart.type),
            tickChars,
            dates: labels.dates,
            ...(scatterX && { xValues: scatterX }),
          }),
    [
      round,
      width,
      plotHeight,
      horizontal,
      axisValues,
      labels.text,
      labels.dates,
      chart.type,
      tickChars,
      scatterX,
    ],
  );

  const ring = useMemo(
    () =>
      round
        ? roundLayout(
            width,
            plotHeight,
            pie?.slices.map((s) => s.share) ?? [],
            chart.type === 'donut',
          )
        : undefined,
    [round, width, plotHeight, pie, chart.type],
  );

  // ── The read-out ─────────────────────────────────────────────────────────
  const at = cursor ?? selected;
  const readOut = (i: number): string => {
    if (round) {
      const slice = pie?.slices[i];
      if (!slice) return '';
      const folded = slice.folded ? `, ${slice.folded} smaller ones together` : '';
      return `${slice.label}${folded}: ${format(slice.value)}, ${sharePercent(locale, slice.share)} of ${format(pie?.total ?? 0)}.`;
    }
    const where = labels.full[i] ?? '';
    const parts = shown.map(
      ({ s }) => `${s.name} ${s.values[i] == null ? 'no reading' : format(s.values[i] as number)}`,
    );
    return `${where}: ${parts.join(', ')}.`;
  };

  const toggle = (i: number) =>
    setHidden((was) => {
      const next = new Set(was);
      if (next.has(i)) next.delete(i);
      else if (series.length - next.size > 1) next.add(i);
      return next;
    });

  const move = (to: number) => setCursor(Math.min(steps - 1, Math.max(0, to)));

  const pointIndex = (event: ReactPointerEvent<HTMLElement>): number | undefined => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !steps) return undefined;
    if (ring)
      return sliceAt(
        ring,
        event.clientX - box.left - ring.cx,
        event.clientY - box.top - ring.cy,
        ring.arcs,
      );
    if (!layout) return undefined;
    const f = horizontal
      ? (event.clientY - box.top) / Math.max(1, box.height)
      : (event.clientX - box.left) / Math.max(1, box.width);
    return Math.min(steps - 1, Math.max(0, Math.round(f * (steps - 1) + (bars ? 0.0 : 0))));
  };

  const label = chart.title
    ? `Chart: ${chart.title}`
    : `${round ? 'Share' : 'Chart'} of ${series.map((s) => s.name).join(', ')}`;
  const description = useMemo(
    () => describeChart(chart, format, labels.full),
    [chart, format, labels.full],
  );
  const foldedSlice = pie?.slices.find((s) => s.folded);

  return (
    <section
      ref={root}
      data-nacre-card="chart"
      data-chart={chart.type}
      aria-label={label}
      className={cx(styles.root, className)}
      style={style}
      {...props}
    >
      {(chart.title || chart.subtitle) && (
        <header className={styles.head}>
          {chart.title && <h3 className={styles.title}>{chart.title}</h3>}
          {chart.subtitle && <p className={styles.subtitle}>{chart.subtitle}</p>}
        </header>
      )}

      {round
        ? pie &&
          pie.slices.length > 1 && (
            <ul className={styles.legend}>
              {pie.slices.map((slice, i) => (
                <li key={`${slice.label}-${i}`}>
                  <button
                    type="button"
                    className={styles.legendButton}
                    aria-pressed={selected === i}
                    data-dim={
                      (selected !== undefined && selected !== i) ||
                      (lifted !== undefined && lifted !== i)
                        ? ''
                        : undefined
                    }
                    onClick={() => setSelected((was) => (was === i ? undefined : i))}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setLifted(i)}
                    onPointerLeave={() => setLifted(undefined)}
                    onFocus={() => setLifted(i)}
                    onBlur={() => setLifted(undefined)}
                  >
                    <span
                      className={styles.key}
                      data-shape="block"
                      style={{ background: token(slice.slot) }}
                    />
                    <span className={styles.keyName}>{slice.label}</span>
                    <span className={styles.keyValue}>{sharePercent(locale, slice.share)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        : series.length > 1 && (
            <ul className={styles.legend}>
              {series.map((s, i) => {
                const last = s.values.findLastIndex((v) => v != null);
                return (
                  <li key={`${s.name}-${i}`}>
                    <button
                      type="button"
                      className={styles.legendButton}
                      aria-pressed={!hidden.has(i)}
                      data-off={hidden.has(i) ? '' : undefined}
                      data-dim={lifted !== undefined && lifted !== i ? '' : undefined}
                      onClick={() => toggle(i)}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setLifted(i)}
                      onPointerLeave={() => setLifted(undefined)}
                      onFocus={() => setLifted(i)}
                      onBlur={() => setLifted(undefined)}
                    >
                      <span
                        className={styles.key}
                        data-shape={
                          chart.type === 'line' || chart.type === 'scatter' ? 'line' : 'block'
                        }
                        style={{ background: token(i) }}
                      />
                      <span className={styles.keyName}>{s.name}</span>
                      {last >= 0 && (
                        <span className={styles.keyValue}>{short(s.values[last] as number)}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

      <div
        ref={plotRef}
        className={styles.plot}
        data-empty={empty ? '' : undefined}
        style={{ '--ch-h': `${plotHeight}px` } as CSSProperties}
      >
        {empty ? (
          <p className={styles.nothing}>Nothing to draw: no numbers came with this chart.</p>
        ) : (
          <>
            <svg
              ref={svgRef}
              data-nacre-chart-svg=""
              className={styles.svg}
              width={width}
              height={plotHeight}
              viewBox={`0 0 ${width} ${plotHeight}`}
              role="img"
              aria-label={label}
            >
              {/* A background of the card's own surface, so the picture stands
                  alone once it has been saved or copied. */}
              <rect x={0} y={0} width={width} height={plotHeight} style={{ fill: SURFACE }} />
              {ring && pie ? (
                <RoundMarks
                  uid={uid}
                  ring={ring}
                  slices={pie.slices}
                  total={pie.total}
                  at={at}
                  lifted={lifted}
                  selected={selected}
                  locale={locale}
                  donut={chart.type === 'donut'}
                  short={short}
                />
              ) : layout ? (
                <CartesianMarks
                  chart={chart}
                  layout={layout}
                  labels={labels.text}
                  shown={shown}
                  at={at}
                  lifted={lifted}
                  selected={selected}
                  stacked={stacked}
                  scatterX={scatterX}
                  short={short}
                  locale={locale}
                />
              ) : null}
            </svg>

            {/* Pointer and keyboard read the same places. A mouse reads by
                passing over; a finger has to touch, so a tap never fights the
                page's own scrolling. */}
            {steps > 1 && (
              <div
                className={styles.reader}
                role="slider"
                tabIndex={0}
                aria-label={round ? 'Read each part' : 'Read the chart'}
                aria-valuemin={0}
                aria-valuemax={steps - 1}
                aria-valuenow={at ?? 0}
                aria-valuetext={readOut(at ?? 0)}
                style={
                  layout
                    ? ({
                        insetInlineStart: `${layout.pads.left}px`,
                        insetBlockStart: `${layout.pads.top}px`,
                        inlineSize: `${layout.plotW}px`,
                        blockSize: `${layout.plotH}px`,
                      } as CSSProperties)
                    : undefined
                }
                onPointerMove={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  const next = pointIndex(e);
                  setCursor(next);
                }}
                onPointerDown={(e) => {
                  const next = pointIndex(e);
                  if (next === undefined) return;
                  setCursor(next);
                  setSelected((was) => (was === next ? undefined : next));
                }}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setCursor(undefined)}
                onPointerCancel={() => setCursor(undefined)}
                onKeyDown={(e) => {
                  const backward = horizontal && !round ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft'];
                  const forward =
                    horizontal && !round ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight'];
                  if (!round && !horizontal) {
                    backward.push('ArrowDown');
                    forward.push('ArrowUp');
                  }
                  // Nothing on yet: the first press reads the near end, so a
                  // key always does something visible.
                  if (backward.includes(e.key)) {
                    e.preventDefault();
                    move(at === undefined ? steps - 1 : at - 1);
                  } else if (forward.includes(e.key)) {
                    e.preventDefault();
                    move(at === undefined ? 0 : at + 1);
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    move(0);
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    move(steps - 1);
                  } else if (e.key === 'Escape') {
                    if (cursor === undefined && selected === undefined) return;
                    e.stopPropagation();
                    setCursor(undefined);
                    setSelected(undefined);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const here = at ?? 0;
                    setSelected((was) => (was === here ? undefined : here));
                  }
                }}
                onBlur={() => setCursor(undefined)}
              />
            )}

            {at !== undefined && (
              <Tip
                at={at}
                pinned={selected === at}
                {...(ring && pie
                  ? {
                      round: true as const,
                      ring,
                      slice: pie.slices[at],
                      total: pie.total,
                      format,
                      locale,
                    }
                  : layout
                    ? {
                        round: false as const,
                        layout,
                        chart,
                        shown,
                        label: labels.full[at] ?? '',
                        format,
                        stacked,
                        scatterX,
                      }
                    : { round: false as const })}
              />
            )}
          </>
        )}
      </div>

      {/* The picture is never the only way to the numbers. */}
      <p className="nc-visually-hidden">{description}</p>

      <footer className={styles.foot}>
        <Button
          variant="ghost"
          size="sm"
          tone="neutral"
          aria-expanded={numbers}
          onClick={() => setNumbers((was) => !was)}
        >
          <Table2 aria-hidden />
          {numbers ? 'Hide the numbers' : 'Show the numbers'}
        </Button>
        {/*
         * TODO(share): the shared card share bar mounts here — Save as image,
         * Copy, Send to a chat app. It can find what it needs without a ref:
         * the card root is `[data-nacre-card="chart"]` and the plot is
         * `[data-nacre-chart-svg]` inside it (both are also handed over as
         * `ref` and `svgRef`).
         */}
        {actions != null && <div className={styles.share}>{actions}</div>}
      </footer>

      {numbers && (
        <div className={styles.numbers}>
          <table className={styles.table}>
            <caption className="nc-visually-hidden">
              {chart.title ?? label}
              {chart.unit ? `, in ${chart.unit}` : ''}
            </caption>
            <thead>
              <tr>
                <th scope="col">{round ? 'Part' : labels.dates ? 'Date' : 'Category'}</th>
                {round ? (
                  <>
                    <th scope="col">Value</th>
                    <th scope="col">Share</th>
                  </>
                ) : (
                  series.map((s, i) => (
                    <th scope="col" key={`${s.name}-${i}`}>
                      {s.name}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {round
                ? (pie?.slices ?? []).map((slice, i) => (
                    <tr key={`${slice.label}-${i}`}>
                      <th scope="row">{slice.label}</th>
                      <td>{format(slice.value)}</td>
                      <td>{sharePercent(locale, slice.share)}</td>
                    </tr>
                  ))
                : chart.labels.map((_, i) => (
                    <tr key={i}>
                      <th scope="row">{labels.full[i]}</th>
                      {series.map((s, k) => (
                        <td key={k}>{s.values[i] == null ? '—' : format(s.values[i] as number)}</td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {(chart.source || chart.note || foldedSlice) && (
        <p className={styles.small}>
          {[
            chart.source && `From ${chart.source}`,
            foldedSlice && `The ${foldedSlice.folded} smallest are together as “Others”.`,
            chart.note,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

// ── Bars, lines, areas and dots ─────────────────────────────────────────────

interface CartesianProps {
  chart: ChartSpec;
  layout: CartesianLayout;
  labels: readonly string[];
  shown: readonly { s: ChartSpec['series'][number]; i: number }[];
  at?: number;
  lifted?: number;
  selected?: number;
  stacked: boolean;
  scatterX?: readonly number[];
  short: (v: number) => string;
  locale?: string;
}

function CartesianMarks({
  chart,
  locale,
  layout,
  labels,
  shown,
  at,
  lifted,
  selected,
  stacked,
  scatterX,
  short,
}: CartesianProps) {
  const { pads, plotW, plotH, horizontal, scale, band, tickEvery, rotate, labelChars } = layout;
  const bars = chart.type === 'bar' || chart.type === 'column';
  const n = Math.max(1, chart.labels.length);
  const dim = (k: number) => lifted !== undefined && lifted !== k;

  // Where a point sits along the category axis: a bar stands in its slot, a
  // line's points sit on the plot's edges so the line fills the width.
  const slot = (i: number) =>
    bars ? layout.centre(i) : scatterX ? xOf(i) : edgeCentre(layout, i, n);
  const xOf = (i: number) => {
    const s = layout.xScale;
    const v = scatterX?.[i] ?? 0;
    if (!s) return edgeCentre(layout, i, n);
    return pads.left + ((v - s.min) / (s.max - s.min || 1)) * plotW;
  };
  const place = (i: number, value: number): [number, number] =>
    horizontal ? [layout.along(value), slot(i)] : [slot(i), layout.along(value)];

  /**
   * Where each stacked area's top edge runs. A gap counts as nothing for the
   * pile — the series above it would otherwise leap — but it still breaks the
   * band it belongs to, so a missing reading never draws as a zero.
   */
  const stackTops: number[][] = [];
  if (stacked && !bars) {
    const running = new Array<number>(n).fill(0);
    for (const { s } of shown) {
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        running[i] = (running[i] ?? 0) + (v != null && Number.isFinite(v) ? v : 0);
      }
      stackTops.push([...running]);
    }
  }
  const drawnValue = (g: number, i: number): number | null => {
    const raw = shown[g]?.s.values[i];
    if (raw == null || !Number.isFinite(raw)) return null;
    return stacked && !bars ? (stackTops[g]?.[i] ?? raw) : raw;
  };
  const beneath = (g: number, i: number) => (g === 0 ? 0 : (stackTops[g - 1]?.[i] ?? 0));

  const marks: Mark[] = [];
  /** A stack's whole total, on its cap: the one number a pile is really about. */
  const totals: { x: number; y: number; anchor: 'middle' | 'start' | 'end'; text: string }[] = [];

  if (bars) {
    const groups = stacked ? 1 : shown.length;
    const inner = Math.min(band * 0.74, groups * (BAR_MAX + GAP));
    const thick = Math.max(2, Math.min(BAR_MAX, inner / groups - (groups > 1 ? GAP : 0)));
    // A stacked segment has no free end, so an inline value would land on the
    // part above it: the stack is labelled with its total instead, and every
    // part stays in the read-out and the table.
    const labelAll = !stacked && n * groups <= 14;
    for (let i = 0; i < n; i++) {
      let up = 0;
      let down = 0;
      // Only the far end of a pile is rounded; the joins inside it are square.
      const lastUp = shown.reduce((found, { s }, g) => ((s.values[i] ?? 0) > 0 ? g : found), -1);
      const lastDown = shown.reduce((found, { s }, g) => ((s.values[i] ?? 0) < 0 ? g : found), -1);
      shown.forEach(({ s, i: k }, g) => {
        const v = s.values[i];
        if (v == null || !Number.isFinite(v)) return;
        const base = stacked ? (v >= 0 ? up : down) : 0;
        if (stacked) {
          if (v >= 0) up += v;
          else down += v;
        }
        const from = layout.along(base);
        const to = layout.along(base + v);
        const lead = Math.min(from, to);
        const length = Math.abs(to - from);
        const across =
          layout.centre(i) - inner / 2 + (stacked ? 0 : g * (thick + GAP)) + (stacked ? 0 : 0);
        const w = stacked ? inner : thick;
        // A 2 px gap of surface between the parts of a stack.
        const trim = stacked && length > GAP * 2 ? GAP : 0;
        const grow: Mark['grow'] = horizontal
          ? v >= 0
            ? 'right'
            : 'left'
          : v >= 0
            ? 'up'
            : 'down';
        const capped = !stacked || g === (v >= 0 ? lastUp : lastDown);
        const r = capped ? dataEnd(grow) : ([0, 0, 0, 0] as [number, number, number, number]);
        const d = horizontal
          ? roundedRect(
              lead + (grow === 'left' ? 0 : trim === 0 ? 0 : 0),
              across,
              Math.max(1, length - trim),
              w,
              r,
            )
          : roundedRect(
              across,
              lead + (grow === 'up' ? trim : 0),
              w,
              Math.max(1, length - trim),
              r,
            );
        const tip = horizontal
          ? { x: to + (v >= 0 ? 5 : -5), y: slot(i) + 4 }
          : { x: across + w / 2, y: to + (v >= 0 ? -6 : 13) };
        const text = short(v);
        const fits = horizontal
          ? v >= 0
            ? to + 6 + text.length * 6 < pads.left + plotW + pads.right
            : true
          : w >= text.length * 5.4;
        marks.push({
          k,
          i,
          value: v,
          d,
          grow,
          ...(labelAll &&
            fits && {
              label: {
                x: tip.x,
                y: tip.y,
                anchor: horizontal ? (v >= 0 ? 'start' : 'end') : 'middle',
                text,
                inside: false,
              },
            }),
        });
      });
      if (stacked && n <= 14) {
        let sum = 0;
        let any = false;
        for (const { s } of shown) {
          const v = s.values[i];
          if (v != null && Number.isFinite(v)) {
            sum += v;
            any = true;
          }
        }
        if (any) {
          const end = layout.along(sum);
          totals.push(
            horizontal
              ? {
                  x: end + (sum >= 0 ? 6 : -6),
                  y: slot(i) + 4,
                  anchor: sum >= 0 ? 'start' : 'end',
                  text: short(sum),
                }
              : {
                  x: layout.centre(i),
                  y: end + (sum >= 0 ? -7 : 14),
                  anchor: 'middle',
                  text: short(sum),
                },
          );
        }
      }
    }
  }

  const lineSets = bars
    ? []
    : shown.map(({ i: k }, g) => {
        const pieces = runs(
          chart.labels.map((_, i) => {
            const v = drawnValue(g, i);
            return v === null ? null : (place(i, v) as [number, number]);
          }),
        );
        return { k, g, pieces };
      });

  const zeroAt = layout.along(Math.min(Math.max(0, scale.min), scale.max));
  const goal = chart.goal ? layout.along(chart.goal.value) : undefined;
  const area = chart.type === 'area';

  return (
    <>
      {/* A recessive grid, and the baseline a touch firmer. */}
      {scale.ticks.map((t, i) => {
        const p = layout.along(t);
        const zero = Math.abs(t) < scale.step / 1e6;
        return horizontal ? (
          <g key={`t${i}`}>
            <line
              x1={f2(p)}
              x2={f2(p)}
              y1={pads.top}
              y2={pads.top + plotH}
              style={{ stroke: zero ? AXIS : GRID }}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={f2(p)}
              y={pads.top + plotH + 17}
              textAnchor="middle"
              className={styles.tick}
              style={{ fill: SUBTLE }}
            >
              {short(t)}
            </text>
          </g>
        ) : (
          <g key={`t${i}`}>
            <line
              x1={pads.left}
              x2={pads.left + plotW}
              y1={f2(p)}
              y2={f2(p)}
              style={{ stroke: zero ? AXIS : GRID }}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={pads.left - 8}
              y={f2(p) + 4}
              textAnchor="end"
              className={styles.tick}
              style={{ fill: SUBTLE }}
            >
              {short(t)}
            </text>
          </g>
        );
      })}

      {/* The x axis for a scatter whose labels are numbers. */}
      {layout.xScale &&
        layout.xScale.ticks.map((t, i) => {
          const s = layout.xScale as NonNullable<typeof layout.xScale>;
          const x = pads.left + ((t - s.min) / (s.max - s.min || 1)) * plotW;
          return (
            <text
              key={`x${i}`}
              x={f2(x)}
              y={pads.top + plotH + 17}
              textAnchor="middle"
              className={styles.tick}
              style={{ fill: SUBTLE }}
            >
              {/* The bottom axis measures the other thing, so the series'
                  unit has no business on it. */}
              {shortValue(t, undefined, undefined, locale)}
            </text>
          );
        })}

      {/* The category labels, thinned or turned so they never collide. */}
      {!layout.xScale &&
        labels.map((text, i) => {
          if (i % tickEvery) return null;
          const p = slot(i);
          if (horizontal)
            return (
              <text
                key={`c${i}`}
                x={pads.left - 8}
                y={f2(p) + 4}
                textAnchor="end"
                className={styles.catLabel}
                style={{ fill: SOFT }}
                data-on={at === i ? '' : undefined}
              >
                {clip(text, labelChars)}
              </text>
            );
          return (
            <text
              key={`c${i}`}
              x={f2(p)}
              y={pads.top + plotH + (rotate ? 14 : 18)}
              textAnchor={rotate ? 'end' : 'middle'}
              transform={rotate ? `rotate(-35 ${f2(p)} ${pads.top + plotH + 14})` : undefined}
              className={styles.catLabel}
              style={{ fill: SOFT }}
              data-on={at === i ? '' : undefined}
            >
              {clip(text, labelChars)}
            </text>
          );
        })}

      {/* Where the pointer or the arrow keys are. */}
      {at !== undefined &&
        (horizontal ? (
          <line
            x1={pads.left}
            x2={pads.left + plotW}
            y1={f2(slot(at))}
            y2={f2(slot(at))}
            style={{ stroke: CROSS }}
            strokeWidth={1}
            opacity={0.55}
            shapeRendering="crispEdges"
          />
        ) : (
          <line
            x1={f2(slot(at))}
            x2={f2(slot(at))}
            y1={pads.top}
            y2={pads.top + plotH}
            style={{ stroke: CROSS }}
            strokeWidth={1}
            opacity={0.55}
            shapeRendering="crispEdges"
          />
        ))}

      {/* Areas under their lines, a wash never a block. */}
      {area &&
        lineSets.map(({ k, g, pieces }) =>
          pieces.map((piece, p) => {
            const first = piece.items[0];
            const last = piece.items.at(-1);
            if (!first || !last) return null;
            const line = piece.items
              .map(([x, y], j) => `${j ? 'L' : 'M'} ${f2(x)} ${f2(y)}`)
              .join(' ');
            // Stacked, an area's lower edge is the pile under it; on its own
            // it runs down to the baseline.
            const back = stacked
              ? piece.items
                  .map((_, j) =>
                    place(
                      piece.start + piece.items.length - 1 - j,
                      beneath(g, piece.start + piece.items.length - 1 - j),
                    ),
                  )
                  .map(([x, y]) => `L ${f2(x)} ${f2(y)}`)
                  .join(' ')
              : horizontal
                ? `L ${f2(zeroAt)} ${f2(last[1])} L ${f2(zeroAt)} ${f2(first[1])}`
                : `L ${f2(last[0])} ${f2(zeroAt)} L ${f2(first[0])} ${f2(zeroAt)}`;
            const d = `${line} ${back} Z`;
            return (
              <path
                key={`a${k}-${p}`}
                className={styles.area}
                d={d}
                fillOpacity={stacked ? 0.24 : shown.length > 1 ? 0.13 : 0.18}
                data-dim={dim(k) ? '' : undefined}
                style={{ '--i': k, fill: paint(k) } as CSSProperties}
              />
            );
          }),
        )}

      {/* Bars grow out of the axis, with a short stagger. */}
      {marks.map((mark) => (
        <path
          key={`m${mark.k}-${mark.i}`}
          className={styles.bar}
          d={mark.d}
          data-grow={mark.grow}
          data-dim={dim(mark.k) || (selected !== undefined && selected !== mark.i) ? '' : undefined}
          data-on={selected === mark.i || at === mark.i ? '' : undefined}
          style={{ '--i': mark.i, fill: paint(mark.k) } as CSSProperties}
        >
          <title>{`${chart.series[mark.k]?.name ?? ''} ${labels[mark.i] ?? ''}: ${short(mark.value)}`}</title>
        </path>
      ))}

      {/* Lines draw along their own path. */}
      {!bars &&
        chart.type !== 'scatter' &&
        lineSets.map(({ k, pieces }) =>
          pieces.map((piece, p) => {
            const d = piece.items
              .map(([x, y], j) => `${j ? 'L' : 'M'} ${f2(x)} ${f2(y)}`)
              .join(' ');
            const len = pathLength(piece.items);
            return (
              <path
                key={`l${k}-${p}`}
                className={styles.line}
                d={d}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={len}
                data-dim={dim(k) ? '' : undefined}
                style={{ '--len': len, '--i': k, stroke: paint(k) } as CSSProperties}
              />
            );
          }),
        )}

      {/* A dot per reading when there's room for them, and always for a scatter. */}
      {!bars &&
        lineSets.map(({ k, pieces }) =>
          pieces.flatMap((piece, p) =>
            (chart.type === 'scatter' || n <= 14 ? piece.items : []).map(([x, y], j) => (
              <circle
                key={`d${k}-${p}-${j}`}
                className={styles.dot}
                cx={f2(x)}
                cy={f2(y)}
                r={chart.type === 'scatter' ? 4.5 : 3.5}
                strokeWidth={2}
                paintOrder="stroke"
                data-dim={dim(k) ? '' : undefined}
                style={{ '--i': piece.start + j, fill: paint(k), stroke: SURFACE } as CSSProperties}
              />
            )),
          ),
        )}

      {/* The reading under the crosshair, marked on every line. */}
      {at !== undefined &&
        !bars &&
        shown.map(({ i: k }, g) => {
          const v = drawnValue(g, at);
          if (v === null) return null;
          const [x, y] = place(at, v);
          return (
            <circle
              key={`h${k}`}
              cx={f2(x)}
              cy={f2(y)}
              r={5}
              style={{ fill: paint(k), stroke: SURFACE }}
              strokeWidth={2.5}
              paintOrder="stroke"
            />
          );
        })}

      {/* A line to read against, clearly not data. */}
      {goal !== undefined && chart.goal && (
        <g>
          {horizontal ? (
            <line
              x1={f2(goal)}
              x2={f2(goal)}
              y1={pads.top}
              y2={pads.top + plotH}
              style={{ stroke: GOAL }}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          ) : (
            <line
              x1={pads.left}
              x2={pads.left + plotW}
              y1={f2(goal)}
              y2={f2(goal)}
              style={{ stroke: GOAL }}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          )}
          <text
            x={horizontal ? f2(goal) : pads.left + plotW}
            y={horizontal ? pads.top - 6 : f2(goal) - 5}
            textAnchor={horizontal ? (goal > pads.left + plotW * 0.8 ? 'end' : 'middle') : 'end'}
            className={styles.goalLabel}
            style={{ fill: SOFT, stroke: SURFACE }}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {`${chart.goal.label ?? 'Target'} ${short(chart.goal.value)}`}
          </text>
        </g>
      )}

      {/* Values on the marks, only where they fit. */}
      {marks.map((mark) =>
        mark.label ? (
          <text
            key={`v${mark.k}-${mark.i}`}
            x={f2(mark.label.x)}
            y={f2(mark.label.y)}
            textAnchor={mark.label.anchor}
            className={styles.valueLabel}
            style={{ fill: SOFT, stroke: SURFACE }}
            strokeWidth={3}
            paintOrder="stroke"
            data-dim={dim(mark.k) ? '' : undefined}
          >
            {mark.label.text}
          </text>
        ) : null,
      )}

      {/* A pile's own total, on its cap. */}
      {totals.map((total, i) => (
        <text
          key={`s${i}`}
          x={f2(total.x)}
          y={f2(total.y)}
          textAnchor={total.anchor}
          className={styles.valueLabel}
          style={{ fill: SOFT, stroke: SURFACE }}
          strokeWidth={3}
          paintOrder="stroke"
        >
          {total.text}
        </text>
      ))}
    </>
  );
}

// ── A pie or a ring ─────────────────────────────────────────────────────────

function RoundMarks({
  uid,
  ring,
  slices,
  total,
  at,
  lifted,
  selected,
  locale,
  donut,
  short,
}: {
  uid: string;
  ring: RoundLayout;
  slices: readonly Slice[];
  total: number;
  at?: number;
  lifted?: number;
  selected?: number;
  locale?: string;
  donut: boolean;
  short: (v: number) => string;
}) {
  const sweepId = `${uid}-sweep`;
  const circumference = 2 * Math.PI * (ring.outer / 2);
  const centre = selected ?? at;
  const middle = centre !== undefined ? slices[centre] : undefined;

  return (
    <>
      <mask id={sweepId} maskUnits="userSpaceOnUse">
        <rect x={0} y={0} width={ring.cx * 2} height={ring.cy * 2} fill="#000" />
        <circle
          className={styles.sweep}
          cx={ring.cx}
          cy={ring.cy}
          r={ring.outer / 2}
          fill="none"
          stroke="#fff"
          strokeWidth={ring.outer + 2}
          strokeDasharray={circumference}
          transform={`rotate(-90 ${ring.cx} ${ring.cy})`}
          style={{ '--c': circumference } as CSSProperties}
        />
      </mask>
      <g mask={`url(#${sweepId})`}>
        {slices.map((slice, i) => {
          const arc = ring.arcs[i];
          if (!arc) return null;
          const on = at === i || lifted === i || selected === i;
          const mid = (arc.from + arc.to) / 2;
          const push = on ? LIFT : 0;
          return (
            <path
              key={`${slice.label}-${i}`}
              className={styles.slice}
              d={arcPath(ring.cx, ring.cy, ring.outer, ring.inner, arc.from, arc.to)}
              style={{ fill: paint(slice.slot), stroke: SURFACE }}
              strokeWidth={GAP}
              transform={`translate(${f2(Math.cos(mid) * push)} ${f2(Math.sin(mid) * push)})`}
              data-dim={
                (selected !== undefined && selected !== i) || (lifted !== undefined && lifted !== i)
                  ? ''
                  : undefined
              }
            >
              <title>{`${slice.label}: ${short(slice.value)}, ${sharePercent(locale, slice.share)}`}</title>
            </path>
          );
        })}
      </g>
      {donut && (
        <>
          <text
            x={ring.cx}
            y={ring.cy + (middle ? -2 : 6)}
            textAnchor="middle"
            className={styles.hero}
            style={{ fill: INK }}
          >
            {short(middle ? middle.value : total)}
          </text>
          {middle && (
            <text
              x={ring.cx}
              y={ring.cy + 16}
              textAnchor="middle"
              className={styles.heroUnder}
              style={{ fill: SOFT }}
            >
              {clip(middle.label, 16)}
            </text>
          )}
        </>
      )}
    </>
  );
}

// ── One tooltip, every series ───────────────────────────────────────────────

type TipProps = {
  at: number;
  pinned: boolean;
} & (
  | {
      round: true;
      ring: RoundLayout;
      slice?: Slice;
      total: number;
      format: (v: number) => string;
      locale?: string;
    }
  | {
      round: false;
      layout?: CartesianLayout;
      chart?: ChartSpec;
      shown?: readonly { s: ChartSpec['series'][number]; i: number }[];
      label?: string;
      format?: (v: number) => string;
      stacked?: boolean;
      scatterX?: readonly number[];
    }
);

function Tip(props: TipProps) {
  const { at, pinned } = props;
  if (props.round) {
    const { ring, slice, total, format, locale } = props;
    if (!slice) return null;
    const arc = ring.arcs[at];
    const mid = arc ? (arc.from + arc.to) / 2 : 0;
    const r = (ring.outer + ring.inner) / 2 + LIFT;
    const x = ring.cx + Math.cos(mid) * r;
    const y = ring.cy + Math.sin(mid) * r;
    return (
      <div
        className={styles.tip}
        data-side={x > ring.cx ? 'left' : 'right'}
        data-pinned={pinned ? '' : undefined}
        style={{ '--ch-x': `${x}px`, '--ch-y': `${y}px` } as CSSProperties}
        aria-hidden
      >
        <div className={styles.tipWhen}>{slice.label}</div>
        <div className={styles.tipRow}>
          <span className={styles.tipKey} style={{ background: token(slice.slot) }} />
          <strong>{format(slice.value)}</strong>
          <span>{sharePercent(locale, slice.share)}</span>
        </div>
        {slice.folded ? (
          <div className={styles.tipWhen}>{slice.folded} smaller parts together</div>
        ) : (
          <div className={styles.tipWhen}>of {format(total)}</div>
        )}
      </div>
    );
  }
  const { layout, chart, shown, label, format, scatterX } = props;
  if (!layout || !chart || !shown || !format) return null;
  const bars = chart.type === 'bar' || chart.type === 'column';
  const n = Math.max(1, chart.labels.length);
  const slotOf = (i: number) => {
    if (bars) return layout.centre(i);
    if (scatterX && layout.xScale) {
      const s = layout.xScale;
      return (
        layout.pads.left + (((scatterX[i] ?? 0) - s.min) / (s.max - s.min || 1)) * layout.plotW
      );
    }
    return edgeCentre(layout, i, n);
  };
  const values = shown
    .map(({ s, i: k }) => ({ k, name: s.name, value: s.values[at] }))
    .filter((r) => r.value != null && Number.isFinite(r.value));
  const best = values.length ? Math.max(...values.map((r) => r.value as number)) : 0;
  const across = slotOf(at);
  const along = values.length ? layout.along(best) : layout.pads.top;
  const [x, y] = layout.horizontal ? [along, across] : [across, along];
  const mid = layout.horizontal
    ? layout.pads.top + layout.plotH / 2
    : layout.pads.left + layout.plotW / 2;
  return (
    <div
      className={styles.tip}
      data-side={(layout.horizontal ? y : x) > mid ? 'left' : 'right'}
      data-pinned={pinned ? '' : undefined}
      style={{ '--ch-x': `${x}px`, '--ch-y': `${y}px` } as CSSProperties}
      aria-hidden
    >
      <div className={styles.tipWhen}>{label}</div>
      {values.length ? (
        values.map((row) => (
          <div key={row.k} className={styles.tipRow}>
            <span className={styles.tipKey} style={{ background: token(row.k) }} />
            <strong>{format(row.value as number)}</strong>
            {shown.length > 1 && <span>{row.name}</span>}
          </div>
        ))
      ) : (
        <div className={styles.tipRow}>
          <strong>—</strong>
          <span>no reading</span>
        </div>
      )}
    </div>
  );
}
