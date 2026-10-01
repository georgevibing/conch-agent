import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
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
  act(() => useUi.setState({ settings: null, settingsFocus: undefined }));
});

describe('Settings', () => {
  it('is a page of its own: its places in a few groups, General first, Back to return', async () => {
    narrowScreen(false);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />);
    await loaded();
    act(() => useUi.getState().openSettings());

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

    await userEvent.click(within(page).getByRole('tab', { name: 'Appearance' }));
    expect(within(page).getByRole('heading', { name: 'Appearance' })).toBeVisible();

    await userEvent.click(within(page).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(useUi.getState().settings).toBeNull());
  });

  it('on a phone, is a list and then the place you chose, with ‹ Settings back to the list', async () => {
    narrowScreen(true);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />);
    await loaded();
    act(() => useUi.getState().openSettings());

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    // The place already chosen opens too.
    await userEvent.click(within(page).getByRole('tab', { name: 'General' }));
    expect(await within(page).findByRole('heading', { name: 'Working folder' })).toBeVisible();

    await userEvent.click(within(page).getByRole('button', { name: 'Settings' }));
    expect(useUi.getState().settingsBrowse).toBe(true);
  });

  it('on a phone, opens straight at a place it was asked for', async () => {
    narrowScreen(true);
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<Settings />);
    await loaded();
    act(() => useUi.getState().openSettings('general'));

    const page = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(page).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(useUi.getState().settingsBrowse).toBe(false);
  });
});
