import { BrowserStatus } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { BrowserSettings } from './BrowserSettings';

afterEach(() => vi.unstubAllGlobals());

const status = (patch: Record<string, unknown> = {}) =>
  BrowserStatus.parse({
    phase: 'running',
    settings: {},
    candidates: [],
    browser: { name: 'Microsoft Edge', id: 'msedge', version: '154.0.1' },
    backend: { chosen: 'local', using: 'local', saved: { browserbase: false, steel: false } },
    ...patch,
  });

describe('Settings → Browser and repairing', () => {
  it('says nothing about repairing while the browser is healthy: Health looks after it', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/browser': () => status() });
    renderApp(<BrowserSettings />);
    expect(await screen.findByRole('status')).toHaveTextContent('Running');
    expect(screen.queryByRole('button', { name: /Repair/ })).toBeNull();
  });

  it('with a real problem, one line and one button that runs the browser’s fix', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/browser': () =>
        status({ phase: 'problem', problem: { message: 'The browser won’t start.' } }),
      'POST /api/browser/repair': () => status(),
    });
    renderApp(<BrowserSettings />);
    expect(await screen.findByText('The browser won’t start.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Repair/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Repair' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/browser/repair')).toBe(true),
    );
    // Fixed, the button goes away with the problem.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Repair/ })).toBeNull());
  });
});
