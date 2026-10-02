import type { UpdatesStatus } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../../app/ui';
import { mockFetch, renderApp } from '../../test/harness';
import { UpdateNotice } from './UpdateNotice';

afterEach(() => useUi.setState({ settings: null, settingsFocus: undefined }));

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
  it('says a release is ready, opens Updates, and is put away for that version', async () => {
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
    expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'updates' });
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(useUi.getState()).toMatchObject({ settingsFocus: 'update-conch' });
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
