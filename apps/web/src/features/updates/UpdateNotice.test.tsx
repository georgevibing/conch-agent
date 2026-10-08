import type { UpdatesStatus } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { UpdateNotice } from './UpdateNotice';

afterEach(() => useUi.setState({ settingsFocus: undefined, updateDialog: undefined }));

function status(announce: boolean): UpdatesStatus {
  return {
    conch: {
      checkable: true,
      version: '0.2.0',
      behind: 1,
      improvements: 1,
      whatsNew: [],
      restartNeeded: false,
      source: 'releases',
      channel: 'stable',
      everyChange: false,
      latest: { version: '0.3.0', channel: 'stable' },
      releases: [],
      announce,
      failed: [],
    },
    programs: [],
    checking: false,
    auto: false,
    restartable: true,
  };
}

describe('the new-release banner', () => {
  it('says a release is ready, opens the update dialog, and is put away for that version', async () => {
    const user = userEvent.setup();
    let announce = true;
    const calls = mockFetch({
      'GET /api/updates': () => status(announce),
      'PATCH /api/updates/settings': () => {
        announce = false;
        return status(false);
      },
    });
    renderApp(<UpdateNotice />);
    expect(await screen.findByRole('region', { name: 'Conch 0.3 is ready' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    expect(useUi.getState().updateDialog).toEqual({});
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(useUi.getState().updateDialog).toEqual({ start: true });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ dismiss: '0.3.0' });
  });

  it('stays quiet when nothing new is waiting', async () => {
    mockFetch({ 'GET /api/updates': () => status(false) });
    renderApp(<UpdateNotice />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('a newer web app under an open page', () => {
  const built = (webBuilt?: string): UpdatesStatus => ({
    ...status(false),
    ...(webBuilt && { webBuilt }),
  });

  it('offers to reload when the app was built again since this page loaded', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    mockFetch({ 'GET /api/updates': () => built('2026-10-08T10:00:00.000Z') });
    renderApp(<UpdateNotice ownBuild="2026-10-01T09:00:00.000Z" reload={reload} />);
    const banner = await screen.findByRole('region', { name: 'A newer Conch is ready' });
    await user.click(within(banner).getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    await user.click(within(banner).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  });

  it('reloads by itself when a page nobody was looking at is opened again', async () => {
    const reload = vi.fn();
    mockFetch({ 'GET /api/updates': () => built('2026-10-08T10:00:00.000Z') });
    renderApp(<UpdateNotice ownBuild="2026-10-01T09:00:00.000Z" reload={reload} />);
    await screen.findByRole('region', { name: 'A newer Conch is ready' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('stays quiet on the same build, and in development', async () => {
    const reload = vi.fn();
    mockFetch({ 'GET /api/updates': () => built('2026-10-08T10:00:00.000Z') });
    renderApp(<UpdateNotice ownBuild="2026-10-08T10:00:00.000Z" reload={reload} />);
    renderApp(<UpdateNotice reload={reload} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region')).toBeNull();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).not.toHaveBeenCalled();
  });
});
