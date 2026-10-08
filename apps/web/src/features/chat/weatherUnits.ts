import { unitsForTimeZone, type WeatherUnits } from '@conch/protocol';
import { useSyncExternalStore } from 'react';

const KEY = 'conch.weather.units';
const listeners = new Set<() => void>();

function stored(): WeatherUnits | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  const value = localStorage.getItem(KEY);
  return value === 'metric' || value === 'imperial' ? value : undefined;
}

/**
 * The units weather cards are shown in: what the person last chose on a card's
 * °C/°F switch, else what's read where this browser is (its time zone). Every
 * card follows one choice, and it lasts.
 */
export function useWeatherUnits(): [WeatherUnits, (units: WeatherUnits) => void] {
  const chosen = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    stored,
    () => undefined,
  );
  const units = chosen ?? unitsForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const choose = (next: WeatherUnits) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private windows may refuse; the card still switches.
    }
    for (const listener of listeners) listener();
  };
  return [units, choose];
}
