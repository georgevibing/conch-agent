import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ArchivedChats, type ArchivedChat } from './ArchivedChats';

const chats: ArchivedChat[] = [
  { id: 'a', title: 'Plan my week', archived: '2 hours ago', preview: 'Gym on Tuesday.' },
  { id: 'b', title: 'Groceries', archived: 'yesterday' },
];

describe('ArchivedChats', () => {
  it('lists each chat with when it was archived and what was said last', async () => {
    const { container } = renderNacre(<ArchivedChats chats={chats} />);
    const list = screen.getByRole('list', { name: 'Archived chats' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Plan my week');
    expect(rows[0]).toHaveTextContent('Archived 2 hours ago · Gym on Tuesday.');
    expect(rows[1]).toHaveTextContent('Archived yesterday');
    expect(rows[1]).not.toHaveTextContent('·');
    // Nothing to do but read: no actions offered.
    expect(screen.queryByRole('button', { name: /Unarchive|Delete/ })).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens a chat, and unarchives or deletes it from beside the row, not inside it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onUnarchive = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderNacre(
      <ArchivedChats chats={chats} onOpen={onOpen} onUnarchive={onUnarchive} onDelete={onDelete} />,
    );

    await user.click(screen.getByRole('button', { name: /^Plan my week/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));

    await user.click(screen.getByRole('button', { name: 'Unarchive Groceries' }));
    expect(onUnarchive).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));

    await user.click(screen.getByRole('button', { name: 'Delete Plan my week' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await expectAccessible(container);
  });

  it('works from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onUnarchive = vi.fn();
    renderNacre(
      <ArchivedChats chats={chats.slice(0, 1)} onOpen={onOpen} onUnarchive={onUnarchive} />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /^Plan my week/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Unarchive Plan my week' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it('marks where a filter matched the title', () => {
    renderNacre(
      <ArchivedChats
        chats={[{ id: 'a', title: 'Plan my week', archived: 'today', ranges: [[0, 4]] }]}
      />,
    );
    expect(screen.getByText('Plan', { selector: 'mark' })).toBeInTheDocument();
  });
});
