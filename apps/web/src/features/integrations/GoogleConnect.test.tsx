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
const client = {
  installed: {
    client_id: 'client.apps.googleusercontent.com',
    client_secret: 'not-a-real-secret',
    project_id: 'my-conch-project',
  },
};
const fileOf = (content: unknown, name = 'client_secret.json') => {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const file = new File([text], name, { type: 'application/json' });
  // jsdom does not yet implement Blob.text; the actual browser file API is used in production.
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
};
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe('Google sign-in', () => {
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

  it('guides setup, skips to the file, and keeps Web credentials advanced', async () => {
    mockFetch({ 'GET /api/google': () => ({ configured: false, accounts: [] }) });
    renderApp(<GoogleConnect capabilities={['mail-read']} onReady={() => {}} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'I already have a credential file' }),
    );
    expect(screen.getByRole('group', { name: 'Drop the file you downloaded' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose the file' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and continue with Google' })).toBeDisabled();
    expect(screen.queryByLabelText('Google client secret')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Advanced: existing Web client' }));
    expect(screen.getByLabelText('Callback address to register')).toHaveValue(
      `${window.location.origin}/oauth/google/callback`,
    );
    expect(screen.getByText(/Desktop app works for a self-hosted server/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });

  it('checks a chosen file here, says what it is, and starts consent without manual IDs', async () => {
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
    // The wrong kind of file is turned down here, in words, before anything is sent.
    await userEvent.upload(picker(), fileOf({ type: 'service_account' }, 'key.json'));
    expect(await screen.findByText(/This is a service-account key/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and continue with Google' })).toBeDisabled();
    await userEvent.upload(picker(), fileOf(client));
    expect(
      await screen.findByText('Desktop app · my-conch-project. Ready to connect.'),
    ).toBeVisible();
    expect(screen.getByText('client_secret.json')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue with Google' }));
    await waitFor(() => expect(opened.location.href).toBe('https://accounts.google.com/auth'));
    expect(received).toEqual({ credentials: JSON.stringify(client) });
    expect(JSON.stringify(sessionStorage)).not.toMatch(/not-a-real-secret|client_secret|installed/);
  });

  it('takes the file’s contents pasted instead', async () => {
    mockFetch({ 'GET /api/google': () => ({ configured: false, accounts: [] }) });
    renderApp(<GoogleConnect capabilities={['calendar-read']} onReady={() => {}} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'I already have a credential file' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Paste what’s in it instead' }));
    const field = screen.getByLabelText('What’s in the file');
    await userEvent.click(field);
    await userEvent.paste(JSON.stringify(client));
    expect(
      await screen.findByText('Desktop app · my-conch-project. Ready to connect.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and continue with Google' })).toBeEnabled();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
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

  it('asks Google for exactly what was chosen, as the account it is for', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const calls = mockFetch({
      'GET /api/google': () => ({ configured: true, accounts: [] }),
      'POST /api/google/connect': () => ({
        url: 'https://accounts.google.com/auth',
        flowId: 'more',
        mode: 'automatic',
      }),
      'GET /api/google/flows/more': () => ({ state: 'pending', mode: 'automatic' }),
    });
    renderApp(
      <GoogleConnect
        accountId="work"
        capabilities={['mail-read', 'calendar-read', 'calendar-write']}
        label="Allow on Google"
        onReady={() => {}}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Allow on Google' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/google/connect')?.body).toEqual({
        capabilities: ['mail-read', 'calendar-read', 'calendar-write'],
        accountId: 'work',
      }),
    );
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
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalled();
  });

  it('never carries on with a different account than the one it signed in again for', async () => {
    sessionStorage.setItem('conch-google-flow:personal:calendar-read', 'other-flow');
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
      'GET /api/google/flows/other-flow': () => ({ state: 'ready', accountId: 'work' }),
    });
    const onReady = vi.fn();
    renderApp(
      <GoogleConnect accountId="personal" capabilities={['calendar-read']} onReady={onReady} />,
    );
    expect(await screen.findByText(/doesn’t have what was asked for/)).toBeVisible();
    expect(onReady).not.toHaveBeenCalled();
  });
});
