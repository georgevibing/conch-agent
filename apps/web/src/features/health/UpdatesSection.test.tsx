import type { UpdatesStatus } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { HealthTab } from './HealthTab';
import { RestartWatch } from './RestartWatch';
import { UpdatesSection } from './UpdatesSection';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ restarting: undefined, settingsFocus: undefined });
});

const HOUR = 3_600_000;

function status(patch: Partial<UpdatesStatus> = {}, conch: Partial<UpdatesStatus['conch']> = {}) {
  const base: UpdatesStatus = {
    conch: {
      checkable: true,
      version: '0.2.0',
      commit: 'abc1234',
      branch: 'main',
      behind: 0,
      improvements: 0,
      whatsNew: [],
      checkedAt: Date.now() - 2 * HOUR,
      restartNeeded: false,
      source: 'branch',
      channel: 'stable',
      everyChange: false,
      releases: [],
      announce: false,
      failed: [],
      ...conch,
    },
    programs: [
      {
        id: 'claude-code',
        name: 'Claude Code',
        installed: '2.1.284',
        latest: '2.1.284',
        available: false,
        canUpdate: true,
        state: 'idle',
      },
      {
        id: 'codex',
        name: 'Codex',
        installed: '0.159.0',
        latest: '0.160.0',
        available: true,
        canUpdate: true,
        state: 'idle',
      },
    ],
    checking: false,
    checkedAt: Date.now() - 2 * HOUR,
    auto: false,
    bootId: 'boot-1',
    restartable: true,
  };
  return { ...base, ...patch };
}

const ready = {
  behind: 12,
  improvements: 9,
  whatsNew: [
    'Attach files, pictures and long pastes to a message',
    'Terminals heal a spawn helper that lost its execute bit',
  ],
};

describe('Settings → Health → Updates', () => {
  it('says Conch is up to date, and when it last looked', async () => {
    mockFetch({ 'GET /api/updates': () => status() });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Conch is up to date' });
    expect(card).toHaveTextContent('0.2.0 · Checked 2 hours ago');
    expect(within(card).queryByRole('button')).toBeNull();
    const programs = screen.getByRole('list', { name: 'Programs Conch uses' });
    expect(programs.children[0]).toHaveTextContent('Claude Code2.1.284Up to date');
    expect(within(programs).getByRole('button', { name: 'Update to 0.160.0' })).toBeInTheDocument();
  });

  it('offers the update with what’s new, and shows real progress once it starts', async () => {
    const user = userEvent.setup();
    let current = status({}, ready);
    const calls = mockFetch({
      'GET /api/updates': () => current,
      'POST /api/updates/conch': () => {
        current = status(
          {},
          {
            ...ready,
            running: { phase: 'install', label: 'Installing', step: 2, steps: 3, percent: 50 },
          },
        );
        return current;
      },
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'An update is ready' });
    expect(card).toHaveTextContent('9 improvements · Checked 2 hours ago');
    expect(card).toHaveTextContent('Conch restarts by itself when it’s done. Your chats are safe.');
    await user.click(within(card).getByRole('button', { name: 'What’s new' }));
    expect(
      within(card).getByText('Attach files, pictures and long pastes to a message'),
    ).toBeVisible();
    expect(within(card).getByText('and 7 more')).toBeVisible();

    await user.click(within(card).getByRole('button', { name: 'Update Conch' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/conch')).toBe(true);
    const progress = await screen.findByRole('progressbar', { name: 'Installing · 2 of 3' });
    // Step 2 of 3, halfway through: half of the middle third.
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('button', { name: 'Update Conch' })).toBeNull();
  });

  it('rests on “Updating Conch…” while Conch starts itself again on the new version', async () => {
    mockFetch({ 'GET /api/updates': () => status({}, ready) });
    useUi.setState({ settings: 'health' });
    renderApp(<UpdatesSection />);
    await screen.findByRole('region', { name: 'An update is ready' });
    act(() =>
      FakeSocket.last?.push({
        type: 'updates.changed',
        status: status(
          {},
          { ...ready, running: { phase: 'restart', label: 'Updating Conch…', percent: 100 } },
        ),
      }),
    );
    // Settings steps aside for the calm screen, and comes back after the reload.
    await waitFor(() =>
      expect(useUi.getState().restarting).toEqual({
        title: 'Updating Conch…',
        from: 'boot-1',
        reopen: 'health',
      }),
    );
    expect(useUi.getState().settings).toBeNull();
  });

  it('opens Health again once the page is back from the restart', async () => {
    mockFetch({ 'GET /api/updates': () => status() });
    sessionStorage.setItem('conch.reopenAfterRestart', 'health');
    renderApp(<RestartWatch />);
    await waitFor(() => expect(useUi.getState().settings).toBe('health'));
    expect(sessionStorage.getItem('conch.reopenAfterRestart')).toBeNull();
    useUi.setState({ settings: null });
  });

  it('says why one press can’t do it, with the command to run by hand', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status(
          {},
          {
            ...ready,
            blocked: {
              reason:
                'Conch’s folder has changes that aren’t saved in git (1 file), so updating by itself could lose them.',
              command:
                'cd "/home/ada/conch"\ngit stash\ngit pull --ff-only\ngit stash pop\npnpm install',
            },
          },
        ),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'An update is ready' });
    expect(card).toHaveTextContent(/changes that aren’t saved in git/);
    expect(card).toHaveTextContent(/git pull --ff-only/);
    expect(within(card).getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Update Conch' })).toBeNull();
  });

  it('says in one sentence that it went back to the version you had, and offers to try again', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status(
          {},
          {
            ...ready,
            outcome: {
              kind: 'rolled-back',
              message:
                'The update didn’t install (the new version wouldn’t build), so Conch went back to the version you had.',
              at: Date.now(),
              whatsNew: [],
              releases: [],
            },
          },
        ),
    });
    renderApp(<UpdatesSection />);
    expect(await screen.findByRole('status')).toHaveTextContent(/went back to the version you had/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says how to finish when Conch can’t restart itself', async () => {
    mockFetch({
      'GET /api/updates': () => status({ restartable: false }, { restartNeeded: true }),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Restart Conch to finish' });
    expect(card).toHaveTextContent('Stop Conch and run pnpm start');
    expect(within(card).queryByRole('button', { name: 'Restart Conch' })).toBeNull();
  });

  it('offers to restart when the folder moved on under a Conch that can restart itself', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/updates': () => status({}, { restartNeeded: true }),
      'GET /api/health': () => ({
        ok: true,
        serverVersion: '0.2.0',
        protocolVersion: 7,
        bootId: 'boot-1',
      }),
      'POST /api/gateway/restart': () => ({ ok: true }),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Restart Conch to finish' });
    await user.click(within(card).getByRole('button', { name: 'Restart Conch' }));
    await waitFor(() =>
      expect(useUi.getState().restarting).toMatchObject({
        title: 'Updating Conch…',
        from: 'boot-1',
      }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/gateway/restart')).toBe(true);
  });

  it('asks you to confirm it’s you before restarting, when it’s been a while', async () => {
    const user = userEvent.setup();
    let verified = false;
    const calls = mockFetch({
      'GET /api/updates': () => status({}, { restartNeeded: true }),
      'GET /api/auth': () => ({
        method: 'password',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'GET /api/health': () => ({
        ok: true,
        serverVersion: '0.2.0',
        protocolVersion: 7,
        bootId: 'boot-1',
      }),
      'POST /api/gateway/restart': () =>
        verified
          ? { ok: true }
          : new Response(
              JSON.stringify({
                error: 'verify-required',
                message: 'Confirm it’s you to restart Conch.',
              }),
              { status: 403 },
            ),
      'POST /api/access/verify': () => {
        verified = true;
        return {
          method: 'password',
          username: 'ada',
          suggestedUsername: 'ada',
          keys: [],
          sessions: [],
          devices: [],
          requests: [],
          approval: { on: false, here: true },
          checkup: [],
          exposure: 'local',
          port: 4317,
          urls: [],
          verified: true,
        };
      },
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Restart Conch to finish' });
    await user.click(within(card).getByRole('button', { name: 'Restart Conch' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    await user.type(within(confirm).getByLabelText('Password'), 'purple otters juggle at dawn');
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(useUi.getState().restarting?.title).toBe('Updating Conch…'));
    expect(calls.filter((c) => c.path === '/api/gateway/restart')).toHaveLength(2);
  });

  it('says so, and doesn’t restart, while a chat is working', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/updates': () => status({}, { restartNeeded: true }),
      'GET /api/health': () => ({
        ok: true,
        serverVersion: '0.2.0',
        protocolVersion: 7,
        bootId: 'boot-1',
      }),
      'POST /api/gateway/restart': () =>
        new Response(
          JSON.stringify({
            error: 'busy',
            message: 'A chat is still working. Wait for it to finish, then restart Conch.',
          }),
          { status: 409 },
        ),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Restart Conch to finish' });
    await user.click(within(card).getByRole('button', { name: 'Restart Conch' }));
    expect(
      await screen.findByText(
        'A chat is still working. Wait for it to finish, then restart Conch.',
      ),
    ).toBeInTheDocument();
    expect(useUi.getState().restarting).toBeUndefined();
  });

  it('offers the update rather than a restart when something newer waits', async () => {
    mockFetch({ 'GET /api/updates': () => status({}, { ...ready, restartNeeded: true }) });
    renderApp(<UpdatesSection />);
    expect(await screen.findByRole('region', { name: 'An update is ready' })).toBeInTheDocument();
  });

  it('shows that it just updated, and what that brought', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status(
          {},
          {
            outcome: {
              kind: 'updated',
              message: 'Conch was updated.',
              at: Date.now() - 60_000,
              whatsNew: ['A calmer restart screen'],
              releases: [],
            },
          },
        ),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Conch is up to date' });
    expect(card).toHaveTextContent('0.2.0 · Updated 1 minute ago');
    expect(
      within(card).getByRole('button', { name: 'What’s new in this update' }),
    ).toBeInTheDocument();
  });

  it('updates programs one press each, or all at once, with their progress', async () => {
    const user = userEvent.setup();
    const both = status({
      programs: [
        ...status().programs.slice(1),
        {
          id: 'uv',
          name: 'uv',
          installed: '0.8.3',
          latest: '0.8.4',
          available: true,
          canUpdate: true,
          state: 'idle',
        },
      ],
    });
    let current = both;
    const calls = mockFetch({
      'GET /api/updates': () => current,
      'POST /api/updates/programs/codex': () => {
        current = {
          ...both,
          programs: [
            {
              ...(both.programs[0] as UpdatesStatus['programs'][number]),
              state: 'updating',
              progress: { percent: 40, label: 'Downloading Codex · 40%' },
            },
            { ...(both.programs[1] as UpdatesStatus['programs'][number]), state: 'queued' },
          ],
        };
        return current;
      },
      'POST /api/updates/programs': () => both,
    });
    renderApp(<UpdatesSection />);
    await user.click(await screen.findByRole('button', { name: 'Update all' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/programs')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Update to 0.160.0' }));
    expect(
      await screen.findByRole('progressbar', { name: 'Downloading Codex · 40%' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Programs Conch uses' })).toHaveTextContent('Waiting…');
  });

  it('says why a program didn’t update, and offers to try again', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status({
          programs: [
            {
              ...(status().programs[1] as UpdatesStatus['programs'][number]),
              problem: 'Couldn’t download Codex: the internet seems to be unreachable.',
            },
          ],
        }),
    });
    renderApp(<UpdatesSection />);
    expect(await screen.findByText(/internet seems to be unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('checks now, quietly', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/updates': () => status(),
      'POST /api/updates/check': () => status({ checking: true }),
    });
    renderApp(<UpdatesSection />);
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/check')).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check now' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
  });

  it('turns automatic updates on (after confirming it’s you) and off', async () => {
    const user = userEvent.setup();
    let auto = false;
    const calls = mockFetch({
      'GET /api/updates': () => status({ auto }),
      'PATCH /api/updates/settings': (body) => {
        auto = (body as { auto: boolean }).auto;
        return status({ auto });
      },
    });
    renderApp(<UpdatesSection />);
    const toggle = await screen.findByRole('switch', {
      name: /Keep the programs Conch uses up to date/,
    });
    expect(
      screen.getByText(/Conch itself always asks first, since it restarts/),
    ).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ auto: true });
  });

  it('says nothing of Conch’s version when it can’t update itself here', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status(
          { programs: [] },
          {
            checkable: false,
            problem:
              'Conch isn’t running from a folder it can update, so it can’t check for its own updates.',
          },
        ),
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Conch 0.2.0' });
    expect(card).toHaveTextContent(/isn’t running from a folder it can update/);
    expect(screen.queryByRole('list', { name: 'Programs Conch uses' })).toBeNull();
  });
});

describe('quiet signals when updates wait', () => {
  it('puts a dot on Settings and a line at the top of Health, and nothing else', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => status({}, ready),
    });
    renderApp(
      <>
        <Sidebar />
        <HealthTab />
      </>,
    );
    expect(
      await screen.findByRole('button', { name: 'Settings, Update available' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Update available')).toBeInTheDocument();
    expect(screen.getByText('for Conch and Codex')).toBeInTheDocument();
  });

  it('shows no dot when everything is up to date', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/updates': () => status({ programs: [] }),
    });
    renderApp(<Sidebar />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Update available/ })).toBeNull();
  });

  it('starts Conch’s update when ⌘K asked for it', async () => {
    const calls = mockFetch({
      'GET /api/updates': () => status({}, ready),
      'POST /api/updates/conch': () => status({}, ready),
    });
    useUi.setState({ settingsFocus: 'update-conch' });
    renderApp(<UpdatesSection />);
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === 'POST' && c.path === '/api/updates/conch'),
      ).toHaveLength(1),
    );
    expect(useUi.getState().settingsFocus).toBeUndefined();
  });
});

/** Conch following its releases (ADR 0048). */
const notes = (version: string, line: string, extra = {}) => ({
  version,
  channel: 'stable' as const,
  headsUp: [],
  new: [line],
  better: [],
  fixed: [],
  ...extra,
});
const onReleases = (conch: Partial<UpdatesStatus['conch']> = {}) =>
  status(
    {},
    {
      source: 'releases',
      branch: undefined,
      commit: undefined,
      ...conch,
    },
  );

describe('Settings → Health → Updates, following releases', () => {
  it('names the release, shows each version’s notes newest first, and updates with one press', async () => {
    const user = userEvent.setup();
    let current = onReleases({
      behind: 2,
      latest: { version: '0.4.0', channel: 'stable' },
      releases: [
        notes('0.4.0', 'Edit pages by hand, with a live preview', {
          headsUp: ['Sign in again on your phone'],
        }),
        notes('0.3.0', 'Connect iMessage and email'),
      ],
      announce: true,
    });
    const calls = mockFetch({
      'GET /api/updates': () => current,
      'POST /api/updates/conch': () => {
        current = onReleases({
          ...current.conch,
          running: { phase: 'install', label: 'Installing', step: 2, steps: 4, percent: 0 },
        });
        return current;
      },
    });
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Conch 0.4 is ready' });
    expect(card).toHaveTextContent('You have 0.2.0 · Checked 2 hours ago');
    await user.click(within(card).getByRole('button', { name: 'What’s new' }));
    expect(within(card).getByText('Edit pages by hand, with a live preview')).toBeVisible();
    expect(within(card).getByRole('note')).toHaveTextContent('Heads upSign in again on your phone');
    // The older release is folded away until asked for.
    expect(within(card).queryByText('Connect iMessage and email')).toBeNull();
    await user.click(within(card).getByRole('button', { name: /^Conch 0\.3/ }));
    expect(within(card).getByText('Connect iMessage and email')).toBeVisible();
    // No developer's switch for someone on releases.
    expect(screen.queryByRole('switch', { name: /Every change on main/ })).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Update Conch' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/conch')).toBe(true);
    expect(
      await screen.findByRole('progressbar', { name: 'Installing · 2 of 4' }),
    ).toBeInTheDocument();
  });

  it('chooses a channel, and says when going back to stable waits', async () => {
    const user = userEvent.setup();
    let current = onReleases({ version: '0.4.0-beta.2', channel: 'beta' });
    const calls = mockFetch({
      'GET /api/updates': () => current,
      'PATCH /api/updates/settings': () => {
        current = onReleases({
          version: '0.4.0-beta.2',
          channel: 'stable',
          waiting:
            'You’re on 0.4.0-beta.2. Conch moves to stable releases with the next one after it (0.4.0 or later): it never goes back a version by itself.',
        });
        return current;
      },
    });
    renderApp(<UpdatesSection />);
    const group = await screen.findByRole('radiogroup', { name: 'Which releases Conch gets' });
    expect(within(group).getByRole('radio', { name: 'Beta' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Stable' }));
    expect(
      calls.some(
        (c) =>
          c.method === 'PATCH' &&
          c.path === '/api/updates/settings' &&
          (c.body as Record<string, unknown> | undefined)?.channel === 'stable',
      ),
    ).toBe(true);
    expect(await screen.findByText(/never goes back a version by itself/)).toBeVisible();
  });

  it('refuses a release that isn’t signed, in plain words', async () => {
    mockFetch({
      'GET /api/updates': () =>
        onReleases({ refused: 'Conch 0.4.0 isn’t signed, so Conch won’t install it.' }),
    });
    renderApp(<UpdatesSection />);
    expect(
      await screen.findByText(/0\.4\.0 isn’t signed, so Conch won’t install it/),
    ).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Conch is up to date' })).toBeInTheDocument();
  });

  it('says once that Conch now follows releases, and offers going back to the version before', async () => {
    const user = userEvent.setup();
    let current = onReleases({
      version: '0.4.0',
      previous: '0.3.0',
      notice: {
        id: 'releases',
        message: 'Conch now follows its releases instead of every change.',
      },
    });
    const calls = mockFetch({
      'GET /api/updates': () => current,
      'PATCH /api/updates/settings': () => {
        current = onReleases({ version: '0.4.0', previous: '0.3.0' });
        return current;
      },
      'POST /api/updates/conch/back': () => current,
    });
    renderApp(<UpdatesSection />);
    expect(await screen.findByText(/now follows its releases/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByText(/now follows its releases/)).toBeNull());
    expect(
      calls.some(
        (c) => (c.body as Record<string, unknown> | undefined)?.dismissNotice === 'releases',
      ),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Go back to 0.3.0' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/updates/conch/back')).toBe(
      true,
    );
  });

  it('shows what the update brought, from its notes', async () => {
    mockFetch({
      'GET /api/updates': () =>
        onReleases({
          version: '0.4.0',
          outcome: {
            kind: 'updated',
            message: 'Conch was updated to 0.4.0.',
            at: Date.now() - 60_000,
            whatsNew: [],
            releases: [notes('0.4.0', 'Edit pages by hand, with a live preview')],
          },
        }),
    });
    const user = userEvent.setup();
    renderApp(<UpdatesSection />);
    const card = await screen.findByRole('region', { name: 'Conch is up to date' });
    expect(card).toHaveTextContent('0.4.0 · Updated 1 minute ago');
    await user.click(within(card).getByRole('button', { name: 'What’s new in this update' }));
    expect(within(card).getByText('Edit pages by hand, with a live preview')).toBeVisible();
  });

  it('keeps the developer’s switch for a copy that follows its branch', async () => {
    mockFetch({
      'GET /api/updates': () =>
        status(
          {},
          {
            branch: 'my-idea',
            sourceWhy: 'This copy is on the branch “my-idea”, so it follows that branch.',
          },
        ),
    });
    renderApp(<UpdatesSection />);
    expect(await screen.findByText(/follows that branch/)).toBeVisible();
    expect(screen.getByRole('switch', { name: /Every change on main/ })).toBeInTheDocument();
  });
});
