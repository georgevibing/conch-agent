import type { UpdatesStatus } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { Sidebar } from '../sidebar/Sidebar';
import { HealthTab } from './HealthTab';
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
    await waitFor(() =>
      expect(useUi.getState().restarting).toEqual({ title: 'Updating Conch…', from: 'boot-1' }),
    );
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
