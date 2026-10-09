import type { BackgroundStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { HealthTab } from '../health/HealthTab';
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

  it('is a page of its own inside Health, one row away, and ⌘K opens it on its switch', async () => {
    const user = userEvent.setup();
    mockFetch({ 'GET /api/background': () => status({ on: true }) });
    const { where } = renderApp(<HealthTab />, { route: '/settings/health' });
    const row = await screen.findByRole('button', { name: /Always on/ });
    await waitFor(() => expect(row).toHaveTextContent('On'));
    // The menu bar, logging out and quitting are on its page, not here.
    expect(screen.queryByRole('button', { name: 'Quit Conch' })).toBeNull();
    await user.click(row);
    expect(where()).toBe('/settings/health/always-on');
    expect(await screen.findByRole('button', { name: 'Quit Conch' })).toBeVisible();

    useUi.getState().openSettings('health');
    await waitFor(() => expect(where()).toBe('/settings/health'));
    useUi.getState().openSettings('health', 'background');
    await waitFor(() => expect(where()).toBe('/settings/health/always-on'));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Start Conch when I log in/ })).toHaveFocus(),
    );
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

describe('how it runs (ADR 0029)', () => {
  it('turns the menu bar off, and keeps a Mac awake', async () => {
    const user = userEvent.setup();
    const tray = { available: true, on: true, running: true, where: 'menu bar' };
    const calls = mockFetch({
      'GET /api/background': () =>
        status({ on: true, running: 'background', tray, keepAwake: { on: false, active: false } }),
      'PUT /api/background/tray': () =>
        status({
          on: true,
          running: 'background',
          tray: { ...tray, on: false, running: false },
          keepAwake: { on: false, active: false },
        }),
      'PUT /api/background/keep-awake': () =>
        status({ on: true, running: 'background', keepAwake: { on: true, active: true } }),
    });
    renderApp(<AlwaysOnSection />);
    await user.click(await screen.findByRole('switch', { name: /Show Conch in the menu bar/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/background/tray')?.body).toEqual({ on: false }),
    );
    await user.click(await screen.findByRole('switch', { name: /Keep this Mac awake/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/background/keep-awake')?.body).toEqual({
        on: true,
      }),
    );
  });

  it('on Linux, says the one command when logging out needs an administrator', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/background': () =>
        status({ on: true, running: 'background', afterLogout: { state: 'off' } }),
      'PUT /api/background/after-logout': () =>
        status({
          on: true,
          running: 'background',
          afterLogout: {
            state: 'off',
            command: 'sudo loginctl enable-linger ada',
            note: 'This computer asks for an administrator to change that.',
          },
        }),
    });
    renderApp(<AlwaysOnSection />);
    await user.click(await screen.findByRole('switch', { name: /Keep running after you log out/ }));
    expect(await screen.findByText('sudo loginctl enable-linger ada')).toBeVisible();
  });

  it('asks you to confirm it’s you before it keeps running with nobody logged in', async () => {
    const user = userEvent.setup();
    let verified = false;
    const calls = mockFetch({
      'GET /api/auth': () => ({
        method: 'password',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/background': () =>
        status({ on: true, running: 'background', afterLogout: { state: 'off' } }),
      'PUT /api/background/after-logout': () =>
        verified
          ? status({ on: true, running: 'background', afterLogout: { state: 'on' } })
          : new Response(
              JSON.stringify({
                error: 'verify-required',
                message: 'Confirm it’s you to keep Conch running after you log out.',
              }),
              { status: 403 },
            ),
      'POST /api/access/verify': () => {
        verified = true;
        return {
          method: 'password',
          username: 'ada',
          suggestedUsername: 'ada',
          keys: [],
          passkeys: [],
          passkeysHere: false,
          sessions: [],
          devices: [],
          requests: [],
          approval: { on: false, here: true, canApprove: true },
          checkup: [],
          exposure: 'local',
          port: 4317,
          urls: [],
          verified: true,
        };
      },
    });
    renderApp(<AlwaysOnSection />);
    await user.click(await screen.findByRole('switch', { name: /Keep running after you log out/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(confirm).getByLabelText('Password'), 'purple otters juggle at dawn');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Keep running after you log out/ })).toBeChecked(),
    );
    expect(calls.filter((c) => c.path === '/api/background/after-logout')).toHaveLength(2);
  });

  it('on a Mac, says how to stay logged in instead', async () => {
    mockFetch({
      'GET /api/background': () =>
        status({
          on: true,
          running: 'background',
          afterLogout: { state: 'unavailable', note: 'A Mac stops what you run when you log out.' },
        }),
    });
    renderApp(<AlwaysOnSection />);
    expect(await screen.findByText('A Mac stops what you run when you log out.')).toBeVisible();
    expect(screen.queryByRole('switch', { name: /after you log out/ })).toBeNull();
  });
});
