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

describe('AuthGate on the computer running Conch (ADR 0063)', () => {
  it('hands in the code a launcher opened it with, then shows the app', async () => {
    window.history.replaceState(null, '', '/?open=devices#here=one-time-code');
    let proven = false;
    const handedIn: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input, 'http://localhost').pathname;
        if (path === '/api/here' && init?.method === 'POST') {
          handedIn.push(JSON.parse(String(init.body)));
          proven = true;
          return json({ ok: true });
        }
        if (path === '/api/auth')
          return json({
            method: 'none',
            signedIn: proven,
            setupRequired: false,
            secure: true,
            ...(proven ? { here: 'proven' } : { hereRequired: true, here: 'unproven' }),
          } satisfies AuthStatus);
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
    expect(handedIn).toEqual([{ code: 'one-time-code' }]);
    // The code is gone from the address bar; where it was going stays.
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?open=devices');
  });

  it('says to open it from your apps when the link was already used', async () => {
    window.history.replaceState(null, '', '/#here=spent');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input, 'http://localhost').pathname;
        if (path === '/api/here' && init?.method === 'POST')
          return new Response(JSON.stringify({ error: 'invalid', message: 'used' }), {
            status: 401,
          });
        if (path === '/api/auth')
          return json({
            method: 'none',
            signedIn: false,
            setupRequired: false,
            hereRequired: true,
            here: 'unproven',
            secure: true,
          } satisfies AuthStatus);
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
    expect(
      await screen.findByRole('heading', { name: 'Open Conch from your apps' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/expired or was already used/)).toBeInTheDocument();
    expect(screen.getByText('pnpm conch open')).toBeInTheDocument();
    expect(screen.queryByText('The app')).toBeNull();
  });

  it('opens the page that makes a new Conch yours from a hello link, and keeps the code out of the address', async () => {
    window.history.replaceState(null, '', '/#hello=the-code');
    const sent: { path: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost');
        sent.push({
          path: url.pathname + url.search,
          body: init?.body && JSON.parse(String(init.body)),
        });
        if (url.pathname === '/api/auth/hello')
          return json({
            ok: true,
            expiresAt: Date.now() + 3_600_000,
            address: 'conch.example.com',
            suggestedUsername: 'george',
            passkeys: true,
          });
        if (url.pathname === '/api/auth')
          return json({ method: 'none', signedIn: false, setupRequired: true, secure: true });
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
    expect(await screen.findByRole('heading', { name: 'Make Conch yours' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(sent.find((r) => r.path === '/api/auth/hello')?.body).toEqual({ code: 'the-code' });
    expect(sent.every((r) => !r.path.includes('the-code'))).toBe(true);
    expect(screen.queryByText('The app')).toBeNull();
  });
});
