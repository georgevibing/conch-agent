import type {
  CommunityResults,
  ConchApp,
  ConchAppManifest,
  ConchAppOffer,
  ConchAppPreview,
  ConversationEvent,
  Integration,
} from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { useLiveStore } from '../../live/store';
import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChatView } from '../chat/ChatView';
import { AppDetailView } from '../integrations/AppDetailView';
import { AppsView } from '../integrations/AppsView';
import { AppPageFrame } from './AppPage';
import { ShareFlow } from './ShareFlow';

afterEach(() => {
  vi.unstubAllGlobals();
  useLiveStore.setState({ views: {}, pending: {} });
});

const manifest = (patch: Partial<ConchAppManifest> = {}): ConchAppManifest => ({
  conch: 1,
  id: 'tally',
  name: 'Tally',
  tagline: 'Counts things for you',
  description: 'A counter.',
  version: '1.0.0',
  icon: { glyph: 'calculator', color: 'teal' },
  kind: 'personal',
  tools: 'tools.mjs',
  pages: [{ id: 'main', title: 'Tally', file: 'pages/main.html' }],
  reaches: [],
  settings: [],
  instructions: '',
  examples: ['Count one more coffee'],
  ...patch,
});

const tools = [
  { name: 'count', title: 'Count one more', description: 'Adds one.', changes: true },
  { name: 'read_count', title: 'Read the tally', description: 'Says it.', changes: false },
];

const tally = (patch: Partial<ConchApp> = {}): ConchApp => ({
  id: 'tally',
  integrationId: 'capp_tally',
  manifest: manifest(),
  tools,
  source: { kind: 'made', conversationId: 'c1' },
  signature: { state: 'unsigned' },
  hash: 'h1',
  addedAt: 1,
  updatedAt: 1,
  versions: [],
  saved: [],
  values: {},
  missing: [],
  dataBytes: 2048,
  pinned: true,
  ...patch,
});

const integration = (patch: Partial<Integration> = {}): Integration => ({
  id: 'capp_tally',
  conchApp: 'tally',
  name: 'Tally',
  server: 'app_tally',
  transport: { type: 'host', how: 'Runs sealed off on this computer' },
  auth: 'none',
  enabled: true,
  policy: 'ask-writes',
  health: { state: 'ok', checkedAt: 1 },
  tools: [
    {
      name: 'app_tally__count',
      title: 'Count one more',
      description: '',
      access: 'write',
      destructive: false,
    },
    {
      name: 'app_tally__read_count',
      title: 'Read the tally',
      description: '',
      access: 'read',
      destructive: false,
    },
  ],
  values: {},
  secrets: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const vault = {
  items: [],
  status: {
    lock: { enabled: false, locked: false, autoLockMinutes: 30 },
    protection: 'keychain',
    sources: [],
    health: { weak: 0, reused: 0, compromised: 0, expired: 0, insecure: 0 },
    trash: 0,
  },
};

const notion = {
  id: 'notion',
  name: 'Notion',
  tagline: 'Pages, docs and databases',
  description: 'Use Notion.',
  category: 'productivity',
  auth: 'oauth',
  local: false,
  fields: [],
  steps: [],
  examples: [],
  access: [],
  featured: false,
};

function routes(
  over: { apps?: ConchApp[]; integrations?: Integration[] } & Record<string, unknown> = {},
) {
  const { apps = [], integrations = [], ...rest } = over;
  return {
    'GET /api/state': () => appState(),
    'GET /api/conversations': () => [],
    'GET /api/integrations': () => ({ catalog: [notion], providers: [], integrations }),
    'GET /api/channels': () => ({ channels: [], catalog: [] }),
    'GET /api/vault': () => vault,
    'GET /api/conch-apps': () => ({ apps }),
    ...Object.fromEntries(apps.map((a) => [`GET /api/conch-apps/${a.id}`, () => a])),
    ...(rest as Record<string, (body: unknown) => unknown>),
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

const verifyFirst = () =>
  new Response(JSON.stringify({ error: 'verify-required', message: 'Confirm it’s you.' }), {
    status: 403,
  });

describe('Add your own (ADR 0061)', () => {
  it('opens on Describe it; Build it starts a chat that makes it, and opens it', async () => {
    mockFetch(routes());
    const { where } = renderApp(
      <Routes>
        <Route path="/apps" element={<AppsView />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Add your own' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
    expect(within(dialog).getByRole('tab', { name: 'Describe it' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of ['From a link', 'By address', 'Run a program'])
      expect(within(dialog).getByRole('tab', { name })).toBeInTheDocument();
    const box = within(dialog).getByRole('textbox', { name: 'What should it do?' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.type(box, 'Count my coffees');
    await userEvent.click(within(dialog).getByRole('button', { name: /Build it/ }));

    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          text: 'Make me an app: Count my coffees',
        }),
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const sent = FakeSocket.last?.sent.find(
      (m) => (m as { type: string }).type === 'conversation.send',
    ) as { clientMessageId: string };
    act(() =>
      FakeSocket.last?.push({
        type: 'conversation.created',
        clientMessageId: sent.clientMessageId,
        conversation: {
          id: 'c9',
          title: 'Coffee',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'running',
          options: {},
        },
      }),
    );
    await waitFor(() => expect(where()).toBe('/c/c9'));
  });

  it('⌘K’s Add an app from a link opens on From a link', async () => {
    mockFetch(routes());
    renderApp(
      <Routes>
        <Route path="/apps" element={<AppsView />} />
      </Routes>,
      { route: '/apps?add=link' },
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
    expect(within(dialog).getByRole('tab', { name: 'From a link' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveFocus());
  });

  it('shows what a link holds, and adds it with the settings typed in, and opens its page', async () => {
    const preview: ConchAppPreview = {
      packageId: 'pkg_1',
      source: {
        kind: 'github',
        owner: 'ada',
        repo: 'plant-diary',
        url: 'https://github.com/ada/plant-diary',
      },
      apps: [
        {
          manifest: manifest({
            id: 'plant-diary',
            name: 'Plant diary',
            settings: [
              { key: 'city', label: 'City', secret: false, optional: false },
              { key: 'apiKey', label: 'API key', secret: true, optional: false },
            ],
            reaches: ['api.open-meteo.com'],
          }),
          tools,
          signature: { state: 'unsigned' },
          hash: 'pd1',
          problems: [],
          warnings: [{ message: 'It replaces the Plant diary you have, from someone else.' }],
        },
      ],
    };
    const calls = mockFetch(
      routes({
        'POST /api/conch-apps/preview': () => preview,
        'POST /api/conch-apps/install': () =>
          tally({
            id: 'plant-diary',
            manifest: { ...manifest(), id: 'plant-diary', name: 'Plant diary' },
          }),
      }),
    );
    const { where } = renderApp(
      <Routes>
        <Route path="/apps" element={<AppsView />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps?add=link' },
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'github.com/ada/plant-diary');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Look' }));
    expect(calls).toContainEqual(
      expect.objectContaining({
        path: '/api/conch-apps/preview',
        body: { link: 'github.com/ada/plant-diary' },
      }),
    );
    const found = await within(dialog).findByRole('region', { name: 'Plant diary' });
    expect(found).toHaveTextContent('From github.com/ada/plant-diary · 1.0.0');
    expect(found).toHaveTextContent('Reaches api.open-meteo.com');
    expect(found).toHaveTextContent('It replaces the Plant diary you have');
    await userEvent.type(within(found).getByLabelText('City'), 'Porto');
    await userEvent.type(within(found).getByLabelText('API key'), 'k-123');
    await userEvent.click(
      within(found).getByRole('button', { name: 'Add Plant diary to my apps' }),
    );
    await waitFor(() => expect(where()).toBe('/apps/capp_plant-diary'));
    const installs = calls.filter((c) => c.path === '/api/conch-apps/install');
    expect(installs.at(-1)?.body).toEqual({
      packageId: 'pkg_1',
      appId: 'plant-diary',
      hash: 'pd1',
      settings: { city: 'Porto', apiKey: 'k-123' },
    });
  });

  it('a link with nothing to add says so, with Try again', async () => {
    mockFetch(
      routes({
        'POST /api/conch-apps/preview': () =>
          new Response(
            JSON.stringify({ error: 'not-found', message: 'There’s no Conch app there.' }),
            { status: 404 },
          ),
      }),
    );
    renderApp(<AppsView />, { route: '/apps?add=link' });
    const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'https://example.com/nothing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Look' }));
    expect(await within(dialog).findByText('There’s no Conch app there.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the Apps page with Conch apps', () => {
  it('a Conch app is a card under Connected, with its icon and Made by you', async () => {
    mockFetch(routes({ apps: [tally()], integrations: [integration()] }));
    renderApp(<AppsView />, { route: '/apps' });
    const card = await screen.findByRole('article', { name: 'Tally' });
    expect(within(card).getByText('Made by you')).toBeInTheDocument();
    expect(card.querySelector('[data-app-color]')).not.toBeNull();
    expect(card.querySelector('img')).toBeNull();
  });

  it('an app with a picture wears it on its card and its page, the glyph beneath (ADR 0090)', async () => {
    const picture = '/api/conch-apps/tally/icon?v=0123456789ab';
    mockFetch(routes({ apps: [tally({ picture })], integrations: [integration()] }));
    renderApp(<AppsView />, { route: '/apps' });
    const card = await screen.findByRole('article', { name: 'Tally' });
    expect(card.querySelector('img')).toHaveAttribute('src', picture);
    // The glyph is still there, for until (or unless) the picture loads.
    expect(card.querySelector('[data-app-color] svg')).not.toBeNull();
  });

  it('an update is the card’s calm notice', async () => {
    const app = tally({
      update: {
        version: '1.1.0',
        foundAt: 1,
        signature: { state: 'unsigned' },
        sameSigner: false,
        changes: {
          from: '1.0.0',
          to: '1.1.0',
          reachesAdded: ['api.example.com'],
          reachesRemoved: [],
          settingsAdded: [],
          toolsAdded: [],
          toolsRemoved: [],
          toolsNowChange: [],
          pagesAdded: [],
        },
      },
      source: { kind: 'github', owner: 'ada', repo: 'tally', url: 'https://github.com/ada/tally' },
    });
    mockFetch(routes({ apps: [app], integrations: [integration()] }));
    renderApp(
      <Routes>
        <Route path="/apps" element={<AppsView />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps' },
    );
    const card = await screen.findByRole('article', { name: 'Tally' });
    expect(card).toHaveTextContent('Version 1.1.0 is ready');
    // A new reach is shown first: Update opens its page, where what changed is.
    await userEvent.click(within(card).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps/capp_tally'));
  });

  it('nothing found offers Make “…” with Conch, filled in', async () => {
    mockFetch(
      routes({
        'GET /api/conch-apps/community': () => ({ apps: [], limited: false, offline: false }),
      }),
    );
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.type(
      await screen.findByRole('searchbox', { name: 'Find an app' }),
      'pool hours',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make “pool hours” with Conch' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
    expect(within(dialog).getByRole('textbox', { name: 'What should it do?' })).toHaveValue(
      'pool hours',
    );
  });

  describe('From the community', () => {
    const results = (r: Partial<CommunityResults>) =>
      routes({
        'GET /api/conch-apps/community': () => ({
          apps: [],
          limited: false,
          offline: false,
          ...r,
        }),
      });

    it('lives behind the search; Look opens From a link with the repository', async () => {
      const calls = mockFetch({
        ...results({
          apps: [
            {
              owner: 'ada',
              repo: 'plant-diary',
              description: 'Remember when you water',
              stars: 12,
              url: 'https://github.com/ada/plant-diary',
              installed: false,
            },
          ],
        }),
        'POST /api/conch-apps/preview': () => new Response('{}', { status: 500 }),
      });
      renderApp(<AppsView />, { route: '/apps' });
      expect(await screen.findByRole('button', { name: 'Browse community apps' })).toBeVisible();
      expect(screen.queryByRole('heading', { name: 'From the community' })).toBeNull();
      await userEvent.type(screen.getByRole('searchbox', { name: 'Find an app' }), 'plant');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Look at plant-diary by ada' }),
      );
      const dialog = await screen.findByRole('dialog', { name: 'Add your own' });
      expect(within(dialog).getByRole('tab', { name: 'From a link' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await waitFor(() =>
        expect(calls).toContainEqual(
          expect.objectContaining({
            path: '/api/conch-apps/preview',
            body: { link: 'https://github.com/ada/plant-diary' },
          }),
        ),
      );
      expect(calls.some((c) => c.path === '/api/conch-apps/community?q=plant')).toBe(true);
    });

    it('Browse community apps asks for everything', async () => {
      const calls = mockFetch(results({}));
      renderApp(<AppsView />, { route: '/apps' });
      await userEvent.click(await screen.findByRole('button', { name: 'Browse community apps' }));
      expect(await screen.findByText('Nobody has shared a Conch app yet.')).toBeInTheDocument();
      expect(calls.some((c) => c.path === '/api/conch-apps/community?q=')).toBe(true);
    });

    it('is calm when GitHub limits it', async () => {
      mockFetch(results({ limited: true }));
      renderApp(<AppsView />, { route: '/apps' });
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Find an app' }), 'x');
      expect(
        await screen.findByText('GitHub asked us to wait a minute. Try again shortly.'),
      ).toBeInTheDocument();
    });

    it('is calm when GitHub can’t be reached', async () => {
      mockFetch(results({ offline: true }));
      renderApp(<AppsView />, { route: '/apps' });
      await userEvent.type(await screen.findByRole('searchbox', { name: 'Find an app' }), 'x');
      expect(
        await screen.findByText(
          'GitHub can’t be reached right now. Conch looks again when you’re back online.',
        ),
      ).toBeInTheDocument();
    });
  });
});

describe('the app’s page', () => {
  const page = (app: ConchApp, extra: Record<string, (body: unknown) => unknown> = {}) => {
    const calls = mockFetch({
      ...routes({ apps: [app], integrations: [integration()] }),
      ...extra,
    });
    const view = renderApp(
      <Routes>
        <Route path="/apps/:appId" element={<AppDetailView appId="capp_tally" />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { route: '/apps/capp_tally' },
    );
    return { calls, ...view };
  };

  it('says who it’s from, opens its page, keeps a secret setting as saved, and lists its versions', async () => {
    const app = tally({
      manifest: manifest({
        settings: [{ key: 'apiKey', label: 'API key', secret: true, optional: false }],
      }),
      saved: ['apiKey'],
      versions: [{ version: '0.9.0', at: 1, hash: 'h0' }],
    });
    const { where } = page(app);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tally' })).toBeInTheDocument();
    expect(screen.getByText('Made by you · 1.0.0')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.getByLabelText('API key')).toHaveAttribute(
      'placeholder',
      'Saved. Type a new one to replace it',
    );
    expect(screen.getByRole('button', { name: 'Go back to Tally 0.9.0' })).toBeInTheDocument();
    expect(screen.getByText(/Keeps 2 KB on this/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Tally' }));
    await waitFor(() => expect(where()).toBe('/apps/capp_tally/main'));
  });

  it('a missing setting is one calm next step in the header', async () => {
    const app = tally({
      manifest: manifest({
        settings: [{ key: 'apiKey', label: 'API key', secret: true, optional: false }],
      }),
      missing: ['apiKey'],
    });
    mockFetch(
      routes({
        apps: [app],
        integrations: [
          integration({
            health: { state: 'needs-auth', message: 'Needs your API key.', action: 'edit' },
          }),
        ],
      }),
    );
    renderApp(<AppDetailView appId="capp_tally" />, { route: '/apps/capp_tally' });
    expect(await screen.findByText('Needs your API key.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add it' }));
    expect(screen.getByLabelText('API key')).toHaveFocus();
  });

  it('Remove asks first, and keeps what it saved unless told not to', async () => {
    const { calls, where } = page(tally(), {
      'DELETE /api/conch-apps/tally': () => ({ ok: true }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Tally' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Remove Tally?' });
    expect(within(ask).getByRole('checkbox', { name: /Keep what it saved/ })).toBeChecked();
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(where()).toBe('/apps'));
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: '/api/conch-apps/tally?keepData=1' }),
    );
  });

  it('Remove without keeping its data says so to the gateway', async () => {
    const { calls } = page(tally(), { 'DELETE /api/conch-apps/tally': () => ({ ok: true }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Tally' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Remove Tally?' });
    await userEvent.click(within(ask).getByRole('checkbox', { name: /Keep what it saved/ }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'DELETE', path: '/api/conch-apps/tally' }),
      ),
    );
  });
});

describe('sharing an app', () => {
  it('walks publishing on GitHub through each state, and saves a file', async () => {
    let state: unknown = { state: 'idle' };
    const calls = mockFetch({
      ...routes(),
      'GET /api/conch-apps/tally/publish': () => state,
      'POST /api/conch-apps/tally/publish': () => {
        state = {
          state: 'needs-sign-in',
          code: 'AB12-CD34',
          url: 'https://github.com/login/device',
        };
        return state;
      },
      'GET /api/conch-apps/tally/export': () =>
        new Response('bytes', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="tally.conchapp"' },
        }),
    });
    const created = vi.fn(() => 'blob:x');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }),
    );
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { client } = renderApp(
      <ShareFlow appId="tally" name="Tally" source={{ kind: 'made' }} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Publish on GitHub' }));
    expect(await screen.findByText('Sign in to GitHub with this code')).toBeInTheDocument();
    // Signing in finishes on GitHub; the page carries on by itself as it asks again.
    state = { state: 'publishing', step: 'Making the release v1.0.0' };
    await act(() => client.invalidateQueries());
    expect(await screen.findByText('Publishing Tally…')).toBeInTheDocument();
    state = { state: 'published', url: 'https://github.com/ada/tally', version: '1.0.0' };
    await act(() => client.invalidateQueries());
    expect(await screen.findByText('Tally 1.0.0 is on GitHub')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save as a file' }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(calls.some((c) => c.path === '/api/conch-apps/tally/export')).toBe(true);
    clicked.mockRestore();
  });

  it('a publish that fails says why, with Try again', async () => {
    mockFetch({
      ...routes(),
      'GET /api/conch-apps/tally/publish': () => ({ state: 'idle' }),
      'POST /api/conch-apps/tally/publish': () => ({
        state: 'failed',
        message: 'You already have a repository called tally.',
      }),
    });
    const { client } = renderApp(
      <ShareFlow appId="tally" name="Tally" source={{ kind: 'made' }} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Publish on GitHub' }));
    client.setQueryData(['conch-apps', 'publish', 'tally'], {
      state: 'failed',
      message: 'You already have a repository called tally.',
    });
    expect(await screen.findByText('You already have a repository called tally.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('an app from someone else offers where it came from, and the file, never Publish', async () => {
    mockFetch(routes());
    renderApp(
      <ShareFlow
        appId="tally"
        name="Tally"
        source={{
          kind: 'github',
          owner: 'ada',
          repo: 'tally',
          url: 'https://github.com/ada/tally',
        }}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Save as a file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish on GitHub' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'https://github.com/ada/tally (opens in a new tab)' }),
    ).toBeInTheDocument();
  });
});

describe('a page’s bridge to its own tools', () => {
  function frame(result: unknown[]) {
    const calls = mockFetch({
      'POST /api/conch-apps/tally/call': () => result.shift(),
    });
    renderApp(
      <AppPageFrame
        owner={{ appId: 'tally' }}
        pageId="main"
        title="Tally"
        appName="Tally"
        tools={tools}
      />,
    );
    const iframe = screen.getByTitle('Tally') as HTMLIFrameElement;
    const answers: unknown[] = [];
    const page = iframe.contentWindow as Window;
    page.addEventListener('message', (e) => answers.push(e.data));
    const call = (input: Record<string, unknown>) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: page,
            data: { conch: 'artifact', call: { id: 'k1', tool: 'count', input } },
          }),
        );
      });
    return { calls, call, answers };
  }

  it('a change with no press asks first, naming the app, the tool and what it sends', async () => {
    const { calls, call } = frame([
      { ok: false, reason: 'confirm', message: 'Tally wants to count one more.' },
      { ok: true, text: 'The tally is at 3.' },
    ]);
    await call({ by: 2 });
    const ask = await screen.findByRole('alertdialog', { name: 'Let Tally count one more?' });
    expect(ask).toHaveTextContent('by: 2');
    expect(calls[0]?.body).toEqual({ tool: 'count', input: { by: 2 }, confirmed: false });
    await userEvent.click(within(ask).getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(calls[1]?.body).toEqual({ tool: 'count', input: { by: 2 }, confirmed: true }),
    );
  });

  it('Not now sends nothing more', async () => {
    const { calls, call } = frame([
      { ok: false, reason: 'confirm', message: 'Tally wants to count one more.' },
    ]);
    await call({ by: 1 });
    const ask = await screen.findByRole('alertdialog', { name: 'Let Tally count one more?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls).toHaveLength(1);
  });
});

describe('the app card in the chat', () => {
  const offer = (patch: Partial<ConchAppOffer> = {}): ConchAppOffer => ({
    offerId: 'capo_1',
    action: 'add',
    from: 'draft',
    draftId: 'd1',
    hash: 'h1',
    manifest: manifest(),
    tools,
    source: { kind: 'made', conversationId: 'c1' },
    signature: { state: 'unsigned' },
    summary: 'Tally counts things for you.',
    state: 'ready',
    ...patch,
  });
  let seq = 0;
  const logged = <T extends { type: string }>(event: T) =>
    ({
      conversationId: 'c1',
      seq: seq++,
      at: Date.now(),
      ...event,
    }) as unknown as ConversationEvent;
  const turn = (made: ConchAppOffer) => {
    seq = 0;
    return [
      logged({ type: 'user.message', messageId: 'u1', text: 'Make me an app: count things' }),
      logged({ type: 'status', status: 'running' }),
      logged({ type: 'conch-app.offer', offer: made }),
      logged({ type: 'assistant.delta', messageId: 'm1', kind: 'text', delta: 'I made Tally.' }),
      logged({ type: 'assistant.done', messageId: 'm1' }),
      logged({ type: 'turn.completed', outcome: 'success' }),
      logged({ type: 'status', status: 'idle' }),
    ];
  };

  function chat(extra: Record<string, (body: unknown) => unknown> = {}) {
    const calls = mockFetch({ ...routes(), ...extra });
    const view = renderApp(<ChatView conversationId="c1" />, { route: '/c/c1' });
    const push = (events: ConversationEvent[]) =>
      act(() => {
        for (const event of events) FakeSocket.last?.push({ type: 'conversation.event', event });
      });
    return { calls, push, ...view };
  }

  it('sits under the reply; Add to my apps adds it, and it becomes a welcome with things to try', async () => {
    const { calls, push } = chat({
      'POST /api/conch-apps/offers/capo_1/accept': () => tally(),
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn(offer()));
    const card = await screen.findByRole('group', { name: 'Tally' });
    const reply = screen.getByText('I made Tally.');
    expect(reply.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Add Tally to my apps' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          path: '/api/conch-apps/offers/capo_1/accept',
          body: { conversationId: 'c1', settings: {} },
        }),
      ),
    );
    // The gateway's word, in the log: the newest for this offer wins, where it is.
    push([logged({ type: 'conch-app.offer', offer: offer({ state: 'added' }) })]);
    expect(await screen.findByText('Tally is in your apps')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Count one more coffee' }));
    await waitFor(() =>
      expect(FakeSocket.last?.sent).toContainEqual(
        expect.objectContaining({
          type: 'conversation.send',
          conversationId: 'c1',
          text: 'Count one more coffee',
        }),
      ),
    );
  });

  it('an app from a link asks that it’s you before it’s added', async () => {
    const { push } = chat({ 'POST /api/conch-apps/offers/capo_1/accept': verifyFirst });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(
      turn(
        offer({
          from: 'package',
          packageId: 'pkg_1',
          draftId: undefined,
          source: {
            kind: 'github',
            owner: 'ada',
            repo: 'tally',
            url: 'https://github.com/ada/tally',
          },
        }),
      ),
    );
    const card = await screen.findByRole('group', { name: 'Tally' });
    expect(within(card).queryByRole('button', { name: 'Open the page' })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Add Tally to my apps' }));
    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeInTheDocument();
  });

  it('Not now declines it, and it folds to a quiet line', async () => {
    const { calls, push } = chat({
      'POST /api/conch-apps/offers/capo_1/decline': () => ({ ok: true }),
    });
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn(offer()));
    const card = await screen.findByRole('group', { name: 'Tally' });
    await userEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          path: '/api/conch-apps/offers/capo_1/decline',
          body: { conversationId: 'c1' },
        }),
      ),
    );
    push([logged({ type: 'conch-app.offer', offer: offer({ state: 'declined' }) })]);
    expect(await screen.findByText(/Didn’t add/)).toBeInTheDocument();
  });

  it('Open the page opens the draft’s page beside the chat', async () => {
    const { push } = chat();
    await waitFor(() => expect(FakeSocket.last).toBeDefined());
    push(turn(offer()));
    const card = await screen.findByRole('group', { name: 'Tally' });
    await userEvent.click(within(card).getByRole('button', { name: 'Open the page' }));
    const frame = await screen.findByTitle('Tally');
    expect(frame.getAttribute('src')).toMatch(
      /^\/api\/conch-apps\/drafts\/d1\/pages\/main\/frame\?theme=(light|dark)/,
    );
    expect(screen.getByText('Tally · not added yet')).toBeInTheDocument();
  });

  it('replays from the log the same way on another device: the newest word wins', () => {
    seq = 0;
    const view = reduceAll([
      ...turn(offer()),
      logged({ type: 'conch-app.offer', offer: offer({ state: 'added' }) }),
    ]);
    const cards = view.items.filter((i) => i.kind === 'conch-app-offer');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ offer: { state: 'added' } });
  });
});
