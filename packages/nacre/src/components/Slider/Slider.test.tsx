import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { Slider } from './Slider';

describe('Slider', () => {
  it('is labelled by its Field', async () => {
    const { container } = renderNacre(
      <Field>
        <Field.Label>Budget</Field.Label>
        <Slider defaultValue={[10]} />
      </Field>,
    );
    expect(screen.getByRole('slider', { name: 'Budget' })).toHaveAttribute('aria-valuenow', '10');
    await expectAccessible(container);
  });

  it('steps with the keyboard', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <Slider aria-label="Volume" defaultValue={[50]} step={5} onValueChange={onValueChange} />,
    );
    const thumb = screen.getByRole('slider', { name: 'Volume' });
    thumb.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(thumb).toHaveAttribute('aria-valuenow', '55');
    await userEvent.keyboard('{Home}');
    expect(thumb).toHaveAttribute('aria-valuenow', '0');
    expect(onValueChange).toHaveBeenLastCalledWith([0]);
  });

  it('exposes a human-readable value', () => {
    renderNacre(
      <Slider aria-label="Budget" defaultValue={[16]} getValueText={(v) => `${v}k tokens`} />,
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '16k tokens');
  });

  it('labels each thumb in a range', () => {
    renderNacre(<Slider defaultValue={[10, 90]} thumbLabels={['Min', 'Max']} />);
    expect(screen.getByRole('slider', { name: 'Min' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Max' })).toBeInTheDocument();
  });
});
