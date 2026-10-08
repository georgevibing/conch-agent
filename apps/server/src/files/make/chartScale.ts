/**
 * The pure maths and words a chart needs, wherever it's drawn: the validated
 * categorical order, a clean axis step, and a value in a few characters.
 * Shared by the static chart a file is made of (`chart.ts`) and the live card
 * the chat draws (`research/charts.ts`), so the two never drift apart.
 *
 * Nacre mirrors these in `patterns/Charts/scale.ts` — the design system stays
 * free of server code — and `--nc-chart-1…8` mirrors `SERIES`.
 */

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

/** A clean axis step: 1, 2, 2.5 or 5 times a power of ten, for about `ticks` of them. */
export function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/** A value in a few characters: `1.2M`, `$4.5k`, `62%`, `3.4 kWh`. */
export function formatValue(value: number, unit: string | undefined): string {
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
