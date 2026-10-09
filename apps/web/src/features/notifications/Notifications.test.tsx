import type { PushStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { DevicesTab } from '../auth/DevicesTab';
import { pushKeys } from './api';
import { NotificationsTab } from './NotificationsTab';
import { PushKeeper } from './PushKeeper';

const KEY = `B${'A'.repeat(86)}`;
const OTHER_KEY = `B${'Q'.repeat(86)}`;
const keyBytes = (k: string) => {
  const b64 = k.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};

/** A browser that can do push, as far as the page can tell. */
function pushableBrowser(
  options: {
    permission?: NotificationPermission;
    subscribedWith?: string;
    /** Its push service won't register anyone, in Chromium's own words. */
    refuses?: boolean;
    brave?: boolean;
  } = {},
) {
  let permission: NotificationPermission = options.permission ?? 'default';
  let subscription: {
    options: { applicationServerKey: ArrayBuffer };
    toJSON: () => unknown;
    unsubscribe: () => Promise<boolean>;
  } | null = options.subscribedWith ? make(options.subscribedWith) : null;
  function make(key: string) {
    return {
      options: { applicationServerKey: keyBytes(key).buffer },
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
      }),
      unsubscribe: async () => {
        subscription = null;
        return true;
      },
    };
  }
  const subscribe = vi.fn(
    async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      if (options.refuses)
        throw new DOMException('Registration failed - push service error', 'AbortError');
      subscription = make(
        btoa(String.fromCharCode(...applicationServerKey))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, ''),
      );
      return subscription;
    },
  );
  const registration = { pushManager: { getSubscription: async () => subscription, subscribe } };
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission: vi.fn(async () => (permission = 'granted')),
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
      register: async () => registration,
    },
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  if (options.brave)
    Object.defineProperty(navigator, 'brave', {
      configurable: true,
      value: { isBrave: async () => true },
    });
  return { subscribe };
}

const status = (patch: Partial<PushStatus> = {}): PushStatus => ({
  publicKey: KEY,
  devices: [],
  ...patch,
});
const device = (patch: Partial<PushStatus['devices'][number]> = {}) => ({
  id: 'ps_1',
  name: 'Chrome on Mac',
  current: true,
  createdAt: 1,
  prefs: {
    approvals: true,
    replies: true,
    routines: true,
    tasks: true,
    updates: false,
    devices: true,
    previews: true,
  },
  ...patch,
});

/** Every state the named switch was seen in, from the first render on. */
function watchSwitch(container: HTMLElement, name: string) {
  const states: string[] = [];
  const look = () => {
    const sw = within(container).queryByRole('switch', { name });
    const state = sw?.getAttribute('aria-checked');
    if (state && states.at(-1) !== state) states.push(state);
  };
  look();
  const observer = new MutationObserver(look);
  observer.observe(container, { subtree: true, childList: true, attributes: true });
  return {
    states,
    stop: () => {
      look();
      observer.disconnect();
    },
  };
}

let userAgent: PropertyDescriptor | undefined;
beforeEach(() => {
  userAgent = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'userAgent');
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'brave');
  if (userAgent)
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: userAgent.get });
});

describe('Settings → Notifications', () => {
  it('turns them on for this device: permission, subscribe with Conch’s key, tell Conch', async () => {
    const user = userEvent.setup();
    const browser = pushableBrowser();
    const calls = mockFetch({
      'GET /api/push': () => status(),
      'POST /api/push/subscriptions': () => status({ devices: [device()] }),
      'PATCH /api/push/subscriptions/ps_1': () =>
        status({ devices: [device({ prefs: { ...device().prefs, replies: false } })] }),
    });
    const { where } = renderApp(<NotificationsTab />, { route: '/settings/notifications' });
    await user.click(await screen.findByRole('switch', { name: 'Allow notifications' }));
    await waitFor(() => expect(browser.subscribe).toHaveBeenCalled());
    expect(browser.subscribe.mock.calls[0]?.[0]).toMatchObject({ userVisibleOnly: true });
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/push/subscriptions')?.body).toMatchObject({
        subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Allow notifications' })).toBeChecked(),
    );

    // What it's told about is a page of its own, one row away, one switch each.
    const row = await screen.findByRole('button', { name: /Topics/ });
    expect(row).toHaveTextContent('5 of 6');
    await user.click(row);
    expect(where()).toBe('/settings/notifications/topics');
    const told = await screen.findByRole('group', { name: 'Tell me when' });
    await user.click(within(told).getByRole('switch', { name: 'An answer is ready' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ prefs: { replies: false } }),
    );
  });

  it('opens as it was saved: on, with its choices, never off and then on', async () => {
    pushableBrowser({ permission: 'granted', subscribedWith: KEY });
    const saved = device({ prefs: { ...device().prefs, replies: false, previews: false } });
    mockFetch({ 'GET /api/push': () => status({ devices: [saved] }) });
    const { container } = renderApp(<NotificationsTab />, { route: '/settings/notifications' });
    const seen = watchSwitch(container, 'Allow notifications');
    const master = await screen.findByRole('switch', { name: 'Allow notifications' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Topics/ })).toBeVisible());
    seen.stop();
    // The first switch anyone saw was already on, and nothing moved it there.
    expect(seen.states).toEqual(['true']);
    expect(master).not.toHaveAttribute('data-moving');
    expect(screen.getByRole('button', { name: /Topics/ })).toHaveTextContent('4 of 6');
    expect(screen.getByRole('switch', { name: 'Show what it’s about' })).not.toBeChecked();
    for (const sw of screen.getAllByRole('switch')) expect(sw).not.toHaveAttribute('data-moving');
  });

  it('opened at Topics by its address, the switches are there as they were saved', async () => {
    pushableBrowser({ permission: 'granted', subscribedWith: KEY });
    const saved = device({ prefs: { ...device().prefs, replies: false } });
    mockFetch({ 'GET /api/push': () => status({ devices: [saved] }) });
    renderApp(<NotificationsTab />, { route: '/settings/notifications/topics' });
    const told = await screen.findByRole('group', { name: 'Tell me when' });
    expect(within(told).getAllByRole('switch')).toHaveLength(6);
    expect(within(told).getByRole('switch', { name: 'It needs you' })).toBeChecked();
    expect(within(told).getByRole('switch', { name: 'An answer is ready' })).not.toBeChecked();
    // The page itself; the switch for this device is a step back.
    expect(screen.queryByRole('switch', { name: 'Allow notifications' })).toBeNull();
  });

  it('opens as it was saved: off, with nothing beneath it', async () => {
    pushableBrowser({ permission: 'default' });
    mockFetch({ 'GET /api/push': () => status() });
    const { container } = renderApp(<NotificationsTab />);
    const seen = watchSwitch(container, 'Allow notifications');
    expect(await screen.findByRole('switch', { name: 'Allow notifications' })).not.toBeChecked();
    seen.stop();
    expect(seen.states).toEqual(['false']);
    expect(screen.queryByRole('group', { name: 'Tell me when' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send a test' })).toBeNull();
  });

  it('opens straight away when the keeper already asked, on load', async () => {
    pushableBrowser({ permission: 'granted', subscribedWith: KEY });
    const calls = mockFetch({ 'GET /api/push': () => status({ devices: [device()] }) });
    /** Settings → Notifications, opened once the keeper has looked. */
    function Later() {
      const client = useQueryClient();
      const [open, setOpen] = useState(false);
      useEffect(
        () =>
          client
            .getQueryCache()
            .subscribe(() => setOpen(client.getQueryData(pushKeys.here(KEY)) !== undefined)),
        [client],
      );
      return open ? <NotificationsTab /> : null;
    }
    renderApp(
      <>
        <PushKeeper />
        <Later />
      </>,
    );
    // Its first frame has the switch, on: no placeholder, nothing asked again.
    expect(await screen.findByRole('switch', { name: 'Allow notifications' })).toBeChecked();
    expect(calls.filter((c) => c.path === '/api/push')).toHaveLength(1);
  });

  it('on an iPhone in Safari, says to add Conch to the Home Screen first', async () => {
    pushableBrowser();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () =>
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    });
    mockFetch({ 'GET /api/push': () => status() });
    renderApp(<NotificationsTab />);
    expect(
      await screen.findByRole('region', { name: 'Add Conch to your Home Screen' }),
    ).toBeVisible();
    expect(screen.getByRole('list', { name: 'Add Conch to your Home Screen' })).toBeVisible();
    expect(screen.queryByRole('switch', { name: 'Allow notifications' })).toBeNull();
  });

  it('says where to undo it when the browser was told no', async () => {
    pushableBrowser({ permission: 'denied' });
    mockFetch({ 'GET /api/push': () => status() });
    renderApp(<NotificationsTab />);
    expect(
      await screen.findByRole('region', { name: 'Notifications are blocked' }),
    ).toHaveTextContent(/browser’s settings/);
  });

  it('in Brave, whose push messaging starts switched off, names the setting to turn on', async () => {
    const user = userEvent.setup();
    const browser = pushableBrowser({ brave: true, refuses: true });
    const calls = mockFetch({ 'GET /api/push': () => status() });
    renderApp(<NotificationsTab />);
    await user.click(await screen.findByRole('switch', { name: 'Allow notifications' }));
    await waitFor(() => expect(browser.subscribe).toHaveBeenCalled());
    // It stays on the card, to read while Brave's settings are open.
    const card = screen.getByRole('region', { name: 'Allow notifications' });
    await waitFor(() =>
      expect(card).toHaveTextContent(/Brave’s settings.*“Use Google services for push messaging”/),
    );
    // Never the browser's own words, and Conch isn't told about a device that can't be reached.
    expect(screen.queryByText(/Registration failed/)).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(screen.getByRole('switch', { name: 'Allow notifications' })).not.toBeChecked();
  });

  it('says so in plain words when another browser’s push service won’t answer', async () => {
    const user = userEvent.setup();
    const browser = pushableBrowser({ refuses: true });
    mockFetch({ 'GET /api/push': () => status() });
    renderApp(<NotificationsTab />);
    await user.click(await screen.findByRole('switch', { name: 'Allow notifications' }));
    await waitFor(() => expect(browser.subscribe).toHaveBeenCalled());
    const card = screen.getByRole('region', { name: 'Allow notifications' });
    await waitFor(() => expect(card).toHaveTextContent(/couldn’t reach its notification service/));
    expect(card).not.toHaveTextContent(/Brave/);
    expect(screen.queryByText(/Registration failed/)).toBeNull();
  });

  it('says how many other devices get them, and leaves them to Settings → Access', async () => {
    const user = userEvent.setup();
    pushableBrowser();
    const others = status({
      devices: [
        device({
          id: 'ps_2',
          name: 'Safari on iPhone',
          current: false,
          problem: 'It didn’t arrive.',
        }),
      ],
    });
    mockFetch({ 'GET /api/push': () => others });
    const real = useUi.getState().openSettings;
    const openSettings = vi.fn();
    useUi.setState({ openSettings });
    try {
      renderApp(<NotificationsTab />);
      expect(await screen.findByText('1 other device gets them too.')).toBeVisible();
      // No list of devices here any more: one place for them.
      expect(screen.queryByRole('list', { name: 'Devices that get notifications' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Your devices' }));
      expect(openSettings).toHaveBeenCalledWith('access', 'devices');
    } finally {
      useUi.setState({ openSettings: real });
    }
  });

  it('in Settings → Devices, stops one a sign-in doesn’t cover, and says when one didn’t arrive', async () => {
    const user = userEvent.setup();
    pushableBrowser();
    const calls = mockFetch({
      'GET /api/access': () => ({
        method: 'none',
        username: undefined,
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
      }),
      'GET /api/push': () =>
        status({
          devices: [
            device({
              id: 'ps_2',
              name: 'Safari on iPhone',
              current: false,
              problem: 'It didn’t arrive.',
            }),
          ],
        }),
      'DELETE /api/push/subscriptions/ps_2': () => status(),
    });
    renderApp(<DevicesTab />);
    expect(await screen.findByText('It didn’t arrive.')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Stop notifications on Safari on iPhone' }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('keeping notifications working', () => {
  it('subscribes again, quietly, when Conch has a new key (a restored backup)', async () => {
    const browser = pushableBrowser({ permission: 'granted', subscribedWith: OTHER_KEY });
    const calls = mockFetch({
      'GET /api/push': () => status({ devices: [] }),
      'POST /api/push/subscriptions': () => status({ devices: [device()] }),
    });
    renderApp(<PushKeeper />);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/push/subscriptions')).toBe(true));
    expect(browser.subscribe).toHaveBeenCalledOnce();
  });

  it('never asks for permission by itself', async () => {
    const browser = pushableBrowser({ permission: 'default' });
    const calls = mockFetch({ 'GET /api/push': () => status() });
    renderApp(<PushKeeper />);
    await new Promise((r) => setTimeout(r, 30));
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
