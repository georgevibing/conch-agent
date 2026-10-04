import type {
  CatalogEntry,
  Channel,
  ChannelCatalogEntry,
  Integration,
  VaultSource,
} from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MovedToApps } from '../../app/Root';
import { Shell } from '../../app/Shell';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { AppsLink } from './AppsLink';
import { AppDetailView } from './AppDetailView';
import {
  describeApp,
  describeFound,
  galleryTiles,
  groupTiles,
  isFound,
  joinApps,
  managerItem,
  toolGroups,
} from './apps';
import { AppsView } from './AppsView';
import { newHome } from './paths';
import { applyIntegrationEvent } from './queries';

afterEach(() => vi.unstubAllGlobals());

const entry = (
  patch: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'name' | 'auth'>,
): CatalogEntry => ({
  tagline: `${patch.name} tagline`,
  description: `Use ${patch.name}.`,
  category: 'productivity',
  local: false,
  fields: [],
  steps: [],
  examples: [],
  access: [],
  featured: false,
  ...patch,
});

const catalog: CatalogEntry[] = [
  entry({ id: 'notion', name: 'Notion', auth: 'oauth' }),
  entry({ id: 'gmail', name: 'Gmail', auth: 'google', featured: true }),
  entry({ id: 'slack', name: 'Slack', auth: 'slack', featured: true }),
  entry({
    id: '1password',
    name: '1Password',
    auth: 'none',
    local: true,
    category: 'developer',
    tagline: 'Sign-ins and Environments',
  }),
];

const chats: ChannelCatalogEntry[] = [
  { id: 'telegram', name: 'Telegram', tagline: 'The easiest.', color: '#26A5E4', available: true },
  { id: 'slack', name: 'Slack', tagline: 'A DM.', color: '#4A154B', available: true },
  { id: 'email', name: 'Email', tagline: 'Write to yourself.', color: '#5B6B7F', available: true },
  {
    id: 'imessage',
    name: 'iMessage',
    tagline: 'Only on a Mac.',
    color: '#34DA50',
    available: false,
  },
];

const tools = {
  slack: ['slack_channels', 'slack_search', 'slack_read_channel', 'slack_send_message'],
  gmail: ['google_mail_search', 'google_mail_read', 'google_mail_create_draft'],
};

const hosted = (id: 'slack' | 'gmail', patch: Partial<Integration> = {}): Integration => ({
  id,
  catalogId: id,
  name: id === 'slack' ? 'Slack' : 'Gmail',
  server: id,
  transport: { type: 'host', how: 'With your own app' },
  auth: 'token',
  enabled: true,
  policy: 'ask-writes',
  health: { state: 'ok', checkedAt: 1, okAt: 1 },
  tools: tools[id].map((name) => ({
    name,
    description: '',
    access: /send|draft/.test(name) ? 'write' : 'read',
    destructive: false,
    ...(/send|draft/.test(name) && { alwaysAsks: true }),
  })),
  values: {},
  secrets: [],
  ...(id === 'gmail' && { account: 'ada@gmail.com' }),
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const channel = (patch: Partial<Channel> = {}): Channel => ({
  id: 'ch_1',
  kind: 'telegram',
  enabled: true,
  createdAt: 1,
  bot: { id: '42', name: 'Ada’s Conch', username: 'adas_conch_bot' },
  people: [{ id: '4242', name: 'Ada', since: 1 }],
  requests: [],
  blocked: 0,
  groups: [],
  settings: { notifyRoutines: true },
  health: { state: 'online' },
  ...patch,
});

const slackBot = channel({
  id: 'ch_slack',
  kind: 'slack',
  app: 'slack',
  bot: { id: 'U1', name: 'Conch', workspace: 'Acme' },
});
const mailBox = channel({
  id: 'ch_mail',
  kind: 'email',
  app: 'gmail',
  bot: { id: 'ada@gmail.com', name: 'Ada', address: 'ada+conch@gmail.com' },
});

const onePassword = (patch: Partial<VaultSource> = {}): VaultSource => ({
  id: '1password',
  name: '1Password',
  state: 'ready',
  writable: false,
  unlock: 'none',
  count: 12,
  ...patch,
});

const vault = (sources: VaultSource[] = []) => ({
  items: [],
  status: {
    lock: { enabled: false, locked: false, autoLockMinutes: 30 },
    protection: 'keychain',
    sources,
    health: { weak: 0, reused: 0, compromised: 0, expired: 0, insecure: 0 },
    trash: 0,
  },
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function routes(
  over: {
    integrations?: Integration[];
    channels?: Channel[];
    sources?: VaultSource[];
  } & Record<string, unknown> = {},
) {
  const { integrations = [], channels = [], sources = [], ...rest } = over;
  return {
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/integrations': () => ({ catalog, providers: [], integrations }),
    'GET /api/channels': () => ({ channels, catalog: chats }),
    'GET /api/vault': () => vault(sources),
    ...(rest as Record<string, (body: unknown) => unknown>),
  };
}

describe('one app, one card (ADR 0052)', () => {
  it('joins what the assistant uses and where you talk to it into one item per app', () => {
    const items = joinApps({
      integrations: [hosted('slack'), hosted('gmail')],
      catalog,
      channels: [slackBot, mailBox, channel()],
      sources: [onePassword()],
    });
    expect(items.map((i) => [i.key, i.channels.map((c) => c.id), Boolean(i.source)])).toEqual([
      ['slack', ['ch_slack'], false],
      ['gmail', ['ch_mail'], false],
      ['channel:ch_1', ['ch_1'], false],
      ['1password', [], true],
    ]);
    // A half on its own is still the app's card.
    const half = joinApps({ integrations: [], catalog, channels: [slackBot], sources: [] });
    expect(half).toMatchObject([{ key: 'slack', name: 'Slack', to: '/apps/slack', talks: true }]);
    // 1Password that isn't on this computer, or is off, isn't a card.
    for (const state of ['missing', 'off'] as const)
      expect(
        joinApps({ integrations: [], catalog, channels: [], sources: [onePassword({ state })] }),
      ).toEqual([]);
  });

  it('a card sums up its halves: what’s wrong first, then a calm next step', () => {
    const one = (...args: Parameters<typeof joinApps>) => {
      const [item] = joinApps(...args);
      if (!item) throw new Error('no app');
      return item;
    };
    const slack = one({
      integrations: [hosted('slack')],
      catalog,
      channels: [
        { ...slackBot, health: { state: 'needs-token', message: 'Slack refused the key.' } },
      ],
    });
    expect(describeApp(slack)).toMatchObject({
      state: 'needs-auth',
      message: 'Slack refused the key.',
      fix: { label: 'Paste the new key' },
    });
    const hello = one({
      integrations: [],
      catalog,
      channels: [channel({ people: [] })],
    });
    expect(describeApp(hello)).toMatchObject({
      state: 'ok',
      notice: { label: 'Say hello' },
    });
    const off = one({
      integrations: [hosted('gmail', { enabled: false })],
      catalog,
      channels: [{ ...mailBox, enabled: false }],
    });
    expect(describeApp(off)).toMatchObject({ state: 'off', enabled: false });
  });

  it('turns tools into a few plain switches', () => {
    expect(toolGroups(hosted('slack')).map((g) => [g.title, g.tools.length])).toEqual([
      ['Read & search', 3],
      ['Send (asks first)', 1],
    ]);
    expect(toolGroups(hosted('gmail')).map((g) => [g.title, g.note])).toEqual([
      ['Read & search', undefined],
      ['Draft', 'Asks every time. Never sends.'],
    ]);
  });

  it('the gallery has one tile per app: Slack’s chat tile is Slack’s, and nothing you have is offered again', () => {
    const tiles = galleryTiles({ catalog, channelCatalog: chats, have: [] });
    expect(tiles.map((t) => `${t.kind}:${t.id}`)).toEqual([
      'app:notion',
      'app:gmail',
      'app:slack',
      'app:1password',
      'chat:telegram',
      'chat:email',
    ]);
    expect(tiles.find((t) => t.id === 'slack')?.categories).toContain('talk');
    const have = joinApps({ integrations: [], catalog, channels: [slackBot, channel()] });
    expect(galleryTiles({ catalog, channelCatalog: chats, have }).map((t) => t.id)).toEqual([
      'notion',
      'gmail',
      '1password',
      'email',
    ]);
  });

  it('shows Slack once, whether it reads for you, talks to you, or both', async () => {
    mockFetch(routes({ integrations: [hosted('slack')], channels: [slackBot, channel()] }));
    renderApp(<AppsView />, { route: '/apps' });
    const connected = await screen.findByRole('region', { name: 'Connected' });
    const cards = within(connected).getAllByRole('article');
    expect(cards.map((c) => within(c).getAllByRole('button')[0]?.textContent)).toEqual([
      'Slack',
      'Telegram',
    ]);
    expect(cards[0]).toHaveTextContent(/talks to you here/);
    const gallery = screen.getByRole('region', { name: 'Add another app' });
    expect(within(gallery).queryByRole('button', { name: 'Slack' })).toBeNull();
    expect(within(gallery).queryByRole('button', { name: 'Telegram' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Apps' })).toBeInTheDocument();
  });

  it('the card’s switch is the whole app’s: every half goes off together', async () => {
    const calls = mockFetch(
      routes({
        integrations: [hosted('slack')],
        channels: [slackBot],
        'PATCH /api/integrations/slack': () => hosted('slack', { enabled: false }),
        'PATCH /api/channels/ch_slack': () => ({ ...slackBot, enabled: false }),
      }),
    );
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('switch', { name: 'Turn off Slack' }));
    await waitFor(() =>
      expect(
        calls
          .filter((c) => c.method === 'PATCH')
          .map((c) => [c.path, c.body])
          .sort(),
      ).toEqual([
        ['/api/channels/ch_slack', { enabled: false }],
        ['/api/integrations/slack', { enabled: false }],
      ]),
    );
  });

  it('Talk to me here: how it works, the chat apps, and Slack and Gmail among them', async () => {
    mockFetch(routes());
    renderApp(<AppsView />, { route: '/apps?show=talk' });
    expect(await screen.findByRole('list', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: /example conversation/ })).toBeInTheDocument();
    const gallery = screen.getByRole('region', { name: 'Connect your first app' });
    expect(
      within(gallery)
        .getAllByRole('article')
        .map((a) => within(a).getByRole('button').textContent),
    ).toEqual(['Gmail', 'Slack', 'Telegram', 'Email']);
    expect(screen.getByRole('radio', { name: 'Talk to me here' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/Private by default/)).toBeInTheDocument();
  });

  it('old addresses lead to Apps, keeping what they asked for', async () => {
    expect(newHome('/integrations', '?connect=notion')).toBe('/apps?connect=notion');
    expect(newHome('/integrations/int_1', '?id=int_1&result=connected')).toBe(
      '/apps/int_1?id=int_1&result=connected',
    );
    expect(newHome('/channels', '')).toBe('/apps?show=talk');
    expect(newHome('/integrations/done', '?result=connected')).toBeUndefined();
    mockFetch(routes());
    for (const [from, to] of [
      ['/integrations?connect=notion', '/apps?connect=notion'],
      ['/integrations/slack', '/apps/slack'],
      ['/channels', '/apps?show=talk'],
    ] as const) {
      const { unmount } = renderApp(
        <Routes>
          <Route path="/integrations" element={<MovedToApps />} />
          <Route path="/integrations/:id" element={<MovedToApps />} />
          <Route path="/channels" element={<MovedToApps />} />
          <Route path="*" element={<Where />} />
        </Routes>,
        { route: from },
      );
      expect(await screen.findByTestId('where')).toHaveTextContent(to);
      unmount();
    }
  });

  it('each address shows its page: Apps, an app, a chat app’s setup and page', async () => {
    mockFetch(routes({ integrations: [hosted('slack')], channels: [channel()] }));
    const shell = (route: string) =>
      renderApp(
        <Routes>
          <Route path="/apps" element={<Shell />} />
          <Route path="/apps/:appId" element={<Shell />} />
          <Route path="/channels/new/:channelKind" element={<Shell />} />
          <Route path="/channels/:channelId" element={<Shell />} />
        </Routes>,
        { route },
      );
    for (const [route, heading] of [
      ['/apps', 'Apps'],
      ['/apps/slack', 'Slack'],
      ['/channels/new/telegram', 'Connect Telegram'],
      ['/channels/ch_1', 'Ada’s Conch'],
    ] as const) {
      const { unmount } = shell(route);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      unmount();
    }
  });

  it('the sidebar’s Apps counts what needs you, chat apps included', async () => {
    mockFetch(
      routes({
        integrations: [hosted('gmail', { health: { state: 'needs-auth', message: 'Sign in.' } })],
        channels: [channel({ people: [] })],
      }),
    );
    renderApp(<AppsLink />, { route: '/' });
    expect(await screen.findByRole('button', { name: 'Apps, 2 need you' })).toBeInTheDocument();
  });
});

describe('an app’s page has plain switches for what it does', () => {
  it.each([false, true])(
    'a removed integration does not reopen setup (has a chat connection: %s)',
    async (hasChat) => {
      mockFetch(routes({ integrations: [hosted('gmail')], channels: hasChat ? [mailBox] : [] }));
      const { client } = renderApp(
        <>
          <Routes>
            <Route path="/apps/:appId" element={<AppDetailView appId="gmail" />} />
            <Route path="/apps" element={<AppsView />} />
          </Routes>
          <Where />
        </>,
        { route: '/apps/gmail' },
      );
      await screen.findByRole('button', { name: 'Disconnect Gmail' });
      // The socket can remove the integration before the disconnect navigation settles.
      act(() =>
        applyIntegrationEvent(client, { type: 'integration.deleted', integrationId: 'gmail' }),
      );
      if (hasChat) {
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'Disconnect Gmail' })).toBeNull(),
        );
        expect(screen.getByTestId('where')).toHaveTextContent('/apps/gmail');
        expect(screen.getByRole('switch', { name: 'Talk to me here' })).toBeChecked();
      } else {
        expect(await screen.findByRole('heading', { name: 'Apps', level: 1 })).toBeInTheDocument();
        expect(screen.getByTestId('where').textContent).toBe('/apps');
        expect(screen.getByRole('button', { name: 'Gmail' })).toBeInTheDocument();
      }
      expect(screen.queryByRole('dialog', { name: 'Connect Gmail' })).toBeNull();
    },
  );

  it('opening an app that was not connected still offers setup', async () => {
    mockFetch(routes());
    renderApp(
      <>
        <Routes>
          <Route path="/apps/:appId" element={<AppDetailView appId="gmail" />} />
          <Route path="/apps" element={<AppsView />} />
        </Routes>
        <Where />
      </>,
      { route: '/apps/gmail' },
    );
    expect(await screen.findByRole('dialog', { name: 'Connect Gmail' })).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/apps?connect=gmail');
  });

  it('Slack: Read & search turns its tools off together; Talk to me here sets up with the same app', async () => {
    const calls = mockFetch(
      routes({
        integrations: [hosted('slack')],
        'PATCH /api/integrations/slack': () => hosted('slack'),
      }),
    );
    renderApp(
      <>
        <AppDetailView appId="slack" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { route: '/apps/slack' },
    );
    const does = await screen.findByRole('list', { name: 'What Slack does' });
    await userEvent.click(within(does).getByRole('switch', { name: 'Read & search' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        tools: { slack_channels: 'off', slack_search: 'off', slack_read_channel: 'off' },
      }),
    );
    expect(within(does).getByRole('switch', { name: 'Send (asks first)' })).toBeChecked();
    // Talking to it there is a separate key from the same app: never pretended on.
    expect(within(does).queryByRole('switch', { name: 'Talk to me here' })).toBeNull();
    expect(within(does).getByText(/two more keys/)).toBeInTheDocument();
    await userEvent.click(within(does).getByRole('button', { name: 'Set up' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/channels/new/slack?with=app');
  });

  it('Gmail: talking to you by email shares the app password in one tap, only when flipped', async () => {
    const calls = mockFetch(
      routes({
        integrations: [hosted('gmail')],
        'GET /api/channels/email/gmail': () => ({ address: 'ada@gmail.com' }),
        'POST /api/channels/email/gmail': () => mailBox,
      }),
    );
    renderApp(<AppDetailView appId="gmail" />, { route: '/apps/gmail' });
    const does = await screen.findByRole('list', { name: 'What Gmail does' });
    const talk = await within(does).findByRole('switch', { name: 'Talk to me here' });
    expect(talk).toHaveAccessibleDescription(
      /app password Gmail already has.*ada\+conch@gmail\.com/,
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(talk);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
        '/api/channels/email/gmail',
      ]),
    );
    expect(await within(does).findByRole('switch', { name: 'Talk to me here' })).toBeChecked();
    expect(within(does).getByRole('button', { name: 'Who can write to it' })).toBeInTheDocument();
  });

  it('a half on its own: the Slack you talk to offers the reading half', async () => {
    mockFetch(routes({ channels: [slackBot] }));
    renderApp(<AppDetailView appId="slack" />, { route: '/apps/slack' });
    const does = await screen.findByRole('list', { name: 'What Slack does' });
    expect(within(does).getByRole('switch', { name: 'Talk to me here' })).toBeChecked();
    await userEvent.click(within(does).getByRole('button', { name: 'Set up' }));
    expect(await screen.findByRole('dialog', { name: 'Connect Slack' })).toBeInTheDocument();
  });

  it('1Password: one place for filling sign-ins and managing Environments', async () => {
    const calls = mockFetch(
      routes({
        sources: [onePassword({ state: 'locked' })],
        'PATCH /api/vault/sources/1password': () => [onePassword({ state: 'off' })],
      }),
    );
    renderApp(<AppDetailView appId="1password" />, { route: '/apps/1password' });
    const does = await screen.findByRole('list', { name: 'What 1Password does' });
    const fill = within(does).getByRole('switch', { name: 'Fill sign-ins from 1Password' });
    expect(fill).toBeChecked();
    expect(fill).toHaveAccessibleDescription(/Locked\. Unlock 1Password/);
    expect(within(does).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(within(does).getByText('Manage Environments')).toBeInTheDocument();
    await userEvent.click(fill);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        path: '/api/vault/sources/1password',
        body: { enabled: false },
      }),
    );
  });
});

/** One Conch came across in a provider, never signed in to here. */
const found = (name: string, patch: Partial<Integration> = {}): Integration => ({
  id: `int_${name.toLowerCase()}`,
  name,
  server: name.toLowerCase(),
  transport: { type: 'http', url: `https://mcp.${name.toLowerCase()}.example/mcp` },
  auth: 'oauth',
  enabled: true,
  policy: 'ask',
  health: {
    state: 'needs-auth',
    message: 'Sign in to use it with every model.',
    action: 'reconnect',
    checkedAt: 1,
  },
  tools: [],
  values: {},
  secrets: [],
  createdAt: 1,
  updatedAt: 1,
  from: {
    provider: 'claude-code',
    providerName: 'Claude Code',
    source: 'plugin',
    plugin: 'engineering',
  },
  ...patch,
});

describe('what Conch found in a provider is an offer, apart from what’s connected', () => {
  it('says once where they came from; names each origin only when they differ', () => {
    const items = (integrations: Integration[]) =>
      joinApps({ integrations, catalog, channels: [] });
    const same = items([found('Datadog', { brand: 'datadog', color: '#632CA6' }), found('Linear')]);
    expect(same.map((i) => [i.brand, i.color, isFound(i)])).toEqual([
      ['datadog', '#632CA6', true],
      ['custom', undefined, true],
    ]);
    expect(describeFound(same, 'Conch')).toEqual({
      title: 'Found in Claude Code',
      lead: 'Claude Code’s engineering plugin already has these. Sign in once, and Conch can use them with every model.',
      taglines: {},
    });
    const mixed = items([
      found('Datadog'),
      found('Notion', {
        from: { provider: 'claude-code', providerName: 'Claude Code', source: 'account' },
      }),
    ]);
    expect(describeFound(mixed, 'Conch').taglines).toEqual({
      int_datadog: 'engineering plugin',
      int_notion: 'Your account there',
    });
    expect(describeFound(items([found('Linear')]), 'Ada').lead).toBe(
      'Claude Code’s engineering plugin already has this one. Sign in once, and Ada can use it with every model.',
    );
    // One you've used is yours: when its sign-in runs out it's a problem to fix, among the connected.
    const used = found('Linear', { health: { state: 'needs-auth', okAt: 5, action: 'reconnect' } });
    expect(items([used]).map(isFound)).toEqual([false]);
    expect(items([used]).map((i) => describeApp(i).fix?.label)).toEqual(['Sign in again']);
  });

  it('waits in its own section with one Sign in each: no switch, no warning, no “again”', async () => {
    const calls = mockFetch(
      routes({
        integrations: [hosted('slack'), found('Datadog'), found('Linear')],
        'POST /api/integrations/int_datadog/connect': () => ({
          integration: found('Datadog', {
            health: { state: 'connecting', message: 'Waiting for you to sign in.' },
          }),
        }),
        'DELETE /api/integrations/int_linear': () => ({ ok: true }),
      }),
    );
    renderApp(<AppsView />, { route: '/apps' });
    const section = await screen.findByRole('region', { name: 'Found in Claude Code' });
    expect(section).toHaveTextContent(
      'Claude Code’s engineering plugin already has these. Sign in once, and',
    );
    const tiles = within(section).getAllByRole('article');
    expect(tiles.map((t) => t.getAttribute('aria-labelledby') && t.textContent)).toEqual([
      'DatadogSign in',
      'LinearSign in',
    ]);
    expect(within(section).queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/Sign in again/)).toBeNull();
    // What's connected is only what is.
    const connected = screen.getByRole('region', { name: 'Connected' });
    expect(within(connected).getAllByRole('article')).toHaveLength(1);
    expect(within(connected).queryByText('Datadog')).toBeNull();

    await userEvent.click(within(section).getByRole('button', { name: 'Sign in to Datadog' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/api/integrations/int_datadog/connect'))).toBe(
        true,
      ),
    );
    // Half-way through it stays where it was, and pressing again starts over.
    expect(
      await within(section).findByRole('button', { name: 'Signing in… to Datadog' }),
    ).toBeEnabled();

    // Saying no leaves it with its provider.
    await userEvent.click(within(section).getByRole('button', { name: 'Don’t use Linear here' }));
    await waitFor(() => expect(within(section).queryByText('Linear')).toBeNull());
    expect(
      calls.some((c) => c.method === 'DELETE' && c.path === '/api/integrations/int_linear'),
    ).toBe(true);
  });

  it('isn’t counted as needing you in the sidebar', async () => {
    mockFetch(routes({ integrations: [found('Datadog'), found('Linear')] }));
    renderApp(<AppsLink />, { route: '/' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apps' })).toBeInTheDocument());
    expect(screen.queryByText('2')).toBeNull();
  });
});

describe('the page reads top to bottom: connected, what Conch offers by kind, what it found', () => {
  it('groups the gallery by kind, each tile once, the ones most people want first', () => {
    const tiles = galleryTiles({
      catalog: [
        ...catalog,
        entry({ id: 'dropbox', name: 'Dropbox', auth: 'oauth', category: 'files' }),
        entry({ id: 'stripe', name: 'Stripe', auth: 'oauth', category: 'business' }),
      ],
      channelCatalog: chats,
      have: [],
    });
    expect(groupTiles(tiles).map((g) => [g.id, g.tiles.map((t) => t.name)])).toEqual([
      // Slack and Gmail can talk to you too, and are still one tile each, under Work.
      ['productivity', ['Gmail', 'Slack', 'Notion']],
      ['talk', ['Telegram', 'Email']],
      ['files', ['Dropbox']],
      ['business', ['Stripe']],
      ['developer', ['1Password']],
    ]);
  });

  it('shows the three parts in that order, and a kind’s heading over its tiles', async () => {
    mockFetch(routes({ integrations: [hosted('slack'), found('Datadog')] }));
    renderApp(<AppsView />, { route: '/apps' });
    await screen.findByRole('region', { name: 'Found in Claude Code' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Connected',
      'Add another app',
      'Found in Claude Code',
    ]);
    const work = screen.getByRole('region', { name: 'Work' });
    expect(within(work).getByRole('button', { name: 'Gmail' })).toBeInTheDocument();
    expect(within(work).queryByRole('button', { name: 'Telegram' })).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Talk to me here' })).getByRole('button', {
        name: 'Telegram',
      }),
    ).toBeInTheDocument();
  });

  it('a filter or a search is one list, and a search finds a found app too', async () => {
    mockFetch(routes({ integrations: [found('Datadog')] }));
    renderApp(<AppsView />, { route: '/apps' });
    await screen.findByRole('region', { name: 'Work' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find an app' }), 'gmai');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Work' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Gmail' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Found in Claude Code' })).toBeNull();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Find an app' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find an app' }), 'datad');
    expect(await screen.findByRole('button', { name: 'Sign in to Datadog' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing called/)).toBeNull();
  });
});

describe('an app disconnected while its page is open', () => {
  it('goes back to Apps, not into its connect dialog', async () => {
    let integrations = [found('Notion', { id: 'int_notion', catalogId: 'notion' })];
    mockFetch({
      ...routes(),
      'GET /api/integrations': () => ({ catalog, providers: [], integrations }),
    });
    const { client } = renderApp(
      <Routes>
        <Route path="/apps/:appId" element={<AppDetailView appId="notion" />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps/notion' },
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Notion' })).toBeInTheDocument();
    // Its going arrives before the page has left (Disconnect, here or on another device).
    integrations = [];
    await client.invalidateQueries();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps'));
    expect(screen.getByTestId('where').textContent).toBe('/apps');
  });

  it('one that was never connected still opens its connect dialog', async () => {
    mockFetch(routes());
    renderApp(
      <Routes>
        <Route path="/apps/:appId" element={<AppDetailView appId="notion" />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps/notion' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/apps?connect=notion'),
    );
  });
});

/** Another password manager, as Passwords reports it. */
const manager = (
  id: 'bitwarden' | 'keepassxc' | 'keychain',
  name: string,
  patch: Partial<VaultSource> = {},
): VaultSource => ({
  id,
  name,
  state: 'off',
  writable: false,
  unlock: id === 'bitwarden' ? 'password' : 'app',
  ...patch,
});

describe('every password manager is an app, not only 1Password (ADR 0052)', () => {
  const sources = [
    onePassword({ state: 'off' }),
    manager('bitwarden', 'Bitwarden', { state: 'locked' }),
    manager('keepassxc', 'KeePassXC'),
    // Off a Mac it has no way to work, so it isn’t offered anywhere.
    manager('keychain', 'macOS Keychain', { available: false }),
  ];

  it('one you turned on is a card; the others are in the gallery under Passwords', () => {
    const items = joinApps({ integrations: [], catalog, channels: [], sources });
    expect(items.map((i) => [i.key, i.name, i.brand, i.to, Boolean(i.source)])).toEqual([
      ['bitwarden', 'Bitwarden', 'bitwarden', '/apps/bitwarden', true],
    ]);
    expect(items.map((i) => describeApp(i).meta)).toEqual(['fills sign-ins once unlocked']);
    // Its page is the same item whether it is on or not.
    expect(sources.slice(1, 3).map((source) => managerItem(source).to)).toEqual([
      '/apps/bitwarden',
      '/apps/keepassxc',
    ]);
    const tiles = galleryTiles({ catalog, channelCatalog: [], have: items, sources });
    expect(
      tiles.filter((t) => t.kind === 'passwords').map((t) => [t.id, t.categories, t.tagline]),
    ).toEqual([['keepassxc', ['passwords'], 'Fills your sign-ins']]);
  });

  it('shows on Apps: connected above, the rest to turn on below', async () => {
    mockFetch(routes({ sources }));
    renderApp(<AppsView />, { route: '/apps' });
    const connected = await screen.findByRole('region', { name: 'Connected' });
    expect(within(connected).getByRole('button', { name: 'Bitwarden' })).toBeInTheDocument();
    const passwords = screen.getByRole('region', { name: 'Passwords' });
    expect(within(passwords).getByRole('button', { name: 'KeePassXC' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'macOS Keychain' })).toBeNull();
  });

  it('has a page with its one switch, on or not', async () => {
    const calls = mockFetch(
      routes({
        sources,
        'PATCH /api/vault/sources/keepassxc': () => [manager('keepassxc', 'KeePassXC')],
      }),
    );
    renderApp(<AppDetailView appId="keepassxc" />, { route: '/apps/keepassxc' });
    expect(await screen.findByRole('heading', { level: 1, name: 'KeePassXC' })).toBeInTheDocument();
    const fill = within(screen.getByRole('list', { name: 'What KeePassXC does' })).getByRole(
      'switch',
      { name: 'Fill sign-ins from KeePassXC' },
    );
    expect(fill).not.toBeChecked();
    await userEvent.click(fill);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        path: '/api/vault/sources/keepassxc',
        body: { enabled: true },
      }),
    );
  });

  it('one that’s locked says where to unlock it', async () => {
    mockFetch(routes({ sources }));
    renderApp(<AppDetailView appId="bitwarden" />, { route: '/apps/bitwarden' });
    const fill = await screen.findByRole('switch', { name: 'Fill sign-ins from Bitwarden' });
    expect(fill).toBeChecked();
    expect(fill).toHaveAccessibleDescription(/Locked\. Unlock it in Passwords\./);
    expect(screen.getByRole('button', { name: 'Open Passwords' })).toBeInTheDocument();
  });
});
