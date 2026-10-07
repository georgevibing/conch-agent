import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AgentCard } from './AgentCard';
import { AgentFacePicker } from './AgentFacePicker';
import { AgentGallery, type AgentGalleryItem } from './AgentGallery';
import { AgentPicker } from './AgentPicker';
import { ToneChips } from './ToneChips';

const agents: AgentGalleryItem[] = [
  { id: 'a', name: 'Conch', avatar: { kind: 'preset', id: 'shell' }, isDefault: true },
  { id: 'b', name: 'Atlas', role: 'Plans trips', avatar: { kind: 'preset', id: 'compass' } },
  { id: 'c', name: 'Juniper', avatar: 'feather' },
];

function gallery(props: Partial<Parameters<typeof AgentGallery>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onReorder: vi.fn(),
    onMakeDefault: vi.fn(),
    onDelete: vi.fn(),
  };
  const view = renderNacre(<AgentGallery agents={agents} {...handlers} {...props} />);
  return { ...view, ...handlers };
}

describe('AgentGallery', () => {
  it('is a wall of faces with their names, the default marked, and a + to make another', async () => {
    const { container, onOpen, onCreate } = gallery();
    const wall = screen.getByRole('list', { name: 'Agents' });
    expect(within(wall).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Conch, default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atlas' })).toHaveAccessibleDescription(
      'Plans trips Alt and an arrow key move it.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }));
    expect(onOpen).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    expect(onCreate).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('moves a face with Alt and an arrow, says where it went, and keeps the focus on it', async () => {
    const user = userEvent.setup();
    const { onReorder } = gallery();
    screen.getByRole('button', { name: 'Conch, default' }).focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(screen.getByRole('status')).toHaveTextContent('Conch moved to 2 of 3.');
    // Shown in its new place at once, before the new order comes back.
    const names = screen.getAllByRole('listitem').map((li) => li.style.order);
    expect(names.slice(0, 3)).toEqual(['1', '0', '2']);
  });

  it('offers the rest from each face’s ⋯: make it the default, move it, delete it', async () => {
    const user = userEvent.setup();
    const { onMakeDefault, onDelete, onReorder } = gallery();
    await user.click(screen.getByRole('button', { name: 'More for Atlas' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Make default' }));
    expect(onMakeDefault).toHaveBeenCalledWith('b');
    await user.click(screen.getByRole('button', { name: 'More for Atlas' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move later' }));
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
    await user.click(screen.getByRole('button', { name: 'More for Juniper' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('c');
  });

  it('drags a face to another place with the mouse, and a press without moving still opens it', () => {
    const { onReorder, onOpen } = gallery();
    const items = screen.getAllByRole('listitem');
    // jsdom has no layout: give each place a box, three across.
    items.forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({
          left: i * 100,
          top: 0,
          width: 100,
          height: 120,
          right: i * 100 + 100,
          bottom: 120,
        }) as DOMRect;
    });
    const conch = screen.getByRole('button', { name: 'Conch, default' });
    conch.setPointerCapture = () => {};
    fireEvent.pointerDown(conch, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 50,
      clientY: 60,
    });
    fireEvent.pointerMove(conch, { pointerId: 1, pointerType: 'mouse', clientX: 70, clientY: 60 });
    fireEvent.pointerMove(conch, { pointerId: 1, pointerType: 'mouse', clientX: 250, clientY: 60 });
    fireEvent.pointerUp(conch, { pointerId: 1, pointerType: 'mouse', clientX: 250, clientY: 60 });
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
    // The click that ends a drag isn't a press.
    fireEvent.click(conch);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('with one agent, there is nothing to move or delete', async () => {
    const user = userEvent.setup();
    gallery({ agents: agents.slice(0, 1) });
    await user.click(screen.getByRole('button', { name: 'More for Conch' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Move/ })).toBeNull();
  });
});

describe('AgentCard', () => {
  it('shows what’s typed as its name, and a placeholder before', () => {
    const { rerender } = renderNacre(<AgentCard name="" avatar="owl" placeholder="Your agent" />);
    expect(screen.getByText('Your agent')).toBeInTheDocument();
    rerender(<AgentCard name="Hoot" avatar="owl" isDefault />);
    expect(screen.getByText('Hoot')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
});

describe('ToneChips', () => {
  const tones = [
    { value: 'warm', label: 'Warm', description: 'Friendly and encouraging' },
    { value: 'concise', label: 'Concise', description: 'Brief and to the point' },
  ];

  it('is one choice of a few, walked with the arrows, its words under it', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { container } = renderNacre(
      <ToneChips aria-label="How it sounds" choices={tones} value="warm" onValueChange={change} />,
    );
    expect(screen.getByRole('radio', { name: 'Warm' })).toBeChecked();
    expect(screen.getByText('Friendly and encouraging')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Concise' }));
    expect(change).toHaveBeenCalledWith('concise');
    await expectAccessible(container);
  });
});

describe('AgentFacePicker', () => {
  it('chooses a face, then a colour for it, keeping the colour for the next face', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { container, rerender } = renderNacre(
      <AgentFacePicker name="Hoot" value={{ kind: 'preset', id: 'owl' }} onValueChange={change} />,
    );
    expect(screen.getByRole('radio', { name: 'Owl' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Amber' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Fox' }));
    expect(change).toHaveBeenLastCalledWith({ kind: 'preset', id: 'fox' });
    await user.click(screen.getByRole('radio', { name: 'Teal' }));
    expect(change).toHaveBeenLastCalledWith({ kind: 'preset', id: 'owl', color: 'teal' });
    rerender(
      <AgentFacePicker
        name="Hoot"
        value={{ kind: 'preset', id: 'owl', color: 'teal' }}
        onValueChange={change}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Cat' }));
    expect(change).toHaveBeenLastCalledWith({ kind: 'preset', id: 'cat', color: 'teal' });
    await expectAccessible(container);
  });

  it('leads with a picture of its own, without colours, until a face is chosen', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    renderNacre(
      <AgentFacePicker
        name="Ada"
        value={{ kind: 'image', url: '/api/agents/ag_ada1/avatar/im_1234' }}
        onValueChange={change}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Your picture' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Teal' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Moon' }));
    expect(change).toHaveBeenCalledWith({ kind: 'preset', id: 'moon' });
  });
});

describe('AgentPicker', () => {
  it('says who you’re talking to, and switches from a menu of faces', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const make = vi.fn();
    const { container } = renderNacre(
      <AgentPicker
        agents={agents}
        value="b"
        onValueChange={change}
        actions={[{ label: 'New agent', onSelect: make }]}
      />,
    );
    await expectAccessible(container);
    await user.click(
      screen.getByRole('button', { name: 'Talking to Atlas. Choose another agent' }),
    );
    expect(await screen.findByRole('menuitemradio', { name: /Atlas/ })).toBeChecked();
    await user.click(screen.getByRole('menuitemradio', { name: /Juniper/ }));
    expect(change).toHaveBeenCalledWith('c');
    await user.click(screen.getByRole('button', { name: /Talking to Atlas/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'New agent' }));
    expect(make).toHaveBeenCalled();
  });

  it('offers the default agent first, as no agent in particular', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { container, rerender } = renderNacre(
      <AgentPicker
        agents={agents}
        value={null}
        onValueChange={change}
        fallback={{
          label: 'Default agent',
          agent: { name: 'Conch', avatar: 'shell' },
          role: 'Conch, while it’s the default',
        }}
        label={(name) => `Answered by ${name}. Choose another agent`}
      />,
    );
    await expectAccessible(container);
    const button = screen.getByRole('button', {
      name: 'Answered by Default agent. Choose another agent',
    });
    await user.click(button);
    const unset = await screen.findByRole('menuitemradio', { name: /Default agent/ });
    expect(unset).toBeChecked();
    expect(unset).toHaveTextContent('Conch, while it’s the default');
    await user.click(screen.getByRole('menuitemradio', { name: /Atlas/ }));
    expect(change).toHaveBeenLastCalledWith('b');

    rerender(
      <AgentPicker
        agents={agents}
        value="b"
        onValueChange={change}
        fallback={{ label: 'Default agent', agent: { name: 'Conch', avatar: 'shell' } }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Talking to Atlas/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Default agent/ }));
    expect(change).toHaveBeenLastCalledWith(null);

    // An agent that's gone is the default's to answer for.
    rerender(
      <AgentPicker
        agents={agents}
        value="ag_gone"
        onValueChange={change}
        fallback={{ label: 'Default agent', agent: { name: 'Conch', avatar: 'shell' } }}
      />,
    );
    expect(screen.getByRole('button', { name: /Talking to Default agent/ })).toBeVisible();
  });
});
