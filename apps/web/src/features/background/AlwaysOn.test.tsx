import type { BackgroundStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { AlwaysOnHint } from './AlwaysOnHint';
import { AlwaysOnSection, sinceText } from './AlwaysOnSection';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ restarting: undefined, settingsFocus: undefined });
});

function status(patch: Partial<BackgroundStatus> = {}): BackgroundStatus {
  return {
    supported: true,
    kind: 'launchd',
    on: false,
    running: 'window',
    since: Date.now() - 60_000,
    place: 'System Settings → General → Login Items',
    ...patch,
  };
}

const health = {
  ok: true,
  serverVersion: '0.1.0',
  protocolVersion: 7,
  bootId: 'boot-1',
  restartable: true,
};

describe('Always on', () => {
  it('moves Conch to the background, and the page rests until it’s back', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/background': () =>
        status({ needed: 'Your routine only runs while Conch is running.' }),
      'GET /api/health': () => health,
      'PUT /api/background': () => ({
        status: status({ on: true }),
        handover: true,
      }),
    });
    renderApp(<AlwaysOnSection />);
    expect(await screen.findByText('Your routine only runs while Conch is running.')).toBeVisible();
    await user.click(screen.getByRole('switch', { name: /Start Conch when I log in/ }));
    await waitFor(() =>
      expect(useUi.getState().restarting).toMatchObject({
        title: 'Moving Conch to the background…',
        from: 'boot-1',
        reopen: 'health',
      }),
    );
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ on: true });
  });

  it('shows why when the background Conch didn’t start, and this one keeps going', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/background': () => status(),
      'GET /api/health': () => health,
      'PUT /api/background': () => ({
        status: status({
          on: true,
          problem: {
            message: 'Couldn’t start in the background just now.',
            command: 'tail -n 40 x',
          },
        }),
        handover: false,
      }),
    });
    renderApp(<AlwaysOnSection />);
    await user.click(await screen.findByRole('switch'));
    expect(await screen.findByText('Couldn’t start in the background just now.')).toBeVisible();
    expect(screen.getByText('tail -n 40 x')).toBeVisible();
    expect(useUi.getState().restarting).toBeUndefined();
  });

  it('asks before quitting, then rests on “Conch has stopped”', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/background': () => status({ on: true, running: 'background' }),
      'GET /api/health': () => health,
      'POST /api/gateway/quit': () => ({ ok: true }),
    });
    renderApp(<AlwaysOnSection />);
    await user.click(await screen.findByRole('button', { name: 'Quit Conch' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Quit Conch?' });
    expect(dialog).toHaveTextContent('starts again by itself when you log in');
    await user.click(within(dialog).getByRole('button', { name: 'Keep running' }));
    expect(calls.some((c) => c.path === '/api/gateway/quit')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Quit Conch' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Quit Conch' }),
    );
    await waitFor(() =>
      expect(useUi.getState().restarting).toMatchObject({
        title: 'Conch has stopped',
        stopped: true,
      }),
    );
  });

  it('says why it can’t be turned on here, with no switch', async () => {
    mockFetch({
      'GET /api/background': () =>
        status({ supported: false, running: 'dev', unsupported: 'Not on a development server.' }),
    });
    renderApp(<AlwaysOnSection />);
    expect(await screen.findByText('Not on a development server.')).toBeVisible();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quit Conch' })).toBeNull();
  });

  it('opens on its switch from ⌘K and Repair everything', async () => {
    mockFetch({ 'GET /api/background': () => status() });
    useUi.setState({ settingsFocus: 'background' });
    renderApp(<AlwaysOnSection />);
    await waitFor(() => expect(screen.getByRole('switch')).toHaveFocus());
    expect(useUi.getState().settingsFocus).toBeUndefined();
  });

  it('reads when it started like a clock today, and in days before', () => {
    const now = new Date('2026-10-01T15:00:00').getTime();
    expect(sinceText(new Date('2026-10-01T09:14:00').getTime(), now)).toMatch(/9:14/);
    expect(sinceText(now - 3 * 86_400_000, now)).toMatch(/3 days ago/);
  });
});

describe('the hint beside routines and chat apps', () => {
  it('offers to keep Conch running, in one press', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/background': () => status(),
      'GET /api/health': () => health,
      'PUT /api/background': () => ({ status: status({ on: true }), handover: true }),
    });
    renderApp(<AlwaysOnHint what="This routine runs" />);
    expect(await screen.findByText(/This routine runs only while Conch is running/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep Conch running' }));
    await waitFor(() => expect(useUi.getState().restarting?.title).toMatch(/background/));
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('says nothing when Always on is on, or can’t be', async () => {
    mockFetch({ 'GET /api/background': () => status({ on: true, running: 'background' }) });
    const { unmount } = renderApp(<AlwaysOnHint what="Telegram reaches you" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/reaches you/)).toBeNull();
    unmount();
    mockFetch({ 'GET /api/background': () => status({ supported: false }) });
    renderApp(<AlwaysOnHint what="Telegram reaches you" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/reaches you/)).toBeNull();
  });
});
