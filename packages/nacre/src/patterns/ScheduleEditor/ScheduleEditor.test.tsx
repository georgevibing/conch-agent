import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import type { ScheduleValue } from '../Routines/types';
import { fakePreview } from './fixtures';
import { convertSchedule, repeatKindOf, ScheduleEditor } from './ScheduleEditor';

const tz = 'Europe/Berlin';

function Harness({
  initial,
  onChange,
}: {
  initial: ScheduleValue;
  onChange?: (v: ScheduleValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ScheduleEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      timezone={tz}
      preview={fakePreview(value, Date.UTC(2025, 9, 16, 8))}
    />
  );
}

describe('ScheduleEditor helpers', () => {
  it('recognises the weekdays preset', () => {
    expect(
      repeatKindOf({ type: 'weekly', days: ['fri', 'mon', 'tue', 'wed', 'thu'], time: '08:00' }),
    ).toBe('weekdays');
    expect(repeatKindOf({ type: 'weekly', days: ['mon'], time: '08:00' })).toBe('weekly');
  });

  it('keeps the chosen time when switching kinds', () => {
    const daily = { type: 'daily', time: '07:45' } as const;
    expect(convertSchedule(daily, 'weekdays', tz)).toEqual({
      type: 'weekly',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      time: '07:45',
    });
    expect(convertSchedule(daily, 'monthly', tz)).toEqual({
      type: 'monthly',
      day: 1,
      time: '07:45',
    });
    expect(convertSchedule(daily, 'cron', tz)).toEqual({ type: 'cron', expression: '45 7 * * *' });
    const once = convertSchedule(daily, 'once', tz);
    expect(once.type === 'once' && once.at).toMatch(/T07:45:00[+-]\d\d:\d\d$/);
  });
});

describe('ScheduleEditor', () => {
  it('is accessible and shows the plain-language preview', async () => {
    const { container } = renderNacre(
      <Harness
        initial={{ type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'When should it run?' })).toBeInTheDocument();
    expect(screen.getByText('Every weekday at 7:30 AM')).toBeInTheDocument();
    expect(screen.getByText('Europe/Berlin')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('toggles days by keyboard and never allows zero days', async () => {
    const onChange = vi.fn();
    renderNacre(
      <Harness initial={{ type: 'weekly', days: ['sun'], time: '18:00' }} onChange={onChange} />,
    );
    const sunday = screen.getByRole('button', { name: 'Sunday' });
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    sunday.focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Pick at least one day.');

    await userEvent.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'weekly',
      days: ['sat', 'sun'],
      time: '18:00',
    });
  });

  it('clamps intervals to 15 minutes with a gentle hint', () => {
    const onChange = vi.fn();
    renderNacre(
      <Harness initial={{ type: 'interval', every: 20, unit: 'minutes' }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Number of minutes' }), {
      target: { value: '5' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'interval', every: 15, unit: 'minutes' });
    expect(screen.getByRole('status')).toHaveTextContent('Every 15 minutes is the most often');
  });

  it('warns about very frequent schedules', () => {
    renderNacre(<Harness initial={{ type: 'interval', every: 15, unit: 'minutes' }} />);
    expect(screen.getByText(/runs about 96 times a day/)).toBeInTheDocument();
  });

  it('explains invalid custom schedules and offers examples', async () => {
    const onChange = vi.fn();
    renderNacre(<Harness initial={{ type: 'cron', expression: '0 9 * *' }} onChange={onChange} />);
    expect(screen.getByText('That schedule doesn’t work')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Weekdays at 9' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'cron', expression: '0 9 * * 1-5' });
  });

  it('changes the time', () => {
    const onChange = vi.fn();
    renderNacre(<Harness initial={{ type: 'daily', time: '08:00' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('At'), { target: { value: '06:15' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'daily', time: '06:15' });
  });

  it('notes that short months are skipped for late days', () => {
    renderNacre(<Harness initial={{ type: 'monthly', day: 31, time: '09:00' }} />);
    expect(screen.getByText('Months without a 31st are skipped.')).toBeInTheDocument();
  });
});
