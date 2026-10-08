/** The few sums a map of tiles needs: Web Mercator, and words for what a place says. */

export const TILE = 256;
const MAX_LAT = 85.05112878;

/** A point's place on the world at `zoom`, in tile pixels from the top left. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

export interface Grid {
  zoom: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
}

/** Where a point sits on a grid of tiles, as fractions of its width and height (0–1 inside). */
export function onGrid(grid: Grid, lat: number, lon: number): { x: number; y: number } {
  const p = worldPixel(lat, lon, grid.zoom);
  return {
    x: (p.x - grid.x * TILE) / (grid.cols * TILE),
    y: (p.y - grid.y * TILE) / (grid.rows * TILE),
  };
}

/** The smallest grid at `zoom` that holds every point, for a map without tiles. */
export function gridAround(points: readonly { lat: number; lon: number }[], zoom: number): Grid {
  const cols = 3,
    rows = 2;
  const px = points.map((p) => worldPixel(p.lat, p.lon, zoom));
  const cx = px.reduce((a, p) => a + p.x, 0) / Math.max(1, px.length);
  const cy = px.reduce((a, p) => a + p.y, 0) / Math.max(1, px.length);
  return { zoom, cols, rows, x: cx / TILE - cols / 2, y: cy / TILE - rows / 2 };
}

/** "120 m", "1.4 km", "12 km". */
export function distanceWords(metres: number): string {
  if (metres < 950) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, '') : Math.round(km).toLocaleString('en')} km`;
}

/** Whether a place is open now, as its hours say on its own clock. */
export interface PlaceOpenState {
  open: boolean;
  /** When that changes: closes at, or opens at ("18:00"). */
  at?: string;
  /** The day it changes, when that isn't today ("Mon"). */
  day?: string;
  /** Open all day, every day. */
  always?: boolean;
}

/** "Open now · closes 18:00", "Closed · opens Mon 09:00", "Open 24 hours". */
export function openWords(state: PlaceOpenState): { state: string; next?: string } {
  if (state.always) return { state: 'Open 24 hours' };
  const when = state.at ? `${state.day ? `${state.day} ` : ''}${state.at}` : undefined;
  return state.open
    ? { state: 'Open now', ...(when && { next: `closes ${when}` }) }
    : { state: 'Closed', ...(when && { next: `opens ${when}` }) };
}

const CLAMP = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How the map is moved: scale ≥ 1, and the top-left corner's offset in fractions of the frame. */
export interface View {
  s: number;
  tx: number;
  ty: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/** Kept inside the mosaic: never a gap at an edge. */
export function clampView(v: View): View {
  const s = CLAMP(v.s, MIN_SCALE, MAX_SCALE);
  return { s, tx: CLAMP(v.tx, 1 - s, 0), ty: CLAMP(v.ty, 1 - s, 0) };
}

/** Zoomed by `factor` around a point of the frame (fractions), so that point stays put. */
export function zoomAt(v: View, factor: number, fx = 0.5, fy = 0.5): View {
  const s = CLAMP(v.s * factor, MIN_SCALE, MAX_SCALE);
  const wx = (fx - v.tx) / v.s,
    wy = (fy - v.ty) / v.s;
  return clampView({ s, tx: fx - wx * s, ty: fy - wy * s });
}

/** Moved so a point of the mosaic (fractions) is in the middle, at scale `s`. */
export function centreOn(point: { x: number; y: number }, s: number): View {
  return clampView({ s, tx: 0.5 - point.x * s, ty: 0.5 - point.y * s });
}
