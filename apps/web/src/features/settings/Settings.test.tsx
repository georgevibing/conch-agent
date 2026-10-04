import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, baseProviders, mockFetch, provider, renderApp } from '../../test/harness';
import { Settings } from './Settings';

function narrowScreen(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Conch's state is in hand, as it always is by the time Settings opens. */
const loaded = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useUi.setState({ settingsFocus: undefined, restarting: undefined }));
});

describe('Settings', () => {
  it('is a page of its own: its places in a few groups, General first, Back to return', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    const { where } = renderApp(<Settings />, { route: '/c/c1' });
    await loaded();
    act(() => useUi.getState().openSettings());
    expect(where()).toBe('/settings');

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(within(page).getByRole('tab', { name: 'General' })).toHaveFocus());
    for (const group of ['Your assistant', 'Intelligence', 'Tools', 'Safe and sound'])
      expect(within(page).getByRole('tablist', { name: group })).toBeInTheDocument();
    expect(
      within(within(page).getByRole('tablist', { name: 'Intelligence' })).getAllByRole('tab'),
    ).toHaveLength(4);
    expect(within(page).getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(within(page).queryByRole('tab', { name: /Models & modes/ })).not.toBeInTheDocument();
    expect(await within(page).findByRole('heading', { name: 'Working folder' })).toBeVisible();

    // Every place has its own address.
    await userEvent.click(within(page).getByRole('tab', { name: 'Appearance' }));
    expect(within(page).getByRole('heading', { name: 'Appearance' })).toBeVisible();
    expect(where()).toBe('/settings/appearance');

    // Back returns to the page it opened over.
    await userEvent.click(within(page).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/c/c1');
  });

  it('opens at the place its address names, and steps aside while Conch restarts', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />, { route: '/settings/appearance' });

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).getByRole('tab', { name: 'Appearance' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    act(() => useUi.getState().setRestarting({ title: 'Updating Conch…' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => useUi.getState().setRestarting(undefined));
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('closes when the address leaves it, and has no address of its own for another page', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    const { where } = renderApp(<Settings />, { route: '/settings/notifications' });
    await screen.findByRole('dialog', { name: 'Settings' });
    // Opened by its address, Back goes to the chats.
    act(() => useUi.getState().closeSettings());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/');
  });

  it('a provider’s page has its address, and Providers in the list goes back to them all', async () => {
    narrowScreen(false);
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => ({
        ...baseProviders,
        providers: [
          ...baseProviders.providers,
          provider({ id: 'mistral', name: 'Mistral', active: false, connect: 'key' }),
        ],
      }),
    });
    const { where } = renderApp(<Settings />, { route: '/settings/providers/mistral' });
    const page = await screen.findByRole('dialog', { name: 'Settings' });
    // Connected, the page stays (it says so) until you go back.
    expect(await within(page).findByRole('heading', { name: /Mistral/ })).toBeInTheDocument();
    expect(within(page).queryByRole('heading', { name: 'Your providers' })).toBeNull();

    await userEvent.click(within(page).getByRole('tab', { name: 'Providers' }));
    expect(where()).toBe('/settings/providers');
    expect(await within(page).findByRole('heading', { name: 'Your providers' })).toBeVisible();

    // Opening one again is an address too; its own ← Providers goes back the same way.
    await userEvent.click(
      within(within(page).getByRole('article', { name: 'Codex' })).getByRole('button', {
        name: 'Codex',
      }),
    );
    expect(where()).toBe('/settings/providers/codex-cli');
    await userEvent.click(await within(page).findByRole('button', { name: 'Providers' }));
    expect(where()).toBe('/settings/providers');
  });

  it('opens what Conch remembers inside Memory, with ‹ Memory back', async () => {
    narrowScreen(false);
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [
        {
          id: 'm_1',
          content: 'Projects live in ~/projects',
          kind: 'project',
          source: 'agent',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const { where } = renderApp(<Settings />, { route: '/settings/memory' });
    const page = await screen.findByRole('dialog', { name: 'Settings' });
    await userEvent.click(await within(page).findByRole('button', { name: 'Open' }));
    expect(where()).toBe('/settings/memory/everything');
    // Still Settings, its places beside it: the memories are a page inside Memory.
    expect(
      await within(page).findByRole('heading', { name: 'What Conch knows about you' }),
    ).toBeVisible();
    expect(within(page).getByRole('tab', { name: 'Memory' })).toBeInTheDocument();
    expect(await within(page).findByText('Projects live in ~/projects')).toBeVisible();
    await userEvent.click(within(page).getByRole('button', { name: 'Memory' }));
    expect(where()).toBe('/settings/memory');
  });

  it('on a phone, is a list and then the place you chose, with ‹ Settings back to the list', async () => {
    narrowScreen(true);
    mockFetch({ 'GET /api/state': () => appState() });
    const { where } = renderApp(<Settings />);
    await loaded();
    act(() => useUi.getState().openSettings());

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    // The place already chosen opens too.
    await userEvent.click(within(page).getByRole('tab', { name: 'General' }));
    expect(await within(page).findByRole('heading', { name: 'Working folder' })).toBeVisible();

    expect(where()).toBe('/settings/general');

    await userEvent.click(within(page).getByRole('button', { name: 'Settings' }));
    expect(where()).toBe('/settings');
    expect(within(page).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('on a phone, opens straight at a place it was asked for', async () => {
    narrowScreen(true);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />, { route: '/settings/general' });
    await loaded();

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
