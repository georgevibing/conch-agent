import { readFileSync } from 'node:fs';

import { WeatherView } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { AppFetchRequest, AppFetcher } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import { localeUnits, pickPlace, placeQuery, weatherTool } from './weather';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/weather-${name}.json`, import.meta.url), 'utf8');
const GEOCODE = fixture('geocode');
const FORECAST = fixture('forecast');
const AIR = fixture('air');

const ctx = { conversationId: 'one', signal: new AbortController().signal } as ToolContext;
const ok = (body: string) => ({ ok: true, status: 200, headers: {}, body });

/** A pretend Open-Meteo: each service answers from its fixture, or as told. */
function openMeteo(answers: Partial<Record<'geocode' | 'forecast' | 'air', unknown>> = {}) {
  const seen: AppFetchRequest[] = [];
  const fetcher: AppFetcher = vi.fn(async (_app, request) => {
    seen.push(request);
    const host = new URL(request.url).hostname;
    const which = host.startsWith('geocoding')
      ? 'geocode'
      : host.startsWith('air-quality')
        ? 'air'
        : 'forecast';
    const answer = answers[which] ?? ok({ geocode: GEOCODE, forecast: FORECAST, air: AIR }[which]);
    if (answer instanceof Error) throw answer;
    return answer as Awaited<ReturnType<AppFetcher>>;
  });
  return { fetcher, seen };
}

const run = async (
  fetcher: AppFetcher,
  args: Record<string, unknown>,
  units = 'metric' as const,
) => {
  const tool = weatherTool(ctx, fetcher, { units: () => units, language: () => 'en-GB' });
  const parsed = (await import('zod')).z.object(tool.input).parse(args);
  const result = await tool.run(parsed);
  if (typeof result === 'string' || !result.view) throw new Error('no view');
  return { text: JSON.parse(result.text) as Record<string, unknown>, view: result.view };
};

describe('the weather tool', () => {
  it('finds the place, reads the forecast and the air, and draws a card that logs as it is', async () => {
    const { fetcher, seen } = openMeteo();
    const { text, view } = await run(fetcher, { place: 'Berlin', days: 7 });
    expect(view.kind).toBe('weather');
    if (view.kind !== 'weather') return;
    expect(WeatherView.safeParse(view).success).toBe(true);
    expect(cleanView(view)).toEqual(view);
    expect(view.place).toEqual({ name: 'Berlin', region: 'State of Berlin', country: 'Germany' });
    expect(view.timezone).toBe('Europe/Berlin');
    expect(view.utcOffset).toBe(120);
    // The strip starts at the hour we're in and runs a whole day.
    expect(view.hourly).toHaveLength(24);
    expect(view.hourly[0]?.time).toBe(`${view.at.slice(0, 13)}:00`);
    expect(view.daily).toHaveLength(7);
    expect(view.daily[0]).toMatchObject({ date: '2026-10-08', sunrise: '2026-10-08T07:19' });
    expect(view.airQuality).toEqual({ european: 25, us: 77 });
    expect(text.summary).toMatch(/^Berlin, State of Berlin, Germany: \d+°C and /);
    expect(text.note).toMatch(/card/);
    expect(text.otherPlacesWithThisName).toContain('Berlin, New Hampshire, United States');
    // Only the name and the coordinates leave: nothing about the chat.
    expect(seen.map((r) => new URL(r.url).hostname).sort()).toEqual([
      'air-quality-api.open-meteo.com',
      'api.open-meteo.com',
      'geocoding-api.open-meteo.com',
    ]);
    expect(new URL(seen[0]?.url ?? '').searchParams.get('name')).toBe('Berlin');
  });

  it('reads “Paris, Texas” as the one in Texas', async () => {
    const paris = JSON.stringify({
      results: [
        {
          name: 'Paris',
          latitude: 48.85,
          longitude: 2.35,
          country: 'France',
          country_code: 'FR',
          admin1: 'Île-de-France',
        },
        {
          name: 'Paris',
          latitude: 33.66,
          longitude: -95.55,
          country: 'United States',
          country_code: 'US',
          admin1: 'Texas',
        },
      ],
    });
    const { fetcher, seen } = openMeteo({ geocode: ok(paris) });
    const { view } = await run(fetcher, { place: 'Paris, Texas' });
    expect(view.kind === 'weather' && view.place.region).toBe('Texas');
    const forecast = seen.find((r) => r.url.startsWith('https://api.open-meteo.com'));
    expect(new URL(forecast?.url ?? '').searchParams.get('latitude')).toBe('33.6600');
    expect(placeQuery('Paris, Texas')).toEqual({ name: 'Paris', hints: ['texas'] });
    expect(pickPlace([], [])).toBeUndefined();
  });

  it('asks for °F, mph and inches when the units are imperial', async () => {
    const { fetcher, seen } = openMeteo();
    const { view, text } = await run(fetcher, { place: 'Berlin' }, 'imperial' as never);
    const forecast = new URL(
      seen.find((r) => r.url.startsWith('https://api.open-meteo.com'))?.url ?? '',
    );
    expect(forecast.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(forecast.searchParams.get('wind_speed_unit')).toBe('mph');
    expect(view.kind === 'weather' && view.units).toBe('imperial');
    expect(text.units).toMatchObject({ temperature: '°F' });
  });

  it('takes the units from this computer’s locale', () => {
    expect(localeUnits('en-US')).toBe('imperial');
    expect(localeUnits('en-GB')).toBe('metric');
    expect(localeUnits('de-DE')).toBe('metric');
    expect(localeUnits('not a locale!')).toBe('metric');
  });

  it('goes straight to the forecast for coordinates', async () => {
    const { fetcher, seen } = openMeteo();
    const { view } = await run(fetcher, { latitude: 38.72, longitude: -9.14, place: 'Home' });
    expect(view.kind === 'weather' && view.place.name).toBe('Home');
    expect(seen.some((r) => r.url.includes('geocoding'))).toBe(false);
  });

  it('says what to try when no place has that name', async () => {
    const { fetcher } = openMeteo({ geocode: ok('{"generationtime_ms":0.2}') });
    await expect(run(fetcher, { place: 'Atlantis Under The Sea' })).rejects.toThrow(
      /No place called “Atlantis Under The Sea”.*latitude and longitude/,
    );
  });

  it('asks which place when it was given none', async () => {
    const { fetcher } = openMeteo();
    await expect(run(fetcher, {})).rejects.toThrow(/Say which place/);
  });

  it('does not hide a failed forecast, and carries on without the air', async () => {
    const down = openMeteo({ forecast: { ok: false, status: 503, headers: {}, body: 'busy' } });
    await expect(run(down.fetcher, { place: 'Berlin' })).rejects.toThrow(/503.*web_search/);

    const odd = openMeteo({ forecast: ok('{"nope":true}') });
    await expect(run(odd.fetcher, { place: 'Berlin' })).rejects.toThrow(/unexpected/);

    const refused = openMeteo({
      geocode: { ok: false, status: 0, headers: {}, body: '', refused: 'Offline.' },
    });
    await expect(run(refused.fetcher, { place: 'Berlin' })).rejects.toThrow(/Offline/);

    const noAir = openMeteo({ air: new Error('network') });
    const { view } = await run(noAir.fetcher, { place: 'Berlin' });
    expect(view.kind === 'weather' && view.airQuality).toBeUndefined();
  });
});
