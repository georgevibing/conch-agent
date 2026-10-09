import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { PastChatsLook, type PastChatView } from './PastChats';

const chats: PastChatView[] = [
  {
    id: 'c1',
    title: 'Wedding planning',
    when: '6 days ago',
    lines: [
      { id: 'u1', who: 'You', text: 'Which venue did we pick?', ranges: [[6, 11]] },
      { id: 'a1', who: 'Shelly', text: 'The venue at Quinta da Regaleira.' },
    ],
  },
  {
    id: 'c2',
    title: 'Venue shortlist',
    when: 'Sep 12',
    from: 'Telegram',
    archived: true,
    lines: [{ id: 'u2', who: 'You', text: 'Three venue ideas near Sintra' }],
  },
];

describe('PastChatsLook', () => {
  it('says what it looked for and how much it found, and shows where when opened', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <PastChatsLook action="search" query="venue" chats={chats} />,
    );
    const row = screen.getByRole('button', { name: /Looked through your chats/ });
    expect(row).toHaveTextContent('“venue” · 2 chats');
    await user.click(row);
    const list = screen.getByRole('list', { name: 'Chats it found' });
    const found = within(list).getAllByRole('button');
    expect(found.map((b) => b.textContent)).toEqual([
      'Wedding planning6 days ago',
      'YouWhich venue did we pick?',
      'ShellyThe venue at Quinta da Regaleira.',
      'Venue shortlistTelegram\u00a0· Archived\u00a0· Sep 12',
      'YouThree venue ideas near Sintra',
    ]);
    // The word that matched is marked, not only coloured.
    expect(within(list).getByText('venue', { selector: 'mark' })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('opens the chat at a line, or at its first match from the title', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderNacre(
      <PastChatsLook action="search" query="venue" chats={chats} onOpen={onOpen} defaultOpen />,
    );
    await user.click(screen.getByRole('button', { name: /Shelly/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'c1' }),
      expect.objectContaining({ id: 'a1' }),
    );
    await user.click(screen.getByRole('button', { name: /^Venue shortlist/ }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'c2' }),
      expect.objectContaining({ id: 'u2' }),
    );
  });

  it('works from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderNacre(<PastChatsLook action="search" query="venue" chats={chats} onOpen={onOpen} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Looked through your chats/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: /^Wedding planning/ })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1' }),
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('says nothing was found, with nothing to open', async () => {
    const { container } = renderNacre(
      <PastChatsLook action="search" query="zeppelin" chats={[]} />,
    );
    expect(screen.getByText('“zeppelin” · nothing found')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectAccessible(container);
  });

  it('names the chat it read, and says when matches were only close', () => {
    renderNacre(<PastChatsLook action="read" chats={chats.slice(0, 1)} />);
    expect(screen.getByRole('button', { name: /Read your chat/ })).toHaveTextContent(
      'Wedding planning',
    );
    renderNacre(<PastChatsLook action="search" query="venu" close chats={chats.slice(0, 1)} />);
    expect(screen.getByText('“venu” · 1 chat, close matches')).toBeInTheDocument();
  });
});
