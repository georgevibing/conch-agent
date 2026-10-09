/**
 * The page Prometheus reads (`GET /metrics`, ADR 0119): the text exposition
 * format 0.0.4, or OpenMetrics 1.0 when the scraper asks for it.
 *
 * Written from the specs (prometheus.io/docs/instrumenting/exposition_formats,
 * the OpenMetrics specification) and OpenTelemetry's Prometheus compatibility
 * spec for the names: one `# HELP` and `# TYPE` per family before its samples,
 * label values escaped (`\\`, `\"`, `\n`), histograms as cumulative `_bucket`
 * lines ending in `le="+Inf"` with `_sum` and `_count`, counters as `_total`,
 * and what the process is (`service.name`, its version) on `target_info`.
 */
import { prometheusLabel, prometheusName, type MetricDef } from './catalog';
import type { MetricSnapshot } from './meter';

export const TEXT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
export const OPENMETRICS_TYPE = 'application/openmetrics-text; version=1.0.0; charset=utf-8';

/** OpenMetrics when the scraper says it takes it (Prometheus does), the classic text otherwise. */
export function wantsOpenMetrics(accept: string | undefined): boolean {
  return /application\/openmetrics-text/i.test(accept ?? '');
}

const escapeHelp = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
const escapeValue = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** A number as both formats write it: `+Inf`, `NaN`, and plain decimals otherwise. */
export function promNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Number.POSITIVE_INFINITY) return '+Inf';
  if (n === Number.NEGATIVE_INFINITY) return '-Inf';
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

function labelText(labels: Record<string, string>, extra?: [string, string]): string {
  const pairs = Object.entries(labels).map(([k, v]) => `${prometheusLabel(k)}="${escapeValue(v)}"`);
  if (extra) pairs.push(`${extra[0]}="${escapeValue(extra[1])}"`);
  return pairs.length ? `{${pairs.join(',')}}` : '';
}

/** OpenMetrics writes `le` in canonical float form: `1.0`, `0.25`, `+Inf`. */
const canonicalLe = (n: number) => {
  const text = promNumber(n);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
};

function family(def: MetricDef, open: boolean): { name: string; type: string; sample: string } {
  const full = prometheusName(def);
  if (def.kind === 'counter') {
    // OpenMetrics names the family without `_total` and its samples with it.
    return {
      name: open ? full.replace(/_total$/, '') : full,
      type: 'counter',
      sample: full,
    };
  }
  return { name: full, type: def.kind, sample: full };
}

/**
 * Every metric that has a series, in catalog order, plus `target_info` with
 * the resource (`service_name`, `service_version`, `service_instance_id`).
 */
export function writePrometheus(
  metrics: readonly MetricSnapshot[],
  resource: Record<string, string>,
  options: { openMetrics?: boolean } = {},
): string {
  const open = Boolean(options.openMetrics);
  const lines: string[] = [];
  const info: Record<string, string> = {};
  for (const [key, value] of Object.entries(resource)) info[key] = value;
  if (open) {
    lines.push('# TYPE target info', '# HELP target Target metadata');
    lines.push(`target_info${labelText(info)} 1`);
  } else {
    lines.push('# HELP target_info Target metadata', '# TYPE target_info gauge');
    lines.push(`target_info${labelText(info)} 1`);
  }
  for (const { def, series } of metrics) {
    if (!series.length) continue;
    const f = family(def, open);
    if (open) {
      lines.push(`# TYPE ${f.name} ${f.type}`);
      const unit = /_(seconds|bytes|ratio|usd)$/.exec(f.name)?.[1];
      if (unit) lines.push(`# UNIT ${f.name} ${unit}`);
      lines.push(`# HELP ${f.name} ${escapeHelp(def.description)}`);
    } else {
      lines.push(`# HELP ${f.name} ${escapeHelp(def.description)}`);
      lines.push(`# TYPE ${f.name} ${f.type}`);
    }
    for (const s of series) {
      if (def.kind !== 'histogram' || !s.histogram) {
        lines.push(`${f.sample}${labelText(s.labels)} ${promNumber(s.value)}`);
        continue;
      }
      const h = s.histogram;
      const bounds = def.buckets ?? [];
      let running = 0;
      bounds.forEach((bound, i) => {
        running += h.buckets[i] ?? 0;
        const le = open ? canonicalLe(bound) : promNumber(bound);
        lines.push(`${f.name}_bucket${labelText(s.labels, ['le', le])} ${running}`);
      });
      lines.push(`${f.name}_bucket${labelText(s.labels, ['le', '+Inf'])} ${h.count}`);
      lines.push(`${f.name}_sum${labelText(s.labels)} ${promNumber(h.sum)}`);
      lines.push(`${f.name}_count${labelText(s.labels)} ${h.count}`);
    }
  }
  if (open) lines.push('# EOF');
  return `${lines.join('\n')}\n`;
}
