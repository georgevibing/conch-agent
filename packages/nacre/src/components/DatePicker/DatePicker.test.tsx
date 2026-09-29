import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { addMonths, monthGrid, startOfWeek } from './calendar';
import { DatePicker, type DatePickerProps } from './DatePicker';

const today = '2026-09-29'; // a Tuesday

function Harness(props: Omit<DatePickerProps, 'value'> & { initial?: string }) {
  const { initial, onValueChange, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <Field>
      <Field.Label>Date</Field.Label>
      <DatePicker
        today={today}
        locale="en-US"
        weekStartsOn={1}
        {...rest}
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onValueChange?.(v);
        }}
      />
    </Field>
  );
}

describe('calendar helpers', () => {
  it('clamps month arithmetic and builds a six-week grid', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(startOfWeek('2026-09-29', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-09-29', 0)).toBe('2026-09-27');
    const grid = monthGrid('2026-09-01', 1);
    expect(grid).toHaveLength(6);
    expect(grid[0]?.[0]).toBe('2026-08-31');
  });
});

describe('DatePicker', () => {
  it('reads like speech in the trigger', async () => {
    const { container } = renderNacre(<Harness initial="2026-09-30" />);
    const trigger = screen.getByRole('button', { name: 'Date' });
    expect(trigger).toHaveTextContent('Tomorrow');
    expect(trigger).toHaveTextContent('Wed, Sep 30');
    await expectAccessible(container);
  });

  it('opens on the selected day and walks the grid by keyboard', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness initial="2026-09-30" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a date' });
    expect(within(dialog).getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
    const selected = within(dialog).getByRole('button', { name: 'Wednesday, September 30, 2026' });
    expect(selected).toHaveFocus();
    await expectAccessible(dialog);

    await userEvent.keyboard('{ArrowDown}');
    expect(
      within(dialog).getByRole('button', { name: 'Wednesday, October 7, 2026' }),
    ).toHaveFocus();
    expect(await within(dialog).findByRole('grid', { name: 'October 2026' })).toBeInTheDocument();

    await userEvent.keyboard('{End}{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-11');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent('Sun, Oct 11');
  });

  it('keeps days before min out of reach', async () => {
    renderNacre(<Harness min={today} />);
    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Monday, September 28, 2026' }),
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Previous month' })).toBeDisabled();
    const todayButton = within(dialog).getByRole('button', { name: 'Tuesday, September 29, 2026' });
    expect(todayButton).toHaveAttribute('aria-current', 'date');
    await userEvent.keyboard('{ArrowLeft}');
    expect(todayButton).toHaveFocus();
  });

  it('offers quick picks', async () => {
    const onValueChange = vi.fn();
    renderNacre(<Harness onValueChange={onValueChange} />);
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent('Pick a date');
    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next week' }));
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-06');
  });

  it('turns months with the header buttons', async () => {
    renderNacre(<Harness initial="2026-09-30" />);
    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    expect(await within(dialog).findByRole('grid', { name: 'October 2026' })).toBeInTheDocument();
  });
});
