/**
 * Conch's numbers, held in memory (ADR 0121): counters and histograms that
 * only grow (cumulative, as Prometheus reads them; `delta.ts` turns them into
 * differences for the services that want those), and gauges read when asked.
 *
 * Small on purpose: adding to a counter is a map lookup, so a turn never waits
 * for its numbers. Every series is a metric from the catalog with labels its
 * row allows (`labels.ts`); a metric that would grow past `MAX_SERIES` folds
 * the rest into one series marked `otel.metric.overflow`, as OpenTelemetry's
 * cardinality limit does.
 */
import { METRIC, METRICS, type MetricDef } from './catalog';
import { Labels } from './labels';

export const MAX_SERIES = 500;

export interface HistogramValue {
  count: number;
  sum: number;
  min: number;
  max: number;
  /** One more than the boundaries: the last is everything above them. */
  buckets: number[];
}

export interface Series {
  labels: Record<string, string>;
  /** When this series began counting, in ms. */
  start: number;
  /** Counters and gauges. */
  value: number;
  histogram?: HistogramValue;
}

export interface MetricSnapshot {
  def: MetricDef;
  series: Series[];
}

const keyOf = (labels: Record<string, string>) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}\u0000${labels[k]}`)
    .join('\u0001');

const OVERFLOW = { 'otel.metric.overflow': 'true' };

export class Meter {
  readonly labels = new Labels();
  readonly #series = new Map<string, Map<string, Series>>();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    for (const def of METRICS) this.#series.set(def.name, new Map());
  }

  #find(name: string, raw: Record<string, unknown>): { def: MetricDef; series: Series } {
    const def = METRIC.get(name);
    const table = this.#series.get(name);
    if (!def || !table) throw new Error(`No metric called ${name} in the catalog.`);
    let labels = this.labels.pick(def.labels, raw);
    let key = keyOf(labels);
    let series = table.get(key);
    if (!series) {
      if (table.size >= MAX_SERIES) {
        labels = OVERFLOW;
        key = keyOf(labels);
        series = table.get(key);
      }
      if (!series) {
        series = {
          labels,
          start: this.#now(),
          value: 0,
          ...(def.kind === 'histogram' && {
            histogram: {
              count: 0,
              sum: 0,
              min: Number.POSITIVE_INFINITY,
              max: Number.NEGATIVE_INFINITY,
              buckets: new Array<number>((def.buckets?.length ?? 0) + 1).fill(0),
            },
          }),
        };
        table.set(key, series);
      }
    }
    return { def, series };
  }

  /** Add to a counter. Negative or not-a-number amounts are ignored: a counter only grows. */
  add(name: string, amount: number, labels: Record<string, unknown> = {}): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    const { def, series } = this.#find(name, labels);
    if (def.kind !== 'counter') return;
    series.value += amount;
  }

  /** One measurement into a histogram. */
  record(name: string, value: number, labels: Record<string, unknown> = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    const { def, series } = this.#find(name, labels);
    const h = series.histogram;
    if (def.kind !== 'histogram' || !h) return;
    const bounds = def.buckets ?? [];
    let i = 0;
    while (i < bounds.length && value > (bounds[i] ?? Number.POSITIVE_INFINITY)) i++;
    h.buckets[i] = (h.buckets[i] ?? 0) + 1;
    h.count++;
    h.sum += value;
    h.min = Math.min(h.min, value);
    h.max = Math.max(h.max, value);
  }

  /** A gauge's value now. */
  set(name: string, value: number, labels: Record<string, unknown> = {}): void {
    if (!Number.isFinite(value)) return;
    const { def, series } = this.#find(name, labels);
    if (def.kind !== 'gauge') return;
    series.value = value;
  }

  /** Forget a gauge's series that no longer exist (a provider removed, a state left). */
  clear(name: string): void {
    const def = METRIC.get(name);
    if (def?.kind === 'gauge') this.#series.get(name)?.clear();
  }

  /** Every metric with at least one series, as it stands now. Copies: safe to keep. */
  snapshot(): MetricSnapshot[] {
    const out: MetricSnapshot[] = [];
    for (const def of METRICS) {
      const table = this.#series.get(def.name);
      if (!table?.size) continue;
      out.push({
        def,
        series: [...table.values()].map((s) => ({
          labels: { ...s.labels },
          start: s.start,
          value: s.value,
          ...(s.histogram && {
            histogram: { ...s.histogram, buckets: [...s.histogram.buckets] },
          }),
        })),
      });
    }
    return out;
  }
}
