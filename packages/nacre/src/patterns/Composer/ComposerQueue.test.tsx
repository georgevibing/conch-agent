import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ComposerQueue } from './ComposerQueue';

const items = [
  { id: 'a', text: 'Once the PR is green, find why CI fails' },
  { id: 'b', text: 'Then update the docs', meta: '2 files' },
  { id: 'c', text: 'And tell me what changed' },
];

function setup(props: Partial<Parameters<typeof ComposerQueue>[0]> = {}) {
  const handlers = {
    onReorder: vi.fn(),
    onSteer: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };
  const view = renderNacre(<ComposerQueue items={items} name="Conch" {...handlers} {...props} />);
  return { ...view, ...handlers };
}

describe('ComposerQueue', () => {
  it('lists what waits, in order, and says how it goes', async () => {
    const { container } = setup();
    const region = screen.getByRole('region', { name: '3 messages waiting' });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(region).toHaveTextContent('Sends one at a time when Conch is done · drag to reorder');
    expect(screen.getByText('2 files')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('moves one with the arrow keys on its handle, and says where it went', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();
    screen.getByRole('button', { name: /^Move “Then update the docs”, 2 of 3/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
    expect(screen.getByRole('status')).toHaveTextContent('Moved to 3 of 3.');
  });

  it('steers, edits and removes each one', async () => {
    const user = userEvent.setup();
    const { onSteer, onEdit, onRemove } = setup();
    const [, second] = screen.getAllByRole('button', {
      name: 'Steer: stop Conch and send this now',
    });
    await user.click(second as HTMLElement);
    expect(onSteer).toHaveBeenCalledWith('b');
    await user.click(
      screen.getAllByRole('button', { name: 'Edit: take it back into the box' })[2] as HTMLElement,
    );
    expect(onEdit).toHaveBeenCalledWith('c');
    await user.click(screen.getAllByRole('button', { name: 'Don’t send it' })[0] as HTMLElement);
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('says it waits after a stop, and offers to send instead of steer', () => {
    setup({ running: false, paused: true });
    expect(screen.getByText(/Waiting: the reply was stopped/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send this now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Steer/ })).toBeNull();
  });

  it('has no handle when only one waits', () => {
    setup({ items: items.slice(0, 1) });
    expect(screen.getByRole('region', { name: 'A message waiting' })).toHaveTextContent(
      'Sends when Conch is done',
    );
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
  });
});
