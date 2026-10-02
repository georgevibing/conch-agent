import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderApp } from '../../test/harness';
import { GoogleConnect } from './GoogleConnect';
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('Google connection', () => {
  it('clears recovery state before continuing a finished job, even when that continuation unmounts the view', async () => {
    sessionStorage.setItem('conch-google-flow:new:mail-read', 'completed-flow');
    const account = {
      id: 'personal',
      email: 'personal@example.com',
      name: 'Person',
      capabilities: ['mail-read'],
      state: 'ready',
    };
    mockFetch({
      'GET /api/google': () => ({ configured: true, accounts: [account] }),
      'GET /api/google/flows/completed-flow': () => ({ state: 'ready', accountId: 'personal' }),
    });
    const onReady = vi.fn(() => {
      expect(sessionStorage.getItem('conch-google-flow:new:mail-read')).toBeNull();
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledExactlyOnceWith('personal'));
  });
  it('guides personal setup, skips to credential import, and keeps Web credentials advanced', async () => {
    mockFetch({ 'GET /api/google': () => ({ configured: false, accounts: [] }) });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'I already have a credential file' }),
    );
    expect(screen.getByRole('button', { name: 'Save and connect Google' })).toBeDisabled();
    expect(screen.getByLabelText('Google credential JSON')).toHaveAttribute('type', 'file');
    expect(screen.queryByLabelText('Google client secret')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Advanced: existing Web client' }));
    expect(screen.getByLabelText('Callback address to register')).toHaveValue(
      `${window.location.origin}/oauth/google/callback`,
    );
    expect(screen.getByText(/Desktop app works for a self-hosted server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).not.toBeInTheDocument();
  });
  it('imports a downloaded credential file and starts consent without asking for manual IDs or callback setup', async () => {
    const client = {
      installed: {
        client_id: 'client.apps.googleusercontent.com',
        client_secret: 'not-a-real-secret',
        project_id: 'my-conch-project',
      },
    };
    let configured = false;
    let received: unknown;
    const opened = { closed: false, close: vi.fn(), location: { href: '' } };
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    mockFetch({
      'GET /api/google': () => ({ configured, accounts: [] }),
      'POST /api/google/import': (body) => {
        received = body;
        configured = true;
        return { configured, clientType: 'desktop', accounts: [] };
      },
      'POST /api/google/connect': () => ({
        url: 'https://accounts.google.com/auth',
        flowId: 'import-flow',
        mode: 'automatic',
      }),
      'GET /api/google/flows/import-flow': () => ({ state: 'pending', mode: 'automatic' }),
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'I already have a credential file' }),
    );
    const file = new File([JSON.stringify(client)], 'client_secret.json', {
      type: 'application/json',
    });
    // jsdom does not yet implement Blob.text; the actual browser file API is used in production.
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(client) });
    await userEvent.upload(screen.getByLabelText('Google credential JSON'), file);
    expect(await screen.findByRole('status')).toHaveTextContent('Desktop app · my-conch-project');
    await userEvent.click(screen.getByRole('button', { name: 'Save and connect Google' }));
    await waitFor(() => expect(opened.location.href).toBe('https://accounts.google.com/auth'));
    expect(received).toEqual({ credentials: JSON.stringify(client) });
    expect(JSON.stringify(sessionStorage)).not.toMatch(/not-a-real-secret|client_secret|installed/);
  });
  it('keeps popup-blocked sign-in usable with an explicit browser link and remote paste-back', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    let returned: unknown;
    mockFetch({
      'GET /api/google': () => ({ configured: true, clientType: 'desktop', accounts: [] }),
      'POST /api/google/connect': () => ({
        url: 'https://accounts.google.com/auth',
        flowId: 'remote-flow',
        mode: 'manual',
      }),
      'GET /api/google/flows/remote-flow': () => ({ state: 'pending', mode: 'manual' }),
      'POST /api/google/flows/remote-flow/complete': (body) => {
        returned = body;
        return { state: 'pending' };
      },
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Google' }));
    expect(await screen.findByRole('link', { name: 'Open Google sign-in' })).toHaveAttribute(
      'href',
      'https://accounts.google.com/auth',
    );
    const address = 'http://127.0.0.1:1/?state=remote-flow&code=do-not-store-code';
    await userEvent.type(screen.getByLabelText('Return address from Google'), address);
    await userEvent.click(screen.getByRole('button', { name: 'Finish connecting' }));
    await waitFor(() => expect(returned).toEqual({ redirectUrl: address }));
    expect(JSON.stringify(sessionStorage)).not.toContain('do-not-store-code');
    expect(screen.getByLabelText('Return address from Google')).toHaveValue('');
  });
  it('recovers the same pending flow after reload and reports the server’s actionable failure', async () => {
    sessionStorage.setItem('conch-google-flow:new:mail-read', 'saved-flow');
    mockFetch({
      'GET /api/google': () => ({ configured: true, accounts: [] }),
      'GET /api/google/flows/saved-flow': () => ({
        state: 'failed',
        message: 'Enable Gmail API, then press Check connection.',
      }),
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    expect(await screen.findByText('Enable Gmail API, then press Check connection.')).toBeVisible();
    await waitFor(() =>
      expect(sessionStorage.getItem('conch-google-flow:new:mail-read')).toBeNull(),
    );
  });
  it('rechecks API access without repeating consent and continues only after verification', async () => {
    let ready = false;
    const account = () => ({
      id: 'personal',
      email: 'personal@example.com',
      name: 'Personal',
      capabilities: ['mail-read'],
      state: ready ? 'ready' : 'unavailable',
      message: ready ? undefined : 'Enable Gmail API.',
    });
    const onReady = vi.fn();
    mockFetch({
      'GET /api/google': () => ({ configured: true, accounts: [account()] }),
      'POST /api/google/accounts/personal/check': () => {
        ready = true;
        return { configured: true, accounts: [account()] };
      },
    });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={onReady} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Check connection for personal@example.com' }),
    );
    expect(onReady).toHaveBeenCalledWith('personal');
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
