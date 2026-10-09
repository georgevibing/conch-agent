import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../components/Button';
import { expectAccessible, renderNacre } from '../../test/render';
import { UpdateChip } from './UpdateChip';
import { UpdateDialog } from './UpdateDialog';

const changes = ['Attach files to a message', 'Terminals heal themselves'];

describe('UpdateDialog', () => {
  it('says what’s coming, with one press to have it', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="ready"
        title="16 improvements are ready"
        detail="You have 0.4.2 · main a1b2c3d → f00ba12"
        changes={changes}
        more={14}
        footnote="About a minute."
        action={<Button onClick={onUpdate}>Update now</Button>}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: '16 improvements are ready' });
    expect(dialog).toHaveAccessibleDescription('You have 0.4.2 · main a1b2c3d → f00ba12');
    expect(screen.getByText('What it brings')).toBeVisible();
    expect(screen.getByText('Attach files to a message')).toBeVisible();
    expect(screen.getByText('and 14 more changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(onUpdate).toHaveBeenCalledOnce();
    await expectAccessible(dialog);
  });

  it('asks first in place, naming what’s working, and hands its first answer the focus', async () => {
    const onWait = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="ready"
        title="2 improvements are ready"
        changes={changes}
        footnote="Keep working while it gets ready."
        confirm="Fix Conch CI failures is working. Update anyway? It will pause, and carry on after Conch restarts."
        action={[
          <Button key="wait" variant="ghost" onClick={onWait}>
            Wait until it’s done
          </Button>,
          <Button key="anyway">Update anyway</Button>,
        ]}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: '2 improvements are ready' });
    expect(screen.getByText(/^Fix Conch CI failures is working\. Update anyway\?/)).toHaveAttribute(
      'role',
      'status',
    );
    // The question takes the footnote's place: one thing to read.
    expect(screen.queryByText('Keep working while it gets ready.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Wait until it’s done' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onWait).toHaveBeenCalledOnce();
    await expectAccessible(dialog);
  });

  it('waiting to update by itself is a quiet line, not an alarm', async () => {
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="ready"
        title="2 improvements are ready"
        changes={changes}
        waiting="Will update when the chat finishes"
        action={<Button>Update now</Button>}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: '2 improvements are ready' });
    expect(screen.getByText('Will update when the chat finishes')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    await expectAccessible(dialog);
  });

  it('while updating, says the step it’s on, politely, and how far', async () => {
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="updating"
        title="Updating Conch"
        changes={changes}
        progress={{ label: 'Installing', value: 48, step: 2, steps: 3 }}
        action={<Button variant="ghost">Keep working</Button>}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Updating Conch' });
    expect(dialog).toHaveAccessibleDescription('Installing · Step 2 of 3 · 48%');
    expect(screen.getByRole('status')).toHaveTextContent('Installing');
    expect(screen.getByText('Coming with this update')).toBeVisible();
    await expectAccessible(dialog);
  });

  it('when done, lists what arrived', () => {
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="done"
        title="You’re on the new Conch"
        changes={changes}
        action={<Button>Done</Button>}
      />,
    );
    expect(screen.getByText('What’s new')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('when it didn’t work, says why and gives the command to run', async () => {
    renderNacre(
      <UpdateDialog
        open
        onOpenChange={() => undefined}
        stage="failed"
        title="Conch can’t update by itself"
        notice={{
          tone: 'warning',
          message: 'Changes of yours are in the way.',
          command: 'git stash',
        }}
      />,
    );
    expect(screen.getByText('Changes of yours are in the way.')).toBeVisible();
    expect(screen.getByText('git stash')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    await expectAccessible(screen.getByRole('dialog'));
  });

  it('closes with Escape at any point, so you can keep working', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <UpdateDialog open onOpenChange={onOpenChange} stage="updating" title="Updating Conch" />,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('UpdateChip', () => {
  it('is one button that says what it does', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { container } = renderNacre(
      <UpdateChip state="ready" aria-label="Update Conch: 16 improvements" onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: 'Update Conch: 16 improvements' });
    expect(button).toHaveTextContent('Update');
    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('says it’s updating while it does', () => {
    renderNacre(<UpdateChip state="updating" value={40} />);
    expect(screen.getByRole('button')).toHaveTextContent('Updating');
  });
});
