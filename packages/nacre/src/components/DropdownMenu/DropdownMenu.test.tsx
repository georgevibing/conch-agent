import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Button } from '../Button';
import { DropdownMenu } from './DropdownMenu';

function Example({ onRename = () => {} }: { onRename?: () => void }) {
  const [pinned, setPinned] = useState(false);
  const [model, setModel] = useState('opus');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button>Actions</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={<svg />} shortcut="mod+r" onSelect={onRename}>
          Rename
        </DropdownMenu.Item>
        <DropdownMenu.CheckboxItem checked={pinned} onCheckedChange={setPinned}>
          Pinned
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.RadioGroup value={model} onValueChange={setModel}>
          <DropdownMenu.RadioItem value="opus">Opus</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="haiku">Haiku</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>Export</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            <DropdownMenu.Item>Markdown</DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Separator />
        <DropdownMenu.Item tone="danger">Delete</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Actions' }));
  return screen.findByRole('menu');
}

describe('DropdownMenu', () => {
  it('opens a labelled menu with accessible items', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    const menu = await open(user);
    // Shortcut hints are aria-hidden so the accessible name stays clean.
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await expectAccessible(menu);
  });

  it('supports arrow-key navigation and Enter to select', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Example onRename={onRename} />);
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pinned' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('toggles checkbox and radio items', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await open(user);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Pinned' }));
    await open(user);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pinned' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Haiku' }));
    await open(user);
    expect(screen.getByRole('menuitemradio', { name: 'Haiku' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('opens submenus with ArrowRight', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await open(user);
    screen.getByRole('menuitem', { name: 'Export' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitem', { name: 'Markdown' })).toBeInTheDocument();
  });

  it('marks destructive items with a tone', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    await open(user);
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-tone', 'danger');
  });
});
