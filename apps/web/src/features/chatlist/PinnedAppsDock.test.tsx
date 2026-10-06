import type { Artifact } from '@conch/protocol';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { PinnedAppsDock } from './PinnedAppsDock';

afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  localStorage.clear();
});

/** `n` pages pinned as apps, oldest first: Page 1 … Page n. */
function pinned(n: number): Artifact[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a_${i + 1}`,
    title: `Page ${i + 1}`,
    kind: 'chart' as const,
    conversationId: 'c1',
    createdAt: 0,
    updatedAt: 0,
    versions: [{ n: 1, at: 0, size: 10 }],
    pinned: { at: i },
  }));
}

function dock(artifacts: Artifact[]) {
  mockFetch({
    'GET /api/state': () => appState(),
    'GET /api/artifacts': () => ({ artifacts }),
    'GET /api/conch-apps': () => ({ apps: [] }),
  });
  return renderApp(<PinnedAppsDock />);
}

describe('The apps in the sidebar', () => {
  it('names them Apps and shows every one while they fit', async () => {
    dock(pinned(3));
    const apps = await screen.findByRole('region', { name: 'Pinned apps' });
    expect(within(apps).getByText('Apps')).toBeInTheDocument();
    expect(within(apps).getByRole('button', { name: 'Page 3' })).toBeInTheDocument();
    expect(within(apps).queryByRole('button', { name: /All apps/ })).not.toBeInTheDocument();
  });

  it('with more than fit, opens the rest as a folder you can search', async () => {
    const user = userEvent.setup();
    const { where } = dock(pinned(12));
    const apps = await screen.findByRole('region', { name: 'Pinned apps' });
    // Two rows: seven apps and the folder.
    expect(within(apps).getAllByRole('button')).toHaveLength(8);
    expect(within(apps).queryByRole('button', { name: 'Page 9' })).not.toBeInTheDocument();

    await user.click(within(apps).getByRole('button', { name: /All apps/ }));
    const folder = await screen.findByRole('dialog', { name: 'Apps' });
    expect(within(folder).getAllByRole('button', { name: /^Page \d+$/ })).toHaveLength(12);

    await user.type(within(folder).getByRole('searchbox', { name: 'Search apps' }), 'page 9');
    const found = within(folder).getByRole('button', { name: 'Page 9' });
    await user.click(found);
    // It opens on its own page, and the folder folds away.
    expect(where()).toBe('/apps/a_9');
    expect(screen.queryByRole('dialog', { name: 'Apps' })).not.toBeInTheDocument();
  });

  it('puts the apps you open in the row, so they are there next time', async () => {
    const user = userEvent.setup();
    const first = dock(pinned(12));
    const apps = await screen.findByRole('region', { name: 'Pinned apps' });
    await user.click(within(apps).getByRole('button', { name: /All apps/ }));
    const folder = await screen.findByRole('dialog', { name: 'Apps' });
    await user.click(within(folder).getByRole('button', { name: 'Page 11' }));
    first.unmount();

    dock(pinned(12));
    const again = await screen.findByRole('region', { name: 'Pinned apps' });
    expect(within(again).getByRole('button', { name: 'Page 11' })).toBeInTheDocument();
  });
});
