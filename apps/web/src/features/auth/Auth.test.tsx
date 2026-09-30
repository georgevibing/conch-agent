import type { AccessSettings, AuthStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
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
  sessions: [],
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
    renderApp(<SecurityTab />);
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
    mockFetch({
      'GET /api/access': () => settings(),
      'POST /api/access/keys': () => ({
        key,
        info: { id: 'key_1', name: 'My devices', hint: 'zzzz', createdAt: Date.now() },
      }),
      'GET /api/auth': () => status({ method: 'key', signedIn: true }),
    });
    renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('radio', { name: /Access key/ }));
    await user.click(screen.getByRole('button', { name: 'Create key & turn on' }));
    expect(await screen.findByText(key)).toBeInTheDocument();
    expect(screen.getByText(/won’t be shown again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
    expect(screen.queryByText(key)).toBeNull();
  });

  it('asks for a restart when the gateway is older than the page', async () => {
    mockFetch({});
    renderApp(<SecurityTab />);
    expect(await screen.findByText('Restart Conch to finish updating')).toBeInTheDocument();
  });
});
