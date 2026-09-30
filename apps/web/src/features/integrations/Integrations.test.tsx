import type { CatalogEntry, ExternalList, Integration } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { splitCommand } from './CustomDialog';
import { IntegrationDetailView } from './IntegrationDetailView';
import { IntegrationsView } from './IntegrationsView';

afterEach(() => vi.unstubAllGlobals());

const entry = (
  patch: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'name' | 'auth'>,
): CatalogEntry => ({
  tagline: `${patch.name} tagline`,
  description: `Claude can use ${patch.name}.`,
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
  entry({ id: 'notion', name: 'Notion', auth: 'oauth', examples: ['Find my notes'] }),
  entry({
    id: 'github',
    name: 'GitHub',
    auth: 'token',
    category: 'developer',
    fields: [
      {
        key: 'token',
        label: 'Access token',
        secret: true,
        optional: false,
        pattern: '^github_pat_\\w{10,}$',
        patternHint: 'GitHub tokens start with github_pat_.',
      },
    ],
    steps: ['Open GitHub’s token page.'],
  }),
  entry({ id: 'gmail', name: 'Gmail', auth: 'account' }),
  entry({ id: 'linear', name: 'Linear', auth: 'oauth' }),
];

const integration = (patch: Partial<Integration>): Integration => ({
  id: 'int_1',
  catalogId: 'notion',
  name: 'Notion',
  server: 'notion',
  transport: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  auth: 'oauth',
  enabled: true,
  policy: 'ask-writes',
  health: { state: 'ok', checkedAt: 1, okAt: 1 },
  tools: [{ name: 'search', description: '', access: 'read', destructive: false }],
  values: {},
  secrets: [],
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const provider = {
  id: 'claude-code' as const,
  engine: 'Claude Code',
  mode: 'native' as const,
  hasOwnServers: true,
  account: {
    label: 'your Claude account',
    url: 'https://claude.ai/settings/connectors',
    ready: true,
  },
};

const external: ExternalList = {
  servers: [
    {
      name: 'filesystem',
      provider: 'claude-code',
      providerName: 'Claude Code',
      source: 'engine',
      state: 'ok',
      toolCount: 11,
    },
  ],
  checkedAt: 1,
};

describe('Integrations page', () => {
  it('puts what needs you first, with the button that fixes it', async () => {
    const broken = integration({
      id: 'int_2',
      catalogId: 'linear',
      name: 'Linear',
      server: 'linear',
      health: {
        state: 'needs-auth',
        message: 'Sign in again to keep using it.',
        action: 'reconnect',
      },
    });
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [provider],
        integrations: [integration({}), broken],
      }),
      'GET /api/integrations/external': () => external,
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    const connected = await screen.findByRole('region', { name: 'Connected' });
    const cards = within(connected).getAllByRole('article');
    expect(
      cards.map(
        (c) =>
          c.getAttribute('aria-labelledby') && within(c).getAllByRole('button')[0]?.textContent,
      ),
    ).toEqual(['Linear', 'Notion']);
    expect(
      within(cards[0] as HTMLElement).getByRole('button', { name: 'Sign in again' }),
    ).toBeInTheDocument();
    // Connected apps aren't offered again; the rest are.
    const add = screen.getByRole('region', { name: 'Add another app' });
    expect(within(add).queryByRole('button', { name: 'Notion' })).toBeNull();
    expect(within(add).getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
    // What a provider set up by itself is folded away under its name.
    await userEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    expect(await screen.findByText('filesystem')).toBeInTheDocument();
  });

  it('updates live when an integration recovers', async () => {
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [provider],
        integrations: [
          integration({
            health: { state: 'error', message: 'Notion is having problems.', action: 'retry' },
          }),
        ],
      }),
      'GET /api/integrations/external': () => external,
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    expect(await screen.findByText('Notion is having problems.')).toBeInTheDocument();
    act(() => FakeSocket.last?.push({ type: 'integration.changed', integration: integration({}) }));
    await waitFor(() => expect(screen.queryByText('Notion is having problems.')).toBeNull());
    expect(screen.getByText(/1 tool · not used yet/)).toBeInTheDocument();
  });

  it('connects with a token, checking its shape first', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [provider], integrations: [] }),
      'GET /api/integrations/external': () => external,
      'POST /api/integrations': () => ({
        integration: integration({
          id: 'int_gh',
          catalogId: 'github',
          name: 'GitHub',
          auth: 'token',
        }),
      }),
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    await userEvent.click(await screen.findByRole('button', { name: 'GitHub' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect GitHub' });
    const field = within(dialog).getByLabelText(/Access token/);
    await userEvent.type(field, 'ghp-nope');
    expect(within(dialog).getByText('GitHub tokens start with github_pat_.')).toBeInTheDocument();
    await userEvent.clear(field);
    // Paste the real token, as people do: typing it key by key re-renders the dialog 24 times.
    await userEvent.paste('github_pat_0123456789abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('heading', { name: 'GitHub is connected' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      catalogId: 'github',
      values: { token: 'github_pat_0123456789abc' },
    });
  });

  it('signs in through a popup and celebrates when the service comes back', async () => {
    const popup = { closed: false, location: { href: '' }, focus: vi.fn(), close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    const pending = integration({
      health: { state: 'connecting', message: 'Waiting for you to sign in.' },
    });
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [provider], integrations: [] }),
      'GET /api/integrations/external': () => external,
      'POST /api/integrations': () => ({
        integration: pending,
        authorizeUrl: 'https://mcp.notion.com/authorize?state=abc',
      }),
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    await userEvent.click(await screen.findByRole('button', { name: 'Notion' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Notion' }));
    await waitFor(() =>
      expect(popup.location.href).toBe('https://mcp.notion.com/authorize?state=abc'),
    );
    expect(calls.find((c) => c.method === 'POST')?.path).toBe('/api/integrations?display=popup');
    expect(
      await screen.findByRole('heading', { name: 'Signing in to Notion…' }),
    ).toBeInTheDocument();
    act(() => FakeSocket.last?.push({ type: 'integration.changed', integration: integration({}) }));
    expect(await screen.findByRole('heading', { name: 'Notion is connected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find my notes' })).toBeInTheDocument();
  });

  describe('apps that run on this computer', () => {
    const onePassword = entry({
      id: '1password',
      name: '1Password',
      auth: 'none',
      local: true,
      category: 'developer',
      command: '1password-mcp',
      steps: ['In 1Password, open Settings → Labs and turn on “Enable local MCP server”.'],
    });
    const app = {
      id: '1password-app',
      name: 'The 1Password app',
      short: '1Password',
      openable: false,
    };
    const server = {
      id: '1password-mcp',
      name: '1Password’s MCP server',
      short: '1Password’s MCP server',
      openable: false,
    };
    const install = {
      label: 'Install 1Password',
      command: 'winget install --id AgileBits.1Password',
    };
    const added = (patch: Partial<Integration> = {}) =>
      integration({
        id: 'int_1p',
        catalogId: '1password',
        name: '1Password',
        server: '1password',
        transport: { type: 'stdio', command: '1password-mcp', args: [] },
        auth: 'none',
        ...patch,
      });

    it('offers to install what’s missing, then connects by itself', async () => {
      let stage: 'missing' | 'installing' | 'ready' = 'missing';
      const readiness = () => ({
        ready: stage === 'ready',
        needs:
          stage === 'missing'
            ? [
                { ...app, state: 'missing', install },
                { ...server, state: 'missing', message: 'Comes with the 1Password app.' },
              ]
            : stage === 'installing'
              ? [
                  {
                    ...app,
                    state: 'installing',
                    progress: { percent: 40, label: 'Downloading 1Password · 40%' },
                  },
                  { ...server, state: 'installing' },
                ]
              : [
                  { ...app, state: 'ready', openable: true },
                  { ...server, state: 'ready', openable: true },
                ],
      });
      const calls = mockFetch({
        'GET /api/integrations': () => ({
          catalog: [onePassword],
          providers: [provider],
          integrations: [],
        }),
        'GET /api/integrations/external': () => external,
        'GET /api/integrations/catalog/1password/needs': () => {
          const now = readiness();
          if (stage === 'installing') stage = 'ready';
          return now;
        },
        'POST /api/integrations/catalog/1password/needs/1password-app/install': () => {
          stage = 'installing';
          return readiness();
        },
        'POST /api/integrations': () => ({ integration: added() }),
      });
      renderApp(<IntegrationsView />, { route: '/integrations' });
      await userEvent.click(await screen.findByRole('button', { name: '1Password' }));
      const dialog = await screen.findByRole('dialog', { name: 'Connect 1Password' });
      const needs = await within(dialog).findByRole('list', { name: 'What 1Password needs' });
      expect(
        within(needs)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([
        'To do: The 1Password appConch can install it for you. It takes a minute or two.',
        'Later: 1Password’s MCP serverComes with the 1Password app.',
        'Later: Turn it on',
      ]);
      // What will run is there to read before you agree.
      expect(
        within(dialog).getByText('winget install --id AgileBits.1Password'),
      ).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole('button', { name: 'Install 1Password' }));
      expect(
        await within(dialog).findByRole('progressbar', { name: 'Downloading 1Password · 40%' }),
      ).toBeInTheDocument();
      // Nobody presses anything: once it's installed, Conch connects it.
      expect(
        await screen.findByRole('heading', { name: '1Password is connected' }, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
        '/api/integrations/catalog/1password/needs/1password-app/install',
        '/api/integrations?display=popup',
      ]);
    });

    it('finishes one that’s waiting on a switch, and notices when you come back', async () => {
      const off = added({
        health: {
          state: 'error',
          message: 'Turn on the MCP server in 1Password.',
          action: 'setup',
        },
      });
      const calls = mockFetch({
        'GET /api/integrations': () => ({
          catalog: [onePassword],
          providers: [provider],
          integrations: [off],
        }),
        'GET /api/integrations/external': () => external,
        'GET /api/integrations/catalog/1password/needs': () => ({
          ready: true,
          needs: [
            { ...app, state: 'ready', openable: true },
            { ...server, state: 'ready', openable: true },
          ],
        }),
        'POST /api/integrations/catalog/1password/needs/1password-app/open': () => ({
          ready: true,
          needs: [],
        }),
        'POST /api/integrations/int_1p/check': () => added(),
      });
      renderApp(<IntegrationsView />, { route: '/integrations' });
      expect(await screen.findByText('Turn on the MCP server in 1Password.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

      const dialog = await screen.findByRole('dialog', { name: 'Connect 1Password' });
      expect(await within(dialog).findByText(/Settings → Labs/)).toBeInTheDocument();
      // Waiting on you isn't a failure: no red error box.
      expect(within(dialog).queryByText('Turn on the MCP server in 1Password.')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Open 1Password' }));
      expect(calls.some((c) => c.path.endsWith('/needs/1password-app/open'))).toBe(true);

      // Back from 1Password: Conch looks again by itself.
      act(() => window.dispatchEvent(new Event('focus')));
      expect(
        await screen.findByRole('heading', { name: '1Password is connected' }),
      ).toBeInTheDocument();
    });
  });

  it('offers to install the program one you added runs with', async () => {
    const fetchServer = integration({
      id: 'int_fetch',
      catalogId: undefined,
      name: 'Fetch',
      server: 'fetch',
      transport: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      auth: 'none',
      health: {
        state: 'error',
        message: 'Needs uv (runs Python tools).',
        action: 'setup',
        need: 'uv',
      },
      tools: [],
    });
    const calls = mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [provider],
        integrations: [fetchServer],
      }),
      'GET /api/needs/uv': () => ({
        ready: false,
        needs: [
          {
            id: 'uv',
            name: 'uv (runs Python tools)',
            short: 'uv',
            openable: false,
            state: 'missing',
            install: { label: 'Install uv', command: 'winget install --id astral-sh.uv' },
          },
        ],
      }),
      'POST /api/needs/uv/install': () => ({ ready: false, needs: [] }),
    });
    renderApp(<IntegrationDetailView integrationId="int_fetch" />, {
      route: '/integrations/int_fetch',
    });
    expect(await screen.findByText('Needs uv (runs Python tools).')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Install uv' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/needs/uv/install')).toBe(true);
    // No "Try again" next to it: pressing it again changes nothing until uv is here.
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull();
  });

  it('never sends the browser to anything but a web page', async () => {
    const popup = { closed: false, location: { href: '' }, focus: vi.fn(), close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [provider], integrations: [] }),
      'GET /api/integrations/external': () => external,
      'POST /api/integrations': () => ({
        integration: integration({ health: { state: 'connecting' } }),
        authorizeUrl: 'javascript:alert(1)',
      }),
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    await userEvent.click(await screen.findByRole('button', { name: 'Notion' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Notion' }));
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    expect(popup.location.href).toBe('');
  });
});

describe('Integrations belong to Conch, not to a provider', () => {
  it('never shows a service only one provider can reach as connected, and offers to bring one into Conch', async () => {
    const openrouter = {
      id: 'openrouter' as const,
      engine: 'OpenRouter',
      mode: 'bridge' as const,
      hasOwnServers: false,
    };
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [provider, openrouter],
        integrations: [],
      }),
      'GET /api/integrations/external': () => ({
        servers: [
          {
            name: 'Gmail',
            provider: 'claude-code',
            providerName: 'Claude Code',
            source: 'account',
            state: 'ok',
            toolCount: 6,
            catalogId: 'gmail',
          },
          {
            name: 'linear',
            provider: 'claude-code',
            providerName: 'Claude Code',
            source: 'plugin',
            plugin: 'engineering',
            state: 'needs-auth',
            toolCount: 0,
            catalogId: 'linear',
          },
        ],
        checkedAt: 1,
      }),
    });
    renderApp(<IntegrationsView />, { route: '/integrations' });
    expect(await screen.findByText(/with every model you pick/)).toBeInTheDocument();
    const gmail = await screen.findByRole('button', { name: 'Gmail' });
    const tile = gmail.closest('article') as HTMLElement;
    expect(await within(tile).findByText('Only with Claude Code models')).toBeInTheDocument();
    expect(within(tile).queryByLabelText(/connected/i)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Claude Code.*1 server/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use with every model' }));
    expect(await screen.findByRole('dialog', { name: 'Connect Linear' })).toBeInTheDocument();
  });
});

describe('splitCommand', () => {
  it('splits like a shell would, without running one', () => {
    expect(splitCommand('npx -y @scope/pkg "My Docs" \'a b\'')).toEqual([
      'npx',
      '-y',
      '@scope/pkg',
      'My Docs',
      'a b',
    ]);
    expect(splitCommand('run "" x; rm -rf ~')).toEqual(['run', '', 'x;', 'rm', '-rf', '~']);
  });
});

describe('integration issues in a chat', () => {
  it('shows one card per integration per turn', () => {
    const base = { conversationId: 'c', at: 1 };
    const issue = (seq: number) => ({
      ...base,
      seq,
      type: 'integration.issue' as const,
      integrationId: 'int_1',
      name: 'Notion',
      state: 'needs-auth' as const,
      message: 'Sign in again.',
    });
    const view = reduceAll([
      { ...base, seq: 0, type: 'user.message', messageId: 'u1', text: 'hi' },
      issue(1),
      issue(2),
      { ...base, seq: 3, type: 'user.message', messageId: 'u2', text: 'again' },
      issue(4),
    ]);
    expect(view.items.filter((i) => i.kind === 'integration-issue')).toHaveLength(2);
  });
});
