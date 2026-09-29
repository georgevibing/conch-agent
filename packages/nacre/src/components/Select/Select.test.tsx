import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { Select } from './Select';

function ModelSelect(props: { onValueChange?: (v: string) => void; invalid?: boolean }) {
  return (
    <Field invalid={props.invalid}>
      <Field.Label>Model</Field.Label>
      <Select defaultValue="opus" onValueChange={props.onValueChange}>
        <Select.Item value="opus" description="Most capable">
          Opus
        </Select.Item>
        <Select.Item value="sonnet">Sonnet</Select.Item>
        <Select.Item value="haiku" disabled>
          Haiku
        </Select.Item>
      </Select>
      <Field.Error>Required</Field.Error>
    </Field>
  );
}

describe('Select', () => {
  it('renders a labelled combobox showing the selected value', async () => {
    const { container } = renderNacre(<ModelSelect />);
    const trigger = screen.getByRole('combobox', { name: 'Model' });
    expect(trigger).toHaveTextContent('Opus');
    expect(trigger).not.toHaveTextContent('Most capable');
    await expectAccessible(container);
  });

  it('selects an option with the pointer', async () => {
    const onValueChange = vi.fn();
    renderNacre(<ModelSelect onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sonnet' }));
    expect(onValueChange).toHaveBeenCalledWith('sonnet');
    expect(screen.getByRole('combobox')).toHaveTextContent('Sonnet');
  });

  it('marks disabled options and invalid state', async () => {
    renderNacre(<ModelSelect invalid />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleDescription('Required');
    await userEvent.click(trigger);
    expect(await screen.findByRole('option', { name: 'Haiku' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
