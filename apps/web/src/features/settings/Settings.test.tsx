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
  it('is a page of its own: its places in a few groups, General first, ‹ Chats to return', async () => {
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
    // Thirteen places: the defaults for new chats are the composer's own, so no Models.
    expect(within(page).getAllByRole('tab')).toHaveLength(13);
    expect(
      within(within(page).getByRole('tablist', { name: 'Intelligence' })).getAllByRole('tab'),
    ).toHaveLength(2);
    expect(within(page).queryByRole('tab', { name: 'Models' })).not.toBeInTheDocument();
    expect(within(page).queryByRole('tab', { name: 'Commands' })).not.toBeInTheDocument();
    expect(within(page).queryByRole('tab', { name: 'About you' })).not.toBeInTheDocument();
    expect(
      within(within(page).getByRole('tablist', { name: 'Safe and sound' })).getAllByRole('tab'),
    ).toHaveLength(3);
    expect(await within(page).findByRole('heading', { name: 'Working folder' })).toBeVisible();
    // How it looks is part of General.
    expect(within(page).getByRole('heading', { name: 'Appearance' })).toBeVisible();

    // Every place has its own address.
    await userEvent.click(within(page).getByRole('tab', { name: 'Access' }));
    expect(where()).toBe('/settings/access');

    // A place has no trail of its own: its name is its heading.
    expect(within(page).queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();

    // ‹ Chats returns to the page it opened over.
    await userEvent.click(within(page).getByRole('button', { name: 'Chats' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/c/c1');
  });

  it('shows a simple place whole: nothing folded away behind Advanced', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />, { route: '/settings/general' });
    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(await within(page).findByRole('heading', { name: 'Working folder' })).toBeVisible();
    // Starting over is right there, one row with its button.
    expect(within(page).getByRole('button', { name: 'Replay welcome' })).toBeVisible();
    expect(within(page).queryByRole('button', { name: 'Advanced' })).toBeNull();

    // How it looks, and how new chats are named, are beside the rest.
    expect(within(page).getByRole('slider', { name: 'Shimmer' })).toBeVisible();
    expect(
      within(page).getByRole('switch', { name: /Name new chats automatically/ }),
    ).toBeVisible();
  });

  it('lands an old address where that place is now', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    const { where } = renderApp(<Settings />, { route: '/settings/appearance' });
    const page = await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(where()).toBe('/settings/general'));
    expect(within(page).getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Models is gone: what was left of it is on Providers.
    act(() => useUi.getState().openSettings('models'));
    await waitFor(() => expect(where()).toBe('/settings/providers'));
    // Devices and Other apps are parts of Access.
    act(() => useUi.getState().openSettings('devices'));
    await waitFor(() => expect(where()).toBe('/settings/access'));
    act(() => useUi.getState().openSettings('about'));
    await waitFor(() => expect(where()).toBe('/settings/memory'));
  });

  it('opens at the place its address names, and steps aside while Conch restarts', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />, { route: '/settings/voice' });

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).getByRole('tab', { name: 'Voice' })).toHaveAttribute(
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

    // Opening one again is an address too; Providers in the trail above it goes back the same way.
    await userEvent.click(
      within(within(page).getByRole('article', { name: 'Codex' })).getByRole('button', {
        name: 'Codex',
      }),
    );
    expect(where()).toBe('/settings/providers/codex-cli');
    const trail = await within(page).findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Codex')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(trail).getByRole('button', { name: 'Providers' }));
    expect(where()).toBe('/settings/providers');
  });

  it('opens every memory inside What Conch knows, with the trail above it', async () => {
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
    expect(within(page).getByRole('tab', { name: 'What Conch knows' })).toBeInTheDocument();
    expect(await within(page).findByText('Projects live in ~/projects')).toBeVisible();
    // One way back, in the trail: never a stack of back buttons.
    const trail = within(page).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('All memories')).toHaveAttribute('aria-current', 'page');
    expect(within(page).getAllByRole('button', { name: 'What Conch knows' })).toHaveLength(1);
    // Arriving puts the focus on the page's name, so the way back is a Shift+Tab away.
    await waitFor(() => expect(within(trail).getByText('All memories')).toHaveFocus());

    await userEvent.click(within(trail).getByRole('button', { name: 'What Conch knows' }));
    expect(where()).toBe('/settings/memory');
    expect(within(page).queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    // Stepping back out reads the place itself.
    await waitFor(() =>
      expect(within(page).getByRole('heading', { name: 'Memory', level: 3 })).toHaveFocus(),
    );
  });

  it('on a phone, opens with its places floating in from the side, like the chats', async () => {
    narrowScreen(true);
    mockFetch({ 'GET /api/state': () => appState() });
    const { where } = renderApp(<Settings />, { route: '/c/c1' });
    await loaded();
    act(() => useUi.getState().openSettings());

    // Settings itself: its places, out over the page.
    const menu = (
      await screen.findByRole('tablist', { name: 'Intelligence' })
    ).closest<HTMLElement>('[role="dialog"]') as HTMLElement;
    expect(menu).toHaveAccessibleName('Settings');
    expect(within(menu).getByRole('button', { name: 'Chats' })).toBeInTheDocument();
    await waitFor(() => expect(within(menu).getByRole('tab', { name: 'General' })).toHaveFocus());

    // Choosing a place puts the menu away, and the header says where you are.
    await userEvent.click(within(menu).getByRole('tab', { name: 'Providers' }));
    expect(where()).toBe('/settings/providers');
    await waitFor(() => expect(screen.queryByRole('tablist', { name: 'Intelligence' })).toBeNull());
    const page = screen.getByRole('dialog', { name: 'Settings' });
    const trail = within(page).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('Providers')).toHaveAttribute('aria-current', 'page');
    expect(within(page).getByRole('tabpanel', { name: 'Providers' })).toBeInTheDocument();
    // The menu is gone with what was pressed in it: the focus lands on where you are.
    await waitFor(() => expect(within(trail).getByText('Providers')).toHaveFocus());

    // Settings itself is its places: putting them away is going to the place
    // behind them, so the address still says where you are.
    act(() => useUi.getState().openSettings());
    await screen.findByRole('tablist', { name: 'Intelligence' });
    expect(where()).toBe('/settings');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tablist', { name: 'Intelligence' })).toBeNull());
    expect(where()).toBe('/settings/general');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(within(page).getByRole('navigation', { name: 'Breadcrumb' })).getByText('General'),
      ).toHaveFocus(),
    );

    // The menu is a press away, and in it the way back to the chats.
    await userEvent.click(within(page).getByRole('button', { name: 'Open settings menu' }));
    const again = (
      await screen.findByRole('tablist', { name: 'Intelligence' })
    ).closest<HTMLElement>('[role="dialog"]') as HTMLElement;
    await userEvent.click(within(again).getByRole('button', { name: 'Chats' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/c/c1');
  });

  it('on a phone, opens straight at a place it was asked for, its trail the header', async () => {
    narrowScreen(true);
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/memories': () => [],
    });
    const { where } = renderApp(<Settings />, { route: '/settings/memory/everything' });
    await loaded();

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    // No menu over it, and one way back: the place, in the trail.
    expect(screen.queryByRole('tablist', { name: 'Intelligence' })).toBeNull();
    expect(within(page).getByRole('button', { name: 'Open settings menu' })).toBeInTheDocument();
    const trail = within(page).getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByText('All memories')).toHaveAttribute('aria-current', 'page');
    expect(within(page).getAllByRole('button', { name: 'What Conch knows' })).toHaveLength(1);
    await userEvent.click(within(trail).getByRole('button', { name: 'What Conch knows' }));
    expect(where()).toBe('/settings/memory');
    expect(within(page).getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      /^What Conch knows$/,
    );
  });
});
