import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { SafetySection } from './SafetySection';

afterEach(() => vi.unstubAllGlobals());

describe('Safety in Settings', () => {
  it('says what sealing means for each provider you use, honestly', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/auth': () => ({
        method: 'none',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/safety': () => ({
        sandbox: { available: true, protects: ['SSH keys'] },
        providers: [
          {
            id: 'claude-code',
            label: 'Claude Code',
            state: 'sealed',
            note: 'Commands run sealed: your work folder and caches only, never where keys live.',
          },
          {
            id: 'codex-cli',
            label: 'Codex',
            state: 'partly',
            note: 'Codex keeps to your work folder, but version 0.120.0 can still read where keys live. Codex 0.159.0 or newer can’t.',
          },
        ],
      }),
    });
    renderApp(<SafetySection />);
    const region = await screen.findByRole('region', { name: 'For the providers you use' });
    expect(within(region).getByText('Partly sealed')).toBeInTheDocument();
    expect(region).toHaveTextContent('can still read where keys live');
  });

  it('turns the memory check down only after saying what could happen (ADR 0087)', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/auth': () => ({
        method: 'none',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/safety': () => ({ sandbox: { available: true, protects: [] }, providers: [] }),
      'PATCH /api/settings': (body) => appState(body as never),
    });
    renderApp(<SafetySection />);
    const toggle = await screen.findByRole('switch', { name: /Check what it remembers/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Stop checking what it remembers?',
    });
    expect(dialog).toHaveTextContent('where your invoices go');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn it off' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        preferences: { checkMemories: false },
      }),
    );
  });
});
