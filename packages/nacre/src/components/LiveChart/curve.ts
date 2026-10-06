/** A point on a chart, in pixels. */
export type Point = readonly [x: number, y: number];

/**
 * A smooth line through points that never overshoots them (monotone cubic,
 * Fritsch–Carlson): a reading of 0 never dips below the baseline and a peak
 * never bulges past itself, so the curve only ever says what was measured.
 */
export function monotonePath(points: readonly Point[]): string {
  const n = points.length;
  const first = points[0];
  if (!first) return '';
  const f = (v: number) => Number(v.toFixed(2));
  if (n === 1) return `M${f(first[0])},${f(first[1])}`;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    dx.push(d);
    slope.push(d === 0 ? 0 : ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / d);
  }
  const tangent: number[] = new Array<number>(n).fill(0);
  tangent[0] = slope[0] ?? 0;
  tangent[n - 1] = slope[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1] ?? 0;
    const b = slope[i] ?? 0;
    tangent[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i] ?? 0;
    if (s === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = (tangent[i] ?? 0) / s;
    const b = (tangent[i + 1] ?? 0) / s;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * s;
      tangent[i + 1] = t * b * s;
    }
  }
  let d = `M${f(first[0])},${f(first[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i] ?? 0;
    const y0 = ys[i] ?? 0;
    const x1 = xs[i + 1] ?? 0;
    const y1 = ys[i + 1] ?? 0;
    const third = (dx[i] ?? 0) / 3;
    d += `C${f(x0 + third)},${f(y0 + (tangent[i] ?? 0) * third)},${f(x1 - third)},${f(y1 - (tangent[i + 1] ?? 0) * third)},${f(x1)},${f(y1)}`;
  }
  return d;
}

/** Runs of points between gaps (a `null` reading is a gap, never a zero). */
export function runs<T>(
  values: readonly (T | null | undefined)[],
): { start: number; items: T[] }[] {
  const out: { start: number; items: T[] }[] = [];
  let current: { start: number; items: T[] } | undefined;
  values.forEach((value, i) => {
    if (value == null) {
      current = undefined;
      return;
    }
    if (!current) {
      current = { start: i, items: [] };
      out.push(current);
    }
    current.items.push(value);
  });
  return out;
}

/** A clean top for an axis: 1, 2, 2.5 or 5 times a power of ten, at or above `max`. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= max) ?? 10;
  return step * power;
}
