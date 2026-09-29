import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Composer } from '../Composer';
import { CommandMenu, useCommandMenu, type CommandItem } from './CommandMenu';
import { commands } from './fixtures';
import { filterCommands } from './match';

function Harness({
  onSelect,
  onSubmit,
}: {
  onSelect: (i: CommandItem) => void;
  onSubmit?: (v: string) => void;
}) {
  const [value, setValue] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const slash = /^\/(\S*)$/.exec(value);
  const menu = useCommandMenu({
    items: commands,
    query: slash && !dismissed ? (slash[1] ?? '') : null,
    onSelect: (item) => {
      onSelect(item);
      setValue('');
    },
    onClose: () => setDismissed(true),
  });
  return (
    <Composer
      label="Message"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        setDismissed(false);
      }}
      onSubmit={onSubmit}
      onTextareaKeyDown={(e) => {
        menu.onKeyDown(e);
      }}
      textareaProps={menu.inputProps}
      overlay={<CommandMenu {...menu.menuProps} />}
    />
  );
}

describe('filterCommands', () => {
  it('ranks prefix, then substring, then keywords, then loose letters', () => {
    expect(filterCommands(commands, 'mo').map((m) => m.item.name)[0]).toBe('model');
    expect(filterCommands(commands, 'trust').map((m) => m.item.name)).toEqual(['mode']);
    expect(filterCommands(commands, 'cpt').map((m) => m.item.name)).toContain('compact');
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });

  it('keeps groups in their given order', () => {
    const groups = filterCommands(commands, '').map((m) => m.item.group);
    expect([...new Set(groups)]).toEqual(['Conch', 'Your commands', 'Claude Code']);
  });
});

describe('CommandMenu', () => {
  it('opens on "/", navigates with arrows and selects with Enter without sending', async () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={onSelect} onSubmit={onSubmit} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/');
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /effort/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'effort' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape and shows an empty state for unknown commands', async () => {
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={() => {}} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/zzz');
    expect(screen.getByRole('status')).toHaveTextContent('No command called /zzz');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('selects on click and keeps focus in the field', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={onSelect} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/com');
    const option = screen.getByRole('option', { name: /compact/ });
    fireEvent.pointerDown(option);
    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'compact' }));
  });

  it('is accessible while open', async () => {
    const { container } = renderNacre(<Harness onSelect={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '/');
    await expectAccessible(container);
  });
});
