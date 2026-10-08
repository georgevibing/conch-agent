/**
 * Reading a forecast: what a WMO code looks like, the time of day a sky has,
 * words for UV and the air, and times written the way the place reads them.
 * Pure, so the card and its tests share one reading.
 */

/** What the art draws. */
export type Condition =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'sleet'
  | 'snow'
  | 'storm';

/** The light the sky is in. */
export type SkyTime = 'dawn' | 'day' | 'dusk' | 'night';

const WORDS: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

/** "Light rain": a WMO code in plain words. A clear night is "Clear", never "Sunny". */
export const conditionWords = (code: number) => WORDS[code] ?? 'Unsettled';

export function conditionOf(code: number): Condition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

/** How heavy rain or snow is, for how much of it the art draws: 1–3. */
export function intensityOf(code: number): 1 | 2 | 3 {
  if ([55, 65, 67, 75, 82, 86, 99].includes(code)) return 3;
  if ([53, 63, 73, 81, 96].includes(code)) return 2;
  return 1;
}

/** Minutes since midnight of a wall-clock time (`2026-10-08T14:05`). */
export function minutesOf(time: string): number {
  const hh = Number(time.slice(11, 13));
  const mm = Number(time.slice(14, 16));
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
}

/** How long the edge of day lasts either side of sunrise and sunset. */
const TWILIGHT = 45;

/** Dawn and dusk near the sun's edges, else day or night. */
export function skyTimeOf(
  time: string,
  isDay: boolean,
  sunrise?: string,
  sunset?: string,
): SkyTime {
  const at = minutesOf(time);
  if (sunrise && Math.abs(at - minutesOf(sunrise)) <= TWILIGHT) return 'dawn';
  if (sunset && Math.abs(at - minutesOf(sunset)) <= TWILIGHT) return 'dusk';
  return isDay ? 'day' : 'night';
}

/** A wall-clock time as a Date whose UTC fields are the place's: format it with `timeZone: 'UTC'`. */
export const wallDate = (time: string) =>
  new Date(`${time.length === 10 ? `${time}T00:00` : time.slice(0, 16)}:00Z`);

export interface Clock {
  locale?: string;
}

/** "14:00" or "2 PM", as the reader's locale writes an hour. */
export function hourLabel(time: string, { locale }: Clock = {}): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(
    wallDate(time),
  );
}

/** "14:45" or "2:45 PM". */
export function timeLabel(time: string, { locale }: Clock = {}): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(wallDate(time));
}

/** "Fri", or "Friday" when `long`. */
export function weekday(date: string, { locale }: Clock = {}, long = false): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: long ? 'long' : 'short',
    timeZone: 'UTC',
  }).format(wallDate(date));
}

/** Where the wind comes from, as a compass point: "WSW". */
export function compass(degrees: number): string {
  const points = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return points[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}

/** A UV index in the WHO's words. */
export function uvWords(uv: number): string {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}

export interface AirReading {
  value: number;
  /** "European AQI" or "US AQI". */
  scale: string;
  words: string;
  /** Where it sits from clean (0) to the top of the scale (1). */
  level: number;
}

/** The air in words, on the scale its readers know: the US index for imperial units, else the European one. */
export function airReading(
  air: { european?: number; us?: number } | undefined,
  preferUs: boolean,
): AirReading | undefined {
  if (!air) return undefined;
  const us = air.us;
  const eu = air.european;
  if (us !== undefined && (preferUs || eu === undefined)) {
    const words =
      us <= 50
        ? 'Good'
        : us <= 100
          ? 'Moderate'
          : us <= 150
            ? 'Unhealthy for some'
            : us <= 200
              ? 'Unhealthy'
              : us <= 300
                ? 'Very unhealthy'
                : 'Hazardous';
    return { value: us, scale: 'US AQI', words, level: Math.min(1, us / 300) };
  }
  if (eu === undefined) return undefined;
  const words =
    eu <= 20
      ? 'Good'
      : eu <= 40
        ? 'Fair'
        : eu <= 60
          ? 'Moderate'
          : eu <= 80
            ? 'Poor'
            : eu <= 100
              ? 'Very poor'
              : 'Extremely poor';
  return { value: eu, scale: 'European AQI', words, level: Math.min(1, eu / 100) };
}

/**
 * A temperature's hue, cool to warm: blue below freezing, teal when it's
 * cool, green when mild, amber when warm, coral when hot. Read in °C.
 */
const TEMP_STOPS: readonly (readonly [number, number])[] = [
  [-15, 265],
  [0, 230],
  [10, 190],
  [18, 140],
  [24, 70],
  [32, 45],
  [40, 25],
];

export function tempHue(celsius: number): number {
  let [t0, h0] = TEMP_STOPS[0] ?? [0, 230];
  if (celsius <= t0) return h0;
  for (const [t1, h1] of TEMP_STOPS) {
    if (celsius <= t1) return Math.round(h0 + ((celsius - t0) / (t1 - t0 || 1)) * (h1 - h0));
    [t0, h0] = [t1, h1];
  }
  return h0;
}

export const toCelsius = (t: number, imperial: boolean) => (imperial ? ((t - 32) * 5) / 9 : t);

/**
 * A smooth line through points that never overshoots them (monotone cubic,
 * Fritsch–Carlson), so a curve of temperatures has no bumps the hours don't.
 */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  if (n === 0) return '';
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = (i: number) => xs[i] ?? 0;
  const y = (i: number) => ys[i] ?? 0;
  const r = (v: number) => Math.round(v * 100) / 100;
  if (n === 1) return `M${r(x(0))},${r(y(0))}`;
  const dx = Array.from({ length: n - 1 }, (_, i) => x(i + 1) - x(i));
  const slope = dx.map((d, i) => (y(i + 1) - y(i)) / (d || 1));
  const at = (list: number[], i: number) => list[i] ?? 0;
  const m = Array.from({ length: n }, (_, i) => {
    if (i === 0) return at(slope, 0);
    if (i === n - 1) return at(slope, n - 2);
    const a = at(slope, i - 1);
    const b = at(slope, i);
    if (a * b <= 0) return 0;
    const d0 = at(dx, i - 1);
    const d1 = at(dx, i);
    return (3 * (d0 + d1)) / ((2 * d1 + d0) / a + (d1 + 2 * d0) / b);
  });
  let d = `M${r(x(0))},${r(y(0))}`;
  for (let i = 0; i < n - 1; i++) {
    const h = at(dx, i) / 3;
    d += `C${r(x(i) + h)},${r(y(i) + at(m, i) * h)} ${r(x(i + 1) - h)},${r(y(i + 1) - at(m, i + 1) * h)} ${r(x(i + 1))},${r(y(i + 1))}`;
  }
  return d;
}
