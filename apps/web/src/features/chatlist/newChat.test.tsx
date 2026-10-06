import type { ChatFolder } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';
import { Sidebar } from '../sidebar/Sidebar';
import { folderOfNewChat } from './newChat';

afterEach(() => {
  vi.unstubAllGlobals();
  useLiveStore.setState({ pending: {} });
  localStorage.clear();
  sessionStorage.clear();
});

const work: ChatFolder = {
  id: 'f_work1',
  name: 'Work',
  glyph: 'briefcase',
  color: 'blue',
  order: 1,
  createdAt: 0,
};

const sends = () =>
  (FakeSocket.last?.sent ?? []).filter(
    (m) => (m as { type: string }).type === 'conversation.send',
  ) as { text: string; folder?: string; conversationId?: string }[];

function app(route = '/c/c9') {
  mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/folders': () => [work],
    'GET /api/conversations': () => [],
  });
  return renderApp(
    <>
      <Sidebar />
      <Routes>
        <Route path="/" element={<ChatView />} />
        <Route path="/c/:conversationId" element={<p>Another chat</p>} />
      </Routes>
    </>,
    { route },
  );
}

describe('a new chat in a folder', () => {
  it('starts from the folder, shows where it goes, and is sent filed there', async () => {
    const { where } = app();
    const user = userEvent.setup();
    const folder = await screen.findByRole('region', { name: 'Work' });
    await user.click(within(folder).getByRole('button', { name: 'New chat in Work' }));

    expect(where()).toBe('/');
    // Its place in the folder, open, until the chat exists; and the page says so too.
    expect(
      within(screen.getByRole('region', { name: 'Work' })).getByRole('link', { name: 'New chat' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText(/New chat in/)).toHaveTextContent('New chat in Work');

    await user.type(
      screen.getByRole('textbox', { name: 'Message Conch' }),
      'Draft the offsite{Enter}',
    );
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]).toMatchObject({ text: 'Draft the offsite', folder: 'f_work1' });
    expect(sends()[0]?.conversationId).toBeUndefined();
  });

  it('can be started outside the folder instead, and New chat is never in one', async () => {
    app();
    const user = userEvent.setup();
    const folder = await screen.findByRole('region', { name: 'Work' });
    await user.click(within(folder).getByRole('button', { name: 'New chat in Work' }));
    await user.click(await screen.findByRole('button', { name: 'Start it outside Work' }));
    expect(screen.queryByText(/New chat in/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Work' })).queryByRole('link', {
        name: 'New chat',
      }),
    ).not.toBeInTheDocument();

    // The plain New chat after a folder's: a chat in the list, as always.
    await user.click(within(folder).getByRole('button', { name: 'New chat in Work' }));
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    await user.type(await screen.findByRole('textbox', { name: 'Message Conch' }), 'Hi{Enter}');
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]?.folder).toBeUndefined();
  });
});

describe('folderOfNewChat', () => {
  it('reads only a folder id from the page’s history state', () => {
    expect(folderOfNewChat({ folder: 'f_work1' })).toBe('f_work1');
    expect(folderOfNewChat({ folder: '' })).toBeUndefined();
    expect(folderOfNewChat({ folder: 3 })).toBeUndefined();
    expect(folderOfNewChat({ draft: 'hi' })).toBeUndefined();
    expect(folderOfNewChat(null)).toBeUndefined();
  });
});
