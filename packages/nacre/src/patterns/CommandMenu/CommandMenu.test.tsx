import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { Composer } from '../Composer';
import { CommandMenu, useCommandMenu, type CommandItem } from './CommandMenu';
import { SlashComposer, commands, efforts, models } from './fixtures';
import { filterCommands, matchCommand } from './match';

function Harness({
  onSelect,
  onSubmit,
  items = commands,
  autoActivate,
}: {
  onSelect: (i: CommandItem) => void;
  onSubmit?: (v: string) => void;
  items?: CommandItem[];
  autoActivate?: boolean;
}) {
  const [value, setValue] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const slash = /^\/(\S*)$/.exec(value);
  const menu = useCommandMenu({
    items,
    query: slash && !dismissed ? (slash[1] ?? '') : null,
    ...(autoActivate !== undefined && { autoActivate }),
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

  it('matches what’s shown and what’s typed, and highlights only what’s shown', () => {
    const opus = models.find((m) => m.name === 'opus') as CommandItem;
    expect(matchCommand(opus, 'op')).toMatchObject({ score: 0, hits: [0, 1] });
    // A word inside the name is nearly as good as its start.
    const gemini = models.find((m) => m.title === 'Gemini 3 Pro') as CommandItem;
    expect(matchCommand(gemini, 'pro')).toMatchObject({ score: 0.5, hits: [9, 10, 11] });
    // The id people type finds it too, with nothing to highlight in its name.
    expect(matchCommand(gemini, 'google/')).toMatchObject({ score: 0, hits: [] });
    expect(filterCommands(models, 'gpt').map((m) => m.item.title)).toEqual(['GPT-5.1']);
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

  it('wraps around with the arrows, and Tab chooses as Enter does', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={onSelect} />);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '/');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: /init/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Tab}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'model' }));
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
    expect(field).toHaveFocus();
  });

  it('has a close button for touch, which keeps the field focused', async () => {
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={() => {}} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/');
    await user.click(screen.getByRole('button', { name: 'Close commands' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it('says how many it found, for screen readers', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<Harness onSelect={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '/mod');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/^\d+ results?$/);
  });

  it('only suggests, without choosing, when it shouldn’t pick for Enter', async () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderNacre(<Harness onSelect={onSelect} onSubmit={onSubmit} autoActivate={false} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/mo');
    expect(field).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith('/mo');
  });

  it('is accessible while open', async () => {
    const { container } = renderNacre(<Harness onSelect={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '/');
    await expectAccessible(container);
  });
});

describe('a command’s values', () => {
  it('goes on from /effort to its values, starting on the current one, and acts on one', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderNacre(<SlashComposer onAction={onAction} />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, '/eff');
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('/effort ');
    const list = screen.getByRole('listbox', { name: 'effort values' });
    expect(list).toBeInTheDocument();
    expect(screen.getByText('How hard the model thinks')).toBeInTheDocument();
    const high = screen.getByRole('option', { name: /High/ });
    expect(high).toHaveAttribute('aria-selected', 'true');
    expect(high).toHaveTextContent('Current');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onAction).toHaveBeenCalledWith('/effort max');
  });

  it('filters values as you type, by name or what you’d type', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderNacre(<SlashComposer onAction={onAction} initial="/model " />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, 'gem');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Tab}');
    expect(onAction).toHaveBeenCalledWith('/model google/gemini-3-pro');
  });

  it('goes back to every command, and says plainly when no value matches', async () => {
    const user = userEvent.setup();
    renderNacre(<SlashComposer initial="/effort " />);
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, 'zz');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing like that');
    await user.clear(field);
    await user.type(field, '/effort ');
    await user.click(screen.getByRole('button', { name: 'All commands' }));
    expect(field).toHaveValue('/');
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it('is accessible while choosing a value', async () => {
    const { container } = renderNacre(<SlashComposer initial="/effort " />);
    expect(screen.getAllByRole('option')).toHaveLength(efforts.length);
    await expectAccessible(container);
  });
});
