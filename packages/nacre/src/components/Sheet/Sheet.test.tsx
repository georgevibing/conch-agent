import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../Button';
import { Sheet, type SheetSide } from './Sheet';

function Example({ side = 'right' }: { side?: SheetSide }) {
  return (
    <Sheet.Root>
      <Sheet.Trigger asChild>
        <Button>Open</Button>
      </Sheet.Trigger>
      <Sheet.Content side={side}>
        <Sheet.Header>
          <Sheet.Title>Settings</Sheet.Title>
          <Sheet.Description>Tune the interface.</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body>
          <Button>Inside</Button>
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  );
}

describe('Sheet', () => {
  it.each(['left', 'right', 'bottom'] as const)('opens from the %s edge', async (side) => {
    renderNacre(<Example side={side} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const sheet = await screen.findByRole('dialog', { name: 'Settings' });
    expect(sheet).toHaveAttribute('data-side', side);
    await expectAccessible(document.body);
  });

  it('traps focus and closes on Escape, restoring focus', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog');
    await user.tab();
    await user.tab();
    await user.tab();
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
