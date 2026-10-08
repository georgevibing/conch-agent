import type { SearchPreview, SearchResults, TerminalStatus } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { taskKeys } from '../tasks/queries';
import { useHowItDidIt } from '../trajectory/api';
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
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
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
    // Catching up until the whole word has been asked once. Under load the typing can also
    // search a part of the word first; that mustn't use up the catching-up answer.
    let asked = 0;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () =>
        /^\/api\/search\?q=redeploy(&|$)/.test(calls.at(-1)?.path ?? '') && ++asked > 1
          ? { ...results, catchingUp: undefined }
          : { ...results, groups: [], total: 0, catchingUp: true },
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'redeploy');
    expect(await screen.findByText(/Search is catching up on your chats/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Search is catching up…'),
    );
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
    await screen.findByRole('button', { name: 'Repair search' });
    expect(await screen.findByText(/Repair rebuilds it from your chats/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Search isn’t working right now'),
    );
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
    // Not retried on its own: only a person's Repair tries again. (Under load the typing
    // can also search a part of the word first, and show Repair for it; the whole word is
    // then searched once, a moment later.)
    const whole = () => calls.filter((c) => /^\/api\/search\?q=redeploy(&|$)/.test(c.path));
    await waitFor(() => expect(whole()).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Search isn’t working right now'),
    );
    expect(whole()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Repair search' }));
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
            models: [
              model('qwen/qwen3-coder', 'Qwen: Qwen3 Coder'),
              { ...model('liquid/lfm-7b', 'Liquid: LFM 7B'), tools: false },
            ],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
    });
    const { where } = renderApp(
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

    // A model that can only chat says so, and is found by the words (ADR 0050).
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'chat only');
    expect(await screen.findByRole('option', { name: /LFM 7B/ })).toHaveTextContent(
      'Chat only — can’t use your apps',
    );
    expect(screen.queryByRole('option', { name: /Qwen3 Coder/ })).toBeNull();

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
    // How the computer is doing: by the words of the system's own monitors.
    for (const words of ['cpu', 'activity monitor', 'disk space']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: This computer/ }),
      ).toBeInTheDocument();
    }
    // Offline, or at a limit: "offline" finds where to choose what happens.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'offline');
    expect(
      await screen.findByRole('option', { name: /When a provider can’t answer/ }),
    ).toBeInTheDocument();

    // What routines may spend (ADR 0057): Settings → Usage, where the limit is.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'routine spending');
    expect(
      await screen.findByRole('option', { name: /What routines may spend/ }),
    ).toBeInTheDocument();

    // When routines wait for a plan (ADR 0057): the same place, by its own words.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'room for your own chats');
    expect(
      await screen.findByRole('option', { name: /When routines wait for your plan/ }),
    ).toBeInTheDocument();

    // Pausing long turns (ADR 0085): off by default, found by the words for it.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'carry on');
    expect(await screen.findByRole('option', { name: /Pause long turns/ })).toBeInTheDocument();

    // Keywords count by whole-word prefix, not scattered letters.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'forget');
    expect(await screen.findByRole('option', { name: /Settings: Memory/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'meet');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Settings: Memory/ })).toBeNull(),
    );

    // Where apps you muted in a chat can be suggested again (under Models → Advanced).
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'suggestions');
    expect(
      await screen.findByRole('option', { name: 'Settings: Offers in the chat' }),
    ).toBeInTheDocument();

    // The browser's settings answer to the words people use for it.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'cookies');
    expect(
      await screen.findByRole('option', { name: 'Settings: Where the browser runs' }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/settings/browser'));

    // A setting on a simple page is found by its own name, and opens its place.
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'replay welcome');
    expect(await screen.findByRole('option', { name: 'Settings: Start over' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/settings/general'));
    expect(useUi.getState().settingsFocus).toBeUndefined();

    // One under a dense page's Advanced asks for that place with its Advanced open.
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'fast mode');
    expect(
      await screen.findByRole('option', { name: 'Settings: Fast mode and chat names' }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/settings/models'));
    expect(useUi.getState().settingsFocus).toBe('advanced');
  });

  it('finds Discover and skills people share by name, and opens one to read (ADR 0074)', async () => {
    const user = userEvent.setup();
    const listing = {
      id: 'clawhub:ada/meeting-notes',
      source: 'clawhub',
      sourceLabel: 'ClawHub',
      name: 'meeting-notes',
      title: 'Meeting notes',
      description: 'Turns rough meeting notes into actions.',
      publisher: { name: 'Ada' },
      trust: 'verified',
      url: 'https://clawhub.ai/ada/skills/meeting-notes',
    };
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/skills': () => ({ skills: [], sources: [] }),
      'GET /api/skills/market': () => ({ listings: [listing], sources: [] }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'meeting');
    const found = await screen.findByRole('option', { name: /Meeting notes/ });
    expect(found).toHaveTextContent('Discover · ClawHub');
    await user.click(found);
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        `/skills/discover/${encodeURIComponent(listing.id)}`,
      ),
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'marketplace');
    await user.click(await screen.findByRole('option', { name: /Discover skills/ }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/skills\/discover$/),
    );
  });

  it('finds devices and approving them, straight into Settings → Devices', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['approve', 'devices', 'pending', 'trusted', 'lost phone']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Settings: Devices/ })).toBeInTheDocument();
    }
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'approve');
    await screen.findByRole('option', { name: /Settings: Devices/ });
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/devices',
        focus: 'devices',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('finds passkeys by the names people know, straight into Settings → Security → Passkeys', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['fingerprint', 'face id', 'windows hello', 'passkey', 'touch id']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Settings: Passkeys/ })).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/security',
        focus: 'passkeys',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('finds Other apps by the apps people use Conch from (ADR 0073)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['claude desktop', 'cursor', 'vs code', 'mcp server', 'other apps']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Other apps/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/settings/other-apps'));
  });

  it('finds your own address by domain, certificate or HTTPS, straight to its section', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['domain', 'subdomain', 'certificate', 'https', 'lets encrypt']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Your address/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/security',
        focus: 'address',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('starts a new chat in a folder by its name', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/folders': () => [
        { id: 'f_trips1', name: 'Trips', glyph: 'folder', color: 'green', order: 1, createdAt: 0 },
      ],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const seen: unknown[] = [];
    function State() {
      seen.push(useLocation().state);
      return null;
    }
    const { where } = renderApp(
      <>
        <Palette />
        <State />
      </>,
      { route: '/c/c1' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'new chat trips');
    await user.click(await screen.findByRole('option', { name: /New chat in Trips/ }));
    await waitFor(() => expect(where()).toBe('/'));
    expect(seen.at(-1)).toEqual({ folder: 'f_trips1' });
  });

  it('finds your agents by name: a new chat with one, or this chat answered by one (ADR 0101)', async () => {
    const user = userEvent.setup();
    const agent = (id: string, name: string, order: number, role = '') => ({
      id,
      name,
      role,
      avatar: { kind: 'preset', id: 'shell' },
      persona: { tone: 'warm', personality: '' },
      instructions: '',
      isDefault: order === 0,
      order,
      createdAt: 1,
      updatedAt: 1,
    });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [conversation('c1', 'Plan my week')],
      'GET /api/agents': () => ({
        agents: [agent('ag_conch', 'Conch', 0), agent('ag_sage01', 'Sage', 1, 'Plans trips')],
        defaultId: 'ag_conch',
      }),
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'PATCH /api/conversations/c1': () => ({ ok: true }),
    });
    const page = (
      <>
        <Palette />
        <Where />
      </>
    );
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={page} />
        <Route path="*" element={page} />
      </Routes>,
      { route: '/c/c1' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'trips');
    await user.click(await screen.findByRole('option', { name: /Sage.*Answer this chat/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/conversations/c1', body: { agentId: 'ag_sage01' } }),
      ),
    );

    // Beside it: a new chat with Sage, and Sage's own page.
    act(() => useUi.getState().setPalette(true));
    await user.clear(await screen.findByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'sage');
    expect(await screen.findByRole('option', { name: /New chat with Sage/ })).toBeVisible();
    await user.click(screen.getByRole('option', { name: /Edit Sage/ }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/settings/agents/ag_sage01'),
    );

    // Making one, and the place they all live, by the words people use.
    act(() => useUi.getState().setPalette(true));
    await user.clear(await screen.findByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'new agent');
    await user.click(await screen.findByRole('option', { name: /^New agent/ }));
    expect(useUi.getState().newAgent).toEqual({});
    act(() => useUi.getState().closeNewAgent());
    act(() => useUi.getState().setPalette(true));
    await user.clear(await screen.findByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'persona');
    expect(await screen.findByRole('option', { name: /Settings: Agents/ })).toBeVisible();
  });

  it('finds the working folder in General by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['working folder', 'workspace', 'directory']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Working folder/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() => expect(where()).toBe('/settings/general'));
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('finds things made in chats: a pinned app on its page, anything else beside its chat', async () => {
    const user = userEvent.setup();
    const made = (id: string, title: string, pinned?: boolean) => ({
      id,
      title,
      kind: 'chart' as const,
      conversationId: 'c9',
      createdAt: 1,
      updatedAt: 2,
      versions: [{ n: 1, at: 1, size: 1 }],
      ...(pinned && { pinned: { at: 3 } }),
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/artifacts': () => ({
        artifacts: [made('a_1', 'Visitors this week', true), made('a_2', 'Visitors by country')],
      }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'visitors');
    await user.click(
      await screen.findByRole('option', { name: /Visitors this week.*Chart · pinned/ }),
    );
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps/a_1'));

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'country');
    await user.click(await screen.findByRole('option', { name: /Visitors by country/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/c/c9'));
    expect(useUi.getState().artifactOpen).toMatchObject({
      conversationId: 'c9',
      artifactId: 'a_2',
    });
    act(() => useUi.setState({ artifactOpen: null }));
  });

  it('stops holding the open chat to a skill’s list by name (ADR 0047)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    act(() =>
      useLiveStore.getState().apply({
        type: 'skill.used',
        skillId: 'quick-setup',
        name: 'quick-setup',
        title: 'Quick setup',
        by: 'user',
        conversationId: 'c7',
        seq: 0,
        at: 1,
      }),
    );
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c7' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'stop holding');
    await user.click(
      await screen.findByRole('option', { name: /Stop holding this chat to Quick setup’s list/ }),
    );
    expect(useUi.getState().stopHolding).toEqual({ conversationId: 'c7', skillId: 'quick-setup' });
    act(() => useUi.setState({ stopHolding: undefined }));
  });

  it('opens what the open chat spent, and its limit, by name (ADR 0079)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c7' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'spending limit');
    await user.click(await screen.findByRole('option', { name: /What this chat spent/ }));
    expect(useUi.getState().chatSpendOpen).toBe('c7');
    act(() => useUi.setState({ chatSpendOpen: null }));
  });

  it('summarises the start of the open chat by name, as /compact does (ADR 0055)', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'POST /api/conversations/c7/compact': () => ({
        compacted: true,
        message: 'GPT-5 mini now reads a summary of the earlier messages.',
      }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c7' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'compact');
    await user.click(
      await screen.findByRole('option', { name: /Summarise the start of this chat/ }),
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === '/api/conversations/c7/compact'),
      ).toBe(true),
    );
  });

  it('opens how the chat was done, and saves this chat or many as a file (ADR 0113)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c7' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'replay');
    await user.click(await screen.findByRole('option', { name: /How it did it/ }));
    expect(useHowItDidIt.getState().runFor).toBe('c7');

    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    await user.clear(box);
    await user.type(box, 'save chats as a file');
    await user.click(await screen.findByRole('option', { name: /Save chats as a file/ }));
    expect(useHowItDidIt.getState().saving).toEqual({});
    act(() => useHowItDidIt.setState({ runFor: null, saving: null }));
  });

  it('starts the open chat afresh, and puts /plan and /goal in the message box (ADR 0098)', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'POST /api/conversations/c7/clear': () => ({ changed: true, message: 'Cleared.' }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c7' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'forget conversation');
    await user.click(await screen.findByRole('option', { name: /Start afresh in this chat/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === '/api/conversations/c7/clear'),
      ).toBe(true),
    );

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'plan first');
    await user.click(await screen.findByRole('option', { name: /Plan first, then act/ }));
    expect(useUi.getState().composerText).toBe('/plan ');

    act(() => useUi.setState({ composerText: null }));
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'goal');
    await user.click(await screen.findByRole('option', { name: /Set a goal for this chat/ }));
    expect(useUi.getState().composerText).toBe('/goal ');
    act(() => useUi.setState({ composerText: null }));
  });

  it('edits a thing made in a chat by hand, and finds what pages may read (ADR 0046)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/artifacts': () => ({
        artifacts: [
          {
            id: 'a_3',
            title: 'Budget',
            kind: 'table',
            conversationId: 'c9',
            createdAt: 1,
            updatedAt: 2,
            versions: [{ n: 1, at: 1, size: 1 }],
          },
        ],
      }),
    });
    const { where } = renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'edit budget');
    await user.click(await screen.findByRole('option', { name: /Edit “Budget”.*Table · by hand/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/c/c9'));
    expect(useUi.getState()).toMatchObject({
      artifactOpen: { conversationId: 'c9', artifactId: 'a_3' },
      artifactEditRequest: 'a_3',
    });
    act(() => useUi.setState({ artifactOpen: null, artifactEditRequest: undefined }));

    for (const words of ['live data', 'weather', 'revoke']) {
      act(() => useUi.getState().setPalette(true));
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Live data in pages/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/security',
        focus: 'live-data',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('backs up and restores by name, straight into Settings → Health', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'back up');
    expect(await screen.findByRole('option', { name: /Back up now/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/health',
        focus: 'backup',
      }),
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
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/health',
        focus: 'restore',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('finds Come home by the other apps’ names, straight into Settings → Memory', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    for (const words of ['openclaw', 'hermes', 'migrate']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Bring your things from OpenClaw or Hermes/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/memory',
        focus: 'come-home',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined }));
  });

  it('finds what Conch knows about you, tidying up and exporting, by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['what do you know about me', 'memories', 'forget']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /What Conch knows about you/ }),
      ).toBeInTheDocument();
    }
    for (const words of ['tidy', 'duplicates', 'dream']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Tidy up memories/ })).toBeInTheDocument();
    }
    for (const words of ['meaning', 'synonyms', 'semantic search']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Search memories by meaning/ }),
      ).toBeInTheDocument();
    }
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'export memories');
    expect(
      await screen.findByRole('option', { name: /Export what Conch knows/ }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'what conch knows');
    await user.click(await screen.findByRole('option', { name: /What Conch knows about you/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/memory'));
  });

  it('finds what Conch knows, what it won’t learn again and what learning may spend (ADR 0088)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    // What Conch learned is simply what it knows now (ADR 0097).
    for (const words of ['learned', 'picked up', 'self improving']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /What Conch knows about you/ }),
      ).toBeInTheDocument();
    }
    for (const words of ['never learn', 'taken back']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Things Conch won’t learn again/ }),
      ).toBeInTheDocument();
    }
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'learning spend');
    expect(
      await screen.findByRole('option', { name: /What learning may spend/ }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'never learn');
    await user.click(await screen.findByRole('option', { name: /won’t learn again/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/memory'));
    expect(useUi.getState().memoryIntent).toBe('never');
  });

  it('marks the chat you’re reading not to learn from, and back (ADR 0088)', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [conversation('c1', 'Plan my week')],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'PUT /api/learning/chats/c1': () => ({ quiet: true }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c1' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'incognito');
    await user.click(await screen.findByRole('option', { name: /Don’t learn from this chat/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/learning/chats/c1', body: { quiet: true } }),
      ),
    );
  });

  it('finds archived chats by name, never as recent, and the archive by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        conversation('c1', 'Plan my week'),
        { ...conversation('c2', 'Lisbon trip'), archivedAt: Date.now() },
      ],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    expect(await screen.findByRole('option', { name: /Plan my week/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Lisbon trip/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'lisbon');
    expect(
      await screen.findByRole('option', { name: /Lisbon trip.*Archived/ }),
    ).toBeInTheDocument();

    for (const words of ['archive', 'archived chats', 'put away', 'hidden chats']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /^Archived chats/ })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('option', { name: /^Archived chats/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/archived'));
  });

  it('archives the chat you’re in by name, and unarchives an archived one', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        conversation('c1', 'Plan my week'),
        { ...conversation('c2', 'Lisbon trip'), archivedAt: Date.now() },
      ],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'PATCH /api/conversations/c1': () => ({ ok: true }),
      'PATCH /api/conversations/c2': () => ({ ok: true }),
    });
    const page = (
      <>
        <Palette />
        <Where />
      </>
    );
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={page} />
        <Route path="*" element={page} />
      </Routes>,
      { route: '/c/c1' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'tidy');
    expect(await screen.findByRole('option', { name: /Archive this chat/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'archive this');
    await user.click(await screen.findByRole('option', { name: /Archive this chat/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/conversations/c1', body: { archived: true } }),
      ),
    );
    // It goes from the list, so you go to a new chat.
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
  });

  it('offers to unarchive the archived chat you’re reading', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [
        { ...conversation('c2', 'Lisbon trip'), archivedAt: Date.now() },
      ],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'PATCH /api/conversations/c2': () => ({ ok: true }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
      </Routes>,
      { route: '/c/c2' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'archive');
    expect(screen.queryByRole('option', { name: /Archive this chat/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: /Unarchive this chat/ }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/conversations/c2', body: { archived: false } }),
      ),
    );
  });

  it('finds Always on and quitting by the words people use, straight into Settings → Health', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
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
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/health',
        focus: 'background',
      }),
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
    act(() => useUi.setState({ settingsFocus: undefined, paletteOpen: false }));
  });

  it('finds the publishers you trust by the words people use, straight to the list', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['publishers', 'signed skill', 'verified']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Skill publishers you trust/ }),
      ).toBeInTheDocument();
    }
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'publishers you trust');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/skills'));
  });

  it('finds skills that are off by the words people use, archived among them (ADR 0058)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['archived skills', 'unused skills', 'skills off']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Skills that are off/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/skills?show=off'));
  });

  it('saves how the open chat’s work was done, only in a chat that earned it (ADR 0058)', async () => {
    const user = userEvent.setup();
    const offer = {
      id: 'ws_1',
      title: 'Release notes',
      times: 1,
      examples: [{ text: 'Release notes for 1.3', conversationId: 'c4', at: 1 }],
      draft: {
        title: 'Release notes',
        description: 'Writes release notes. Use when asked for release notes.',
        instructions: '1. Find the last tag.\n2. List the commits since it.',
        permissions: {
          capabilities: ['commands'],
          commands: ['git'],
          words: ['run commands (only `git`)'],
        },
      },
      from: 'work',
      chat: { conversationId: 'c4', title: 'Release notes for 1.3', endedAt: 1 },
      steps: 12,
    };
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/skills/suggestions/work': () => ({ suggestions: [offer] }),
    });
    renderApp(
      <Routes>
        <Route
          path="/c/:conversationId"
          element={
            <>
              <Palette />
              <Where />
            </>
          }
        />
        <Route path="/skills/new" element={<Where />} />
      </Routes>,
      { route: '/c/c5' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'save how');
    // Another chat's offer isn't this chat's.
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Save how I did this/ })).toBeNull(),
    );
  });

  it('opens the draft from the chat that earned it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/skills/suggestions/work': () => ({
        suggestions: [
          {
            id: 'ws_1',
            title: 'Release notes',
            times: 1,
            examples: [],
            draft: {
              title: 'Release notes',
              description: 'Writes release notes. Use when asked for release notes.',
              instructions: '1. Find the last tag.\n2. List the commits since it.',
            },
            from: 'work',
            chat: { conversationId: 'c4', title: 'Release notes for 1.3', endedAt: 1 },
            steps: 12,
          },
        ],
      }),
    });
    renderApp(
      <Routes>
        <Route path="/c/:conversationId" element={<Palette />} />
        <Route path="/skills/new" element={<Where />} />
      </Routes>,
      { route: '/c/c4' },
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'learn the steps');
    await user.click(await screen.findByRole('option', { name: /Save how I did this as a skill/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/skills/new'));
  });

  it('starts a routine that starts when something happens, by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['tell me when', 'watch a page', 'email arrives', 'webhook']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /New routine that starts when/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/routines'));
  });

  it('finds standing orders and the morning’s note by the words people use (ADR 0107)', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    renderApp(
      <>
        <Palette />
        <Where />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    for (const words of ['standing orders', 'heartbeat', 'quiet hours', 'always tell me']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Standing orders and check-ins/ }),
      ).toBeInTheDocument();
    }
    for (const words of ['while you slept', 'dreaming', 'overnight']) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /What Conch learned overnight/ }),
      ).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/memory'));
  });

  it('finds notifications and adding a phone by the words people use', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    // By the page's own words too: the switch, and what it tells you about.
    for (const words of [
      'notifications',
      'push',
      'lock screen',
      'allow notifications',
      'answer is ready',
      'show what',
      'send a test',
    ]) {
      await user.clear(await screen.findByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(
        await screen.findByRole('option', { name: /Settings: Notifications/ }),
      ).toBeInTheDocument();
    }
    // Reaching Conch from a phone has its own row, in Settings → Devices too.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'tailscale');
    expect(
      await screen.findByRole('option', { name: /Use Conch on your phone/ }),
    ).toBeInTheDocument();
    for (const words of ['iphone', 'tailscale', 'add phone']) {
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), words);
      expect(await screen.findByRole('option', { name: /Add your phone/ })).toBeInTheDocument();
    }
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
        at: '/settings/devices',
        focus: 'add-device',
      }),
    );
    act(() => useUi.setState({ settingsFocus: undefined, paletteOpen: false }));
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
    expect(screen.getByRole('option', { name: 'Settings: Terminal' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Show the terminal/ }));
    expect(useUi.getState().terminalOpen).toBe(true);

    // Turned off, only its settings answer (that's where it turns back on).
    enabled = false;
    await act(() => client.invalidateQueries({ queryKey: ['terminal'] }));
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'terminal');
    expect(await screen.findByRole('option', { name: 'Settings: Terminal' })).toBeInTheDocument();
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

  it('sends the draft to the background, and finds what’s in the background', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/tasks': () => ({ tasks: [], concurrent: 3 }),
    });
    renderApp(
      <>
        <Palette />
        <Toaster />
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'background');
    const before = useUi.getState().backgroundRequest;
    await user.click(await screen.findByRole('option', { name: /Run as a task/ }));
    expect(useUi.getState().backgroundRequest).toBe(before + 1);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'tasks');
    // Nothing going: it says so, instead of an empty list.
    await user.click(await screen.findByRole('option', { name: /Tasks going now/ }));
    expect(await screen.findByText('No tasks going right now.')).toBeInTheDocument();
    expect(useUi.getState().pulseOpen).toBe(false);
  });

  it('finds a task by name, helpers included', async () => {
    const user = userEvent.setup();
    const made = (patch: Record<string, unknown>) => ({
      id: 'x',
      kind: 'background',
      title: 'Tidy the README',
      prompt: 'Tidy the README',
      status: 'running',
      options: {},
      createdAt: 1,
      steps: [],
      rev: 1,
      conversationId: 'c-task',
      ...patch,
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where, client } = renderApp(<Palette />);
    // The sidebar keeps the list loaded; here it's put in by hand.
    client.setQueryData(taskKeys.all, {
      concurrent: 3,
      tasks: [
        made({}),
        made({ id: 'h', kind: 'helper', title: 'Tidy the tests', conversationId: 'c-helper' }),
      ],
    });
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'tidy the tests');
    await user.click(await screen.findByRole('option', { name: /Tidy the tests/ }));
    await waitFor(() => expect(where()).toBe('/c/c-helper'));
  });

  it('finds the model on this computer by the words people use for it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
    });
    const { where } = renderApp(<Palette />);
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
    expect(where()).toBe('/settings/providers/ollama');
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
    const { client, where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'upgrade');
    expect(await screen.findByRole('option', { name: /Check for updates/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Update Conch/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /Check for updates/ }));
    expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
      at: '/settings/health',
      focus: 'check-updates',
    });

    behind = 3;
    await act(() => client.invalidateQueries({ queryKey: ['updates'] }));
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'update conch');
    await user.click(await screen.findByRole('option', { name: /Update Conch/ }));
    // The update dialog: what it brings first, then one press.
    expect(useUi.getState().updateDialog).toEqual({});
    useUi.setState({ settingsFocus: undefined, updateDialog: undefined });
  });

  it('finds Apps by its old names too: integrations, and channels for Talk to me here', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/integrations': () => ({
        catalog: [
          {
            id: '1password',
            name: '1Password',
            tagline: 'Sign-ins and Environments',
            description: '',
            category: 'developer',
            auth: 'none',
            local: true,
            fields: [],
            steps: [],
            examples: [],
            access: [],
            featured: false,
          },
        ],
        providers: [],
        integrations: [],
      }),
    });
    renderApp(
      <>
        <Palette />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'integrations');
    await user.click(await screen.findByRole('option', { name: /^Apps/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps');
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'channels');
    await user.click(await screen.findByRole('option', { name: /^Talk to me here/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps?show=talk');
    // 1Password is one place for both its halves: its page, not a dialog for one of them.
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), '1password');
    await user.click(await screen.findByRole('option', { name: /1Password.*Connect/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/1password');
  });

  it('makes an app, adds one from a link, and opens apps you made and their pages (ADR 0061)', async () => {
    const user = userEvent.setup();
    const page = { id: 'plants', title: 'Plants', file: 'pages/plants.html' };
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/integrations': () => ({
        catalog: [],
        providers: [],
        integrations: [
          {
            id: 'capp_plant-diary',
            conchApp: 'plant-diary',
            name: 'Plant diary',
            server: 'app_plant_diary',
            transport: { type: 'host', how: 'Runs sealed off on this computer' },
            auth: 'none',
            enabled: true,
            policy: 'ask-writes',
            health: { state: 'ok', checkedAt: 1 },
            tools: [],
            values: {},
            secrets: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      'GET /api/conch-apps': () => ({
        apps: [
          {
            id: 'plant-diary',
            integrationId: 'capp_plant-diary',
            manifest: {
              conch: 1,
              id: 'plant-diary',
              name: 'Plant diary',
              tagline: 'When you watered what',
              description: '',
              version: '1.0.0',
              icon: { glyph: 'leaf', color: 'green' },
              kind: 'personal',
              pages: [page],
              reaches: [],
              settings: [],
              instructions: '',
              examples: [],
            },
            tools: [],
            source: { kind: 'made' },
            signature: { state: 'unsigned' },
            hash: 'h',
            addedAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    });
    renderApp(
      <>
        <Palette />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'make an app');
    await user.click(await screen.findByRole('option', { name: /^Make an app/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps?add=describe');

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'github');
    await user.click(await screen.findByRole('option', { name: /^Add an app from a link/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps?add=link');

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'plants');
    await user.click(await screen.findByRole('option', { name: /Plant diary — Plants/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/capp_plant-diary/plants');

    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'plant diary');
    await user.click(await screen.findByRole('option', { name: /^Plant diary\s*Open$/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/capp_plant-diary');
  });

  it('finds Gmail, Calendar and Drive as apps: open one that’s connected, connect the others', async () => {
    const user = userEvent.setup();
    const google = (id: string, name: string) => ({
      id,
      name,
      tagline: '',
      description: '',
      category: 'productivity',
      auth: 'google',
      local: false,
      fields: [],
      steps: [],
      examples: [],
      access: [],
      featured: true,
    });
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/integrations': () => ({
        catalog: [google('gmail', 'Gmail'), google('google-calendar', 'Google Calendar')],
        providers: [],
        integrations: [
          {
            id: 'gmail',
            catalogId: 'gmail',
            name: 'Gmail',
            server: 'gmail',
            transport: { type: 'host', how: 'With an app password' },
            auth: 'token',
            enabled: true,
            policy: 'ask-writes',
            health: { state: 'ok' },
            tools: [],
            values: {},
            secrets: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    });
    renderApp(
      <>
        <Palette />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    act(() => useUi.getState().setPalette(true));
    const box = await screen.findByRole('combobox');
    await user.type(box, 'gmail');
    await user.click(await screen.findByRole('option', { name: /Gmail.*Open/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/gmail');
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'calendar');
    expect(
      await screen.findByRole('option', { name: /Google Calendar.*Connect/ }),
    ).toBeInTheDocument();
  });

  it('names the release in “Update Conch”, and finds the release channel', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/updates': () => ({
        conch: {
          checkable: true,
          version: '0.2.0',
          behind: 1,
          improvements: 2,
          whatsNew: [],
          restartNeeded: false,
          source: 'releases',
          latest: { version: '0.3.0', channel: 'stable' },
        },
        programs: [],
        checking: false,
        auto: false,
        restartable: true,
      }),
    });
    const { where } = renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'update conch');
    expect(await screen.findByRole('option', { name: /Update Conch to 0\.3/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'beta');
    await user.click(await screen.findByRole('option', { name: /Release channel/ }));
    expect({ at: where(), focus: useUi.getState().settingsFocus }).toEqual({
      at: '/settings/health',
      focus: 'updates',
    });
    useUi.setState({ settingsFocus: undefined });
  });

  it('finds WhatsApp by what linking it means: a code to scan', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/conversations': () => [],
      'GET /api/search': () => ({ ...results, groups: [], total: 0 }),
      'GET /api/channels': () => ({
        channels: [],
        catalog: [
          {
            id: 'whatsapp',
            name: 'WhatsApp',
            tagline: '',
            color: '#25D366',
            minutes: 1,
            available: true,
          },
        ],
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'scan qr');
    expect(await screen.findByRole('option', { name: /Connect WhatsApp/ })).toBeInTheDocument();
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
          {
            id: 'wechat',
            name: 'WeChat',
            tagline: 'Through a WeCom bot, or your own Official Account. 微信',
            color: '#07C160',
            minutes: 5,
            available: true,
          },
          { id: 'signal', name: 'Signal', tagline: '', color: '#3A76F0', available: false },
          {
            id: 'email',
            name: 'Email',
            tagline: '',
            color: '#5B6B7F',
            minutes: 3,
            available: true,
          },
          {
            id: 'imessage',
            name: 'iMessage',
            tagline: '',
            color: '#34DA50',
            minutes: 1,
            available: true,
          },
        ],
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    // The words people use for them, not only their names.
    await user.type(await screen.findByRole('combobox'), 'gmail');
    expect(await screen.findByRole('option', { name: /Connect Email/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'iphone');
    expect(await screen.findByRole('option', { name: /Connect iMessage/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'discord');
    expect(await screen.findByRole('option', { name: /Connect Discord/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'telegram');
    expect(
      await screen.findByRole('option', { name: /Ada’s Conch on Telegram/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Talk to me here/ })).toBeInTheDocument();
    // Found by the words people type, in their own language too.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), '微信');
    expect(await screen.findByRole('option', { name: /Connect WeChat/ })).toBeInTheDocument();
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
          sources: [
            {
              id: 'bitwarden',
              name: 'Bitwarden',
              state: 'off',
              writable: false,
              unlock: 'password',
            },
            {
              id: 'keychain',
              name: 'macOS Keychain',
              state: 'off',
              writable: false,
              unlock: 'app',
              available: false,
            },
          ],
          health: { weak: 0, reused: 0, compromised: 0, expired: 0, insecure: 0 },
          trash: 0,
        },
      }),
    });
    renderApp(<Palette />);
    act(() => useUi.getState().setPalette(true));
    await user.type(await screen.findByRole('combobox'), 'netflix');
    expect(await screen.findByRole('option', { name: /Netflix/ })).toBeInTheDocument();
    // A password manager is an app to find by name; one this computer has no way to run is not.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'bitwarden');
    expect(await screen.findByRole('option', { name: /Bitwarden/ })).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'keychain');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /macOS Keychain/ })).toBeNull(),
    );
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'generate password');
    expect(await screen.findByRole('option', { name: /Generate a password/ })).toBeInTheDocument();
    // 1Password's service account, by the words someone on a server would type.
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'service account token');
    expect(await screen.findByRole('option', { name: /Connect 1Password/ })).toBeInTheDocument();
  });
});
