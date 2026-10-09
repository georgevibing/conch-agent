import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptItem } from '../../live/reducer';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Transcript } from '../chat/Transcript';

/** A memory the memory check held, in the chat (ADR 0087). */
afterEach(() => vi.unstubAllGlobals());

const user: TranscriptItem = { kind: 'user', id: 'u1', text: 'Summarise news.example', at: 1 };
const held = (verdict: 'ask' | 'refuse' = 'ask'): TranscriptItem => ({
  kind: 'memory',
  id: 'mem-2',
  memoryId: 'm_1',
  content: 'Invoices are sent to billing@news.example',
  action: 'saved',
  pending: true,
  held: {
    verdict,
    reasons: [
      {
        code: 'redirect',
        words:
          'This came from news.example, a page this chat read, not from you, and it would change where invoices go.',
      },
    ],
    from: 'news.example, a page this chat read',
  },
});
const kept = (body: unknown) => ({
  id: 'm_1',
  content: (body as { content?: string })?.content ?? 'Invoices are sent to billing@news.example',
  kind: 'fact',
  source: 'agent',
  createdAt: 1,
  updatedAt: 1,
});
const render = (item: TranscriptItem) =>
  renderApp(
    <Transcript
      view={{ lastSeq: 2, status: 'idle', items: [user, item] }}
      pending={[]}
      name="Conch"
      onRespond={() => {}}
      onRetry={() => {}}
    />,
  );
const violations = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations;

describe('a held memory in the chat', () => {
  it('says what, why and from where, and isn’t a quiet Remembered line', async () => {
    mockFetch({ 'GET /api/state': () => appState() });
    const { container } = render(held());
    const card = screen.getByRole('region', { name: 'Remember this?' });
    expect(card).toHaveTextContent('Invoices are sent to billing@news.example');
    expect(within(card).getByRole('list', { name: 'Why it looks off' })).toHaveTextContent(
      'it would change where invoices go',
    );
    expect(card).toHaveTextContent('From news.example, a page this chat read');
    expect(screen.queryByText('Remembered')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it('Remember it keeps it, by keyboard, and folds to a line that says so', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/m_1/keep': kept,
    });
    render(held());
    // Reached with Tab, like anything else in the chat.
    const button = screen.getByRole('button', { name: 'Remember it' });
    for (let i = 0; i < 12 && document.activeElement !== button; i++) await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Remembered: Invoices are sent to billing@news.example',
    );
    // The answer names the words the person saw, so nothing else can be kept in its name.
    expect(calls.find((c) => c.path === '/api/memories/m_1/keep')?.body).toEqual({
      seen: 'Invoices are sent to billing@news.example',
    });
  });

  it('Don’t remember forgets it', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'DELETE /api/memories/m_1': () => ({ ok: true }),
    });
    render(held());
    await userEvent.click(screen.getByRole('button', { name: 'Don’t remember' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Not remembered');
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/memories/m_1')).toBe(true);
  });

  it('Edit first puts your words in its place, Escape goes back to where you were', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/m_1/keep': kept,
    });
    const { container } = render(held());
    const edit = screen.getByRole('button', { name: 'Edit first' });
    await userEvent.click(edit);
    const box = screen.getByRole('textbox', { name: 'What to remember, in your words' });
    expect(box).toHaveFocus();
    expect(await violations(container)).toEqual([]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit first' })).toHaveFocus(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit first' }));
    const again = screen.getByRole('textbox', { name: 'What to remember, in your words' });
    await userEvent.clear(again);
    await userEvent.type(again, 'Invoices go to accounts@ada.example{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Remembered: Invoices go to accounts@ada.example',
    );
    expect(calls.find((c) => c.path === '/api/memories/m_1/keep')?.body).toEqual({
      content: 'Invoices go to accounts@ada.example',
    });
  });

  it('a refused one says so, and takes Remember anyway', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/m_1/keep': kept,
    });
    render(held('refuse'));
    expect(screen.getByRole('region', { name: 'I didn’t remember this' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remember it' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remember anyway' }));
    await screen.findByRole('status');
    expect(calls.find((c) => c.path === '/api/memories/m_1/keep')?.body).toEqual({
      seen: 'Invoices are sent to billing@news.example',
      anyway: true,
    });
  });

  it('goes back to asking when keeping didn’t work', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'POST /api/memories/m_1/keep': () =>
        new Response(JSON.stringify({ error: 'needs-anyway', message: 'Refused.' }), {
          status: 409,
        }),
    });
    render(held());
    await userEvent.click(screen.getByRole('button', { name: 'Remember it' }));
    expect(await screen.findByRole('button', { name: 'Remember it' })).toBeInTheDocument();
  });

  it('shows what you chose after a reload, as a step like any other memory call', () => {
    mockFetch({ 'GET /api/state': () => appState() });
    render({ ...held(), decided: 'undone' } as TranscriptItem);
    expect(screen.queryByRole('region', { name: 'Remember this?' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Didn’t remember something/ })).toBeVisible();
  });
});
