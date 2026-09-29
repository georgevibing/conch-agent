import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { NumberField } from './NumberField';

describe('NumberField', () => {
  it('is a labelled spin button', async () => {
    const { container } = renderNacre(
      <Field>
        <Field.Label>Retries</Field.Label>
        <NumberField defaultValue={3} min={0} max={10} />
      </Field>,
    );
    const input = screen.getByRole('spinbutton', { name: 'Retries' });
    expect(input).toHaveAttribute('aria-valuenow', '3');
    expect(input).toHaveAttribute('aria-valuemin', '0');
    expect(input).toHaveAttribute('aria-valuemax', '10');
    await expectAccessible(container);
  });

  it('steps with arrows, leaps with Page keys and jumps with Home/End', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <NumberField
        aria-label="Count"
        defaultValue={5}
        min={1}
        max={60}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole('spinbutton');
    input.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveValue('6');
    await userEvent.keyboard('{PageUp}');
    expect(input).toHaveValue('16');
    await userEvent.keyboard('{Home}');
    expect(input).toHaveValue('1');
    await userEvent.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith(60);
  });

  it('commits in-range typing live and clamps the rest on blur', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <NumberField
        aria-label="Minutes"
        defaultValue={30}
        min={15}
        max={90}
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith(15);
    expect(input).toHaveValue('15');

    await userEvent.clear(input);
    await userEvent.type(input, '45');
    expect(onValueChange).toHaveBeenLastCalledWith(45);
  });

  it('steps with the buttons and disables them at the limits', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <NumberField
        aria-label="Hours"
        defaultValue={2}
        min={1}
        max={3}
        onValueChange={onValueChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onValueChange).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onValueChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled();
  });
});
