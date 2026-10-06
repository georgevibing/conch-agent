import type { AccessSettings, AuthStatus, CheckupItem } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { useUi } from '../../app/ui';
import { DevicesTab } from './DevicesTab';
import { SecurityTab } from './SecurityTab';
import { SignIn } from './SignIn';

afterEach(() => vi.unstubAllGlobals());

const status = (patch: Partial<AuthStatus> = {}): AuthStatus => ({
  method: 'password',
  signedIn: false,
  setupRequired: false,
  secure: true,
  ...patch,
});

const json = (body: unknown, init: number | ResponseInit = 200) =>
  new Response(JSON.stringify(body), typeof init === 'number' ? { status: init } : init);

const settings = (patch: Partial<AccessSettings> = {}): AccessSettings => ({
  method: 'none',
  suggestedUsername: 'ada',
  keys: [],
  passkeys: [],
  passkeysHere: false,
  sessions: [],
  devices: [],
  requests: [],
  approval: { on: false, here: true, canApprove: true },
  checkup: [
    {
      id: 'sign-in',
      level: 'info',
      title: 'No sign-in on this computer',
      detail: 'Only this computer can open Conch.',
    },
  ],
  exposure: 'local',
  port: 4317,
  urls: [],
  verified: true,
  ...patch,
});

describe('SignIn', () => {
  it('signs in with a username and password, never saying which was wrong', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const calls = mockFetch({
      'POST /api/auth/sign-in': () =>
        ++attempts === 1
          ? json({ error: 'invalid', message: 'That didn’t work. Check it and try again.' }, 401)
          : status({ signedIn: true }),
    });
    renderApp(<SignIn status={status()} />);
    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('autocomplete', 'username');
    await user.type(username, 'ada');
    const password = screen.getByLabelText('Password', { selector: 'input' });
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    await user.type(password, 'wrong password here');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That didn’t work');
    // The field is cleared after a failed attempt.
    expect(password).toHaveValue('');
    await user.type(password, 'purple otters juggle at dawn');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/auth/sign-in')).toHaveLength(2),
    );
    expect(calls[1]?.body).toEqual({
      with: 'password',
      username: 'ada',
      password: 'purple otters juggle at dawn',
    });
  });

  it('counts down when rate-limited', async () => {
    const user = userEvent.setup();
    mockFetch({
      'POST /api/auth/sign-in': () =>
        json({ error: 'rate-limited', message: 'Too many tries.', retryAfter: 42 }, 429),
    });
    renderApp(<SignIn status={status()} />);
    await user.type(screen.getByLabelText('Username'), 'ada');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/wait 0:4\d before trying again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('signs in as soon as an access key is pasted', async () => {
    const user = userEvent.setup();
    const key = `conch_${'k'.repeat(43)}`;
    const calls = mockFetch({ 'POST /api/auth/sign-in': () => status({ signedIn: true }) });
    renderApp(<SignIn status={status({ method: 'key' })} />);
    const field = screen.getByLabelText('Access key', { selector: 'input' });
    await user.click(field);
    await user.paste(key);
    await waitFor(() => expect(calls[0]?.body).toEqual({ with: 'key', key }));
  });

  it('warns on an unencrypted connection', () => {
    mockFetch({});
    renderApp(<SignIn status={status({ secure: false })} />);
    expect(screen.getByText('This connection isn’t encrypted')).toBeInTheDocument();
  });

  it('explains the way back in when sign-in is locked, and offers no password box', async () => {
    mockFetch({});
    renderApp(<SignIn status={status({ locked: true })} />);
    expect(screen.getByRole('heading', { name: 'Locked to keep it safe' })).toBeInTheDocument();
    expect(screen.getByText('pnpm conch reset')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password', { selector: 'input' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I’ve done it — try again' })).toBeInTheDocument();
  });

  it('explains what to do when sign-in isn’t set up yet', () => {
    mockFetch({});
    renderApp(<SignIn status={status({ method: 'none', setupRequired: true })} />);
    expect(screen.getByRole('heading', { name: 'Almost there' })).toBeInTheDocument();
    expect(screen.getByText(/Settings → Security/)).toBeInTheDocument();
  });
});

describe('SecurityTab', () => {
  it('sets up a password with a suggested strong one', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/access': () => settings(),
      'PUT /api/access/password': () => settings({ method: 'password', username: 'ada' }),
      'GET /api/auth': () => status({ signedIn: true }),
    });
    renderApp(<SecurityTab />);
    expect(await screen.findByText('No sign-in on this computer')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Choose a password' });
    expect(within(form).getByLabelText('Username')).toHaveValue('ada');
    const submit = within(form).getByRole('button', { name: 'Turn on password sign-in' });
    expect(submit).toBeDisabled();

    const password = within(form).getByLabelText('Password', { selector: 'input' });
    await user.type(password, 'passwordpassword');
    expect(screen.getByRole('meter', { name: 'Password strength' })).toHaveAttribute(
      'aria-valuetext',
      'Too easy to guess',
    );
    expect(submit).toBeDisabled();

    await user.click(within(form).getByRole('button', { name: 'Suggest a strong one' }));
    expect(password).toHaveAttribute('type', 'text');
    expect((password as HTMLInputElement).value).toMatch(/^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/);
    await user.click(submit);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/access/password')?.body).toMatchObject({
        username: 'ada',
      }),
    );
  });

  it('asks you to confirm it’s you, then carries on', async () => {
    const user = userEvent.setup();
    let verified = false;
    const calls = mockFetch({
      'GET /api/access': () => settings({ method: 'password', username: 'ada', verified }),
      'POST /api/access/verify': () => {
        verified = true;
        return settings({ method: 'password', username: 'ada', verified });
      },
      'POST /api/access/pairing': () =>
        verified
          ? { code: 'pair-code', expiresAt: Date.now() + 600_000 }
          : json({ error: 'verify-required', message: 'Confirm it’s you.' }, 403),
    });
    renderApp(<DevicesTab />);
    await user.click(await screen.findByRole('button', { name: 'Add a device' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(
      within(dialog).getByLabelText('Password', { selector: 'input' }),
      'secret words here',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('dialog', { name: 'Add a device' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/access/pairing')).toHaveLength(2);
  });

  it('shows a new access key once', async () => {
    const user = userEvent.setup();
    const key = `conch_${'z'.repeat(43)}`;
    const info = { id: 'key_1', name: 'My devices', hint: 'zzzz', createdAt: Date.now() };
    let created = false;
    const calls = mockFetch({
      'GET /api/access': () => (created ? settings({ method: 'key', keys: [info] }) : settings()),
      'POST /api/access/keys': () => {
        created = true;
        return { key, info };
      },
      'GET /api/auth': () => status({ method: 'key', signedIn: true }),
    });
    renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('radio', { name: /Access key/ }));
    await user.click(screen.getByRole('button', { name: 'Create key & turn on' }));
    expect(await screen.findByText(key)).toBeInTheDocument();
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();
    // Sign-in just switched to keys: the key stays until you say you've saved it.
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/access').length).toBeGreaterThan(1),
    );
    expect(await screen.findByRole('list', { name: 'Access keys' })).toBeInTheDocument();
    expect(screen.getByText(key)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
    expect(screen.queryByText(key)).toBeNull();
  });

  it('turns a risky setting off in one click, then the finding goes away', async () => {
    const user = userEvent.setup();
    const finding: CheckupItem = {
      id: 'browser-local',
      level: 'warn',
      title: 'The browser can open local apps',
      detail: 'If you don’t need it, turn it off.',
      fix: { kind: 'act', label: 'Turn off', action: 'browser-local-off' },
    };
    const calls = mockFetch({
      'GET /api/access': () => settings({ checkup: [finding] }),
      'POST /api/access/fix': () => ({
        done: 'The browser can’t open local apps now.',
        access: settings({ checkup: [] }),
      }),
      'GET /api/state': () => appState(),
    });
    renderApp(
      <>
        <SecurityTab />
        <Toaster />
      </>,
    );
    const button = await screen.findByRole('button', { name: 'Turn off' });
    expect(button).toHaveAccessibleDescription(/The browser can open local apps/);
    await user.click(button);
    expect(await screen.findByText('The browser can’t open local apps now.')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/access/fix')?.body).toEqual({
      action: 'browser-local-off',
    });
    expect(screen.queryByText('The browser can open local apps')).toBeNull();
    expect(screen.getByText('Looking good')).toBeInTheDocument();
  });

  it('confirms it’s you first when that setting needs it', async () => {
    const user = userEvent.setup();
    let verified = false;
    const finding: CheckupItem = {
      id: 'terminal-remote',
      level: 'warn',
      title: 'Other devices can open a terminal',
      detail: 'Turn it off if you don’t use it.',
      fix: { kind: 'act', label: 'Turn off', action: 'terminal-remote-off' },
    };
    const calls = mockFetch({
      'GET /api/access': () =>
        settings({ method: 'password', username: 'ada', checkup: [finding], verified }),
      'POST /api/access/verify': () => {
        verified = true;
        return settings({ method: 'password', username: 'ada', checkup: [finding], verified });
      },
      'POST /api/access/fix': () =>
        verified
          ? {
              done: 'Other devices can’t open a terminal now.',
              access: settings({ method: 'password', username: 'ada', checkup: [], verified }),
            }
          : json({ error: 'verify-required', message: 'Confirm it’s you.' }, 403),
      'GET /api/state': () => appState(),
    });
    renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(dialog).getByLabelText('Password', { selector: 'input' }), 'my words');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Other devices can open a terminal')).toBeNull());
    expect(calls.filter((c) => c.path === '/api/access/fix')).toHaveLength(2);
  });

  it('says so when a fix couldn’t finish, and keeps the finding', async () => {
    const user = userEvent.setup();
    const finding: CheckupItem = {
      id: 'files',
      level: 'danger',
      title: 'Other people on this computer may read your Conch files',
      detail: 'If making them private doesn’t work, run:',
      command: 'chmod -R go-rwx /home/ada/.conch',
      fix: { kind: 'act', label: 'Make them private', action: 'secure-files' },
    };
    mockFetch({
      'GET /api/access': () => settings({ checkup: [finding] }),
      'POST /api/access/fix': () =>
        json({ error: 'unfixed', message: 'Run the command shown to fix it.' }, 409),
    });
    renderApp(
      <>
        <SecurityTab />
        <Toaster />
      </>,
    );
    const button = await screen.findByRole('button', { name: 'Make them private' });
    await user.click(button);
    expect(await screen.findByText('Run the command shown to fix it.')).toBeInTheDocument();
    expect(screen.getByText(finding.title)).toBeInTheDocument();
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('takes you to what needs deciding: a new key, old keys, a password, or Tailscale', async () => {
    const user = userEvent.setup();
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const checkup: CheckupItem[] = [
      {
        id: 'env-token',
        level: 'warn',
        title: 'An access key is set in CONCH_TOKEN',
        detail: 'Create an access key here first.',
        command: 'unset CONCH_TOKEN',
        fix: { kind: 'open', label: 'Create a key', place: 'keys' },
      },
      {
        id: 'sign-in',
        level: 'info',
        title: 'No sign-in on this computer',
        detail: 'Add a password.',
        fix: { kind: 'open', label: 'Add a password', place: 'sign-in' },
      },
      {
        id: 'encryption',
        level: 'danger',
        title: 'Your network can see Conch traffic',
        detail: 'Use Tailscale.',
        command: 'tailscale serve --bg 4317',
        fix: { kind: 'open', label: 'Show me how', place: 'reach' },
      },
    ];
    mockFetch({ 'GET /api/access': () => settings({ checkup }) });
    renderApp(<SecurityTab />);

    await user.click(await screen.findByRole('button', { name: 'Create a key' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());
    expect(screen.getByRole('radio', { name: /Access key/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Add a password' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveFocus(),
    );

    // Reaching Conch from a phone is Settings → Devices: the fix goes there, to Tailscale.
    await user.click(screen.getByRole('button', { name: /Show me how/ }));
    expect(useUi.getState().settingsFocus).toBe('reach');
    cleanup();
    mockFetch({ 'GET /api/access': () => settings({ checkup }) });
    renderApp(<DevicesTab />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Tailscale — anywhere/ })).toHaveFocus(),
    );
    expect(screen.getByText(/tailscale.com\/download/)).toBeVisible();

    // Old keys: straight to the first one that hasn't been used.
    cleanup();
    mockFetch({
      'GET /api/access': () =>
        settings({
          method: 'key',
          keys: [
            { id: 'key_new', name: 'Phone', hint: 'aaaa', createdAt: Date.now() },
            { id: 'key_old', name: 'Old laptop', hint: 'bbbb', createdAt: old },
          ],
          checkup: [
            {
              id: 'stale-keys',
              level: 'info',
              title: 'An access key hasn’t been used in 90 days',
              detail: 'Revoke keys you no longer need.',
              fix: { kind: 'open', label: 'Review keys', place: 'keys' },
            },
          ],
        }),
    });
    renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('button', { name: 'Review keys' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke Old laptop' })).toHaveFocus(),
    );
    expect(screen.getByText('Not used in 90 days')).toBeInTheDocument();
  });

  it('opens Models for a choice made there', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/access': () =>
        settings({
          checkup: [
            {
              id: 'provider-prompts',
              level: 'warn',
              title: 'Codex can’t ask you before each step',
              detail: 'Keep it to reading only.',
              fix: { kind: 'open', label: 'Review', place: 'models' },
            },
          ],
        }),
    });
    const { where } = renderApp(<SecurityTab />, { route: '/settings/security' });
    await user.click(await screen.findByRole('button', { name: /Review/ }));
    expect(where()).toBe('/settings/models');
  });

  it('asks for a restart when the gateway is older than the page', async () => {
    mockFetch({});
    renderApp(<SecurityTab />);
    expect(await screen.findByText('Restart Conch to finish updating')).toBeInTheDocument();
  });
});
