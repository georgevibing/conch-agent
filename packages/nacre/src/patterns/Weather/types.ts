/**
 * A forecast, as the card draws it. Mirrors `WeatherView` in `@conch/protocol`:
 * times are the place's own wall-clock times (`2026-10-08T14:00`, no offset).
 */
export interface WeatherNow {
  temp: number;
  feels: number;
  /** A WMO weather code. */
  code: number;
  isDay: boolean;
  /** km/h, or mph in imperial units. */
  wind: number;
  /** Where the wind comes from, in degrees. */
  windDir: number;
  gusts?: number;
  humidity: number;
  precipProb?: number;
  uv?: number;
  /** hPa. */
  pressure?: number;
}

export interface WeatherHour {
  time: string;
  temp: number;
  code: number;
  precipProb?: number;
  isDay: boolean;
}

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
  precipSum?: number;
  precipProb?: number;
  sunrise?: string;
  sunset?: string;
  uvMax?: number;
}

export interface WeatherAlert {
  title: string;
  severity?: 'minor' | 'moderate' | 'severe' | 'extreme';
  until?: string;
}

export interface WeatherData {
  place: { name: string; region?: string; country?: string };
  /** When it was read, in the place's time. */
  at: string;
  timezone: string;
  utcOffset?: number;
  units: 'metric' | 'imperial';
  current: WeatherNow;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  airQuality?: { european?: number; us?: number };
  alerts?: WeatherAlert[];
  source?: string;
}
