import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseEngine, mockFetch, renderApp } from '../../test/harness';
import { EngineConnect } from './EngineConnect';

afterEach(() => vi.unstubAllGlobals());

describe('EngineConnect', () => {
  it('explains how to install when Claude Code is missing', async () => {
    mockFetch({
      'GET /api/engine': () => ({
        ...baseEngine,
        state: 'not-installed',
        version: undefined,
        auth: undefined,
      }),
      'GET /api/state': () => appState(),
    });
    renderApp(<EngineConnect />);
    expect(await screen.findByText('Claude Code isn’t installed yet')).toBeInTheDocument();
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy npm command/ })).toBeInTheDocument();
    expect(screen.getByText('Waiting for Claude Code…')).toBeInTheDocument();
  });

  it('offers sign-in (and alternatives) when signed out', async () => {
    const calls = mockFetch({
      'GET /api/engine': () => ({ ...baseEngine, state: 'signed-out', auth: undefined }),
      'GET /api/state': () => appState(),
      'POST /api/engine/login': () => ({ ok: true }),
    });
    renderApp(<EngineConnect />);
    const signIn = await screen.findByRole('button', { name: 'Sign in with Claude' });
    await userEvent.click(signIn);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/engine/login',
        body: { method: 'subscription' },
      }),
    );
    expect(await screen.findByText('Starting sign-in…')).toBeInTheDocument();
  });

  it('celebrates and moves on when ready', async () => {
    mockFetch({ 'GET /api/engine': () => baseEngine, 'GET /api/state': () => appState() });
    const onReady = vi.fn();
    renderApp(<EngineConnect onReady={onReady} />);
    expect(
      await screen.findByText('Signed in · Claude Max · you@example.com', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it('shows the error with a retry', async () => {
    mockFetch({
      'GET /api/engine': () => ({ ...baseEngine, state: 'error', message: 'Segmentation fault' }),
      'GET /api/state': () => appState(),
    });
    renderApp(<EngineConnect />);
    expect(await screen.findByText('Segmentation fault')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
