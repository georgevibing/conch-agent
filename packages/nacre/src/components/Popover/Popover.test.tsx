import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../Button';
import { Popover } from './Popover';

function Example() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button>Filters</Button>
      </Popover.Trigger>
      <Popover.Content aria-label="Filters">
        <Button>Only running</Button>
        <Popover.Close asChild>
          <Button>Done</Button>
        </Popover.Close>
      </Popover.Content>
    </Popover.Root>
  );
}

describe('Popover', () => {
  it('toggles aria-expanded and moves focus into the content', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await expectAccessible(document.body);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes via Popover.Close', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
