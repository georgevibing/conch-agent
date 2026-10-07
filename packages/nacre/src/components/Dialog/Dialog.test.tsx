import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../Button';
import { Dialog } from './Dialog';

function Example() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button>Open</Button>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Rename session</Dialog.Title>
          <Dialog.Description>Pick something memorable.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="surface">Cancel</Button>
          </Dialog.Close>
          <Button>Save</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

describe('Dialog', () => {
  it('opens from the trigger with an accessible name and description', async () => {
    renderNacre(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename session' });
    expect(dialog).toHaveAccessibleDescription('Pick something memorable.');
    await expectAccessible(document.body);
  });

  it('traps focus inside and restores it to the trigger on Escape', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes from Dialog.Close and the corner close button', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('can hide the corner close button', async () => {
    renderNacre(
      <Dialog.Root defaultOpen>
        <Dialog.Content hideClose>
          <Dialog.Title>Title</Dialog.Title>
          <Dialog.Description>Body</Dialog.Description>
        </Dialog.Content>
      </Dialog.Root>,
    );
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('fills the window as a page of its own, with its own way back', async () => {
    renderNacre(
      <Dialog.Root defaultOpen>
        <Dialog.Content size="full" hideClose aria-describedby={undefined}>
          <Dialog.Title>Settings</Dialog.Title>
          <Dialog.Close asChild>
            <Button>Back</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Root>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('data-size', 'full');
    // A page isn't a card: a press on its empty canvas doesn't ripple the window.
    expect(dialog).not.toHaveAttribute('data-lustre');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await expectAccessible(document.body);
  });

  it('stays open when a toast is pressed: its Undo acts on what is open', async () => {
    renderNacre(
      <>
        <Example />
        <div data-sonner-toaster="">
          <button type="button">Undo</button>
        </div>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const press = userEvent.setup({ pointerEventsCheck: 0 });
    await press.click(screen.getByRole('button', { name: 'Undo', hidden: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Anywhere else outside still closes it.
    await press.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
