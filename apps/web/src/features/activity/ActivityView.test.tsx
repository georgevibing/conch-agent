import type { ActivityEntry } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { ActivityView, matchedRanges } from './ActivityView';

afterEach(() => vi.unstubAllGlobals());

const entry = (id: string, title: string, chat: string, ago = 0): ActivityEntry => ({
  id,
  at: Date.now() - ago,
  kind: 'command',
  title,
  status: 'done',
  conversation: { id: 'c1', title: chat },
});

describe('finding something in Activity', () => {
  it('asks Conch for it (all of history, not just what is shown) and marks the match', async () => {
    const user = userEvent.setup();
    const all = [
      entry('c1:2', 'Ran `git push origin main`', 'Conch repository access check'),
      entry('c1:1', 'Searched the web for “Berlin weather”', 'Weather forecast for Berlin', 1),
    ];
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [],
      'GET /api/activity': () => {
        const q = new URL(calls.at(-1)?.path ?? '/', 'http://x').searchParams.get('q');
        return { entries: q ? all.filter((e) => e.title.includes('git')) : all };
      },
    });
    renderApp(<ActivityView />);
    expect(await screen.findByText(/Berlin weather/)).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Find in activity' }), 'gpush');
    await waitFor(() =>
      expect(calls.some((c) => c.path.includes('/api/activity?q=gpush'))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText(/Berlin weather/)).not.toBeInTheDocument());
    // The matched letters are marked, inside the code too.
    const row = screen.getByRole('button', { name: /git push origin main/ });
    const marks = within(row).getAllByText((_, el) => el?.tagName === 'MARK');
    expect(marks.map((m) => m.textContent).join('')).toBe('gpush');
  });

  it('says plainly when nothing matches', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [],
      'GET /api/activity': () => ({ entries: [] }),
    });
    renderApp(<ActivityView />);
    await user.type(await screen.findByRole('searchbox', { name: 'Find in activity' }), 'zzz');
    expect(await screen.findByText('Nothing matches “zzz”')).toBeInTheDocument();
  });

  it('marks each word where it is, across what happened and the chat', () => {
    const text = 'Weather forecast for Berlin';
    const marked = (q: string) => matchedRanges(text, q).map(([s, e]) => text.slice(s, e));
    expect(marked('berlin')).toEqual(['Berlin']);
    expect(marked('berlin notes')).toEqual(['Berlin']);
    expect(marked('zzz')).toEqual([]);
  });
});
