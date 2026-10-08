import type { WeatherData } from './types';

/** Made-up forecasts for stories and tests: plausible, and the same every time. */

const pad = (n: number) => String(n).padStart(2, '0');

function addHours(date: string, hour: number, add: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hour + add);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`;
}

const dateAfter = (date: string, days: number) => addHours(date, 0, days * 24).slice(0, 10);

export interface SampleOptions {
  place?: WeatherData['place'];
  /** The hour it's read, 0–23. */
  hour?: number;
  minute?: number;
  date?: string;
  /** The WMO code now, and the next day's pattern of codes (repeats). */
  code?: number;
  codes?: number[];
  /** Today's low and high, °C (converted for imperial). */
  low?: number;
  high?: number;
  days?: number;
  units?: WeatherData['units'];
  rain?: number;
  sunrise?: string;
  sunset?: string;
  air?: WeatherData['airQuality'];
  alerts?: WeatherData['alerts'];
  uv?: number;
}

/** A forecast with a daily rhythm: coolest before dawn, warmest mid-afternoon. */
export function sampleWeather({
  place = { name: 'Lisbon', country: 'Portugal' },
  hour = 14,
  minute = 20,
  date = '2026-10-08',
  code = 1,
  codes,
  low = 15,
  high = 24,
  days = 7,
  units = 'metric',
  rain,
  sunrise = '07:28',
  sunset = '19:05',
  air = { european: 22, us: 38 },
  alerts,
  uv,
}: SampleOptions = {}): WeatherData {
  const imperial = units === 'imperial';
  const t = (c: number) => Math.round((imperial ? (c * 9) / 5 + 32 : c) * 10) / 10;
  const riseH = Number(sunrise.slice(0, 2));
  const setH = Number(sunset.slice(0, 2));
  const tempAt = (h: number, dayLow: number, dayHigh: number) => {
    // Coolest at 6:00, warmest at 15:00.
    const after = h < 6 ? h + 24 : h;
    const f =
      h >= 6 && h <= 15
        ? (1 - Math.cos((Math.PI * (h - 6)) / 9)) / 2
        : (1 + Math.cos((Math.PI * (after - 15)) / 15)) / 2;
    return dayLow + (dayHigh - dayLow) * f;
  };
  const wetCode = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  const snowCode = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const pattern = codes ?? [code];
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const time = addHours(date, hour, i);
    const h = Number(time.slice(11, 13));
    const c = i === 0 ? code : (pattern[Math.floor(i / 3) % pattern.length] ?? code);
    const wet = wetCode(c) || snowCode(c);
    return {
      time,
      temp: t(Math.round(tempAt(h, low, high) * 10) / 10),
      code: c,
      precipProb:
        rain ?? (wet ? 55 + ((i * 17) % 40) : c === 3 ? 10 + ((i * 7) % 15) : (i * 3) % 8),
      isDay: h >= riseH && h < setH,
    };
  });
  const dayCodes = [code, 2, 61, 3, 0, 80, 1, 2, 63, 0];
  const daily = Array.from({ length: days }, (_, i) => {
    const d = dateAfter(date, i);
    const swing = [0, -1.5, -3, -0.5, 1.5, 2.5, 0.5, -2, -4, 1][i] ?? 0;
    const c = i === 0 ? code : (dayCodes[i] ?? 2);
    const wet = wetCode(c) || snowCode(c);
    return {
      date: d,
      min: t(low + swing - (i % 3 === 1 ? 1 : 0)),
      max: t(high + swing + (i % 4 === 2 ? 1.5 : 0)),
      code: c,
      precipSum: wet ? Math.round((imperial ? 0.12 : 3.2) * (1 + (i % 3)) * 10) / 10 : 0,
      precipProb: wet ? 60 + ((i * 13) % 35) : (i * 7) % 15,
      sunrise: `${d}T${sunrise.slice(0, 3)}${pad(Math.min(59, Number(sunrise.slice(3)) + i))}`,
      sunset: `${d}T${sunset.slice(0, 3)}${pad(Math.max(0, Number(sunset.slice(3)) - i))}`,
      uvMax: i === 0 ? (uv ?? 4) + 1 : Math.max(0, (uv ?? 5) - (wet ? 2 : 0) + ((i * 5) % 3) - 1),
    };
  });
  const first = hourly[0] ?? { temp: t(low), precipProb: 0 };
  const nowH = hour + minute / 60;
  const isDay = nowH >= riseH && nowH < setH;
  return {
    place,
    at: `${date}T${pad(hour)}:${pad(minute)}`,
    timezone: 'Europe/Lisbon',
    utcOffset: 60,
    units,
    current: {
      temp: first.temp,
      feels: Math.round((first.temp - (imperial ? 2 : 1.2)) * 10) / 10,
      code,
      isDay,
      wind: imperial ? 9 : 14,
      windDir: 315,
      gusts: imperial ? 21 : 34,
      humidity: wetCode(code) ? 88 : 61,
      precipProb: first.precipProb,
      uv: isDay ? (uv ?? 4) : 0,
      pressure: 1016,
    },
    hourly,
    daily,
    ...(air && { airQuality: air }),
    ...(alerts && { alerts }),
    source: 'Open-Meteo',
  };
}
