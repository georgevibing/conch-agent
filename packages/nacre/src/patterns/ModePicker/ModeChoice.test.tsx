import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { modes } from '../ModelPicker/fixtures';
import { ModeChoice } from './ModeChoice';

describe('ModeChoice', () => {
  it('shows every mode with its icon, name and line, in order', () => {
    renderNacre(
      <ModeChoice options={modes} value="default" onValueChange={() => {}} aria-label="Mode" />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(
      modes.map((m) => `${m.label}${m.description}`),
    );
    expect(screen.getByRole('radio', { name: /Ask first/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Full trust/ })).toHaveAttribute(
      'data-tone',
      'danger',
    );
    expect(screen.getByRole('radio', { name: /Auto/ })).toHaveAccessibleDescription(
      /Asks only before risky steps/,
    );
  });

  it('chooses an ordinary mode at once, with the keyboard too', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <ModeChoice
        options={modes}
        value="default"
        onValueChange={onValueChange}
        aria-label="Mode"
      />,
    );
    await user.tab();
    expect(screen.getByRole('radio', { name: /Ask first/ })).toHaveFocus();
    // jsdom moves focus with the arrows; Space chooses (selection follows focus in a browser).
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: /Read only/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenLastCalledWith('plan');
    await user.click(screen.getByRole('radio', { name: /Auto/ }));
    expect(onValueChange).toHaveBeenLastCalledWith('auto');
  });

  it('asks once before Full trust, in the assistant’s name', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <ModeChoice
        options={modes}
        value="default"
        onValueChange={onValueChange}
        aria-label="Mode"
        name="Pearl"
      />,
    );
    await user.click(screen.getByRole('radio', { name: /Full trust/ }));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'lets Pearl run anything without asking',
    );
    await user.click(screen.getByRole('button', { name: 'Keep asking' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: /Full trust/ }));
    await user.click(await screen.findByRole('button', { name: 'Turn on Full trust' }));
    expect(onValueChange).toHaveBeenCalledWith('bypassPermissions');
  });

  it('is accessible, asking or not', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <ModeChoice options={modes} value="auto" onValueChange={() => {}} aria-label="Mode" />,
    );
    await expectAccessible(container);
    await user.click(screen.getByRole('radio', { name: /Full trust/ }));
    await screen.findByRole('alertdialog');
    await expectAccessible(container);
  });
});
