/**
 * Where everything goes. Pure, so the awkward parts — room for the axis, a
 * label that doesn't fit, a band too narrow for every category — are worked
 * out and tested without a browser.
 *
 * One pair of axes: the **value** axis carries the numbers, the **category**
 * axis the labels. Bars lying down only swap which screen direction each one
 * runs in, so there is one set of maths for columns and bars alike.
 */
import { niceScale, type Scale } from './scale';

/** About how wide a character of axis text is, measured off Geist at 11 px. */
export const CHAR = 6.4;

export interface Pads {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CartesianLayout {
  width: number;
  height: number;
  pads: Pads;
  plotW: number;
  plotH: number;
  horizontal: boolean;
  /** The value axis, with its clean ticks. */
  scale: Scale;
  /** For a scatter whose labels are numbers: the value axis across the bottom. */
  xScale?: Scale;
  /** Width of one category's slot along the category axis. */
  band: number;
  /** Draw every nth category label, so they never collide. */
  tickEvery: number;
  /** Turn the labels where straight ones wouldn't fit. */
  rotate: boolean;
  /** The most characters a category label keeps. */
  labelChars: number;
  /** A point in the plot, from a category (or an x value) and a value. */
  point: (i: number, value: number) => [x: number, y: number];
  /** The middle of category `i` along the category axis, in page pixels. */
  centre: (i: number) => number;
  /** Where a value sits along the value axis, in page pixels. */
  along: (value: number) => number;
}

export interface CartesianInput {
  width: number;
  height: number;
  horizontal: boolean;
  /** Every value that has to fit, stacked totals included. */
  values: readonly number[];
  /** The labels as they will be drawn. */
  labels: readonly string[];
  /** Include the baseline: bars and areas grow out of it. */
  zero: boolean;
  /** How wide the longest value tick reads, in characters. */
  tickChars: number;
  /** Labels that are dates are never turned: they're short already. */
  dates: boolean;
  /** x values for a scatter, when the labels are numbers. */
  xValues?: readonly number[];
}

export function cartesianLayout(input: CartesianInput): CartesianLayout {
  const { width, height, horizontal, labels, zero } = input;
  const n = Math.max(1, labels.length);
  const scale = niceScale(input.values, { zero });
  const xScale = input.xValues?.length ? niceScale(input.xValues, { zero: false }) : undefined;
  const longest = labels.reduce((most, l) => Math.max(most, l.length), 0);

  let pads: Pads;
  let rotate = false;
  let tickEvery = 1;
  let labelChars = longest;

  if (horizontal) {
    // The categories run down the left: give them a third of the card at most.
    const want = longest * CHAR + 10;
    const room = Math.min(Math.max(56, width * 0.34), want);
    labelChars = Math.max(3, Math.floor((room - 10) / CHAR));
    // Room over the plot for a goal line's name, which would otherwise land
    // on the longest bar.
    pads = { top: 18, right: 22, bottom: 26, left: room };
    const band = (height - pads.top - pads.bottom) / n;
    tickEvery = Math.max(1, Math.ceil(13 / band));
  } else {
    const left = Math.max(28, input.tickChars * CHAR + 12);
    const band = (width - left - 12) / n;
    const want = longest * CHAR + 8;
    rotate = want > band && band >= 15 && !input.dates;
    tickEvery = rotate ? Math.max(1, Math.ceil(15 / band)) : Math.max(1, Math.ceil(want / band));
    labelChars = rotate
      ? Math.min(longest, 16)
      : Math.max(3, Math.floor((band * tickEvery) / CHAR));
    // A scatter's own x axis puts its last number right at the edge.
    pads = {
      top: 12,
      right: input.xValues?.length ? 26 : 12,
      bottom: rotate ? 54 : 26,
      left,
    };
  }

  const plotW = Math.max(10, width - pads.left - pads.right);
  const plotH = Math.max(10, height - pads.top - pads.bottom);
  const catSpan = horizontal ? plotH : plotW;
  const band = catSpan / n;
  const span = scale.max - scale.min || 1;

  // A line or a scatter sits its points on the edges; a bar stands in its slot.
  const centre = (i: number) => (horizontal ? pads.top : pads.left) + band * (i + 0.5);
  const along = (value: number) =>
    horizontal
      ? pads.left + ((value - scale.min) / span) * plotW
      : pads.top + plotH - ((value - scale.min) / span) * plotH;
  const point = (i: number, value: number): [number, number] =>
    horizontal ? [along(value), centre(i)] : [centre(i), along(value)];

  return {
    width,
    height,
    pads,
    plotW,
    plotH,
    horizontal,
    scale,
    ...(xScale && { xScale }),
    band,
    tickEvery,
    rotate,
    labelChars,
    point,
    centre,
    along,
  };
}

/** Points sat on the plot's edges rather than in the middle of a slot. */
export function edgeCentre(layout: CartesianLayout, i: number, n: number): number {
  const { pads, plotW, plotH, horizontal } = layout;
  const start = horizontal ? pads.top : pads.left;
  const length = horizontal ? plotH : plotW;
  return n <= 1 ? start + length / 2 : start + (length * i) / (n - 1);
}

export interface Arc {
  from: number;
  to: number;
}

export interface RoundLayout {
  cx: number;
  cy: number;
  outer: number;
  inner: number;
  arcs: Arc[];
}

/** A pie or a ring, starting at twelve o'clock and going round clockwise. */
export function roundLayout(
  width: number,
  height: number,
  shares: readonly number[],
  donut: boolean,
): RoundLayout {
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.max(24, Math.min(width, height) / 2 - 14);
  const inner = donut ? outer * 0.6 : 0;
  let angle = -Math.PI / 2;
  const arcs = shares.map((share) => {
    const from = angle;
    angle += share * Math.PI * 2;
    return { from, to: angle };
  });
  return { cx, cy, outer, inner, arcs };
}

/** Which slice a point lands on, by its angle; nothing when it's outside the ring. */
export function sliceAt(
  layout: RoundLayout,
  dx: number,
  dy: number,
  arcs: readonly Arc[],
): number | undefined {
  const r = Math.hypot(dx, dy);
  if (r > layout.outer + 10 || (layout.inner > 0 && r < layout.inner - 10)) return undefined;
  const turn = Math.atan2(dy, dx);
  // Both in the same frame as the arcs: clockwise from twelve o'clock.
  const from = -Math.PI / 2;
  const t = ((((turn - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) + from;
  const found = arcs.findIndex((arc) => t >= arc.from && t < arc.to);
  return found >= 0 ? found : arcs.length ? arcs.length - 1 : undefined;
}
