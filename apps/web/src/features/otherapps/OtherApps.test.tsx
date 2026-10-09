import type { McpOverview } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { ClientBanner } from './ClientBanner';
import { OtherAppsTab } from './OtherAppsTab';
import { usesWords } from './words';

afterEach(() => vi.unstubAllGlobals());

const choices: McpOverview['choices'] = [
  { scope: 'memory.read', title: 'Search what Conch knows about you' },
  { scope: 'memory.write', title: 'Suggest things to remember' },
  { scope: 'skills', title: 'Use your skills' },
  { scope: 'browser', title: 'Use Conch’s browser' },
  { scope: 'app:gmail', title: 'Gmail', catalogId: 'gmail' },
];

const overview = (over: Partial<McpOverview> = {}): McpOverview => ({
  clients: [],
  targets: [
    {
      app: 'claude-desktop',
      name: 'Claude Desktop',
      found: false,
      connected: false,
      file: '/home/ada/.config/Claude/claude_desktop_config.json',
    },
    {
      app: 'cursor',
      name: 'Cursor',
      found: true,
      connected: false,
      file: '/home/ada/.cursor/mcp.json',
    },
    {
      app: 'vscode',
      name: 'VS Code',
      found: true,
      connected: false,
      file: '/home/ada/.config/Code/User/mcp.json',
    },
  ],
  remote: false,
  choices,
  endpoint: 'http://127.0.0.1:4317/mcp',
  ...over,
});

const access = { method: 'none', suggestedUsername: 'ada', keys: [], passkeys: [] };

describe('Other apps', () => {
  it('connects Cursor with what you tick, after showing the file it writes', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/mcp': () => overview(),
      'GET /api/access': () => access,
      'POST /api/mcp/clients': () => ({
        client: {
          id: 'mcpc_1',
          name: 'Cursor',
          app: 'cursor',
          scopes: ['memory.read', 'skills', 'app:gmail'],
          createdAt: 1,
          http: false,
          remote: false,
        },
        wrote: '/home/ada/.cursor/mcp.json',
        next: 'Quit Cursor and open it again to see Conch.',
      }),
    });
    renderApp(<OtherAppsTab />);
    await user.click(await screen.findByRole('button', { name: 'Pair an app' }));
    const chooser = await screen.findByRole('dialog', { name: 'Pair an app' });
    const list = within(chooser).getByRole('list', { name: 'Apps Conch can connect' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Not on this computer');
    await user.click(within(list).getAllByRole('button', { name: 'Connect' })[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Connect Cursor' });
    // It came from the list, so the way out is back to it.
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('/home/ada/.cursor/mcp.json');
    // It starts with memory and skills: things that look, nothing that acts.
    expect(within(dialog).getByRole('checkbox', { name: /Search what Conch knows/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Use Conch’s browser/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Gmail' }));
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(
      await within(dialog).findByText('Quit Cursor and open it again to see Conch.'),
    ).toBeVisible();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      app: 'cursor',
      scopes: ['memory.read', 'skills', 'app:gmail'],
    });
  });

  it('holds the room with placeholder rows while it loads, then shows a calm splash', async () => {
    mockFetch({
      'GET /api/mcp': () => overview(),
      'GET /api/access': () => access,
    });
    const { container } = renderApp(<OtherAppsTab />);
    // The heading and its sentence are there from the start; only the rows wait.
    expect(screen.getByRole('heading', { level: 3, name: 'Apps that use Conch' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
    const splash = await screen.findByRole('heading', { level: 4, name: 'Nothing paired yet' });
    expect(splash).toBeVisible();
    expect(container.querySelector('[data-skeleton]')).toBeNull();
    // One obvious button, and no jargon before you ask for it.
    expect(screen.getAllByRole('button', { name: 'Pair an app' })).toHaveLength(1);
    const words = container.textContent ?? '';
    expect(words.split('For developers')[0]).not.toMatch(/MCP|HTTP/);
  });

  it('fits inside another place, a level down', async () => {
    mockFetch({
      'GET /api/mcp': () => overview(),
      'GET /api/access': () => access,
    });
    renderApp(<OtherAppsTab headingLevel={4} />);
    expect(screen.getByRole('heading', { level: 4, name: 'Apps that use Conch' })).toBeVisible();
    expect(
      await screen.findByRole('heading', { level: 5, name: 'Nothing paired yet' }),
    ).toBeVisible();
  });

  it('pairs another app over HTTP and shows its key once', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/mcp': () => overview(),
      'GET /api/access': () => access,
      'POST /api/mcp/clients': () => ({
        client: {
          id: 'mcpc_2',
          name: 'Zed',
          app: 'other',
          scopes: ['memory.read', 'skills'],
          createdAt: 1,
          http: true,
          remote: false,
        },
        setup: {
          command: '/usr/bin/node',
          args: ['/home/ada/.conch/mcp/launcher.mjs', '--client', 'mcpc_2'],
          json: '{ "mcpServers": {} }',
          url: 'http://127.0.0.1:4317/mcp',
          key: 'cmcp.mcpc_2.' + 'secret',
        },
      }),
    });
    renderApp(<OtherAppsTab />);
    await user.click(await screen.findByRole('button', { name: 'Pair an app' }));
    await user.click(await screen.findByRole('button', { name: 'Another app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pair another app' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Its name' }), 'Zed');
    await user.click(within(dialog).getByRole('switch', { name: /Give it a key instead/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Pair' }));
    expect(await within(dialog).findByText('cmcp.mcpc_2.secret')).toBeVisible();
    expect(dialog).toHaveTextContent('http://127.0.0.1:4317/mcp');
  });

  it('lists what each paired app may use, and removes one', async () => {
    const user = userEvent.setup();
    let clients: McpOverview['clients'] = [
      {
        id: 'mcpc_1',
        name: 'Claude Desktop',
        app: 'claude-desktop',
        scopes: ['memory.read', 'app:gmail', 'browser'],
        createdAt: Date.now(),
        http: false,
        remote: false,
      },
    ];
    const calls = mockFetch({
      'GET /api/mcp': () => overview({ clients }),
      'GET /api/access': () => access,
      'DELETE /api/mcp/clients/mcpc_1': () => {
        clients = [];
        return { ok: true };
      },
    });
    renderApp(<OtherAppsTab />);
    const paired = await screen.findByRole('list', { name: 'Apps paired with Conch' });
    expect(paired).toHaveTextContent('Your memory, Gmail and the browser');
    expect(paired).toHaveTextContent('Not used yet');
    await user.click(within(paired).getByRole('button', { name: 'Remove Claude Desktop' }));
    // Removing asks once, and Cancel keeps it.
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Claude Desktop?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    // Nothing paired any more: the list gives way to the splash.
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Apps paired with Conch' })).toBeNull(),
    );
    expect(await screen.findByRole('heading', { name: 'Nothing paired yet' })).toBeVisible();
  });

  it('keeps how it works under For developers, your address with it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/mcp': () => overview({ address: 'https://conch.example.com/mcp' }),
      'GET /api/access': () => access,
    });
    renderApp(<OtherAppsTab />);
    await user.click(await screen.findByRole('button', { name: 'For developers' }));
    expect(screen.getByText('http://127.0.0.1:4317/mcp')).toBeVisible();
    // Your own address: there, and off until you turn it on.
    expect(
      screen.getByRole('switch', { name: /Let apps on other computers in/ }),
    ).not.toBeChecked();
  });

  it('keeps For developers open while apps on other computers may come in', async () => {
    mockFetch({
      'GET /api/mcp': () => overview({ address: 'https://conch.example.com/mcp', remote: true }),
      'GET /api/access': () => access,
    });
    renderApp(<OtherAppsTab />);
    expect(
      await screen.findByRole('switch', { name: /Let apps on other computers in/ }),
    ).toBeChecked();
  });
});

describe('the words', () => {
  it('lists what an app may use as a sentence', () => {
    expect(usesWords(['memory.read'], choices)).toBe('Your memory');
    expect(usesWords(['skills', 'app:gmail', 'browser'], choices)).toBe(
      'Your skills, Gmail and the browser',
    );
    expect(usesWords(['app:gone'], choices)).toBe('An app that’s gone');
  });
});

describe('an app’s own chat', () => {
  it('says whose log it is, and where to change what it may use', async () => {
    mockFetch({
      'GET /api/conversations': () => [
        {
          id: 'c_1',
          title: 'Claude Desktop',
          preview: '',
          createdAt: 1,
          updatedAt: 1,
          status: 'idle',
          options: {},
          origin: { kind: 'client', clientId: 'mcpc_1', name: 'Claude Desktop' },
        },
      ],
    });
    renderApp(<ClientBanner conversationId="c_1" />);
    expect(await screen.findByRole('note')).toHaveTextContent(
      'What Claude Desktop did through Conch',
    );
    expect(screen.getByRole('button', { name: 'What it may use' })).toBeInTheDocument();
  });
});
