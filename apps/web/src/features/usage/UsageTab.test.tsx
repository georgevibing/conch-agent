import type { LearningStatus, RoutineSpending, UsageSnapshot } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, provider, providersList, renderApp } from '../../test/harness';
import { UsageTab } from './UsageTab';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ settingsFocus: undefined });
});

const usage = (): UsageSnapshot => ({
  engine: 'claude-code',
  kind: 'plan',
  source: 'Claude Max',
  windows: [
    {
      id: 'session',
      label: 'Current session',
      usedPercent: 38,
      resetsAt: Date.now() + 3_600_000,
      severity: 'normal',
    },
  ],
  spend: { today: 0, month: 0 },
  updatedAt: Date.now(),
});

const spending: RoutineSpending = { limitUsd: 20, isDefault: true, monthUsd: 3.2 };

const learning: LearningStatus = {
  on: true,
  entries: [],
  waiting: 0,
  never: [],
  past: [],
  spending: { limitUsd: 1, isDefault: true, monthUsd: 0 },
  quiet: [],
};

/** Every answer the page waits for; the provider's numbers held back until `release`. */
function routes() {
  const calls = mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/providers': () => providersList({ providers: [provider()] }),
    'GET /api/usage': () => usage(),
    'GET /api/routines/spending': () => spending,
    'GET /api/learning': () => learning,
  });
  const answer = globalThis.fetch;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    if (String(input).includes('/api/usage')) await held;
    return answer(input, init);
  });
  return { calls, release };
}

describe('Settings → Usage', () => {
  it('keeps the room of what comes, then shows it all at once: nothing pops in', async () => {
    const { release } = routes();
    const { container } = renderApp(<UsageTab />, { route: '/settings/usage' });
    expect(screen.getByRole('heading', { name: 'What’s left' })).toBeInTheDocument();
    // The limits have answered; the provider's numbers haven't yet.
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByRole('heading', { name: 'Monthly budget' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Limits/ })).toBeNull();
    expect(screen.queryByText('Claude Code')).toBeNull();

    act(() => release());
    // Everything arrives in the same moment.
    expect(await screen.findByRole('heading', { name: 'Monthly budget' })).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Limits/ })).toHaveTextContent('2 on');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('opens Limits as a page of its own, with all three there together', async () => {
    const user = userEvent.setup();
    const { release } = routes();
    release();
    const { where } = renderApp(<UsageTab />, { route: '/settings/usage' });
    await user.click(await screen.findByRole('button', { name: /Limits/ }));
    expect(where()).toBe('/settings/usage/limits');
    expect(await screen.findByRole('heading', { name: 'Long turns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learning from your chats' })).toBeInTheDocument();
    // What's left and the budget are a step back.
    expect(screen.queryByRole('heading', { name: 'Monthly budget' })).toBeNull();
  });

  it('says the token limit in plain words', async () => {
    const user = userEvent.setup();
    routes().release();
    renderApp(<UsageTab />, { route: '/settings/usage/limits' });
    await user.click(await screen.findByRole('switch', { name: /Pause long turns/ }));
    expect(screen.getByLabelText('Tokens used, in millions')).toHaveValue('2');
  });

  it('takes what routines may spend, from elsewhere, to its page inside Usage', async () => {
    routes().release();
    const { where } = renderApp(<UsageTab />, { route: '/settings/usage' });
    act(() => useUi.getState().openSettings('usage', 'routines'));
    await waitFor(() => expect(where()).toBe('/settings/usage/limits'));
    expect(await screen.findByRole('heading', { name: 'Routines' })).toBeInTheDocument();
  });
});
