/**
 * The weather, for every model (ADR 0060 §7): a place found by name, the sky
 * now, the next day hour by hour, up to ten days, the sun, UV and the air.
 * The person sees it as a card; the model reads a compact summary.
 *
 * From Open-Meteo, which needs no key: its geocoding finds the place, its
 * forecast and air quality services read it. Only the place's name (or the
 * coordinates) and the units leave this computer, through the public-web
 * fetcher's SSRF guard. Everything that comes back is data, never words for
 * the model to follow, and every string the card keeps is drawn as text.
 */
import { unitsForTimeZone, WeatherView, type WeatherUnits } from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { AppFetcher } from '../conchapps/types';
import type { HostTool } from '../engines/types';

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** How many hours the card's strip scrubs through. */
const HOURS = 24;

/** WMO weather codes in plain words. */
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
export const weatherWords = (code: number) => WORDS[code] ?? 'Unsettled';

/**
 * The units the person reads when they didn't say: from this computer's time
 * zone (Conch runs on their computer), not its language, which is often
 * English (US) far from the US.
 */
export const homeUnits = (timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) =>
  unitsForTimeZone(timeZone);

const Place = z.object({
  name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  timezone: z.string().optional(),
});
type Place = z.infer<typeof Place>;

const Num = z.number().nullable().optional();
const Nums = z.array(z.number().nullable());
const Times = z.array(z.string());

const Forecast = z.object({
  timezone: z.string(),
  utc_offset_seconds: z.number(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    apparent_temperature: Num,
    relative_humidity_2m: Num,
    is_day: Num,
    weather_code: z.number(),
    pressure_msl: Num,
    wind_speed_10m: Num,
    wind_direction_10m: Num,
    wind_gusts_10m: Num,
    uv_index: Num,
  }),
  hourly: z.object({
    time: Times,
    temperature_2m: Nums,
    weather_code: Nums,
    precipitation_probability: Nums.optional(),
    is_day: Nums.optional(),
  }),
  daily: z.object({
    time: Times,
    weather_code: Nums,
    temperature_2m_max: Nums,
    temperature_2m_min: Nums,
    precipitation_sum: Nums.optional(),
    precipitation_probability_max: Nums.optional(),
    sunrise: z.array(z.string().nullable()).optional(),
    sunset: z.array(z.string().nullable()).optional(),
    uv_index_max: Nums.optional(),
  }),
});
type Forecast = z.infer<typeof Forecast>;

const Air = z.object({
  current: z.object({ european_aqi: Num, us_aqi: Num }),
});

const one = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const wall = (t: string) => t.slice(0, 16);
const where = (p: Pick<Place, 'name' | 'admin1' | 'country'>) =>
  [p.name, p.admin1 !== p.name ? p.admin1 : undefined, p.country].filter(Boolean).join(', ');

/** "Paris, Texas" → the name to look up and the words that tell which Paris. */
export function placeQuery(text: string): { name: string; hints: string[] } {
  const [name = '', ...rest] = text.split(',').map((s) => s.trim());
  return { name, hints: rest.filter(Boolean).map((h) => h.toLowerCase()) };
}

/** The best of the places found: the one the hints name, else the first (the service puts the biggest first). */
export function pickPlace(found: Place[], hints: string[]): Place | undefined {
  if (!hints.length) return found[0];
  const score = (p: Place) =>
    hints.filter((h) =>
      [p.admin1, p.admin2, p.country, p.country_code].some((field) => {
        const f = field?.toLowerCase();
        return f && (f === h || f.startsWith(h) || (h.length > 3 && f.includes(h)));
      }),
    ).length;
  let best = found[0];
  for (const p of found) if (best && score(p) > score(best)) best = p;
  return best;
}

/** The forecast as the card draws it. */
export function weatherView(
  place: { name: string; region?: string; country?: string },
  units: WeatherUnits,
  forecast: Forecast,
  days: number,
  air?: { european?: number; us?: number },
): WeatherView {
  const { current: c, hourly: h, daily: d } = forecast;
  const now = wall(c.time);
  // The strip starts at the hour we're in.
  const thisHour = `${now.slice(0, 13)}:00`;
  const first = Math.max(
    0,
    h.time.findIndex((t) => wall(t) >= thisHour),
  );
  const hourly = h.time.slice(first, first + HOURS).flatMap((time, k) => {
    const i = first + k;
    const temp = num(h.temperature_2m[i]);
    const code = num(h.weather_code[i]);
    if (temp === undefined || code === undefined) return [];
    const prob = num(h.precipitation_probability?.[i]);
    return [
      {
        time: wall(time),
        temp: one(temp),
        code,
        ...(prob !== undefined && { precipProb: clamp(Math.round(prob), 0, 100) }),
        isDay: (num(h.is_day?.[i]) ?? 1) === 1,
      },
    ];
  });
  const daily = d.time.slice(0, days).flatMap((date, i) => {
    const min = num(d.temperature_2m_min[i]);
    const max = num(d.temperature_2m_max[i]);
    const code = num(d.weather_code[i]);
    if (min === undefined || max === undefined || code === undefined) return [];
    const sum = num(d.precipitation_sum?.[i]);
    const prob = num(d.precipitation_probability_max?.[i]);
    const uv = num(d.uv_index_max?.[i]);
    const rise = d.sunrise?.[i];
    const set = d.sunset?.[i];
    return [
      {
        date: date.slice(0, 10),
        min: one(min),
        max: one(max),
        code,
        ...(sum !== undefined && { precipSum: one(Math.max(0, sum)) }),
        ...(prob !== undefined && { precipProb: clamp(Math.round(prob), 0, 100) }),
        ...(rise && { sunrise: wall(rise) }),
        ...(set && { sunset: wall(set) }),
        ...(uv !== undefined && { uvMax: one(clamp(uv, 0, 30)) }),
      },
    ];
  });
  const uv = num(c.uv_index);
  const gusts = num(c.wind_gusts_10m);
  const pressure = num(c.pressure_msl);
  const prob = hourly[0]?.precipProb;
  const view = {
    kind: 'weather' as const,
    place,
    at: now,
    timezone: forecast.timezone.slice(0, 80),
    utcOffset: clamp(Math.round(forecast.utc_offset_seconds / 60), -1080, 1080),
    units,
    current: {
      temp: one(c.temperature_2m),
      feels: one(num(c.apparent_temperature) ?? c.temperature_2m),
      code: c.weather_code,
      isDay: (num(c.is_day) ?? 1) === 1,
      wind: one(Math.max(0, num(c.wind_speed_10m) ?? 0)),
      windDir: clamp(Math.round(num(c.wind_direction_10m) ?? 0), 0, 360),
      ...(gusts !== undefined && { gusts: one(Math.max(0, gusts)) }),
      humidity: clamp(Math.round(num(c.relative_humidity_2m) ?? 0), 0, 100),
      ...(prob !== undefined && { precipProb: prob }),
      ...(uv !== undefined && { uv: one(clamp(uv, 0, 30)) }),
      ...(pressure !== undefined &&
        pressure >= 800 &&
        pressure <= 1200 && { pressure: Math.round(pressure) }),
    },
    hourly,
    daily,
    ...(air && (air.european !== undefined || air.us !== undefined) && { airQuality: air }),
    source: 'Open-Meteo',
  };
  return WeatherView.parse(view);
}

/** What the model reads: a sentence, then the numbers it might need, small. */
export function weatherText(view: WeatherView, alternatives: string[] = []): string {
  const u =
    view.units === 'imperial' ? { t: '°F', w: 'mph', p: 'in' } : { t: '°C', w: 'km/h', p: 'mm' };
  const r = Math.round;
  const place = where({
    name: view.place.name,
    admin1: view.place.region,
    country: view.place.country,
  });
  const c = view.current;
  const today = view.daily[0];
  const summary = [
    `${place}: ${r(c.temp)}${u.t} and ${weatherWords(c.code).toLowerCase()} now, feels like ${r(c.feels)}${u.t}.`,
    today &&
      `Today ${r(today.min)}–${r(today.max)}${u.t}${today.precipProb !== undefined ? `, ${today.precipProb}% chance of rain or snow` : ''}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return JSON.stringify({
    summary,
    note: 'The person sees this forecast as a card. Answer what they asked in a sentence or two; don’t repeat the forecast.',
    place,
    ...(alternatives.length && {
      otherPlacesWithThisName: alternatives,
      ifWrongPlace: 'Call weather again with the region or country, e.g. "Paris, Texas".',
    }),
    localTime: view.at,
    timezone: view.timezone,
    units: { temperature: u.t, wind: u.w, precipitation: u.p },
    now: {
      temp: c.temp,
      feels: c.feels,
      sky: weatherWords(c.code),
      wind: c.wind,
      windFrom: c.windDir,
      ...(c.gusts !== undefined && { gusts: c.gusts }),
      humidity: c.humidity,
      ...(c.uv !== undefined && { uv: c.uv }),
    },
    // Every third hour is enough to answer "will it rain this afternoon?".
    hours: view.hourly
      .filter((_, i) => i % 3 === 0)
      .map((h) => [h.time.slice(11), h.temp, weatherWords(h.code), h.precipProb ?? null]),
    hoursColumns: ['time', 'temp', 'sky', 'precipitation %'],
    days: view.daily.map((d) => ({
      date: d.date,
      min: d.min,
      max: d.max,
      sky: weatherWords(d.code),
      ...(d.precipProb !== undefined && { precipProb: d.precipProb }),
      ...(d.precipSum !== undefined && { precip: d.precipSum }),
      ...(d.sunrise && { sunrise: d.sunrise.slice(11) }),
      ...(d.sunset && { sunset: d.sunset.slice(11) }),
      ...(d.uvMax !== undefined && { uvMax: d.uvMax }),
    })),
    ...(view.airQuality && { airQuality: view.airQuality }),
    source: 'Open-Meteo',
  });
}

const Input = {
  place: z.string().trim().min(1).max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  days: z.number().int().min(1).max(10).default(7),
  units: z.enum(['metric', 'imperial']).optional(),
};

export interface WeatherOptions {
  /** The units when the model doesn't say: this computer's time zone's. */
  units?: () => WeatherUnits;
  /** The language place names are given in. */
  language?: () => string;
}

export function weatherTool(
  ctx: ToolContext,
  fetcher: AppFetcher,
  options: WeatherOptions = {},
): HostTool {
  const get = async (base: string, params: Record<string, string>, what: string) => {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await fetcher(
      { id: `weather-${ctx.conversationId}`, reaches: [url.hostname] },
      { url: url.href, method: 'GET', headers: { accept: 'application/json' } },
      ctx.signal,
    );
    ctx.signal.throwIfAborted();
    if (response.refused) throw new Error(`${what}: ${response.refused}`);
    if (!response.ok)
      throw new Error(
        `${what} answered ${response.status}. Try again in a moment, or use web_search for the forecast.`,
      );
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      throw new Error(`${what} sent something that isn't a forecast. Use web_search instead.`);
    }
  };

  const find = async (text: string, language: string) => {
    const { name, hints } = placeQuery(text);
    // "Berlin Germany" without a comma: try the leading words, the rest as hints.
    const words = name.split(/\s+/).filter(Boolean);
    for (let keep = words.length; keep >= Math.max(1, words.length - 2); keep--) {
      const query = words.slice(0, keep).join(' ');
      const extra = words.slice(keep).map((w) => w.toLowerCase());
      const body = await get(
        GEOCODE,
        { name: query, count: '6', language, format: 'json' },
        'The place finder',
      );
      const results = z
        .object({ results: z.array(z.unknown()).optional() })
        .parse(body)
        .results?.flatMap((r) => {
          const p = Place.safeParse(r);
          return p.success ? [p.data] : [];
        });
      if (results?.length) {
        const chosen = pickPlace(results, [...hints, ...extra]);
        if (chosen) return { chosen, all: results };
      }
    }
    return undefined;
  };

  return {
    name: 'weather',
    effect: 'read',
    row: true,
    searchHint: 'weather forecast rain snow temperature wind sunrise sunset uv air quality',
    description:
      'The weather for a place: now, the next 24 hours, and up to 10 days, with sunrise, sunset, UV and air quality. Use it whenever the person asks about the weather, the temperature, rain or snow, what to wear, whether to take an umbrella or go out, or when the sun rises or sets. Give a place name ("Lisbon", "Paris, Texas" — add the region or country when it could be another place) or latitude and longitude. Leave units out unless the person asked for °C or °F or you know which they read: Conch picks them from where they are, and the card has a °C/°F switch. The person sees the forecast as a card, so reply in a sentence or two that answers their question; don’t list the forecast. Only the place name or coordinates are sent, to Open-Meteo.',
    aliases: { place: ['location', 'city', 'query', 'q', 'name'] },
    input: Input,
    run: async (raw) => {
      const args = z.object(Input).parse(raw);
      const units = args.units ?? options.units?.() ?? homeUnits();
      const language = (options.language?.() ?? Intl.DateTimeFormat().resolvedOptions().locale)
        .slice(0, 2)
        .toLowerCase();
      let place: { name: string; region?: string; country?: string };
      let lat: number, lon: number;
      let alternatives: string[] = [];
      if (args.latitude !== undefined && args.longitude !== undefined) {
        lat = args.latitude;
        lon = args.longitude;
        place = {
          name: args.place?.slice(0, 200) ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
        };
      } else if (args.place) {
        const found = await find(args.place, language);
        if (!found)
          throw new Error(
            `No place called “${args.place}” was found. Check the spelling, try the nearest town, or give latitude and longitude.`,
          );
        lat = found.chosen.latitude;
        lon = found.chosen.longitude;
        place = {
          name: found.chosen.name.slice(0, 200),
          ...(found.chosen.admin1 &&
            found.chosen.admin1 !== found.chosen.name && {
              region: found.chosen.admin1.slice(0, 200),
            }),
          ...(found.chosen.country && { country: found.chosen.country.slice(0, 120) }),
        };
        alternatives = found.all
          .filter((p) => p !== found.chosen)
          .slice(0, 4)
          .map((p) => where(p));
      } else {
        throw new Error(
          'Say which place: a name like “Lisbon” or “Paris, Texas”, or latitude and longitude. If the person didn’t say, ask them, or use a place you know they live.',
        );
      }
      const imperial = units === 'imperial';
      const coords = { latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto' };
      const [forecastBody, airBody] = await Promise.all([
        get(
          FORECAST,
          {
            ...coords,
            current:
              'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
            hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
            daily:
              'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max',
            // Two days at least, so the strip always has its 24 hours.
            forecast_days: String(Math.max(2, args.days)),
            temperature_unit: imperial ? 'fahrenheit' : 'celsius',
            wind_speed_unit: imperial ? 'mph' : 'kmh',
            precipitation_unit: imperial ? 'inch' : 'mm',
          },
          'The forecast service',
        ),
        // The air is a nice-to-have: the forecast stands without it.
        get(AIR, { ...coords, current: 'european_aqi,us_aqi' }, 'The air quality service').catch(
          () => undefined,
        ),
      ]);
      const forecast = Forecast.safeParse(forecastBody);
      if (!forecast.success)
        throw new Error(
          'The forecast service sent an unexpected answer. Use web_search for the forecast.',
        );
      const airNow = Air.safeParse(airBody).data?.current;
      const eu = num(airNow?.european_aqi);
      const us = num(airNow?.us_aqi);
      const air = {
        ...(eu !== undefined && { european: Math.round(clamp(eu, 0, 1000)) }),
        ...(us !== undefined && { us: Math.round(clamp(us, 0, 1000)) }),
      };
      const view = weatherView(place, units, forecast.data, args.days, air);
      return { text: weatherText(view, alternatives), view };
    },
  };
}
