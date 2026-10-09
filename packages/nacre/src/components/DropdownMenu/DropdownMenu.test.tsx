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

  it('opens submenus beside the menu with a pointer', async () => {
    const user = userEvent.setup();
    renderNacre(<Example />);
    expect(await open(user)).toHaveAttribute('data-submenus', 'side');
  });
});

function Nested({
  submenus = 'drill',
  onPick = () => {},
}: {
  submenus?: 'auto' | 'drill' | 'side';
  onPick?: (id: string) => void;
}) {
  const [agent, setAgent] = useState('conch');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button>More</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content submenus={submenus}>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>Answering: Conch</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent backLabel="Answering">
            <DropdownMenu.RadioGroup
              value={agent}
              onValueChange={(id) => {
                setAgent(id);
                onPick(id);
              }}
            >
              <DropdownMenu.RadioItem value="conch">Conch</DropdownMenu.RadioItem>
              <DropdownMenu.RadioItem value="scout">Scout</DropdownMenu.RadioItem>
            </DropdownMenu.RadioGroup>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Item>Find in chat</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

describe('DropdownMenu, drilling in on a phone', () => {
  it('opens a submenu in the same menu, with a way back at its top', async () => {
    const user = userEvent.setup();
    renderNacre(<Nested />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    const trigger = await screen.findByRole('menuitem', { name: 'Answering: Conch' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);

    // Still the one menu: no second popup beside it.
    const menus = screen.getAllByRole('menu');
    expect(menus).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Answering' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Back from Answering' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Scout' })).toBeInTheDocument();
    // The level it left is out of the way of arrows, typeahead and screen readers.
    expect(screen.queryByRole('menuitem', { name: 'Find in chat' })).not.toBeInTheDocument();
    await expectAccessible(screen.getByRole('menu'));

    await user.click(screen.getByRole('menuitem', { name: 'Back from Answering' }));
    expect(await screen.findByRole('menuitem', { name: 'Find in chat' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Scout' })).not.toBeInTheDocument();
  });

  it('goes in with Right or Enter and back with Left or Escape, keeping the focus in place', async () => {
    const user = userEvent.setup();
    renderNacre(<Nested />);
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{Enter}');
    const trigger = await screen.findByRole('menuitem', { name: 'Answering: Conch' });
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Conch' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Scout' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Answering: Conch' })).toHaveFocus(),
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Conch' })).toHaveFocus());
    // Escape steps back a level first, then closes the menu.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Answering: Conch' })).toHaveFocus(),
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('chooses a nested option, closes, and opens again at the top', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Nested onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Answering: Conch' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Scout' }));
    expect(onPick).toHaveBeenCalledWith('scout');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Find in chat' })).toBeInTheDocument();
  });

  it('drills in by itself on a phone', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query.includes('max-width: 40rem'),
    })) as typeof window.matchMedia;
    try {
      const user = userEvent.setup();
      renderNacre(<Nested submenus="auto" />);
      await user.click(screen.getByRole('button', { name: 'More' }));
      expect(await screen.findByRole('menu')).toHaveAttribute('data-submenus', 'drill');
    } finally {
      window.matchMedia = original;
    }
  });
});
