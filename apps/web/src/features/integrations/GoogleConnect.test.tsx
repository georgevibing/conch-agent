import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderApp } from '../../test/harness';
import { GoogleConnect } from './GoogleConnect';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('Google connection', () => {
  it('explains one-time operator setup and exact callback instead of claiming one-click OAuth', async () => {
    mockFetch({ 'GET /api/google': () => ({ configured: false, accounts: [] }) });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Save Google app setup' })).toBeDisabled();
    expect(screen.getByLabelText('Callback address to register')).toHaveValue(
      `${window.location.origin}/oauth/google/callback`,
    );
    expect(screen.getByText(/Web application client/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
  });
  it('verifies the explicitly selected account and discloses draft scope', async () => {
    const account = {
      id: 'account1',
      email: 'personal@example.com',
      name: 'Person',
      capabilities: ['mail-read', 'mail-draft'],
      state: 'ready',
    };
    const onReady = vi.fn();
    mockFetch({
      'GET /api/google': () => ({ configured: true, accounts: [account] }),
      'POST /api/google/accounts/account1/check': () => ({ configured: true, accounts: [account] }),
    });
    renderApp(<GoogleConnect capabilities={['mail-draft']} onReady={onReady} />);
    expect(
      await screen.findByText(/Google’s draft permission also includes sending/),
    ).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: 'Use personal@example.com' }));
    expect(onReady).toHaveBeenCalledWith('account1');
  });
  it('opens the existing password verification flow without discarding the Google popup or current job', async () => {
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      closed: false,
      close,
      location: { href: 'about:blank' },
    } as unknown as Window);
    mockFetch({
      'GET /api/auth': () => ({
        method: 'password',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/google': () => ({ configured: true, accounts: [] }),
      'POST /api/google/connect': () =>
        new Response(JSON.stringify({ error: 'verify-required', message: 'Confirm it is you' }), {
          status: 403,
        }),
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
  });
  it('never silently uses a different account when selected account is unavailable', async () => {
    mockFetch({
      'GET /api/google': () => ({
        configured: true,
        accounts: [
          {
            id: 'work',
            email: 'work@example.com',
            name: 'Work',
            capabilities: ['calendar-read'],
            state: 'ready',
          },
        ],
      }),
    });
    const onReady = vi.fn();
    renderApp(
      <GoogleConnect accountId="personal" capabilities={['calendar-read']} onReady={onReady} />,
    );
    expect(
      await screen.findByRole('button', { name: 'Connect Google · another account' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use work@example.com' })).not.toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
  });
});
