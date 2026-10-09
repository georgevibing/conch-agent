import type { ComputerUseStatus } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { ComputerUseNowCard } from './ComputerUseNow';
import { ComputerUseSection } from './ComputerUseSection';

afterEach(() => vi.unstubAllGlobals());

function status(patch: Partial<ComputerUseStatus> = {}): ComputerUseStatus {
  return {
    platform: 'mac',
    enabled: false,
    access: { screen: 'missing', control: 'missing' },
    grantTo: 'Conch',
    overlay: 'app',
    stopKeys: '⌘⎋',
    apps: [],
    keptAway: ['Conch itself', 'Password managers'],
    here: true,
    ...patch,
  };
}

describe('Settings → This computer → Use your apps', () => {
  it('is off, and turning it on shows the two macOS switches', async () => {
    let now = status();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer-use': () => now,
      'PATCH /api/computer-use': (body) => {
        now = status({ enabled: (body as { enabled: boolean }).enabled });
        return now;
      },
      'POST /api/computer-use/access': () => now,
    });
    renderApp(<ComputerUseSection />);
    const toggle = await screen.findByRole('switch', { name: /use your apps/i });
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText(/Always kept away: Conch itself\s·\sPassword managers/),
    ).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(
      await screen.findByRole('button', { name: 'Open Screen Recording' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Accessibility' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/computer-use/access',
        body: { kind: 'control' },
      }),
    );
  });

  it('says the switch is on by itself once macOS turns it on', async () => {
    let now = status({ enabled: true });
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/computer-use': () => now });
    renderApp(<ComputerUseSection />);
    expect(await screen.findByText('Turn on Conch in Accessibility.')).toBeInTheDocument();
    now = status({ enabled: true, access: { screen: 'granted', control: 'granted' } });
    expect(
      await screen.findByText('Accessibility is on for Conch.', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('lists the apps you always allow, to take back', async () => {
    let now = status({ enabled: true, apps: [{ id: 'com.apple.Notes', name: 'Notes' }] });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer-use': () => now,
      'DELETE /api/computer-use/apps/com.apple.Notes': () => {
        now = status({ enabled: true });
        return now;
      },
    });
    renderApp(<ComputerUseSection />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Stop always allowing Notes' }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('says plainly where it works', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer-use': () => status({ platform: 'unsupported' }),
    });
    renderApp(<ComputerUseSection />);
    expect(await screen.findByText(/On a Mac for now/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('the live card in the chat', () => {
  it('shows what it’s doing on the computer while the turn runs, and Stop stops it', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer-use/live': () => ({
        active: {
          conversationId: 'c1',
          label: 'Typing in Notes',
          steps: 3,
          maxSteps: 60,
          since: 1,
        },
        stopKeys: '⌘⎋',
      }),
      'POST /api/computer-use/stop': () => ({ stopped: true }),
    });
    renderApp(<ComputerUseNowCard conversationId="c1" running />);
    expect(await screen.findByText('Typing in Notes')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/computer-use/stop')).toBe(
        true,
      ),
    );
  });

  it('stays away for another chat, and asks nothing when no turn runs', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/computer-use/live': () => ({
        active: { conversationId: 'other', label: 'Typing', steps: 1, maxSteps: 60, since: 1 },
      }),
    });
    const { unmount } = renderApp(<ComputerUseNowCard conversationId="c1" running />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/computer-use/live')).toBe(true));
    expect(screen.queryByText('Typing')).toBeNull();
    unmount();
    calls.length = 0;
    renderApp(<ComputerUseNowCard conversationId="c1" running={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.path === '/api/computer-use/live')).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
