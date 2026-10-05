import type { UpdatesStatus } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { RestartWatch } from '../health/RestartWatch';
import { Sidebar } from '../sidebar/Sidebar';
import { UpdateDialogHost } from './UpdateDialogHost';
import { ARRIVED, chipView, updateView } from './view';

afterEach(() => {
  useUi.setState({ restarting: undefined, restartSlow: false, updateDialog: undefined });
  sessionStorage.clear();
});

const HOUR = 3_600_000;

function status(conch: Partial<UpdatesStatus['conch']> = {}, patch: Partial<UpdatesStatus> = {}) {
  const base: UpdatesStatus = {
    conch: {
      checkable: true,
      version: '0.4.2',
      commit: 'a1b2c3d',
      target: 'f00ba12',
      branch: 'main',
      behind: 0,
      improvements: 0,
      whatsNew: [],
      checkedAt: Date.now() - 2 * HOUR,
      restartNeeded: false,
      source: 'branch',
      channel: 'stable',
      everyChange: true,
      releases: [],
      announce: false,
      failed: [],
      ...conch,
    },
    programs: [],
    checking: false,
    auto: false,
    bootId: 'boot-1',
    restartable: true,
  };
  return { ...base, ...patch };
}

const ready = {
  behind: 18,
  improvements: 16,
  whatsNew: ['Attach files to a message', 'Terminals heal themselves'],
};

const App = () => (
  <>
    <Sidebar />
    <UpdateDialogHost />
    <RestartWatch />
  </>
);

describe('the update dialog', () => {
  it('is one press away beside your name, says what’s coming, and updates', async () => {
    const user = userEvent.setup();
    let current = status(ready);
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => current,
      'POST /api/updates/conch': () => {
        current = status({
          ...ready,
          running: {
            phase: 'build',
            label: 'Getting the new look ready',
            step: 3,
            steps: 3,
            percent: 40,
          },
        });
        return current;
      },
    });
    renderApp(<App />);
    await user.click(await screen.findByRole('button', { name: 'Update Conch: 16 improvements' }));
    const dialog = await screen.findByRole('dialog', { name: '16 improvements are ready' });
    expect(dialog).toHaveAccessibleDescription('You have 0.4.2 · main a1b2c3d → f00ba12');
    expect(within(dialog).getByText('Attach files to a message')).toBeVisible();
    expect(within(dialog).getByText('and 14 more changes')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Update now' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/conch')).toBe(true);
    const updating = await screen.findByRole('dialog', { name: 'Updating Conch' });
    // Step 3 of 3, 40% through it: two thirds and a bit.
    expect(updating).toHaveAccessibleDescription('Getting the new look ready · Step 3 of 3 · 80%');
    expect(within(updating).getByText('Coming with this update')).toBeVisible();

    // Kept working: the chip says how far it's come.
    await user.click(within(updating).getByRole('button', { name: 'Keep working' }));
    expect(await screen.findByRole('button', { name: 'Updating Conch, 80%' })).toBeVisible();
  });

  it('is where Conch starts again, and the page comes back to say what arrived', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => status(ready),
      'GET /api/health': () => ({ ok: true, bootId: 'boot-1' }),
    });
    useUi.getState().openUpdate();
    renderApp(<App />);
    await screen.findByRole('dialog', { name: '16 improvements are ready' });
    act(() =>
      FakeSocket.last?.push({
        type: 'updates.changed',
        status: status({
          ...ready,
          running: { phase: 'restart', label: 'Updating Conch…', percent: 100 },
        }),
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Starting the new Conch' });
    expect(dialog).toHaveAccessibleDescription('A few seconds. Your chats are safe.');
    expect(useUi.getState().restarting).toMatchObject({ update: true, from: 'boot-1' });
    // The dialog is the calm screen while it's open: no second one over it.
    expect(document.querySelectorAll('[role="status"][data-state="waiting"]')).toHaveLength(0);
  });

  it('says what arrived once the page is back on the new version', async () => {
    sessionStorage.setItem(ARRIVED, '1');
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () =>
        status({
          outcome: {
            kind: 'updated',
            message: 'Conch was updated.',
            at: Date.now() - 5_000,
            whatsNew: ready.whatsNew,
            releases: [],
          },
        }),
    });
    renderApp(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'You’re on the new Conch' });
    expect(dialog).toHaveAccessibleDescription('2 improvements · Updated just now');
    expect(within(dialog).getByText('What’s new')).toBeVisible();
    expect(sessionStorage.getItem(ARRIVED)).toBeNull();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('updateView', () => {
  it('says why one press can’t do it, with the command', () => {
    const view = updateView(
      status({ ...ready, blocked: { reason: 'Changes of yours.', command: 'git stash' } }),
    );
    expect(view).toMatchObject({
      stage: 'failed',
      title: 'Conch can’t update by itself',
      notice: { message: 'Changes of yours.', command: 'git stash' },
      offers: ['close'],
    });
  });

  it('tells a try that went back, and offers it again', () => {
    const view = updateView(
      status({
        ...ready,
        outcome: {
          kind: 'rolled-back',
          message: 'The new version wouldn’t build, so Conch went back.',
          at: Date.now() - 60_000,
          whatsNew: [],
          releases: [],
        },
      }),
    );
    expect(view).toMatchObject({ stage: 'failed', offers: ['close', 'retry'] });
  });

  it('names a release, with its notes', () => {
    const view = updateView(
      status({
        behind: 1,
        source: 'releases',
        latest: { version: '0.5.0', channel: 'stable' },
        releases: [
          {
            version: '0.5.0',
            channel: 'stable',
            headsUp: [],
            new: ['Update from anywhere'],
            better: [],
            fixed: [],
          },
        ],
      }),
    );
    expect(view).toMatchObject({
      stage: 'ready',
      title: 'Conch 0.5 is ready',
      detail: 'You have 0.4.2',
      offers: ['later', 'update'],
    });
    expect(view.releases).toHaveLength(1);
  });

  it('offers the download where the app can’t replace itself', () => {
    const view = updateView(
      status({
        behind: 1,
        source: 'releases',
        latest: { version: '0.5.0', channel: 'stable' },
        blocked: { reason: 'Download it.', download: 'https://example.com/r' },
      }),
    );
    expect(view).toMatchObject({
      offers: ['later', 'download'],
      download: 'https://example.com/r',
    });
  });
});

describe('chipView', () => {
  it('shows only when there is something to press or something moving', () => {
    expect(chipView(status())).toBeUndefined();
    expect(chipView(status(ready))).toEqual({
      state: 'ready',
      label: 'Update Conch: 16 improvements',
    });
    expect(
      chipView(status({ ...ready, blocked: { reason: 'Changes of yours.' } })),
    ).toBeUndefined();
    expect(chipView(status({ restartNeeded: true }))).toMatchObject({ state: 'restart' });
  });
});
