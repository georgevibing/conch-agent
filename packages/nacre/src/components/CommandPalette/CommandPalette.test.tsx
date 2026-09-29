import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { CommandPalette } from './CommandPalette';

function Example({ onNew = () => {} }: { onNew?: () => void }) {
  return (
    <CommandPalette>
      <CommandPalette.Group heading="Actions">
        <CommandPalette.Item onSelect={onNew} shortcut="mod+n">
          New session
        </CommandPalette.Item>
        <CommandPalette.Item>Toggle sidebar</CommandPalette.Item>
      </CommandPalette.Group>
      <CommandPalette.Group heading="Sessions">
        <CommandPalette.Item hint="2m ago">Refactor auth flow</CommandPalette.Item>
      </CommandPalette.Group>
    </CommandPalette>
  );
}

describe('CommandPalette', () => {
  it('opens with the mod+k hotkey and focuses the search input', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await expectAccessible(dialog);
  });

  it('filters results as you type and shows an empty state', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    await user.type(input, 'auth');
    expect(screen.getByRole('option', { name: /Refactor auth flow/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Toggle sidebar/ })).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'zzzz');
    expect(await screen.findByText('No results found.')).toBeInTheDocument();
  });

  it('selects with arrow keys and Enter', async () => {
    const onNew = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Example onNew={onNew} />);
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
