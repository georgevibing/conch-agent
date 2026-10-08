/**
 * The weather, as a forecast service read it (ADR 0060 §7): a place, the sky
 * now, the next day hour by hour, up to ten days, the sun, UV and the air.
 * Drawn as a card in the chat; the model reads the tool's text instead.
 *
 * Times are the place's own wall-clock times (`2026-10-08T14:00`, no offset),
 * as the forecast gives them, so they're shown as people there read them.
 * `utcOffset` places them on the clock when that's needed.
 */
import { z } from 'zod';

/** A place's wall-clock time: `2026-10-08T14:00`, or with seconds. */
const LocalTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/);
/** A place's calendar date: `2026-10-08`. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A WMO weather code (0 clear … 99 thunderstorm with heavy hail). */
const WeatherCode = z.number().int().min(0).max(99);
const Temp = z.number().min(-150).max(150);
const Percent = z.number().min(0).max(100);
const Uv = z.number().min(0).max(30);

export const WeatherUnits = z.enum(['metric', 'imperial']);
export type WeatherUnits = z.infer<typeof WeatherUnits>;

/** Time zones of the places that read °F and mph: the United States and its territories, Liberia, Myanmar. */
const IMPERIAL_ZONE =
  /^(?:US\/|America\/(?:New_York|Detroit|Kentucky\/|Indiana\/|Chicago|Menominee|North_Dakota\/|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Puerto_Rico|St_Thomas)|Pacific\/(?:Honolulu|Guam|Saipan|Pago_Pago)|Africa\/Monrovia|Asia\/(?:Yangon|Rangoon))/;

/**
 * The units someone reads, from where they are: their time zone says the
 * country better than a language setting does (plenty of people outside the US
 * run English, US). Unknown, it's metric, as most of the world reads.
 */
export function unitsForTimeZone(timeZone: string | undefined): WeatherUnits {
  return timeZone && IMPERIAL_ZONE.test(timeZone) ? 'imperial' : 'metric';
}

export const WeatherNow = z.object({
  temp: Temp,
  feels: Temp,
  code: WeatherCode,
  isDay: z.boolean(),
  /** km/h (metric) or mph (imperial). */
  wind: z.number().min(0).max(800),
  /** Where the wind comes from, in degrees (0 north, 90 east). */
  windDir: z.number().min(0).max(360),
  gusts: z.number().min(0).max(800).optional(),
  humidity: Percent,
  precipProb: Percent.optional(),
  uv: Uv.optional(),
  /** Sea-level pressure, hPa. */
  pressure: z.number().min(800).max(1200).optional(),
});
export type WeatherNow = z.infer<typeof WeatherNow>;

export const WeatherHour = z.object({
  time: LocalTime,
  temp: Temp,
  code: WeatherCode,
  precipProb: Percent.optional(),
  isDay: z.boolean(),
});
export type WeatherHour = z.infer<typeof WeatherHour>;

export const WeatherDay = z.object({
  date: LocalDate,
  min: Temp,
  max: Temp,
  code: WeatherCode,
  /** mm (metric) or inches (imperial). */
  precipSum: z.number().min(0).max(5000).optional(),
  precipProb: Percent.optional(),
  sunrise: LocalTime.optional(),
  sunset: LocalTime.optional(),
  uvMax: Uv.optional(),
});
export type WeatherDay = z.infer<typeof WeatherDay>;

export const WeatherAlert = z.object({
  title: z.string().max(200),
  severity: z.enum(['minor', 'moderate', 'severe', 'extreme']).default('moderate'),
  until: LocalTime.optional(),
});
export type WeatherAlert = z.infer<typeof WeatherAlert>;

export const WeatherView = z.object({
  kind: z.literal('weather'),
  place: z.object({
    name: z.string().max(200),
    region: z.string().max(200).optional(),
    country: z.string().max(120).optional(),
  }),
  /** When it was read, in the place's time. */
  at: LocalTime,
  /** The place's time zone: `Europe/Berlin`. */
  timezone: z.string().max(80),
  /** Minutes the place's clock is ahead of UTC. */
  utcOffset: z.number().int().min(-1080).max(1080).optional(),
  units: WeatherUnits,
  current: WeatherNow,
  /** From this hour on, 24 to 48 of them. */
  hourly: z.array(WeatherHour).max(48),
  /** Today first, up to ten days. */
  daily: z.array(WeatherDay).max(10),
  /** The air now, as the European and US indexes put it. */
  airQuality: z
    .object({
      european: z.number().min(0).max(1000).optional(),
      us: z.number().min(0).max(1000).optional(),
    })
    .optional(),
  alerts: z.array(WeatherAlert).max(5).optional(),
  /** Who the forecast is from, for the card's small print: "Open-Meteo". */
  source: z.string().max(80).optional(),
});
export type WeatherView = z.infer<typeof WeatherView>;
