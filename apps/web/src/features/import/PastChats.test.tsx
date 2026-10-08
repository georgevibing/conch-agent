import type { ChatImportStatus, PastChatDetail } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { PastChatSheet } from './PastChatSheet';
import { PastChatsSection } from './PastChatsSection';
import { openPastChat, usePastChatSheet } from './pastChats';

const auth = { method: 'none', signedIn: true, setupRequired: false, secure: true };
const ID = 'pc_0123456789abcdef';

const found = (patch: Partial<ChatImportStatus> = {}): ChatImportStatus => ({
  sources: [
    {
      id: 'claude-code',
      label: 'Claude Code',
      found: 1031,
      fresh: 1031,
      projects: [{ name: 'shop', count: 412 }],
      from: Date.parse('2025-03-04'),
    },
    { id: 'codex', label: 'Codex', found: 253, fresh: 253, projects: [] },
  ],
  brought: 0,
  ...patch,
});

const brought = (): ChatImportStatus => ({
  sources: found().sources.map((s) => ({ ...s, fresh: 0 })),
  brought: 1284,
  last: { at: Date.now(), added: 1284, updated: 0, skipped: 0, redacted: 31 },
});

afterEach(() => usePastChatSheet.setState({ id: undefined }));

describe('Your past chats, in Settings', () => {
  it('says what it found, brings them in with one press, and follows them in', async () => {
    const user = userEvent.setup();
    let status = found();
    const calls = mockFetch({
      'GET /api/auth': () => auth,
      'GET /api/import/chats': () => status,
      'POST /api/import/chats': () => {
        status = { ...found(), running: { done: 400, total: 1284, current: 'Claude Code' } };
        return status;
      },
    });
    renderApp(<PastChatsSection />);
    expect(await screen.findByRole('heading', { name: 'Your past chats' })).toBeInTheDocument();
    expect(screen.getByText('from Claude Code and Codex. Bring them in?')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Where they’re from' })).toHaveTextContent(
      '1,031 chats',
    );
    await user.click(screen.getByRole('button', { name: 'Bring them in' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/import/chats')).toBe(true);
    expect(await screen.findByText('400 of 1,284')).toBeInTheDocument();
    expect(screen.getByText('Reading Claude Code')).toBeInTheDocument();

    act(() => {
      status = brought();
    });
    expect(
      await screen.findByText(/conversations are here/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/31 things that looked like a key/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search them' })).toBeInTheDocument();
  });

  it('once they’re in, says so in a line, and takes them out only after asking', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/auth': () => auth,
      'GET /api/import/chats': () => brought(),
      'DELETE /api/import/chats': () => ({ removed: 1284 }),
    });
    renderApp(<PastChatsSection />);
    expect(
      await screen.findByText(/1,284 past chats from Claude Code and Codex in Conch/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bring them in' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Take them out' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'The apps they came from keep',
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Take them out' }).at(-1) as HTMLElement,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/import/chats')).toBe(true),
    );
  });

  it('shows nothing for someone who never used another app', async () => {
    const calls = mockFetch({
      'GET /api/auth': () => auth,
      'GET /api/import/chats': () => ({ sources: [], brought: 0 }),
    });
    renderApp(<PastChatsSection />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/import/chats')).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Your past chats' })).toBeNull();
  });
});

describe('A past chat, opened to read', () => {
  const detail: PastChatDetail = {
    chat: {
      id: ID,
      source: 'claude-code',
      title: 'Checkout double charge',
      project: 'shop',
      createdAt: Date.parse('2026-03-01T10:00:00Z'),
      updatedAt: Date.parse('2026-03-01T10:05:00Z'),
      messages: 2,
      model: 'claude-sonnet-4-5',
    },
    messages: [
      { id: 'claude-code.0', role: 'user', text: 'Why does it double-charge?', at: 1 },
      { id: 'claude-code.1', role: 'assistant', text: 'The **retry** runs first.', at: 2 },
    ],
  };

  it('reads it in a sheet, and carries it on in a chat of Conch’s own', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      [`GET /api/past-chats/${ID}`]: () => detail,
      [`POST /api/past-chats/${ID}/continue`]: () => ({ conversationId: 'c_new' }),
    });
    const { where } = renderApp(<PastChatSheet />);
    act(() => openPastChat(ID));
    expect(
      await screen.findByRole('heading', { name: 'Checkout double charge' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/shop · /)).toHaveTextContent('2 messages · claude-sonnet-4-5');
    expect(screen.getByRole('log', { name: 'Past chat from Claude Code' })).toHaveTextContent(
      'The retry runs first.',
    );
    await user.click(screen.getByRole('button', { name: 'Carry on here' }));
    await waitFor(() => expect(where()).toBe('/c/c_new'));
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(usePastChatSheet.getState().id).toBeUndefined();
  });
});
