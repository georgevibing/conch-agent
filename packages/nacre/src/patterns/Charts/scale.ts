/**
 * The maths and the words a chart needs, all pure so they can be tested on
 * their own: a clean axis, numbers people read, dates labelled the way they're
 * written, a long tail folded into "Others", and the whole picture as a
 * sentence for anyone who can't see it.
 *
 * `niceStep` and the plain value format mirror `files/make/chartScale.ts` in
 * the gateway, so a chart in the chat and the same chart exported as a file
 * put their ticks in the same places. Nacre stays dependency-free.
 */
import type { ChartSpec, ChartKind, ChartSeries } from './types';

/**
 * The categorical order, mirroring `--nc-chart-1…8` in `tokens.css`. Resolved
 * here as plain hex too, so a card serialised to an image keeps its colours
 * even where custom properties don't survive (the share bar's rasteriser).
 */
export const CHART_PAINTS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

/** The token order never cycles: a ninth series folds in, it never invents a hue. */
export const SERIES_MAX = 8;
/** Any two marks can touch in a scatter, so it tells apart fewer series. */
export const SCATTER_SERIES_MAX = 3;

/** The paint for slot `i`, as a custom property (resolved to hex for export). */
export const paintVar = (i: number) => `var(--nc-chart-${(i % SERIES_MAX) + 1})`;

// ── The value axis ──────────────────────────────────────────────────────────

/** A clean axis step: 1, 2, 2.5 or 5 times a power of ten, for about `ticks` of them. */
export function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * The value axis for a set of readings: clean round ticks, the baseline
 * included where a mark grows from it (bars, areas), and never a zero-height
 * range — a flat series still gets an axis it can sit in the middle of.
 */
export function niceScale(values: readonly number[], options: { zero?: boolean } = {}): Scale {
  const known = values.filter((v) => Number.isFinite(v));
  let lo = known.length ? Math.min(...known) : 0;
  let hi = known.length ? Math.max(...known) : 1;
  if (options.zero !== false) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) {
    // One flat reading: give it room either side so the line isn't on the axis.
    const pad = Math.abs(hi) || 1;
    hi += pad / 2;
    lo -= pad / 2;
    if (options.zero !== false) lo = Math.min(lo, 0);
  }
  const step = niceStep(hi - lo, 5);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Rounded back onto the step: adding floats drifts (0.1 + 0.2 …).
  for (let i = 0; min + i * step <= max + step / 1e6; i++) ticks.push(min + i * step);
  return { min, max: max === min ? min + step : max, step, ticks };
}

// ── Numbers as words ────────────────────────────────────────────────────────

const groupers = new Map<string, Intl.NumberFormat>();

/** Thousands separated the way the reader writes them. */
function grouped(value: number, locale?: string): string {
  const key = locale ?? '';
  let format = groupers.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    groupers.set(key, format);
  }
  return format.format(value);
}

/**
 * A value in a few characters, for an axis tick or a label on a mark: `1.2M`,
 * `$4.5k`, `1,180`, `62%`. The compact suffixes mirror the gateway's
 * (`files/make/chartScale.ts`), so a chart in the chat and the same chart
 * exported as a file put the same words in the same places; under ten
 * thousand it keeps every digit, with the reader's own thousands mark.
 */
export function shortValue(value: number, unit?: string, prefix?: string, locale?: string): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const body =
    abs >= 1e9
      ? `${+(abs / 1e9).toFixed(1)}B`
      : abs >= 1e6
        ? `${+(abs / 1e6).toFixed(1)}M`
        : abs >= 1e4
          ? `${+(abs / 1e3).toFixed(1)}k`
          : grouped(+abs.toFixed(2), locale);
  return `${prefix ?? ''}${sign}${body}${suffix(unit)}`;
}

const suffix = (unit?: string) => (!unit ? '' : unit === '%' ? '%' : ` ${unit}`);

/**
 * How this chart's numbers read in full: the reader's own thousands and
 * decimals (`Intl.NumberFormat`), the prefix in front, the unit after. A
 * currency-looking prefix makes it a currency so the symbol sits where that
 * language puts it.
 */
export function valueFormatter(
  locale: string | undefined,
  options: { unit?: string; prefix?: string } = {},
) {
  const { unit, prefix } = options;
  const currency = CURRENCY[prefix?.trim() ?? ''];
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const money = currency
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        // The symbol the reader knows, not “US$”; and no trailing zeroes on
        // a chart, where “£1,450” says it better than “£1,450.00”.
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      })
    : undefined;
  return (value: number) =>
    money
      ? `${money.format(value)}${suffix(unit)}`
      : `${prefix ?? ''}${plain.format(value)}${suffix(unit)}`;
}

const CURRENCY: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₽': 'RUB',
  R$: 'BRL',
  CHF: 'CHF',
};

/** A share of a whole, to one decimal when it needs one: `42%`, `0.4%`. */
export function sharePercent(locale: string | undefined, share: number): string {
  const digits = share > 0 && share < 0.095 ? 1 : share * 100 >= 10 ? 0 : 1;
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(share);
}

// ── Dates as x labels ───────────────────────────────────────────────────────

const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ](\d{2}):(\d{2}))?$/;

/** A label read as a date, or nothing when it isn't one. */
function asDate(label: string) {
  const m = ISO.exec(label.trim());
  if (!m) return undefined;
  const [, y, mo, d, hh, mm] = m;
  const date = new Date(
    Number(y),
    mo ? Number(mo) - 1 : 0,
    d ? Number(d) : 1,
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0,
  );
  return Number.isNaN(date.getTime())
    ? undefined
    : { date, precision: hh ? 'minute' : d ? 'day' : mo ? 'month' : ('year' as const) };
}

export interface AxisLabels {
  /** Short, for the axis. */
  text: string[];
  /** In full, for the tooltip, the read-out and the table. */
  full: string[];
  /** Whether they turned out to be dates. */
  dates: boolean;
}

/**
 * The x labels as people read them. ISO dates become short dates at the
 * granularity the data moves in — hours within a day, days within a season,
 * months within a year or two, years beyond — and stay in full in the
 * tooltip. Anything else is left exactly as it came.
 */
export function axisLabels(labels: readonly string[], locale?: string): AxisLabels {
  const parsed = labels.map(asDate);
  if (!labels.length || parsed.some((p) => !p))
    return { text: [...labels], full: [...labels], dates: false };
  const dates = parsed.map((p) => p?.date as Date);
  const finest = parsed.some((p) => p?.precision === 'minute')
    ? 'minute'
    : parsed.some((p) => p?.precision === 'day')
      ? 'day'
      : parsed.some((p) => p?.precision === 'month')
        ? 'month'
        : 'year';
  const spanDays =
    (Math.max(...dates.map((d) => d.getTime())) - Math.min(...dates.map((d) => d.getTime()))) /
    86_400_000;
  const years = new Set(dates.map((d) => d.getFullYear()));
  const short: Intl.DateTimeFormatOptions =
    finest === 'minute' && spanDays <= 3
      ? { hour: 'numeric', minute: '2-digit' }
      : finest === 'year' || spanDays > 1200
        ? { year: 'numeric' }
        : finest === 'month' || spanDays > 200
          ? years.size > 1
            ? { month: 'short', year: '2-digit' }
            : { month: 'short' }
          : { day: 'numeric', month: 'short' };
  const long: Intl.DateTimeFormatOptions =
    finest === 'minute'
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : finest === 'year'
        ? { year: 'numeric' }
        : finest === 'month'
          ? { month: 'long', year: 'numeric' }
          : { dateStyle: 'medium' };
  const shortFmt = new Intl.DateTimeFormat(locale, short);
  const longFmt = new Intl.DateTimeFormat(locale, long);
  return {
    text: dates.map((d) => shortFmt.format(d)),
    full: dates.map((d) => longFmt.format(d)),
    dates: true,
  };
}

// ── Parts of a whole ────────────────────────────────────────────────────────

export interface Slice {
  label: string;
  value: number;
  share: number;
  /** Which paint it wears: the slot it was given, kept even when others are off. */
  slot: number;
  /** How many categories this slice stands for, when it's the tail. */
  folded?: number;
}

/**
 * A pie's slices, biggest first, with a long tail gathered into one
 * "Others" — eight paints is the ceiling, and a ring of slivers says less
 * than a slice that admits what it is. Negative and missing values are
 * dropped: a pie can't show them honestly.
 */
export function slicesOf(
  labels: readonly string[],
  values: readonly (number | null)[],
  max = SERIES_MAX,
): { slices: Slice[]; total: number; dropped: number } {
  const kept = labels
    .map((label, i) => ({ label, value: values[i] ?? 0 }))
    .filter((s) => Number.isFinite(s.value) && s.value > 0);
  const dropped = labels.length - kept.length;
  kept.sort((a, b) => b.value - a.value);
  const total = kept.reduce((sum, s) => sum + s.value, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  if (kept.length <= max)
    return {
      slices: kept.map((s, i) => ({ ...s, share: share(s.value), slot: i })),
      total,
      dropped,
    };
  const head = kept.slice(0, max - 1);
  const tail = kept.slice(max - 1);
  const rest = tail.reduce((sum, s) => sum + s.value, 0);
  return {
    slices: [
      ...head.map((s, i) => ({ ...s, share: share(s.value), slot: i })),
      { label: 'Others', value: rest, share: share(rest), slot: max - 1, folded: tail.length },
    ],
    total,
    dropped,
  };
}

/** A slice of a ring (or a whole pie, with `inner` 0), as an SVG path. */
export function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
): string {
  const sweep = to - from;
  const f = (n: number) => Number(n.toFixed(2));
  const at = (angle: number, r: number) =>
    `${f(cx + r * Math.cos(angle))} ${f(cy + r * Math.sin(angle))}`;
  // A single slice filling the circle: two half-arcs, since one would be a point.
  if (sweep >= Math.PI * 2 - 1e-6) {
    const half = from + Math.PI;
    const ring = inner > 0;
    return ring
      ? `M ${at(from, outer)} A ${outer} ${outer} 0 0 1 ${at(half, outer)} A ${outer} ${outer} 0 0 1 ${at(from, outer)} Z M ${at(from, inner)} A ${inner} ${inner} 0 0 0 ${at(half, inner)} A ${inner} ${inner} 0 0 0 ${at(from, inner)} Z`
      : `M ${at(from, outer)} A ${outer} ${outer} 0 0 1 ${at(half, outer)} A ${outer} ${outer} 0 0 1 ${at(from, outer)} Z`;
  }
  const large = sweep > Math.PI ? 1 : 0;
  return inner > 0
    ? `M ${at(from, outer)} A ${outer} ${outer} 0 ${large} 1 ${at(to, outer)} L ${at(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${at(from, inner)} Z`
    : `M ${cx} ${cy} L ${at(from, outer)} A ${outer} ${outer} 0 ${large} 1 ${at(to, outer)} Z`;
}

// ── The picture, in words ───────────────────────────────────────────────────

/** How long a line is, near enough for a drawing animation. */
export function pathLength(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return Math.max(1, total);
}

/** Readings that aren't gaps. */
const known = (series: ChartSeries) => series.values.filter((v): v is number => v != null);

/** Whether this form grows out of a baseline (so the axis must include zero). */
export const fromBaseline = (type: ChartKind) =>
  type === 'bar' || type === 'column' || type === 'area';

/** Whether this form shows parts of one whole. */
export const isRound = (type: ChartKind) => type === 'pie' || type === 'donut';

/**
 * The chart as a sentence or two: what it is, and for each series where it
 * starts, where it ends, its lowest and its highest. The picture is never the
 * only way to the numbers — the table under it carries every one.
 */
export function describeChart(
  chart: ChartSpec,
  format: (value: number) => string,
  labels: readonly string[] = chart.labels,
): string {
  const points = chart.labels.length;
  if (isRound(chart.type)) {
    const { slices, total } = slicesOf(chart.labels, chart.series[0]?.values ?? []);
    const parts = slices.map((s) => `${s.label} ${format(s.value)}, ${Math.round(s.share * 100)}%`);
    return `${slices.length} of ${format(total)} in total: ${parts.join('; ')}.`;
  }
  const lines = chart.series.map((s) => {
    const vs = known(s);
    if (!vs.length) return `${s.name}: nothing measured.`;
    const firstAt = s.values.findIndex((v) => v != null);
    const lastAt = s.values.findLastIndex((v) => v != null);
    const high = Math.max(...vs);
    const low = Math.min(...vs);
    const gaps = s.values.length - vs.length;
    const at = (i: number) => labels[i] ?? String(i + 1);
    const span =
      firstAt === lastAt
        ? `${format(s.values[firstAt] as number)} at ${at(firstAt)}`
        : `${format(s.values[firstAt] as number)} at ${at(firstAt)} to ${format(s.values[lastAt] as number)} at ${at(lastAt)}`;
    return `${s.name}: ${span}; lowest ${format(low)}, highest ${format(high)}${
      gaps ? `; ${gaps} with no reading` : ''
    }.`;
  });
  const what = `${chart.series.length} ${chart.series.length === 1 ? 'series' : 'series'} over ${points} ${points === 1 ? 'point' : 'points'}.`;
  return `${what} ${lines.join(' ')}`;
}
