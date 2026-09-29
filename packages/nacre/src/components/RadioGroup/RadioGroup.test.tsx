import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { RadioGroup } from './RadioGroup';

function Themes({ variant }: { variant?: 'default' | 'card' }) {
  return (
    <Field>
      <Field.Label>Theme</Field.Label>
      <RadioGroup variant={variant} defaultValue="light">
        <RadioGroup.Item value="light" label="Pearl" description="Light" />
        <RadioGroup.Item value="dark" label="Abalone" description="Dark" />
      </RadioGroup>
    </Field>
  );
}

describe('RadioGroup', () => {
  it.each(['default', 'card'] as const)(
    '%s variant is labelled and accessible',
    async (variant) => {
      const { container } = renderNacre(<Themes variant={variant} />);
      expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
      const pearl = screen.getByRole('radio', { name: 'Pearl' });
      expect(pearl).toBeChecked();
      expect(pearl).toHaveAccessibleDescription('Light');
      await expectAccessible(container);
    },
  );

  // Selection-follows-focus is covered in a real browser by the
  // KeyboardNavigation story; jsdom only reliably reproduces focus movement.
  it('moves focus with arrow keys and selects with Space', async () => {
    renderNacre(<Themes />);
    screen.getByRole('radio', { name: 'Pearl' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    const abalone = screen.getByRole('radio', { name: 'Abalone' });
    expect(abalone).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(abalone).toBeChecked();
  });

  it('calls onValueChange', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <RadioGroup aria-label="Size" onValueChange={onValueChange}>
        <RadioGroup.Item value="s" label="Small" />
        <RadioGroup.Item value="l" label="Large" />
      </RadioGroup>,
    );
    await userEvent.click(screen.getByText('Large'));
    expect(onValueChange).toHaveBeenCalledWith('l');
  });
});
