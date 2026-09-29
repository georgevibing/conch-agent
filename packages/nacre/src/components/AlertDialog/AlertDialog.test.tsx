import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../Button';
import { AlertDialog } from './AlertDialog';

function Example({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button>Delete</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content icon={<svg />}>
        <AlertDialog.Header>
          <AlertDialog.Title>Delete session?</AlertDialog.Title>
          <AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel />
          <AlertDialog.Action onClick={onConfirm}>Delete session</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

describe('AlertDialog', () => {
  it('opens as an alertdialog with focus on Cancel', async () => {
    renderNacre(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete session?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await expectAccessible(document.body);
  });

  it('confirms via the action and closes', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Example onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete session' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('dismisses with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const trigger = screen.getByRole('button', { name: 'Delete' });
    await user.click(trigger);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
