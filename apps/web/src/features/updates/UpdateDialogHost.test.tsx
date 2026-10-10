import type { UpdatesStatus } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { RestartWatch } from '../health/RestartWatch';
import { Sidebar } from '../sidebar/Sidebar';
import { UpdateDialogHost } from './UpdateDialogHost';
import { conchCard } from '../health/UpdatesSection';
import { ARRIVED, chipView, confirmText, updateView } from './view';

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
      channels: [],
      channelChosen: false,
      canFollowReleases: false,
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
    expect(dialog).toHaveAccessibleDescription('You have Dev · a1b2c3d → f00ba12');
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
    expect(dialog).toHaveAccessibleDescription(/^2 improvements\s· Updated to a1b2c3d$/);
    expect(within(dialog).getByText('What’s new')).toBeVisible();
    expect(sessionStorage.getItem(ARRIVED)).toBeNull();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('updating while a chat is working', () => {
  const working = [{ id: 'c1', title: 'Fix Conch CI failures' }];

  it('asks first, in place, naming the chat, and updates anyway when you say so', async () => {
    const user = userEvent.setup();
    let current = status(ready, { working });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => current,
      'POST /api/updates/conch': (body) => {
        if ((body as { when?: string }).when !== 'anyway')
          return new Response(JSON.stringify({ error: 'busy', message: 'Busy.' }), {
            status: 409,
          });
        current = status({
          ...ready,
          running: { phase: 'fetch', label: 'Getting the update', step: 1, steps: 3 },
        });
        return current;
      },
    });
    useUi.getState().openUpdate();
    renderApp(<App />);
    const dialog = await screen.findByRole('dialog', { name: '16 improvements are ready' });
    await user.click(within(dialog).getByRole('button', { name: 'Update now' }));
    // A press always answers: the question, in the same dialog, naming what's working.
    expect(
      within(dialog).getByText(
        'Fix Conch CI failures is working. Update anyway? It will pause, and carry on after Conch restarts.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Wait until it’s done' })).toHaveFocus();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Update anyway' }));
    expect(calls.filter((c) => c.path === '/api/updates/conch').map((c) => c.body)).toEqual([
      { when: 'anyway' },
    ]);
    expect(await screen.findByRole('dialog', { name: 'Updating Conch' })).toBeVisible();
  });

  it('asks too when the gateway is the first to know a chat is working', async () => {
    const user = userEvent.setup();
    let current = status(ready);
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => current,
      'POST /api/updates/conch': () => {
        current = status(ready, { working });
        return new Response(JSON.stringify({ error: 'busy', message: 'Busy.' }), {
          status: 409,
        });
      },
    });
    useUi.getState().openUpdate();
    renderApp(<App />);
    const dialog = await screen.findByRole('dialog', { name: '16 improvements are ready' });
    await user.click(within(dialog).getByRole('button', { name: 'Update now' }));
    expect(await within(dialog).findByText(/^Fix Conch CI failures is working\./)).toBeVisible();
  });

  it('waits until it’s done: a quiet line here and in Health, and a way to stop waiting', async () => {
    const user = userEvent.setup();
    let current = status(ready, { working });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => current,
      'POST /api/updates/conch': (body) => {
        const when = (body as { when?: string }).when;
        current =
          when === 'idle'
            ? status({ ...ready, armed: { at: Date.now() } }, { working })
            : status(ready, { working });
        return current;
      },
    });
    useUi.getState().openUpdate();
    renderApp(<App />);
    const dialog = await screen.findByRole('dialog', { name: '16 improvements are ready' });
    await user.click(within(dialog).getByRole('button', { name: 'Update now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Wait until it’s done' }));
    expect(await within(dialog).findByText('Will update when the chat finishes')).toBeVisible();
    expect(within(dialog).queryByText(/Update anyway\?/)).toBeNull();
    expect(updateView(current).offers).toEqual(['stop-waiting', 'update']);
    expect(conchCard(current.conch, { restartable: true, working }).footnote).toBe(
      'Will update when the chat finishes',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Don’t wait' }));
    expect(calls.filter((c) => c.path === '/api/updates/conch').map((c) => c.body)).toEqual([
      { when: 'idle' },
      { when: 'cancel' },
    ]);
    await waitFor(() =>
      expect(within(dialog).queryByText('Will update when the chat finishes')).toBeNull(),
    );
  });
});

describe('confirmText', () => {
  it('names what’s working, one or several', () => {
    expect(confirmText(undefined)).toMatch(/^Something is still working\. Update anyway\?/);
    expect(
      confirmText([
        { id: 'a', title: 'Fix Conch CI failures' },
        { id: 'b', title: 'Weekly note' },
        { id: 'c', title: 'Inbox' },
      ]),
    ).toBe(
      'Fix Conch CI failures and 2 more chats are working. Update anyway? They’ll pause, and carry on after Conch restarts.',
    );
    expect(confirmText([{ id: 'a', title: 'Tidy' }], 'Restart')).toMatch(
      /^Tidy is working\. Restart anyway\?/,
    );
  });
});

describe('noticing a new Conch', () => {
  it('asks for a quick look when the page opens, and not again at once when it comes back', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => status(),
      // It answers at once with what it knew; what the look finds arrives live.
      'POST /api/updates/look': () => status(),
    });
    renderApp(<App />);
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/updates/look')).toHaveLength(1),
    );
    act(() =>
      FakeSocket.last?.push({
        type: 'updates.changed',
        status: status({ behind: 4, improvements: 4, whatsNew: ['Attach files to a message'] }),
      }),
    );
    // What the look found shows at once: the button beside your name.
    expect(
      await screen.findByRole('button', { name: 'Update Conch: 4 improvements' }),
    ).toBeVisible();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.filter((c) => c.path === '/api/updates/look')).toHaveLength(1);
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
      detail: 'You have Dev · a1b2c3d',
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

describe('installed build and future channel are independent', () => {
  it('keeps a Dev build labelled Dev while following releases', () => {
    expect(
      updateView(
        status({ source: 'releases', channel: 'beta', build: { kind: 'dev', commit: 'abcdef0' } }),
      ).detail,
    ).toBe('You have Dev · abcdef0');
  });
  it.each(['0.1.0', '0.1.0-alpha.1', '0.1.0-beta.2'])(
    'shows the actual release %s after choosing another channel',
    (version) => {
      expect(
        updateView(
          status({
            source: 'releases',
            channel: 'stable',
            build: {
              kind: 'release',
              version,
              channel: version.includes('alpha')
                ? 'alpha'
                : version.includes('beta')
                  ? 'beta'
                  : 'stable',
            },
          }),
        ).detail,
      ).toBe(`You have v${version}`);
    },
  );
});
