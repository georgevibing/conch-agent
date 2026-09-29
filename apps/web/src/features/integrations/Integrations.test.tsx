import type { CatalogEntry, ExternalList, Integration } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reduceAll } from '../../live/reducer';
import { FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { splitCommand } from './CustomDialog';
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
  servers: [{ name: 'filesystem', source: 'engine', state: 'ok', toolCount: 11 }],
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
        provider,
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
    expect(await screen.findByText('filesystem')).toBeInTheDocument();
  });

  it('updates live when an integration recovers', async () => {
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        provider,
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
      'GET /api/integrations': () => ({ catalog, provider, integrations: [] }),
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
      'GET /api/integrations': () => ({ catalog, provider, integrations: [] }),
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

  it('never sends the browser to anything but a web page', async () => {
    const popup = { closed: false, location: { href: '' }, focus: vi.fn(), close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    mockFetch({
      'GET /api/integrations': () => ({ catalog, provider, integrations: [] }),
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
