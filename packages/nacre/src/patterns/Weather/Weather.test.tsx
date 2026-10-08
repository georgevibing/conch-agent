import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { sampleWeather } from './fixtures';
import {
  airReading,
  compass,
  conditionOf,
  hourLabel,
  skyTimeOf,
  smoothPath,
  tempHue,
  uvWords,
} from './sky';
import { WeatherCard } from './Weather';

const weather = sampleWeather({
  place: { name: 'Berlin', region: 'State of Berlin', country: 'Germany' },
  hour: 11,
  code: 63,
  codes: [63, 61, 3],
});

describe('WeatherCard', () => {
  it('is one region with a sentence for screen readers, and passes axe', async () => {
    const { container } = renderNacre(<WeatherCard weather={weather} locale="en-GB" />);
    const card = screen.getByRole('region', { name: 'Weather in Berlin' });
    expect(card).toHaveTextContent(/Berlin, State of Berlin, Germany\. Now \d+°C and rain/);
    expect(card).toHaveTextContent(/Wind 14 km\/h from the NW/);
    await expectAccessible(container);
  });

  it('lists the days in words, today first', () => {
    renderNacre(<WeatherCard weather={weather} locale="en-GB" />);
    const days = screen.getByRole('list', { name: '7-day forecast' });
    const rows = within(days).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent(/^Today: rain, \d+° to \d+°C, \d+% chance of rain\./);
    expect(rows[1]).toHaveTextContent(/^Friday: partly cloudy/);
  });

  it('says UV and the air in words, never by colour alone', () => {
    renderNacre(<WeatherCard weather={weather} locale="en-GB" />);
    expect(screen.getByText('UV index').parentElement).toHaveTextContent(/Low|Moderate/);
    expect(screen.getByText('Air quality').parentElement).toHaveTextContent('22 Fair');
    expect(screen.getByText('European AQI')).toBeInTheDocument();
  });

  it('scrubs the hours with the keyboard, and goes back to now on Escape', async () => {
    const user = userEvent.setup();
    renderNacre(<WeatherCard weather={weather} locale="en-GB" />);
    const slider = screen.getByRole('slider', { name: 'Hour by hour' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Now: \d+°C, rain/));
    slider.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '2');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^13:00: \d+°C/));
    await user.keyboard('{Escape}');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '23');
    await user.tab();
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('folds ten days to seven, with Show all', async () => {
    const user = userEvent.setup();
    renderNacre(<WeatherCard weather={sampleWeather({ days: 10 })} locale="en-GB" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'Show 10 days' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('writes °F and mph for imperial units, and the US index', () => {
    renderNacre(
      <WeatherCard
        weather={sampleWeather({ units: 'imperial', air: { us: 58, european: 30 } })}
        locale="en-US"
      />,
    );
    expect(screen.getAllByText('mph', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('US AQI')).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent(/°F/);
  });

  it('switches between °C and °F on the card, converting every reading', async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    renderNacre(
      <WeatherCard
        weather={sampleWeather({ units: 'metric' })}
        locale="en-GB"
        onUnitsChange={(u) => changes.push(u)}
      />,
    );
    const card = screen.getByRole('region');
    expect(card).toHaveTextContent(/Now \d+°C/);
    const units = screen.getByRole('radiogroup', { name: 'Units' });
    await user.click(within(units).getByRole('radio', { name: '°F' }));
    expect(changes).toEqual(['imperial']);
    expect(card).toHaveTextContent(/Now \d+°F/);
    expect(screen.getAllByText('mph', { exact: false }).length).toBeGreaterThan(0);
  });

  it('follows the units the app holds', () => {
    renderNacre(
      <WeatherCard weather={sampleWeather({ units: 'metric' })} units="imperial" locale="en-US" />,
    );
    expect(screen.getByRole('region')).toHaveTextContent(/°F/);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Units' })).getByRole('radio', { name: '°F' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an alert in words', async () => {
    const { container } = renderNacre(
      <WeatherCard
        weather={sampleWeather({
          code: 95,
          alerts: [{ title: 'Storm warning', severity: 'severe', until: '2026-10-08T19:00' }],
        })}
        locale="en-GB"
      />,
    );
    expect(screen.getByText('Storm warning').parentElement).toHaveTextContent('until 19:00');
    await expectAccessible(container);
  });
});

describe('reading the sky', () => {
  it('knows a code’s condition', () => {
    expect(conditionOf(0)).toBe('clear');
    expect(conditionOf(45)).toBe('fog');
    expect(conditionOf(81)).toBe('rain');
    expect(conditionOf(86)).toBe('snow');
    expect(conditionOf(66)).toBe('sleet');
    expect(conditionOf(99)).toBe('storm');
  });

  it('finds dawn and dusk near the sun’s edges', () => {
    expect(skyTimeOf('2026-10-08T07:40', true, '2026-10-08T07:28', '2026-10-08T19:05')).toBe(
      'dawn',
    );
    expect(skyTimeOf('2026-10-08T19:30', false, '2026-10-08T07:28', '2026-10-08T19:05')).toBe(
      'dusk',
    );
    expect(skyTimeOf('2026-10-08T13:00', true, '2026-10-08T07:28', '2026-10-08T19:05')).toBe('day');
    expect(skyTimeOf('2026-10-08T23:00', false)).toBe('night');
  });

  it('writes words for wind, UV and the air', () => {
    expect(compass(0)).toBe('N');
    expect(compass(250)).toBe('WSW');
    expect(compass(359)).toBe('N');
    expect(uvWords(2)).toBe('Low');
    expect(uvWords(9)).toBe('Very high');
    expect(airReading({ european: 45, us: 90 }, false)?.words).toBe('Moderate');
    expect(airReading({ european: 45, us: 160 }, true)).toMatchObject({
      scale: 'US AQI',
      words: 'Unhealthy',
    });
    expect(airReading(undefined, false)).toBeUndefined();
  });

  it('writes an hour the way the place’s wall clock says it', () => {
    expect(hourLabel('2026-10-08T15:00', { locale: 'en-GB' })).toBe('15');
    expect(hourLabel('2026-10-08T15:00', { locale: 'en-US' })).toBe('3 PM');
  });

  it('runs cool to warm, and draws a curve through every point', () => {
    expect(tempHue(-20)).toBeGreaterThan(tempHue(10));
    expect(tempHue(10)).toBeGreaterThan(tempHue(30));
    const d = smoothPath([
      [0, 10],
      [10, 20],
      [20, 15],
    ]);
    expect(d.startsWith('M0,10')).toBe(true);
    expect(d).toContain('10,20');
    expect(d.endsWith('20,15')).toBe(true);
    expect(smoothPath([])).toBe('');
  });
});
