import type { ChatFolder, ConversationSummary } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { useSeen } from './useSeen';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  localStorage.clear();
  // “An hour ago” is only Today after 01:00. Keep date grouping independent of
  // the wall clock while leaving interaction and query timers running normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 6, 15, 12));
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function chat(id: string, title: string, extra: Partial<ConversationSummary> = {}) {
  return {
    id,
    title,
    preview: '',
    createdAt: Date.now() - 5 * HOUR,
    updatedAt: Date.now() - HOUR,
    status: 'idle' as const,
    options: {},
    ...extra,
  } satisfies ConversationSummary;
}

const work: ChatFolder = {
  id: 'f_work1',
  name: 'Work',
  glyph: 'briefcase',
  color: 'blue',
  order: 1,
  createdAt: 0,
};

/** The sidebar beside the open chat, which says it's been seen as ChatView does. */
function OpenChat() {
  useSeen(useParams().conversationId);
  return <Sidebar />;
}

function sidebar() {
  return renderApp(
    <>
      <Sidebar />
      <Toaster />
    </>,
  );
}

describe('The chat list, organised', () => {
  it('shows what needs you, what you pinned, your folders, then the rest by month', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [work],
      'GET /api/conversations': () => [
        chat('c1', 'Book the dentist', { status: 'awaiting-permission' }),
        chat('c2', 'Reading list', { pinned: 1 }),
        chat('c3', 'Offsite agenda', { folderId: 'f_work1' }),
        chat('c4', 'Lisbon trip'),
        chat('c5', 'Sourdough schedule', { updatedAt: Date.now() - 80 * DAY }),
      ],
    });
    sidebar();
    const needs = await screen.findByRole('region', { name: 'Needs you' });
    expect(within(needs).getByRole('link', { name: 'Book the dentist, Needs you' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Pinned' })).getByRole('link', {
        name: 'Reading list',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Work' })).getByRole('link', {
        name: 'Offsite agenda',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Today' })).getByRole('link', {
        name: 'Lisbon trip',
      }),
    ).toBeVisible();
    // No "Earlier": an old chat sits under its month.
    expect(screen.queryByRole('region', { name: 'Earlier' })).not.toBeInTheDocument();
    const month = new Date(Date.now() - 80 * DAY).toLocaleDateString(undefined, {
      month: 'long',
    });
    expect(screen.getByRole('region', { name: new RegExp(month) })).toBeInTheDocument();
  });

  it('pins from the menu, and says a reply you weren’t there for is new', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [
        chat('c1', 'Plan my week'),
        chat('c2', 'Groceries', { seenAt: Date.now() - 2 * HOUR }),
      ],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    sidebar();
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Groceries, New' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Options for Plan my week' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    const pinned = await screen.findByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('link', { name: 'Plan my week' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { pinned: true } }),
      ),
    );
  });

  it('Undo after archiving a pinned chat puts it back where it was pinned', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'Reading list', { pinned: 7 })],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    sidebar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for Reading list' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const note = (await screen.findByText('Archived “Reading list”')).closest(
      '[data-sonner-toast]',
    );
    if (!(note instanceof HTMLElement)) throw new Error('the note');
    await user.click(within(note).getByRole('button', { name: 'Undo' }));
    const pinned = await screen.findByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('link', { name: 'Reading list' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          body: { archived: false, pinned: true, pinOrder: 7 },
        }),
      ),
    );
  });

  it('the open chat is marked seen, and never shows as new', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'Plan my week', { seenAt: 0 })],
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<OpenChat />} />
      </Routes>,
      { route: '/c/c1' },
    );
    expect(await screen.findByRole('link', { name: 'Plan my week' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { seen: true } }),
      ),
    );
  });

  it('makes a folder from a chat’s menu and moves the chat into it', async () => {
    let folders: ChatFolder[] = [];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => folders,
      'GET /api/conversations': () => [chat('c1', 'Offsite agenda')],
      'POST /api/folders': (body) => {
        const made = { ...work, ...(body as Partial<ChatFolder>) };
        folders = [made];
        return made;
      },
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    sidebar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for Offsite agenda' }));
    // Into the submenu by keyboard, as Radix does it.
    (await screen.findByRole('menuitem', { name: 'Move to' })).focus();
    await user.keyboard('{ArrowRight}');
    const item = await screen.findByRole('menuitem', { name: 'New folder…' });
    item.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'New folder' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Work');
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));

    const folder = await screen.findByRole('region', { name: 'Work' });
    expect(within(folder).getByRole('link', { name: 'Offsite agenda' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PATCH', body: { folder: 'f_work1' } }),
      ),
    );
  });

  it('removing a folder asks, and puts its chats back in the list', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [work],
      'GET /api/conversations': () => [chat('c1', 'Offsite agenda', { folderId: 'f_work1' })],
      'DELETE /api/folders/f_work1': () => ({ ok: true }),
    });
    sidebar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for the folder Work' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove folder' }));
    const ask = await screen.findByRole('alertdialog');
    expect(ask).toHaveTextContent('Its chat goes back to your list. Nothing is deleted.');
    await user.click(within(ask).getByRole('button', { name: 'Remove folder' }));
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByRole('link', { name: 'Offsite agenda' })).toBeInTheDocument();
    expect(calls).toContainEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('selects several with Select, and archives them together with Undo', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'One'), chat('c2', 'Two'), chat('c3', 'Three')],
      'POST /api/conversations/bulk': () => ({ ok: true, done: 2 }),
      'PATCH /api/conversations/c1': () => ({ ok: true }),
      'PATCH /api/conversations/c2': () => ({ ok: true }),
    });
    sidebar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Options for One' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Two' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/conversations/bulk',
          body: { ids: ['c1', 'c2'], change: { archived: true } },
        }),
      ),
    );
    expect(await screen.findByText('Archived 2 chats')).toBeInTheDocument();
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Archived 2 chats' })).toBeInTheDocument();
    const note = screen.getByText('Archived 2 chats').closest('[data-sonner-toast]');
    if (!(note instanceof HTMLElement)) throw new Error('the note');
    await user.click(within(note).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('link', { name: 'One' })).toBeInTheDocument();
  });

  it('filters to what’s new, and says so when nothing is', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'Seen one', { seenAt: Date.now() })],
    });
    sidebar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Show and sort chats' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'New' }));
    expect(await screen.findByText('Nothing new. You’re all caught up.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Seen one' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(await screen.findByRole('link', { name: 'Seen one' })).toBeInTheDocument();
  });

  it('offers to tidy away chats nobody has touched in a month', async () => {
    const old = Array.from({ length: 9 }, (_, i) =>
      chat(`o${i}`, `Old ${i}`, { updatedAt: Date.now() - 45 * DAY }),
    );
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'Fresh'), ...old],
      'POST /api/conversations/bulk': () => ({ ok: true, done: 9 }),
    });
    sidebar();
    const user = userEvent.setup();
    expect(await screen.findByText('9 chats you haven’t opened in a month')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive them' }));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ path: '/api/conversations/bulk' })),
    );
    expect(await screen.findByRole('link', { name: 'Archived 9 chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fresh' })).toBeInTheDocument();
  });

  it('a folder made on another device arrives by itself', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/folders': () => [],
      'GET /api/conversations': () => [chat('c1', 'Offsite agenda', { folderId: 'f_work1' })],
    });
    sidebar();
    await screen.findByRole('link', { name: 'Offsite agenda' });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    act(() => FakeSocket.last?.push({ type: 'folders.changed', folders: [work] }));
    expect(await screen.findByRole('region', { name: 'Work' })).toBeInTheDocument();
  });
});
