import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Input } from '../Input';
import { Field } from './Field';

describe('Field', () => {
  it('labels the control and wires description + error', async () => {
    const { container, rerender } = renderNacre(
      <Field>
        <Field.Label>Port</Field.Label>
        <Input />
        <Field.Description>Gateway port</Field.Description>
        <Field.Error>Digits only</Field.Error>
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Port' });
    expect(input).toHaveAccessibleDescription('Gateway port');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Digits only')).not.toBeInTheDocument();
    await expectAccessible(container);

    rerender(
      <Field invalid>
        <Field.Label>Port</Field.Label>
        <Input />
        <Field.Description>Gateway port</Field.Description>
        <Field.Error>Digits only</Field.Error>
      </Field>,
    );
    const invalidInput = screen.getByRole('textbox', { name: 'Port' });
    expect(invalidInput).toHaveAttribute('aria-invalid', 'true');
    expect(invalidInput).toHaveAccessibleDescription('Gateway port Digits only');
    await expectAccessible(container);
  });

  it('propagates required and disabled', () => {
    renderNacre(
      <Field required disabled>
        <Field.Label>Name</Field.Label>
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Name/ });
    expect(input).toBeRequired();
    expect(input).toBeDisabled();
  });

  it('lets explicit props win over context', () => {
    renderNacre(
      <Field>
        <Field.Label htmlFor="custom">Custom</Field.Label>
        <Input id="custom" />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Custom' })).toHaveAttribute('id', 'custom');
  });
});
