/**
 * How far apart Conch looks at something it waits for (ADR 0125): soon at
 * first, then further apart while nothing changes, back to soon when
 * something does. A little jitter keeps many waits from looking in step
 * (the AWS Architecture Blog's "Exponential Backoff And Jitter"), and a
 * server's own hint (`x-poll-interval`, `retry-after`) always wins.
 */

export interface Pace {
  /** The first gap, and the gap after a change, in ms. */
  base: number;
  /** The widest gap, in ms. */
  max: number;
}

/** How much wider each gap gets while nothing changes. */
export const GROWTH = 1.6;
/** ±15%: enough to spread waits apart, never enough to look much later than said. */
export const JITTER = 0.15;

export function nextGap(
  pace: Pace,
  previous: number | undefined,
  changed: boolean,
  options: { hint?: number; random?: () => number } = {},
): number {
  const plain =
    changed || previous === undefined ? pace.base : Math.min(pace.max, previous * GROWTH);
  const random = options.random ?? Math.random;
  const jittered = plain * (1 - JITTER + 2 * JITTER * random());
  const gap = Math.max(pace.base / 2, Math.min(pace.max * (1 + JITTER), jittered));
  return Math.round(Math.max(gap, options.hint ?? 0));
}

/** "40 s", "2 min", "1 h 5 min": a gap or a span, for words. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
