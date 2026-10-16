import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { META_SEP } from '../../components/MetaList';
import { expectAccessible, renderNacre } from '../../test/render';
import { OtherChatsLook, otherChatsSummary, type OtherChatView } from './OtherChats';

const chats: OtherChatView[] = [
  { id: 'c1', title: 'Fix login', state: 'working', words: 'Editing files', sameFolder: true },
  { id: 'c2', title: 'Release notes', state: 'needs-you', words: 'Needs you' },
  { id: 'c3', title: 'Lisbon', state: 'idle', words: 'Done for now', from: 'Telegram' },
];

describe('OtherChatsLook', () => {
  it('says how many are busy, and shows each with its state when opened', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<OtherChatsLook chats={chats} />);
    const row = screen.getByRole('button', { name: /Checked on your other chats/ });
    expect(row.textContent).toContain(`1 working${META_SEP}1 needs you`);
    await user.click(row);
    const list = screen.getByRole('list', { name: 'Your other chats' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((b) => b.textContent)).toEqual([
      `Fix login, workingEditing files${META_SEP}Same folder`,
      'Release notes, needs youNeeds you',
      `Lisbon, done for nowDone for now${META_SEP}Telegram`,
    ]);
    await expectAccessible(container);
  });

  it('opens a chat from its row, from the keyboard too', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderNacre(<OtherChatsLook chats={chats} onOpen={onOpen} />);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }));
  });

  it('says when nothing else is going on, with nothing to open', async () => {
    const { container } = renderNacre(<OtherChatsLook chats={[]} />);
    expect(screen.getByText('Nothing else going on')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('counts in words', () => {
    expect(otherChatsSummary([{ state: 'needs-you' }, { state: 'needs-you' }])).toBe('2 need you');
    expect(otherChatsSummary([{ state: 'idle' }])).toBe('1 chat, none busy');
  });
});
