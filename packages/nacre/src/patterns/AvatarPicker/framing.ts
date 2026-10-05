/**
 * Framing a photo in a square: where it sits and how close, in units of the
 * square's side (so the same frame works at any size on screen, and at any
 * size it's drawn out at).
 */

export interface PhotoSize {
  width: number;
  height: number;
}

/** `zoom` 1 just covers the square; `x`/`y` move the photo's centre from the square's. */
export interface Frame {
  zoom: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 3;
export const START: Frame = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The photo's size at zoom 1: its short side fills the square. */
export function baseSize({ width, height }: PhotoSize) {
  return { w: Math.max(1, width / height), h: Math.max(1, height / width) };
}

/** Moved there, or as near as it goes without showing an edge. */
export function moveFrame(size: PhotoSize, frame: Frame, x: number, y: number): Frame {
  const base = baseSize(size);
  const roomX = (base.w * frame.zoom - 1) / 2;
  const roomY = (base.h * frame.zoom - 1) / 2;
  return { zoom: frame.zoom, x: clamp(x, -roomX, roomX), y: clamp(y, -roomY, roomY) };
}

/** Closer or further, keeping the middle of the square on the same spot of the photo. */
export function zoomFrame(size: PhotoSize, frame: Frame, zoom: number): Frame {
  const next = clamp(zoom, 1, MAX_ZOOM);
  const k = next / frame.zoom;
  return moveFrame(size, { ...frame, zoom: next }, frame.x * k, frame.y * k);
}

/** The square of the photo, in its own pixels, that the frame shows. */
export function cropOf(size: PhotoSize, frame: Frame) {
  const base = baseSize(size);
  const w = base.w * frame.zoom;
  const h = base.h * frame.zoom;
  // Photo pixels per side of the square.
  const side = size.width / w;
  return {
    x: (w / 2 - 0.5 - frame.x) * side,
    y: (h / 2 - 0.5 - frame.y) * side,
    size: side,
  };
}
