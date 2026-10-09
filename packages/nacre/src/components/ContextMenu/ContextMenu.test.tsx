import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ContextMenu } from './ContextMenu';

function Example({ onCopy = () => {} }: { onCopy?: () => void }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>Message</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item shortcut="mod+c" onSelect={onCopy}>
          Copy
        </ContextMenu.Item>
        <ContextMenu.CheckboxItem checked>Starred</ContextMenu.CheckboxItem>
        <ContextMenu.Separator />
        <ContextMenu.Item tone="danger">Delete</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

describe('ContextMenu', () => {
  it('opens on contextmenu and is accessible', async () => {
    renderNacre(<Example />);
    fireEvent.contextMenu(screen.getByText('Message'), { clientX: 20, clientY: 20 });
    const menu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Starred' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expectAccessible(menu);
  });

  it('navigates with the keyboard and selects', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Example onCopy={onCopy} />);
    fireEvent.contextMenu(screen.getByText('Message'), { clientX: 20, clientY: 20 });
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onCopy).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('drills into a submenu on a phone, in the same menu', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderNacre(
      <ContextMenu.Root>
        <ContextMenu.Trigger>Password</ContextMenu.Trigger>
        <ContextMenu.Content submenus="drill">
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger>Copy to</ContextMenu.SubTrigger>
            <ContextMenu.SubContent>
              <ContextMenu.Item onSelect={onPick}>1Password</ContextMenu.Item>
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Item>Delete</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>,
    );
    fireEvent.contextMenu(screen.getByText('Password'), { clientX: 20, clientY: 20 });
    await user.click(await screen.findByRole('menuitem', { name: 'Copy to' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Back from Copy to' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: '1Password' }));
    expect(onPick).toHaveBeenCalledOnce();
  });
});
