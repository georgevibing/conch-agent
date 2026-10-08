import type { WeatherData } from './types';

export type WeatherUnits = WeatherData['units'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const toF = (c: number) => round1((c * 9) / 5 + 32);
const toC = (f: number) => round1(((f - 32) * 5) / 9);
const KM_PER_MILE = 1.609344;
const MM_PER_INCH = 25.4;

/**
 * The same forecast in the other units: temperatures, wind and rain converted,
 * everything else as it was. Already in those units, it's returned as it is.
 */
export function inUnits(weather: WeatherData, units: WeatherUnits): WeatherData {
  if (weather.units === units) return weather;
  const imperial = units === 'imperial';
  const t = imperial ? toF : toC;
  const speed = (v: number) => round1(imperial ? v / KM_PER_MILE : v * KM_PER_MILE);
  const depth = (v: number) =>
    imperial ? Math.round((v / MM_PER_INCH) * 100) / 100 : round1(v * MM_PER_INCH);
  const { current } = weather;
  return {
    ...weather,
    units,
    current: {
      ...current,
      temp: t(current.temp),
      feels: t(current.feels),
      wind: speed(current.wind),
      ...(current.gusts !== undefined && { gusts: speed(current.gusts) }),
    },
    hourly: weather.hourly.map((h) => ({ ...h, temp: t(h.temp) })),
    daily: weather.daily.map((d) => ({
      ...d,
      min: t(d.min),
      max: t(d.max),
      ...(d.precipSum !== undefined && { precipSum: depth(d.precipSum) }),
    })),
  };
}
