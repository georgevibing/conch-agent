import type { UsageSnapshot } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { UsageComposerNotice } from './UsageComposerNotice';
import { UsageIndicator } from './UsageIndicator';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ usageOpen: false });
});

const HOUR = 3_600_000;

function plan(sessionUsed: number): UsageSnapshot {
  const now = Date.now();
  return {
    kind: 'plan',
    source: 'Claude Max',
    windows: [
      {
        id: 'session',
        label: 'Current session',
        usedPercent: sessionUsed,
        resetsAt: now + 2 * HOUR,
        severity: sessionUsed >= 90 ? 'critical' : sessionUsed >= 75 ? 'warning' : 'normal',
      },
      {
        id: 'weekly',
        label: 'This week',
        scope: 'all models',
        usedPercent: 20,
        resetsAt: now + 72 * HOUR,
        severity: 'normal',
      },
    ],
    spend: { today: 0, month: 0 },
    updatedAt: now,
  };
}

function Both() {
  return (
    <>
      <UsageIndicator />
      <UsageComposerNotice />
    </>
  );
}

describe('usage', () => {
  it('shows what is left, updates live, and warns above the composer', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/usage': () => plan(38) });
    renderApp(<Both />);
    const meter = await screen.findByRole('button', { name: /usage/i });
    expect(meter).toHaveTextContent('62% left');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => FakeSocket.last?.push({ type: 'usage.changed', usage: plan(88) }));
    await waitFor(() => expect(meter).toHaveTextContent('12% left'));
    expect(await screen.findByRole('status')).toHaveTextContent(/12% of your current session left/);
  });

  it('opens the full panel from the meter and from /usage', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/usage': () => plan(38) });
    renderApp(<UsageIndicator />);
    await userEvent.click(await screen.findByRole('button', { name: /usage/i }));
    const panel = await screen.findByRole('dialog', { name: 'Usage' });
    expect(panel).toHaveTextContent('Claude Max');
    expect(panel).toHaveTextContent(/This week/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => useUi.getState().setUsageOpen(true));
    expect(await screen.findByRole('dialog', { name: 'Usage' })).toBeInTheDocument();
  });

  it('shows spend for pay-as-you-go sign-ins', async () => {
    mockFetch({
      'GET /api/state': () =>
        appState({
          engine: {
            ...appState().engine,
            auth: { method: 'bedrock', description: 'Amazon Bedrock' },
          },
        }),
      'GET /api/usage': (): UsageSnapshot => ({
        kind: 'metered',
        source: 'Amazon Bedrock',
        windows: [],
        spend: { today: 4.2, month: 38.1 },
        updatedAt: Date.now(),
      }),
    });
    renderApp(<UsageIndicator />);
    expect(await screen.findByRole('button', { name: /usage/i })).toHaveTextContent('$4.20 today');
  });

  it('stays out of the way until the engine is ready', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState({ engine: { ...appState().engine, state: 'signed-out' } }),
      'GET /api/usage': () => plan(38),
    });
    renderApp(<UsageIndicator />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/state')).toBe(true));
    expect(screen.queryByRole('button', { name: /usage/i })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/api/usage'))).toBe(false);
  });
});
