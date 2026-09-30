import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appState,
  baseProviders,
  mockFetch,
  provider,
  providersList,
  renderApp,
} from '../../test/harness';
import { FallbackSection } from './FallbackSection';

afterEach(() => vi.unstubAllGlobals());

const router = provider({ id: 'openrouter', name: 'OpenRouter', active: false, ready: true });

describe('When a provider can’t answer', () => {
  it('offers the connected providers for a limit, and saves the choice', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () =>
        providersList({ providers: [...baseProviders.providers, router] }),
      'PATCH /api/settings': (body) => ({ ...appState(), ...(body as object) }),
    });
    renderApp(<FallbackSection />);
    expect(
      await screen.findByText(/let another connected provider answer while Claude Code/),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('combobox', { name: 'At a usage limit' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Continue with OpenRouter' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'PATCH',
          path: '/api/settings',
          body: { preferences: { limitFallback: 'openrouter' } },
        }),
      ),
    );
  });

  it('says what the chosen fallback does, and waiting clears it', async () => {
    const calls = mockFetch({
      'GET /api/state': () =>
        appState({
          preferences: { ...appState().preferences, limitFallback: 'openrouter' },
        }),
      'GET /api/providers': () =>
        providersList({ providers: [...baseProviders.providers, router] }),
      'PATCH /api/settings': () => appState(),
    });
    renderApp(<FallbackSection />);
    expect(
      await screen.findByText(
        /When Claude Code reaches a limit, OpenRouter answers the same message/,
      ),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('combobox', { name: 'At a usage limit' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Wait until it resets' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ body: { preferences: { limitFallback: null } } }),
      ),
    );
  });

  it('offline: says messages wait when there’s no model on this computer', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => baseProviders,
    });
    renderApp(<FallbackSection />);
    expect(
      await screen.findByText(/No model on this computer yet, so messages wait/),
    ).toBeVisible();
    expect(screen.getByRole('switch', { name: /Answer offline/ })).toBeChecked();
  });
});
