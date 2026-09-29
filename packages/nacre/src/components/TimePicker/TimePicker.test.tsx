import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { TimePicker, type TimePickerProps } from './TimePicker';
import { dayPeriods, from12, parseTime, to12, wrap } from './time';

function Harness(props: Omit<TimePickerProps, 'value'> & { initial?: string }) {
  const { initial = '09:00', onValueChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <TimePicker
      aria-label="Start"
      {...rest}
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onValueChange?.(v);
      }}
    />
  );
}

describe('time helpers', () => {
  it('parses, wraps and converts between clocks', () => {
    expect(parseTime('7:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseTime('nonsense')).toEqual({ hour: 9, minute: 0 });
    expect(wrap(13, 1, 12)).toBe(1);
    expect(wrap(-1, 0, 59)).toBe(59);
    expect(to12(0)).toBe(12);
    expect(to12(13)).toBe(1);
    expect(from12(12, false)).toBe(0);
    expect(from12(12, true)).toBe(12);
    expect(dayPeriods('en-US')).toEqual(['AM', 'PM']);
  });
});

describe('TimePicker', () => {
  it('shows each part as a labelled spin button', async () => {
    const { container } = renderNacre(<Harness hourCycle="h12" initial="21:05" />);
    const group = screen.getByRole('group', { name: 'Start' });
    expect(within(group).getByRole('spinbutton', { name: 'Hour' })).toHaveTextContent('9');
    expect(within(group).getByRole('spinbutton', { name: 'Minute' })).toHaveTextContent('05');
    expect(within(group).getByRole('spinbutton', { name: 'AM/PM' })).toHaveTextContent('PM');
    await expectAccessible(container);
  });

  it('nudges with arrows and wraps within the part', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness hourCycle="h23" initial="23:59" onValueChange={onValueChange} />);
    screen.getByRole('spinbutton', { name: 'Minute' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onValueChange).toHaveBeenLastCalledWith('23:00');
    await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
    expect(onValueChange).toHaveBeenLastCalledWith('22:00');
  });

  it('accepts typed digits and advances between parts', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness hourCycle="h12" initial="09:00" onValueChange={onValueChange} />);
    screen.getByRole('spinbutton', { name: 'Hour' }).focus();
    await userEvent.keyboard('730p');
    expect(onValueChange).toHaveBeenLastCalledWith('19:30');
    expect(screen.getByRole('spinbutton', { name: 'AM/PM' })).toHaveFocus();
  });

  it('waits for a second hour digit when one could follow', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness hourCycle="h23" initial="09:00" onValueChange={onValueChange} />);
    const hour = screen.getByRole('spinbutton', { name: 'Hour' });
    hour.focus();
    await userEvent.keyboard('1');
    expect(hour).toHaveFocus();
    await userEvent.keyboard('8');
    expect(onValueChange).toHaveBeenLastCalledWith('18:00');
    expect(screen.getByRole('spinbutton', { name: 'Minute' })).toHaveFocus();
  });

  it('picks an hour then a minute from the clock face, then closes', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <Harness
        hourCycle="h12"
        initial="09:00"
        onValueChange={onValueChange}
        presets={[{ label: 'Evening', value: '18:00' }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose a time' }));
    const face = await screen.findByRole('dialog', { name: 'Choose a time' });
    expect(within(face).getByRole('radio', { name: '9 AM' })).toHaveFocus();
    await expectAccessible(face);

    await userEvent.click(within(face).getByRole('radio', { name: '4 AM' }));
    expect(onValueChange).toHaveBeenLastCalledWith('04:00');
    expect(within(face).getByRole('radio', { name: '4 AM' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(within(face).getByRole('radio', { name: 'PM' }));
    expect(onValueChange).toHaveBeenLastCalledWith('16:00');

    await userEvent.click(within(face).getByRole('radio', { name: '4:45 PM' }));
    expect(onValueChange).toHaveBeenLastCalledWith('16:45');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers presets', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <Harness
        hourCycle="h23"
        onValueChange={onValueChange}
        presets={[{ label: 'Evening', value: '18:00' }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose a time' }));
    await userEvent.click(await screen.findByRole('button', { name: /Evening/ }));
    expect(onValueChange).toHaveBeenLastCalledWith('18:00');
  });

  it('does nothing when disabled', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness disabled onValueChange={onValueChange} />);
    expect(screen.getByRole('button', { name: 'Choose a time' })).toBeDisabled();
    const hour = screen.getByRole('spinbutton', { name: 'Hour' });
    expect(hour).toHaveAttribute('aria-disabled', 'true');
    expect(hour).toHaveAttribute('tabindex', '-1');
  });
});
