/**
 * A chart to draw, as a tool handed it over. Mirrors `ChartView` in
 * `@conch/protocol` structurally: Nacre stays free of the protocol package.
 */

/** The forms the card draws. Anything else is refused before it gets here. */
export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';

/** One series: its name, and one value per label. `null` is a gap, never a zero. */
export interface ChartSeries {
  name: string;
  values: readonly (number | null)[];
}

/** A line to read against: a target, a budget, last year's average. */
export interface ChartGoal {
  value: number;
  label?: string;
}

export interface ChartSpec {
  type: ChartKind;
  title?: string;
  subtitle?: string;
  /** The categories, or the x values. ISO dates are read and labelled as dates. */
  labels: readonly string[];
  series: readonly ChartSeries[];
  /** After each value: "%", "kWh", "ms". */
  unit?: string;
  /** Before each value: "$", "€", "£". */
  prefix?: string;
  stacked?: boolean;
  /** Bars lying down. `bar` is already horizontal; this overrides either way. */
  horizontal?: boolean;
  goal?: ChartGoal;
  source?: string;
  note?: string;
}
