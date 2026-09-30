import type { AuthStatus } from '@conch/protocol';
import { NacreProvider } from '@conch/nacre';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const status = (signedIn: boolean): AuthStatus => ({
  method: 'password',
  signedIn,
  setupRequired: false,
  secure: true,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  window.history.replaceState(null, '', '/');
});

describe('AuthGate', () => {
  it('opens a phone signed in by its link, even when the first "am I signed in?" answers last', async () => {
    // The link the phone opens: its code is taken from the address bar when the app loads.
    window.history.replaceState(null, '', '/#pair=one-time-code');
    // The two requests race: the sign-in answers first, and the question asked
    // before it (still "signed out") answers after — as on a busy machine.
    let answerAuth: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input, 'http://localhost').pathname;
        if (path === '/api/auth/sign-in' && init?.method === 'POST') return json(status(true));
        if (path === '/api/auth')
          return new Promise<Response>((resolve) => {
            answerAuth = () => resolve(json(status(false)));
          });
        return new Response('{}', { status: 404 });
      }),
    );
    const { AuthGate } = await import('./AuthGate');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <NacreProvider scope="local">
        <QueryClientProvider client={client}>
          <AuthGate>
            <p>The app</p>
          </AuthGate>
        </QueryClientProvider>
      </NacreProvider>,
    );
    expect(await screen.findByText('The app')).toBeInTheDocument();
    // The stale "signed out" arrives now: it must not send the phone back to sign-in.
    answerAuth?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
