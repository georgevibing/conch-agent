import type { SearchPreview, SearchResults, TerminalStatus } from '@conch/protocol';
import { act, configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { Palette } from './Palette';

// Search waits on a debounce and a round trip; under a full parallel run that takes longer than 1 s.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ paletteOpen: false, find: null, terminalOpen: false });
});

const conversation = (id: string, title: string, updatedAt = Date.now()) => ({
  id,
  title,
  preview: '',
  createdAt: updatedAt,
  updatedAt,
  status: 'idle' as const,
  options: {},
});

const results: SearchResults = {
  query: 'redeploy',
  mode: 'exact',
  total: 2,
  capped: false,
  tookMs: 1,
  groups: [
    {
      conversationId: 'c2',
      title: 'Infra notes',
      updatedAt: Date.now(),
      matches: 2,
      hits: [
        {
          conversationId: 'c2',
          anchor: 'm1',
          role: 'assistant',
          at: Date.now(),
          snippet: 'Run the redeploy script again',
          ranges: [[8, 16]],
        },
        {
          conversationId: 'c2',
          anchor: 'u2',
          role: 'user',
          at: Date.now(),
          snippet: 'redeploy failed',
          ranges: [[0, 8]],
        },
      ],
    },
  ],
};

const preview: SearchPreview = {
  conversationId: 'c2',
  title: 'Infra notes',
  createdAt: 1,
  updatedAt: Date.now(),
  messageCount: 4,
  messages: [
    {
      anchor: 'm1',
      role: 'assistant',
      at: Date.now(),
      text: 'Run the redeploy script again',
      ranges: [[8, 16]],
      focus: true,
      clippedStart: false,
      clippedEnd: false,
    },
  ],
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe('Palette search', () => {
  it('finds chats by title and messages by content, previews, and opens at the message', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        conversation('c1', 'Redeploy the staging stack'),
        conversation('c2', 'Infra notes'),
        conversation('c3', 'Plan my week'),
      ],
      'GET /api/search': () => results,
      'GET /api/search/preview': () => preview,
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    // Empty: recent chats first.
    expect(await screen.findByRole('option', { name: /Plan my week/ })).toBeInTheDocument();

    await user.type(box, 'redeploy');
    expect(
      await screen.findByRole('option', { name: /Redeploy the staging stack/ }),
    ).toBeInTheDocument();
    const hit = await screen.findByRole('option', { name: /Infra notes.*Run the redeploy script/ });
    expect(hit.querySelector('mark')?.textContent).toBe('redeploy');
    expect(screen.getByRole('option', { name: /redeploy failed/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Plan my week/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 messages in 1 chat');
    // Typing under load can show results for "redep" first: wait for the whole word's search.
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/api/search?q=redeploy'))).toBe(true),
    );

    await user.keyboard('{ArrowDown}');
    expect(hit).toHaveAttribute('aria-selected', 'true');
    const pane = await screen.findByRole('region', { name: 'Preview' });
    await waitFor(() => expect(pane).toHaveTextContent('4 messages'));
    expect(pane).toHaveTextContent('Open at this message');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/c/c2'));
    expect(useUi.getState()).toMatchObject({
      paletteOpen: false,
      find: { conversationId: 'c2', query: 'redeploy', target: '[data-anchor="m1"]' },
    });
  });

  it('asks for more characters before searching messages, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [conversation('c1', 'Plan my week')],
      'GET /api/search': () => ({ ...results, query: 'zzqx', groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    await user.type(box, 'zz');
    expect(screen.getByRole('status')).toHaveTextContent('Keep typing to search messages');
    expect(calls.some((c) => c.path.startsWith('/api/search?'))).toBe(false);
    await user.type(box, 'qx');
    // The list re-renders as results settle: look again each time, rather than
    // holding on to a node that a later render may replace.
    await waitFor(() => expect(screen.getByText(/Nothing matches “zzqx”/)).toBeInTheDocument(), {
      timeout: 4000,
    });
  });

  it('says search is catching up while its index rebuilds, not that nothing matches', async () => {
    const user = userEvent.setup();
    let asked = 0;
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () =>
        ++asked === 1
          ? { ...results, groups: [], total: 0, catchingUp: true }
          : { ...results, catchingUp: undefined },
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'redeploy');
    expect(await screen.findByText(/Search is catching up on your chats/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Search is catching up…');
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
    // It asks again by itself, and the results fill in.
    expect(
      await screen.findByRole('option', { name: /Run the redeploy script/ }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 messages in 1 chat');
  });

  it('offers one Repair when search isn’t working, and searches again after it', async () => {
    const user = userEvent.setup();
    let repaired = false;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () =>
        repaired
          ? results
          : new Response(
              JSON.stringify({ error: 'search-unavailable', message: 'Search isn’t working.' }),
              { status: 503 },
            ),
      'POST /api/search/repair': () => {
        repaired = true;
        return { state: 'catching-up' };
      },
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'redeploy');
    const repair = await screen.findByRole('button', { name: 'Repair search' });
    expect(await screen.findByText(/Repair rebuilds it from your chats/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Search isn’t working right now'),
    );
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
    // Not retried on its own: only a person's Repair tries again. (Under load the typing
    // can also search a part of the word first; the whole word is searched once.)
    expect(calls.filter((c) => /^\/api\/search\?q=redeploy(&|$)/.test(c.path))).toHaveLength(1);
    await user.click(repair);
    expect(
      await screen.findByRole('option', { name: /Run the redeploy script/ }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/search/repair')).toBe(true);
  });

  it('finds skills, models from every provider, and settings by name', async () => {
    const user = userEvent.setup();
    const model = (id: string, label: string) => ({
      id,
      label,
      description: '',
      efforts: [],
      supportsFastMode: false,
      supportsAutoMode: false,
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/skills': () => ({
        skills: [
          {
            id: 'weekly-review',
            name: 'weekly-review',
            title: 'Weekly review',
            description: 'Drafts a weekly review. Use when asked.',
            source: 'conch',
            sourceLabel: 'Conch',
            editable: true,
            mode: 'auto',
            path: '/x',
            files: [],
            updatedAt: 1,
          },
        ],
        sources: [],
      }),
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'claude-code',
            label: 'Claude Code',
            models: [model('opus', 'Opus 5.5')],
            commands: [],
            permissionModes: ['default'],
          },
          {
            engine: 'openrouter',
            label: 'OpenRouter',
            models: [model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder')],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');

    await user.type(box, 'weekly');
    const skill = await screen.findByRole('option', { name: /Weekly review/ });
    expect(skill).toHaveTextContent('/weekly-review');
    await user.keyboard('{Enter}');
    // Into the composer of a new chat, ready for details.
    await waitFor(() => expect(useUi.getState().composerText).toBe('/weekly-review '));

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'qwen');
    expect(await screen.findByRole('option', { name: /Qwen3 Coder/ })).toHaveTextContent(
      'OpenRouter',
    );

    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'providers');
    expect(await screen.findByRole('option', { name: /Settings: Providers/ })).toBeInTheDocument();

    // Something's broken: "repair" (or "fix") finds the one button for everything.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'fix');
    expect(await screen.findByRole('option', { name: /Repair everything/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'backup');
    expect(await screen.findByRole('option', { name: /Settings: Health/ })).toBeInTheDocument();
    // Offline, or at a limit: "offline" finds where to choose what happens.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'offline');
    expect(
      await screen.findByRole('option', { name: /When a provider can’t answer/ }),
    ).toBeInTheDocument();

    // Keywords count by whole-word prefix, not scattered letters.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'forget');
    expect(await screen.findByRole('option', { name: /Settings: Memory/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'meet');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Settings: Memory/ })).toBeNull(),
    );

    // Where apps you muted in a chat can be suggested again.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'suggestions');
    expect(
      await screen.findByRole('option', { name: /Settings: Models & modes/ }),
    ).toBeInTheDocument();

    // The browser's settings answer to the words people use for it.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'cookies');
    expect(await screen.findByRole('option', { name: /Settings: Browser/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(useUi.getState().settings).toBe('browser'));
  });

  it('finds devices and approving them, straight into Settings → Security → Devices', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['approve', 'devices', 'pending', 'trusted']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Settings: Devices/ })).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(useUi.getState()).toMatchObject({ settings: 'security', settingsFocus: 'devices' }),
    );
    act(() => useUi.setState({ settings: null, settingsFocus: undefined }));
  });

  it('backs up and restores by name, straight into Settings → Health', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'back up');
    expect(await screen.findByRole('option', { name: /Back up now/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'backup' }),
    );

    act(() => useUi.getState().setPalette(true));
    // The words people use: restore, undo, go back, a file they have.
    for (const words of ['restore', 'go back', 'conchbackup']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Restore a backup/ })).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'restore' }),
    );
    act(() => useUi.setState({ settings: null, settingsFocus: undefined }));
  });

  it('finds Always on and quitting by the words people use, straight into Settings → Health', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of [
      'always on',
      'start at login',
      'background',
      'login items',
      'raspberry pi',
    ]) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Always on/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'background' }),
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['tray', 'menu bar']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Settings: Menu bar/ })).toBeInTheDocument();
    }
    for (const words of ['quit', 'shut down']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Quit Conch/ })).toBeInTheDocument();
    }
    act(() => useUi.setState({ settings: null, settingsFocus: undefined, paletteOpen: false }));
  });

  it('finds notifications and adding a phone by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['notifications', 'push', 'lock screen']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Notifications/ }),
      ).toBeInTheDocument();
    }
    for (const words of ['iphone', 'add phone', 'tailscale']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Add your phone/ })).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(useUi.getState()).toMatchObject({ settings: 'security', settingsFocus: 'add-device' }),
    );
    act(() => useUi.setState({ settings: null, settingsFocus: undefined, paletteOpen: false }));
  });

  it('opens the terminal by the words people use for it, and hides it while it’s off', async () => {
    const user = userEvent.setup();
    const terminal = (enabled: boolean): TerminalStatus => ({
      available: enabled,
      unavailable: enabled ? undefined : 'Turned off in Settings › Terminal.',
      backend: 'pty',
      settings: {
        enabled,
        allowRemote: false,
        shell: 'auto',
        fontSize: 13,
        cursorBlink: true,
        screenReader: false,
      },
      shells: [],
      terminals: [],
      remote: false,
      healed: [],
    });
    let enabled = true;
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/terminal': () => terminal(enabled),
    });
    const { client } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'shell');
    expect(await screen.findByRole('option', { name: /Show the terminal/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Settings: Terminal/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Show the terminal/ }));
    expect(useUi.getState().terminalOpen).toBe(true);

    // Turned off, only its settings answer (that's where it turns back on).
    enabled = false;
    await act(() => client.invalidateQueries({ queryKey: ['terminal'] }));
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'terminal');
    expect(await screen.findByRole('option', { name: /Settings: Terminal/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Show the terminal/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /New terminal/ })).toBeNull();
  });

  it('attaches files by the words people use for it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'upload pdf');
    const before = useUi.getState().attachRequest;
    await user.click(await screen.findByRole('option', { name: /Attach files/ }));
    expect(useUi.getState().attachRequest).toBe(before + 1);
  });

  it('finds the model on this computer by the words people use for it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(<Palette />);
    for (const words of ['offline', 'ollama', 'private model', 'local']) {
      act(() => useUi.getState().setPalette(true));
      const box = await screen.findByRole('combobox');
      await user.clear(box);
      await user.type(box, words);
      expect(
        await screen.findByRole('option', { name: /Model on this computer/ }),
      ).toBeInTheDocument();
    }
    await user.click(screen.getByRole('option', { name: /Model on this computer/ }));
    // Straight to its setup page.
    expect(useUi.getState()).toMatchObject({ settings: 'providers', settingsFocus: 'ollama' });
  });

  it('checks for updates, and offers “Update Conch” only when one is ready', async () => {
    const user = userEvent.setup();
    let behind = 0;
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/updates': () => ({
        conch: {
          checkable: true,
          version: '0.2.0',
          behind,
          improvements: behind,
          whatsNew: [],
          restartNeeded: false,
        },
        programs: [],
        checking: false,
        auto: false,
        restartable: true,
      }),
    });
    const { client } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'upgrade');
    expect(await screen.findByRole('option', { name: /Check for updates/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Update Conch/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /Check for updates/ }));
    expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'check-updates' });

    behind = 3;
    await act(() => client.invalidateQueries({ queryKey: ['updates'] }));
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'update conch');
    await user.click(await screen.findByRole('option', { name: /Update Conch/ }));
    expect(useUi.getState()).toMatchObject({ settings: 'health', settingsFocus: 'update-conch' });
    useUi.setState({ settings: null, settingsFocus: undefined });
  });

  it('finds channels: the bots you connected, and each app to connect', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/channels': () => ({
        channels: [
          {
            id: 'ch_1',
            kind: 'telegram',
            enabled: true,
            createdAt: 1,
            bot: { id: '42', name: 'Ada’s Conch', username: 'adas_conch_bot' },
            people: [],
            requests: [],
            blocked: 0,
            settings: { notifyRoutines: true },
            health: { state: 'online' },
          },
        ],
        catalog: [
          {
            id: 'telegram',
            name: 'Telegram',
            tagline: '',
            color: '#26A5E4',
            minutes: 2,
            available: true,
          },
          {
            id: 'discord',
            name: 'Discord',
            tagline: '',
            color: '#5865F2',
            minutes: 4,
            available: true,
          },
          { id: 'signal', name: 'Signal', tagline: '', color: '#3A76F0', available: false },
        ],
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'discord');
    expect(await screen.findByRole('option', { name: /Connect Discord/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'telegram');
    expect(
      await screen.findByRole('option', { name: /Ada’s Conch on Telegram/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Channels/ })).toBeInTheDocument();
    // What's coming isn't offered as if it were here.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'signal');
    expect(screen.queryByRole('option', { name: /Connect Signal/ })).toBeNull();
  });

  it('finds saved passwords by name or site, and opens them', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/vault': () => ({
        items: [
          {
            id: 'pw_netflix',
            source: 'conch',
            type: 'login',
            title: 'Netflix',
            subtitle: 'ada@example.com',
            domains: ['netflix.com'],
            tags: [],
            favorite: false,
            totp: false,
            problems: [],
            readOnly: false,
          },
        ],
        status: {
          protection: 'keychain',
          sources: [],
          health: { weak: 0, reused: 0, compromised: 0, expired: 0, insecure: 0 },
          trash: 0,
        },
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'netflix');
    expect(await screen.findByRole('option', { name: /Netflix/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'generate password');
    expect(await screen.findByRole('option', { name: /Generate a password/ })).toBeInTheDocument();
  });
});
