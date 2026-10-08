/**
 * A chart the assistant asked the chat to draw (ADR 0105): the numbers it
 * already has, as a picture you can read, scrub, select and save. Numbers
 * only — no markup, no addresses — so nothing in a chart can carry anything
 * out of the chat.
 *
 * The same categorical order as a chart made as a file
 * (`files/make/chart.ts`, `--nc-chart-1…8`), so one drawn in the chat and the
 * same one exported for a deck read as one family.
 */
import { z } from 'zod';

/**
 * The forms Conch draws well.
 *
 * - `column` — vertical bars: compare a handful of categories, or counts per period.
 * - `bar` — the same, lying down: long category names, or many of them.
 * - `line` — change over time, two or more series.
 * - `area` — change over time where the total is the point (one series, or stacked).
 * - `pie` / `donut` — parts of one whole, a few slices.
 * - `scatter` — two measures against each other, at most three series.
 *
 * Anything else (radar, treemap, funnel, gauge, waterfall, sankey, boxplot,
 * heatmap, bubble, candlestick) is refused by `chart_show` rather than drawn
 * badly or quietly turned into something it isn't.
 */
export const ChartKind = z.enum(['bar', 'column', 'line', 'area', 'pie', 'donut', 'scatter']);
export type ChartKind = z.infer<typeof ChartKind>;

/** The token order never cycles: a ninth series is refused, never invented. */
export const CHART_SERIES_MAX = 8;
/** Points per series. Past this the picture is a smear and a table reads better. */
export const CHART_POINTS_MAX = 400;
/** Any two marks can touch in a scatter, so it carries fewer series (ADR 0105). */
export const CHART_SCATTER_SERIES_MAX = 3;

/** One series: its name, and one value per label. `null` is a gap, never a zero. */
export const ChartSeries = z.object({
  name: z.string().max(60),
  values: z.array(z.number().finite().nullable()).min(1).max(CHART_POINTS_MAX),
});
export type ChartSeries = z.infer<typeof ChartSeries>;

/** A line to read against: a target, a budget, last year's average. */
export const ChartGoal = z.object({
  value: z.number().finite(),
  /** What it is, in a word or three: "Target", "Budget". */
  label: z.string().max(40).optional(),
});
export type ChartGoal = z.infer<typeof ChartGoal>;

export const ChartView = z.object({
  kind: z.literal('chart'),
  type: ChartKind,
  /** What the chart says, as a short sentence: "Revenue by quarter". */
  title: z.string().max(120).optional(),
  /** The unit, the period, the caveat: one quiet line under the title. */
  subtitle: z.string().max(200).optional(),
  /**
   * The categories, or the x values. ISO dates (`2026-01`, `2026-01-31`) are
   * read as dates and labelled as people write them; anything else is a word.
   */
  labels: z.array(z.string().max(80)).min(1).max(CHART_POINTS_MAX),
  series: z.array(ChartSeries).min(1).max(CHART_SERIES_MAX),
  /** After each value: "%", "kWh", "ms". */
  unit: z.string().max(12).optional(),
  /** Before each value: "$", "€", "£". */
  prefix: z.string().max(4).optional(),
  /** Bars and areas piled into one total rather than set side by side. */
  stacked: z.boolean().optional(),
  /** Bars lying down. `bar` is already horizontal; this overrides either way. */
  horizontal: z.boolean().optional(),
  goal: ChartGoal.optional(),
  /** Where the numbers came from, for the small print: "Stripe, October". */
  source: z.string().max(80).optional(),
  /** One line of small print under the chart: what to watch out for. */
  note: z.string().max(240).optional(),
});
export type ChartView = z.infer<typeof ChartView>;
