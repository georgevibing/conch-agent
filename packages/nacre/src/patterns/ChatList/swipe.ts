/** Which way a swipe went: `start` is towards the line's end (right, in English). */
export type SwipeSide = 'start' | 'end';

/** Past this share of the row's width, letting go does the action. */
export const SWIPE_COMMIT_SHARE = 0.4;
/** A flick this fast (px per ms) does it from a shorter swipe. */
export const SWIPE_FLICK_SPEED = 0.5;
/** …but never from a twitch: a flick still travels this far. */
export const SWIPE_FLICK_MIN = 24;
/** Movement before the row decides whether the finger is swiping or scrolling. */
export const SWIPE_SLOP = 8;

/**
 * What letting go of a swipe does: the side whose action runs, or `null` to
 * spring back. `dx` is how far the row travelled (positive towards the
 * line's end), `velocity` how fast the finger was moving at the end, in px
 * per ms, `width` the row's width.
 *
 * Far enough (40% of the row) always commits; a quick flick the same way
 * commits from a shorter swipe; a flick back towards where it started
 * cancels even a long swipe, the way a person changes their mind.
 */
export function swipeOutcome(dx: number, velocity: number, width: number): SwipeSide | null {
  if (!(width > 0) || dx === 0 || !Number.isFinite(dx)) return null;
  const side: SwipeSide = dx > 0 ? 'start' : 'end';
  const distance = Math.abs(dx);
  const speed = Number.isFinite(velocity) ? velocity : 0;
  const sameWay = Math.sign(speed) === Math.sign(dx);
  if (!sameWay && Math.abs(speed) >= SWIPE_FLICK_SPEED) return null;
  if (distance >= width * SWIPE_COMMIT_SHARE) return side;
  if (sameWay && Math.abs(speed) >= SWIPE_FLICK_SPEED && distance >= SWIPE_FLICK_MIN) return side;
  return null;
}

/**
 * How far the row follows the finger. Towards a side with an action it
 * follows one to one; towards a side without one it gives a little and
 * resists, so the row feels held rather than stuck.
 */
export function swipeOffset(
  dx: number,
  width: number,
  sides: { start: boolean; end: boolean },
): number {
  const allowed = dx > 0 ? sides.start : sides.end;
  if (allowed) return Math.max(-width, Math.min(width, dx));
  // A rubber band: a sixth of the movement, never more than a few pixels.
  const give = Math.min(Math.abs(dx) / 6, 12);
  return Math.sign(dx) * give;
}
