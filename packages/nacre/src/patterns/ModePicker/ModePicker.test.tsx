import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { modes } from '../ModelPicker/fixtures';
import { ModePicker } from './ModePicker';

describe('ModePicker', () => {
  it('switches to a normal mode immediately', async () => {
    const onValueChange = vi.fn();
    renderNacre(
      <ModePicker options={modes} value="default" onValueChange={onValueChange} isDefault />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mode: Ask first' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Plan only/ }));
    expect(onValueChange).toHaveBeenCalledWith('plan');
  });

  it('asks for confirmation before a danger mode', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <ModePicker options={modes} value="default" onValueChange={onValueChange} isDefault />,
    );
    await user.click(screen.getByRole('button', { name: 'Mode: Ask first' }));
    await user.click(await screen.findByRole('radio', { name: /Full trust/ }));
    expect(onValueChange).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('lets Claude run anything without asking');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('radio', { name: /Full trust/ }));
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(onValueChange).toHaveBeenCalledWith('bypassPermissions');
  });

  it('marks the chip with the tone of the current mode', () => {
    renderNacre(
      <ModePicker
        options={modes}
        value="bypassPermissions"
        onValueChange={() => {}}
        isDefault={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mode: Full trust' })).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  it('is accessible when open', async () => {
    renderNacre(
      <ModePicker
        options={modes}
        value="default"
        onValueChange={() => {}}
        isDefault={false}
        onMakeDefault={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Mode:/ }));
    await screen.findByRole('radiogroup', { name: 'Mode' });
    await expectAccessible(document.body);
  });
});
