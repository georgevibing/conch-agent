/**
 * A chart as a self-contained SVG (and, printed, a PNG): bars, lines, areas
 * or a pie, from labels and series. Static files, so no hover: identity is
 * never colour alone (a legend for two or more series, end labels on up to
 * four lines), one value axis, thin marks, a quiet grid. The categorical
 * hues are a fixed order validated for colour-blind separation on a light
 * surface; a ninth series is refused rather than invented.
 */
import { escapeHtml as esc } from './html';

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export interface Chart {
  type: ChartType;
  title?: string;
  /** Words under the title: the unit, the source, the period. */
  subtitle?: string;
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  /** Bars stacked rather than side by side. */
  stacked?: boolean;
  /** Put before or after each value on the axis: "$", "%". */
  unit?: string;
}

/** Light-surface categorical order (validated: lightness band, chroma, CVD separation). */
export const SERIES = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const SOFT = '#52514e';
const MUTED = '#898781';
const GRID = '#e8e7e3';
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const CHART_SIZE = { width: 960, height: 540 };

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

function format(value: number, unit: string | undefined): string {
  const abs = Math.abs(value);
  const text =
    abs >= 1e9
      ? `${+(value / 1e9).toFixed(1)}B`
      : abs >= 1e6
        ? `${+(value / 1e6).toFixed(1)}M`
        : abs >= 1e4
          ? `${+(value / 1e3).toFixed(1)}k`
          : `${+value.toFixed(2)}`;
  if (!unit) return text;
  return unit.length <= 2 && /^[$€£¥]/.test(unit)
    ? `${unit}${text}`
    : `${text}${unit === '%' ? '%' : ` ${unit}`}`;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function chartSvg(chart: Chart): string {
  const { width, height } = CHART_SIZE;
  const series = chart.series.slice(0, SERIES.length);
  const top = chart.title ? (chart.subtitle ? 92 : 70) : 28;
  const legend = series.length >= 2 && chart.type !== 'pie';
  const parts: string[] = [];
  if (chart.title)
    parts.push(
      `<text x="40" y="44" font-size="22" font-weight="650" fill="${INK}">${esc(clip(chart.title, 70))}</text>`,
    );
  if (chart.subtitle)
    parts.push(
      `<text x="40" y="70" font-size="14" fill="${SOFT}">${esc(clip(chart.subtitle, 110))}</text>`,
    );

  if (chart.type === 'pie') {
    const values = chart.labels.map((_, i) => Math.max(0, series[0]?.values[i] ?? 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = 330;
    const cy = top + (height - top) / 2 - 10;
    const r = Math.min(200, (height - top) / 2 - 30);
    let angle = -Math.PI / 2;
    values.forEach((value, i) => {
      const sweep = (value / total) * Math.PI * 2;
      if (sweep <= 0) return;
      const color = SERIES[i % SERIES.length] ?? MUTED;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const p = (a: number, rad: number) =>
        `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
      const inner = r * 0.55;
      parts.push(
        sweep >= Math.PI * 2 - 1e-6
          ? `<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${color}" stroke-width="${r - inner}"/>`
          : `<path d="M ${p(angle, r)} A ${r} ${r} 0 ${large} 1 ${p(end, r)} L ${p(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(angle, inner)} Z" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>`,
      );
      angle = end;
    });
    parts.push(
      `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="26" font-weight="650" fill="${INK}">${esc(format(total, chart.unit))}</text>`,
    );
    // The legend is the labels, with each share: identity is never colour alone.
    chart.labels.slice(0, SERIES.length).forEach((label, i) => {
      const y = top + 40 + i * 40;
      const share = Math.round(((values[i] ?? 0) / total) * 1000) / 10;
      parts.push(
        `<rect x="600" y="${y - 12}" width="14" height="14" rx="3" fill="${SERIES[i]}"/><text x="624" y="${y}" font-size="15" fill="${INK}">${esc(clip(label, 30))}</text><text x="910" y="${y}" text-anchor="end" font-size="15" fill="${SOFT}">${share}%</text>`,
      );
    });
    return wrap(parts.join(''), chart);
  }

  const left = 72;
  const right =
    series.length <= 4 && (chart.type === 'line' || chart.type === 'area') && series.length > 1
      ? 150
      : 32;
  const bottom = legend ? 92 : 60;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const n = Math.max(1, chart.labels.length);
  const stacked = chart.type === 'bar' && chart.stacked;
  const all: number[] = [0];
  if (stacked)
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      all.push(pos, neg);
    }
  else for (const s of series) for (const v of s.values) if (typeof v === 'number') all.push(v);
  const minRaw = Math.min(...all);
  const maxRaw = Math.max(...all);
  const step = niceStep(maxRaw - minRaw || 1, 5);
  const min = Math.floor(minRaw / step) * step;
  const max = Math.ceil(maxRaw / step) * step || step;
  const y = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;

  // Grid and value axis, recessive.
  for (let v = min; v <= max + step / 2; v += step) {
    const yy = y(v).toFixed(1);
    parts.push(
      `<line x1="${left}" x2="${left + plotW}" y1="${yy}" y2="${yy}" stroke="${Math.abs(v) < step / 1e6 ? MUTED : GRID}" stroke-width="1"/><text x="${left - 10}" y="${+yy + 4}" text-anchor="end" font-size="12" fill="${MUTED}">${esc(format(v, chart.unit))}</text>`,
    );
  }
  // Category labels: thinned so they never collide.
  const band = plotW / n;
  const every = Math.max(1, Math.ceil(70 / band));
  chart.labels.forEach((label, i) => {
    if (i % every) return;
    const cx =
      chart.type === 'bar'
        ? left + band * (i + 0.5)
        : left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${top + plotH + 22}" text-anchor="middle" font-size="12" fill="${SOFT}">${esc(clip(label, Math.max(4, Math.floor((band * every) / 7))))}</text>`,
    );
  });

  if (chart.type === 'bar') {
    const groups = stacked ? 1 : series.length;
    // Thin marks: a bar is never wider than 56px, however few there are.
    const inner = Math.min(band * 0.72, groups * 58);
    const barW = Math.max(2, Math.min(56, inner / groups - (groups > 1 ? 2 : 0)));
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      series.forEach((s, k) => {
        const v = s.values[i];
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        const base = stacked ? (v >= 0 ? pos : neg) : 0;
        const from = y(base);
        const to = y(base + v);
        if (stacked) {
          if (v >= 0) pos += v;
          else neg += v;
        }
        const x0 = left + band * i + (band - inner) / 2 + (stacked ? 0 : k * (barW + 2));
        const h = Math.abs(to - from);
        const yTop = Math.min(from, to);
        const w = stacked ? inner : barW;
        // A 4px rounded end away from the baseline, square where it stands; a 2px gap between stacked parts.
        const r = Math.min(4, w / 2, h);
        const gap = stacked && h > 2 ? 1 : 0;
        const d =
          v >= 0
            ? `M ${x0} ${yTop + h - gap} V ${yTop + r + gap} Q ${x0} ${yTop + gap} ${x0 + r} ${yTop + gap} H ${x0 + w - r} Q ${x0 + w} ${yTop + gap} ${x0 + w} ${yTop + r + gap} V ${yTop + h - gap} Z`
            : `M ${x0} ${yTop + gap} V ${yTop + h - r - gap} Q ${x0} ${yTop + h - gap} ${x0 + r} ${yTop + h - gap} H ${x0 + w - r} Q ${x0 + w} ${yTop + h - gap} ${x0 + w} ${yTop + h - r - gap} V ${yTop + gap} Z`;
        parts.push(
          `<path d="${d}" fill="${SERIES[k]}"><title>${esc(`${s.name}, ${chart.labels[i] ?? ''}: ${format(v, chart.unit)}`)}</title></path>`,
        );
      });
    }
  } else {
    const xAt = (i: number) => left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    series.forEach((s, k) => {
      const color = SERIES[k] ?? MUTED;
      const points = s.values
        .map((v, i) => (typeof v === 'number' && Number.isFinite(v) ? [xAt(i), y(v)] : undefined))
        .filter((p): p is number[] => p !== undefined);
      if (!points.length) return;
      const line = points
        .map(([px, py], i) => `${i ? 'L' : 'M'} ${px?.toFixed(1)} ${py?.toFixed(1)}`)
        .join(' ');
      if (chart.type === 'area') {
        const first = points[0] ?? [left, 0];
        const last = points.at(-1) ?? [left, 0];
        parts.push(
          `<path d="${line} L ${last[0]?.toFixed(1)} ${y(Math.max(min, 0)).toFixed(1)} L ${first[0]?.toFixed(1)} ${y(Math.max(min, 0)).toFixed(1)} Z" fill="${color}" fill-opacity="${series.length > 1 ? 0.14 : 0.2}"/>`,
        );
      }
      parts.push(
        `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
      if (points.length <= 24)
        for (const [px, py] of points)
          parts.push(
            `<circle cx="${px?.toFixed(1)}" cy="${py?.toFixed(1)}" r="4" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>`,
          );
      // Direct labels at the end for up to four lines.
      if (right > 32) {
        const last = points.at(-1) ?? [0, 0];
        parts.push(
          `<text x="${((last[0] ?? 0) + 10).toFixed(1)}" y="${((last[1] ?? 0) + 4).toFixed(1)}" font-size="13" fill="${INK}">${esc(clip(s.name, 16))}</text>`,
        );
      }
    });
  }

  if (legend) {
    let lx = left;
    const ly = height - 34;
    series.forEach((s, k) => {
      const label = clip(s.name, 24);
      parts.push(
        `<rect x="${lx}" y="${ly - 11}" width="14" height="14" rx="3" fill="${SERIES[k]}"/><text x="${lx + 20}" y="${ly}" font-size="13" fill="${SOFT}">${esc(label)}</text>`,
      );
      lx += 20 + label.length * 7.4 + 22;
    });
  }
  return wrap(parts.join(''), chart);
}

function wrap(body: string, chart: Chart) {
  const { width, height } = CHART_SIZE;
  const label = esc(chart.title ?? `${chart.type} chart`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}" font-family='${FONT}'><title>${label}</title><rect width="${width}" height="${height}" fill="${SURFACE}"/>${body}</svg>\n`;
}

/** The chart as a page to photograph. */
export function chartPage(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${SURFACE}}svg{display:block}</style></head><body>${svg}</body></html>`;
}

/** The chart's numbers as a table (Markdown), for the model and for anyone who can't see it. */
export function chartTable(chart: Chart): string {
  const head = `| | ${chart.series.map((s) => s.name.replaceAll('|', '/')).join(' | ')} |`;
  const rule = `|---|${chart.series.map(() => '---:').join('|')}|`;
  const rows = chart.labels.map(
    (label, i) =>
      `| ${label.replaceAll('|', '/')} | ${chart.series.map((s) => s.values[i] ?? '').join(' | ')} |`,
  );
  return [head, rule, ...rows].join('\n');
}
