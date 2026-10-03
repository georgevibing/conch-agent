import type { AccessSettings, AuthStatus, DeviceInfo, DeviceRequest } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { AuthGate } from './AuthGate';
import { SecurityTab } from './SecurityTab';

/** Approving new devices: what a waiting device sees, and Settings → Security → Devices. */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const status = (patch: Partial<AuthStatus> = {}): AuthStatus => ({
  method: 'password',
  signedIn: false,
  setupRequired: false,
  secure: true,
  ...patch,
});

const waiting = (state: 'waiting' | 'rejected' = 'waiting') =>
  status({
    approval: {
      code: 'K7M-Q2X',
      device: 'Safari on iPhone',
      expiresAt: Date.now() + 9 * 60 * 1000,
      state,
    },
  });

const request = (patch: Partial<DeviceRequest> = {}): DeviceRequest => ({
  code: 'K7M-Q2X',
  deviceId: 'dev_phone',
  device: 'Safari on iPhone',
  kind: 'phone',
  via: 'password',
  address: '100.64.0.7',
  script: false,
  createdAt: Date.now() - 30_000,
  expiresAt: Date.now() + 9 * 60 * 1000,
  rejected: false,
  ...patch,
});

const device = (patch: Partial<DeviceInfo> = {}): DeviceInfo => ({
  id: 'dev_mac',
  name: 'Chrome on Mac',
  kind: 'desktop',
  firstSeenAt: Date.now() - 86_400_000,
  lastSeenAt: Date.now(),
  approved: true,
  approvedHow: 'this-computer',
  signedIn: true,
  via: 'password',
  script: false,
  current: true,
  ...patch,
});

const settings = (patch: Partial<AccessSettings> = {}): AccessSettings => ({
  method: 'password',
  username: 'ada',
  suggestedUsername: 'ada',
  keys: [],
  passkeys: [],
  passkeysHere: false,
  sessions: [],
  devices: [device()],
  requests: [],
  approval: { on: false, here: true, canApprove: true },
  checkup: [],
  exposure: 'local',
  port: 4317,
  urls: [],
  verified: true,
  ...patch,
});

describe('a device waiting for approval', () => {
  it('shows its code and the command, then opens once it’s approved', async () => {
    let approved = false;
    mockFetch({ 'GET /api/auth': () => (approved ? status({ signedIn: true }) : waiting()) });
    renderApp(
      <AuthGate>
        <p>The app</p>
      </AuthGate>,
    );
    expect(await screen.findByRole('heading', { name: 'Approve this device' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Approval code K 7 M/ })).toBeInTheDocument();
    expect(screen.getByText('conch devices approve K7M-Q2X')).toBeInTheDocument();
    expect(screen.queryByText('The app')).toBeNull();

    // Approved in the terminal: the next check lets it in, with a moment to say so.
    approved = true;
    expect(
      await screen.findByRole('heading', { name: 'Approved' }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('The app', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('says when it was turned down, and goes back to signing in', async () => {
    const user = userEvent.setup();
    let signedOut = false;
    const calls = mockFetch({
      'GET /api/auth': () => (signedOut ? status() : waiting('rejected')),
      'POST /api/auth/sign-out': () => {
        signedOut = true;
        return { ok: true };
      },
    });
    renderApp(
      <AuthGate>
        <p>The app</p>
      </AuthGate>,
    );
    expect(
      await screen.findByRole('heading', { name: 'This device wasn’t approved' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/auth/sign-out')).toBe(true);
    // Leaving on purpose isn't something to explain.
    expect(screen.queryByText(/Nobody approved/)).toBeNull();
  });

  it('explains on the sign-in screen when nobody approved it in time', async () => {
    let expired = false;
    mockFetch({ 'GET /api/auth': () => (expired ? status() : waiting()) });
    renderApp(
      <AuthGate>
        <p>The app</p>
      </AuthGate>,
    );
    await screen.findByRole('heading', { name: 'Approve this device' });
    expired = true;
    expect(
      await screen.findByText(/Nobody approved this device in time/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
});

describe('Settings → Security → Devices', () => {
  it('turns approval on, after confirming it’s you', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/access': () => settings(),
      'GET /api/auth': () => status({ signedIn: true }),
      'PUT /api/access/approval': () =>
        settings({ approval: { on: true, here: true, canApprove: true } }),
    });
    renderApp(<SecurityTab />);
    const toggle = await screen.findByRole('switch', { name: 'Approve new devices' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/access/approval')?.body).toEqual({ on: true }),
    );
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('asks before turning it off, and elsewhere says where to do it', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/access': () => settings({ approval: { on: true, here: true, canApprove: true } }),
      'GET /api/auth': () => status({ signedIn: true }),
      'PUT /api/access/approval': () => settings(),
    });
    const { unmount } = renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('switch', { name: 'Approve new devices' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop approving new devices?' });
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/access/approval')?.body).toEqual({ on: false }),
    );
    unmount();

    mockFetch({
      'GET /api/access': () => settings({ approval: { on: true, here: false, canApprove: false } }),
      'GET /api/auth': () => status({ signedIn: true }),
    });
    renderApp(<SecurityTab />);
    expect(await screen.findByRole('switch', { name: 'Approve new devices' })).toBeDisabled();
    expect(screen.getByText('conch devices off')).toBeInTheDocument();
  });

  it('approves a waiting device on this computer', async () => {
    const user = userEvent.setup();
    let approved = false;
    const calls = mockFetch({
      'GET /api/access': () =>
        settings({
          approval: { on: true, here: true, canApprove: true },
          requests: approved ? [] : [request()],
          devices: approved
            ? [
                device(),
                device({
                  id: 'dev_phone',
                  name: 'Safari on iPhone',
                  kind: 'phone',
                  current: false,
                  approvedHow: 'settings',
                }),
              ]
            : [device()],
        }),
      'GET /api/auth': () => status({ signedIn: true }),
      'POST /api/access/requests/K7M-Q2X/approve': () => {
        approved = true;
        return settings({
          approval: { on: true, here: true, canApprove: true },
          devices: [
            device(),
            device({
              id: 'dev_phone',
              name: 'Safari on iPhone',
              kind: 'phone',
              current: false,
              approvedHow: 'settings',
            }),
          ],
        });
      },
    });
    renderApp(<SecurityTab />);
    const waitingList = await screen.findByRole('list', { name: 'Waiting for your approval' });
    expect(
      within(waitingList).getByText(/From 100.64.0.7 · with your password/),
    ).toBeInTheDocument();
    await user.click(
      within(waitingList).getByRole('button', { name: 'Approve Safari on iPhone (K7M-Q2X)' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/access/requests/K7M-Q2X/approve')).toBe(true),
    );
    const devices = await screen.findByRole('list', { name: 'Devices' });
    expect(await within(devices).findByText('Safari on iPhone')).toBeInTheDocument();
    expect(within(devices).getByText(/approved in Settings/)).toBeInTheDocument();
  });

  it('elsewhere, can turn a device down but shows the command to approve it', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/access': () =>
        settings({ approval: { on: true, here: false, canApprove: false }, requests: [request()] }),
      'GET /api/auth': () => status({ signedIn: true }),
      'DELETE /api/access/requests/K7M-Q2X': () =>
        settings({
          approval: { on: true, here: false, canApprove: false },
          requests: [request({ rejected: true })],
        }),
    });
    renderApp(<SecurityTab />);
    const list = await screen.findByRole('list', { name: 'Waiting for your approval' });
    expect(within(list).queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(within(list).getByText('conch devices approve K7M-Q2X')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Turn down Safari on iPhone/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === '/api/access/requests/K7M-Q2X'),
      ).toBe(true),
    );
    expect(await within(list).findByText('Turned down')).toBeInTheDocument();
  });

  it('removes a device after asking, and signs one out without forgetting it', async () => {
    const user = userEvent.setup();
    const phone = device({
      id: 'dev_phone',
      name: 'Safari on iPhone',
      kind: 'phone',
      current: false,
      approvedHow: 'terminal',
    });
    const calls = mockFetch({
      'GET /api/access': () =>
        settings({
          approval: { on: true, here: true, canApprove: true },
          devices: [device(), phone],
        }),
      'GET /api/auth': () => status({ signedIn: true }),
      'POST /api/access/devices/dev_phone/sign-out': () =>
        settings({
          approval: { on: true, here: true, canApprove: true },
          devices: [device(), { ...phone, signedIn: false }],
        }),
      'DELETE /api/access/devices/dev_phone': () =>
        settings({ approval: { on: true, here: true, canApprove: true }, devices: [device()] }),
    });
    renderApp(<SecurityTab />);
    const list = await screen.findByRole('list', { name: 'Devices' });
    await user.click(within(list).getByRole('button', { name: 'Sign out Safari on iPhone' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/access/devices/dev_phone/sign-out')).toBe(true),
    );
    await user.click(within(list).getByRole('button', { name: 'Remove Safari on iPhone' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove Safari on iPhone?' });
    expect(dialog).toHaveTextContent('need your approval to sign in again');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === '/api/access/devices/dev_phone'),
      ).toBe(true),
    );
    await waitFor(() => expect(within(list).queryByText('Safari on iPhone')).toBeNull());
  });
});
