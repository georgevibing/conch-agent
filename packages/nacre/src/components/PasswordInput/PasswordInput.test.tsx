import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Field } from '../Field';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('hides by default and toggles visibility from the keyboard', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <Field>
        <Field.Label>Password</Field.Label>
        <PasswordInput autoComplete="new-password" defaultValue="hunter2 hunter2" />
      </Field>,
    );
    const input = screen.getByLabelText('Password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('spellcheck', 'false');
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible(container);
  });

  it('supports controlled visibility', async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    renderNacre(
      <PasswordInput aria-label="Secret" revealed onRevealedChange={(r) => changes.push(r)} />,
    );
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(changes).toEqual([false]);
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'text');
  });
});
