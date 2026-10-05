import type { ConversationSummary } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { ArchivedBanner } from './ArchivedBanner';
import { ArchiveView } from './ArchiveView';

afterEach(() => vi.unstubAllGlobals());

const HOUR = 3_600_000;

function chat(id: string, title: string, extra: Partial<ConversationSummary> = {}) {
  return {
    id,
    title,
    preview: `${title}, said last`,
    createdAt: Date.now() - 5 * HOUR,
    updatedAt: Date.now() - HOUR,
    status: 'idle' as const,
    options: {},
    ...extra,
  };
}

function Where() {
  return <output aria-label="Path">{useLocation().pathname}</output>;
}

describe('Archiving from the chat list', () => {
  it('takes a chat out of the list, says where it went, and Undo puts it back', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week'), chat('c2', 'Groceries')],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    renderApp(
      <>
        <Sidebar />
        <Toaster />
      </>,
    );
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Plan my week' });
    expect(screen.queryByRole('link', { name: /^Archived/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Options for Plan my week' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    expect(screen.queryByRole('link', { name: 'Plan my week' })).not.toBeInTheDocument();
    // The menu hides the rest of the page from assistive tech until it has closed.
    expect(await screen.findByRole('link', { name: 'Archived 1 chat' })).toHaveAttribute(
      'href',
      '/archived',
    );
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/conversations/c1',
          body: { archived: true },
        }),
      ),
    );
    expect(await screen.findByText('Archived “Plan my week”')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('link', { name: 'Plan my week' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Archived/ })).not.toBeInTheDocument();
    // The last change sent puts it back (other rows may still be fetching what they show).
    await waitFor(() =>
      expect(calls.filter((c) => c.method !== 'GET').at(-1)).toMatchObject({
        method: 'PATCH',
        body: { archived: false },
      }),
    );
  });

  it('archiving the chat you are reading takes you to a new one', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week')],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    const page = (
      <>
        <Sidebar />
        <Where />
      </>
    );
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={page} />
        <Route path="*" element={page} />
      </Routes>,
      { route: '/c/c1' },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for Plan my week' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(screen.getByRole('status', { name: 'Path' })).toHaveTextContent(/^\/$/);
  });

  it('puts it back in the list when the gateway refuses', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week')],
      'PATCH /api/conversations/c1': () =>
        new Response(JSON.stringify({ error: 'not-found', message: 'Conversation not found.' }), {
          status: 404,
        }),
    });
    renderApp(
      <>
        <Sidebar />
        <Toaster />
      </>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for Plan my week' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Couldn’t archive that chat')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan my week' })).toBeInTheDocument();
  });

  it('a chat written in again comes back to the list by itself', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week', { archivedAt: Date.now() })],
    });
    renderApp(<Sidebar />);
    await screen.findByRole('link', { name: 'Archived 1 chat' });
    expect(screen.queryByRole('link', { name: 'Plan my week' })).not.toBeInTheDocument();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => {
      FakeSocket.last?.push({
        type: 'conversation.updated',
        conversation: chat('c1', 'Plan my week', { updatedAt: Date.now() }),
      });
    });
    expect(await screen.findByRole('link', { name: 'Plan my week' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Archived/ })).not.toBeInTheDocument();
  });
});

describe('Archived chats page', () => {
  const archived = [
    chat('c1', 'Plan my week', { archivedAt: Date.now() - 2 * HOUR }),
    chat('c2', 'Groceries', { archivedAt: Date.now() - 1000 }),
    chat('c3', 'Still here'),
    // A routine's run is never a chat in the archive.
    chat('r1', 'Morning briefing', {
      archivedAt: Date.now(),
      origin: { kind: 'routine', routineId: 'r', runId: 'x' },
    }),
  ];

  it('lists archived chats, newest first, and opens one', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => archived,
    });
    renderApp(
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ArchiveView />
              <Where />
            </>
          }
        />
      </Routes>,
      { route: '/archived' },
    );
    const list = await screen.findByRole('list', { name: 'Archived chats' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Groceries'),
      expect.stringContaining('Plan my week'),
    ]);
    expect(rows[1]).toHaveTextContent('Archived 2 hours ago · Plan my week, said last');
    const user = userEvent.setup();
    await user.click(within(list).getByRole('button', { name: /^Plan my week/ }));
    expect(screen.getByRole('status', { name: 'Path' })).toHaveTextContent('/c/c1');
  });

  it('unarchives one, back to the list, with a way to open it', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => archived,
      'PATCH /api/conversations/c2': () => ({ ok: true }),
    });
    renderApp(
      <>
        <ArchiveView />
        <Toaster />
      </>,
      { route: '/archived' },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Unarchive Groceries' }));
    expect(screen.queryByRole('button', { name: /^Groceries/ })).not.toBeInTheDocument();
    expect(await screen.findByText('“Groceries” is back in your chats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'PATCH', body: { archived: false } }),
    );
  });

  it('asks before deleting one, and Delete all deletes the ones it named', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => archived,
      'DELETE /api/conversations/c1': () => ({ ok: true }),
      'DELETE /api/conversations/c2': () => ({ ok: true }),
    });
    renderApp(
      <>
        <ArchiveView />
        <Toaster />
      </>,
      { route: '/archived' },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Plan my week' }));
    const one = await screen.findByRole('alertdialog', { name: 'Delete this conversation?' });
    expect(one).toHaveTextContent('“Plan my week” will be removed from Conch.');
    await user.click(within(one).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'More for archived chats' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete all…' }));
    const all = await screen.findByRole('alertdialog', { name: 'Delete 2 archived chats?' });
    await user.click(within(all).getByRole('button', { name: 'Delete 2 chats' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
        '/api/conversations/c2',
        '/api/conversations/c1',
      ]),
    );
    expect(await screen.findByText('Deleted 2 chats')).toBeInTheDocument();
    expect(await screen.findByText('Nothing archived')).toBeInTheDocument();
  });

  it('finds one by name once there are many', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      chat(`c${i}`, i === 3 ? 'Lisbon trip' : `Chat number ${i}`, { archivedAt: Date.now() - i }),
    );
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => many,
    });
    renderApp(<ArchiveView />, { route: '/archived' });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Find an archived chat' }), 'lisb');
    const list = screen.getByRole('list', { name: 'Archived chats' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Lisb', { selector: 'mark' })).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'Find an archived chat' }));
    await user.type(screen.getByRole('textbox', { name: 'Find an archived chat' }), 'zzzz');
    expect(screen.getByText(/No archived chat is called “zzzz”/)).toBeInTheDocument();
  });

  it('says what the archive is for when it is empty', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c3', 'Still here')],
    });
    renderApp(<ArchiveView />, { route: '/archived' });
    expect(await screen.findByText('Nothing archived')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More for archived chats' }),
    ).not.toBeInTheDocument();
  });
});

describe('An archived chat, open', () => {
  it('says it is archived, and Unarchive puts it back', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week', { archivedAt: Date.now() })],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    renderApp(<ArchivedBanner conversationId="c1" />, { route: '/c/c1' });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Archived just now. Write here and it goes back to your list.');
    await userEvent.setup().click(within(note).getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'PATCH', body: { archived: false } }),
    );
  });

  it('shows nothing on a chat in the list', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [chat('c1', 'Plan my week')],
    });
    renderApp(<ArchivedBanner conversationId="c1" />, { route: '/c/c1' });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
