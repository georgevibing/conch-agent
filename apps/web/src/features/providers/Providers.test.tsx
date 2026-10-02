import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appState,
  baseProviders,
  FakeSocket,
  mockFetch,
  provider,
  renderApp,
} from '../../test/harness';
import { ProvidersTab } from './ProvidersTab';

afterEach(() => vi.unstubAllGlobals());

const routes = (overrides: Record<string, (body: unknown) => unknown> = {}) => ({
  'GET /api/state': () => appState(),
  'GET /api/providers': () => baseProviders,
  ...overrides,
});

function render() {
  return renderApp(<ProvidersTab />, { route: '/' });
}

describe('Providers settings', () => {
  it('shows every provider, which is the default, and what each one needs', async () => {
    mockFetch(routes());
    render();

    const claude = await screen.findByRole('article', { name: 'Claude Code' });
    expect(claude).toHaveTextContent('Default');
    expect(claude).toHaveTextContent('Claude Max · you@example.com');
    expect(within(claude).getByRole('button', { name: 'Check again' })).toBeInTheDocument();

    const codex = screen.getByRole('article', { name: 'Codex' });
    expect(codex).toHaveTextContent('Early support');
    expect(codex).toHaveTextContent('Codex isn’t on this computer yet.');
    expect(within(codex).getByRole('button', { name: 'How to install' })).toBeInTheDocument();

    const openrouter = screen.getByRole('article', { name: 'OpenRouter' });
    expect(within(openrouter).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('installs a provider’s program with one button, showing its progress', async () => {
    const codex = baseProviders.providers.find((p) => p.id === 'codex-cli');
    if (!codex) throw new Error('fixture');
    const installable = {
      ...codex,
      status: { ...codex.status, fix: { need: 'codex', kind: 'install' as const } },
    };
    let installing = false;
    const need = () => ({
      ready: false,
      needs: [
        installing
          ? {
              id: 'codex',
              name: 'Codex',
              short: 'Codex',
              openable: false,
              state: 'installing',
              progress: { percent: 30, label: 'Downloading Codex · 30%' },
            }
          : {
              id: 'codex',
              name: 'Codex',
              short: 'Codex',
              openable: false,
              state: 'missing',
              install: { label: 'Install Codex', command: 'winget install --id OpenAI.Codex' },
            },
      ],
    });
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({
          ...baseProviders,
          providers: baseProviders.providers.map((p) => (p.id === 'codex-cli' ? installable : p)),
        }),
        'GET /api/needs/codex': need,
        'POST /api/needs/codex/install': () => {
          installing = true;
          return need();
        },
      }),
    );
    render();
    const card = await screen.findByRole('article', { name: 'Codex' });
    await userEvent.click(within(card).getByRole('button', { name: 'Install' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Install Codex' }));
    expect(
      await screen.findByRole('progressbar', { name: 'Downloading Codex · 30%' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/needs/codex/install')).toBe(
      true,
    );
    // The commands are still there for anyone who'd rather, folded away.
    expect(screen.getByRole('button', { name: 'Or install it yourself' })).toBeInTheDocument();
  });

  it('offers to install the 1Password CLI when you keep a key in 1Password', async () => {
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({
          ...baseProviders,
          onePassword: { ...baseProviders.onePassword, fix: { need: 'op', kind: 'install' } },
        }),
        'GET /api/needs/op': () => ({
          ready: false,
          needs: [
            {
              id: 'op',
              name: 'The 1Password command-line tool',
              short: '1Password CLI',
              openable: false,
              state: 'missing',
              install: {
                label: 'Install 1Password CLI',
                command: 'winget install --id AgileBits.1Password.CLI',
              },
            },
          ],
        }),
      }),
    );
    render();
    const card = await screen.findByRole('article', { name: 'OpenRouter' });
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('region', { name: /^Connect / });
    await userEvent.click(within(dialog).getByRole('radio', { name: '1Password' }));
    expect(
      await within(dialog).findByRole('button', { name: 'Install the 1Password CLI' }),
    ).toBeInTheDocument();
    // No command to copy when Conch can do it.
    expect(within(dialog).queryByRole('button', { name: 'Copy install command' })).toBeNull();
    expect(calls.some((c) => c.path === '/api/needs/op')).toBe(true);
  });

  it('changes the default provider', async () => {
    const second = provider({
      id: 'anthropic-api',
      name: 'Anthropic API',
      tagline: 'Claude, billed per token',
      connect: 'key',
      active: false,
      status: { ...provider().status, engine: 'anthropic-api', label: 'Anthropic API' },
      key: { source: 'conch', hint: '…4f2c', savedAt: 1 },
    });
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({
          ...baseProviders,
          providers: [...baseProviders.providers, second],
        }),
        'POST /api/providers/anthropic-api/use': () => ({
          ...baseProviders,
          active: 'anthropic-api',
          providers: [
            ...baseProviders.providers.map((p) => ({ ...p, active: false })),
            { ...second, active: true },
          ],
        }),
      }),
    );
    render();

    const card = await screen.findByRole('article', { name: 'Anthropic API' });
    await userEvent.click(within(card).getByRole('button', { name: 'Make default' }));
    expect(calls.find((call) => call.path === '/api/providers/anthropic-api/use')?.method).toBe(
      'POST',
    );
    expect(await screen.findByRole('article', { name: 'Anthropic API' })).toHaveTextContent(
      'Default',
    );
  });

  it('takes a key, checks its shape first, and never puts it in the address', async () => {
    const calls = mockFetch(
      routes({
        'PUT /api/providers/openrouter/key': () => ({
          ...baseProviders,
          providers: baseProviders.providers.map((p) =>
            p.id === 'openrouter'
              ? {
                  ...p,
                  ready: true,
                  status: { ...p.status, state: 'ready' as const },
                  key: { source: 'conch' as const, hint: '…9abc', savedAt: 2 },
                }
              : p,
          ),
        }),
      }),
    );
    render();

    const card = await screen.findByRole('article', { name: 'OpenRouter' });
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('region', { name: /^Connect / });
    expect(within(dialog).getByRole('heading', { name: 'Connect OpenRouter' })).toBeInTheDocument();
    // It can make a key for you, so that's offered first.
    expect(
      within(dialog).getByRole('button', { name: 'Sign in to OpenRouter' }),
    ).toBeInTheDocument();

    const field = within(dialog).getByLabelText('OpenRouter key');
    await userEvent.click(field);
    await userEvent.paste('nope-not-a-key');
    expect(within(dialog).getByText('OpenRouter keys start with sk-or-.')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.paste('sk-or-v1-0123456789abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));

    const sent = calls.find((call) => call.method === 'PUT');
    expect(sent?.path).toBe('/api/providers/openrouter/key');
    expect(sent?.body).toEqual({ value: 'sk-or-v1-0123456789abc' });
    expect(await screen.findByRole('heading', { name: 'OpenRouter is connected' })).toBeVisible();
    // It opened in place of the list, not in a dialog on top — and it stays until you go back.
    expect(screen.queryByRole('dialog')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(screen.getByRole('heading', { name: 'OpenRouter is connected' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(await screen.findByRole('article', { name: 'OpenRouter' })).toBeInTheDocument();
  });

  it('offers 1Password and says what’s missing when it isn’t installed', async () => {
    mockFetch(routes());
    render();

    const card = await screen.findByRole('article', { name: 'OpenRouter' });
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('region', { name: /^Connect / });
    await userEvent.click(within(dialog).getByRole('radio', { name: '1Password' }));
    expect(
      within(dialog).getByText(
        'Install the 1Password command line tool to keep keys in 1Password.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('brew install 1password-cli')).toBeInTheDocument();
  });

  it('shows how to install a program that isn’t here, and keeps watching', async () => {
    mockFetch(routes());
    render();

    const card = await screen.findByRole('article', { name: 'Codex' });
    await userEvent.click(within(card).getByRole('button', { name: 'How to install' }));
    const dialog = await screen.findByRole('region', { name: /^Connect / });
    expect(within(dialog).getByText('npm install -g @openai/codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Waiting for Codex…')).toBeInTheDocument();
    // What it can't do is said before you connect, not discovered later.
    expect(within(dialog).getByText(/can’t ask you before each step/)).toBeInTheDocument();
  });

  it('asks before forgetting a saved key', async () => {
    const withKey = baseProviders.providers.map((p) =>
      p.id === 'claude-code'
        ? {
            ...p,
            key: { source: '1password' as const, hint: 'op://Private/Claude/key', savedAt: 1 },
          }
        : p,
    );
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({ ...baseProviders, providers: withKey }),
        'DELETE /api/providers/claude-code/key': () => baseProviders,
      }),
    );
    render();

    const card = await screen.findByRole('article', { name: 'Claude Code' });
    await userEvent.click(within(card).getByRole('button', { name: 'Remove key' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('The key itself stays in 1Password.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove key' }));
    expect(calls.find((call) => call.method === 'DELETE')?.path).toBe(
      '/api/providers/claude-code/key',
    );
  });
});

describe('ChatGPT subscription connection', () => {
  it('offers subscription sign-in without an API key and shows the remote device code', async () => {
    const codex = provider({
      id: 'codex-cli',
      name: 'Codex',
      active: false,
      connect: 'program',
      signInLabel: 'Sign in with your ChatGPT subscription',
      signInHelp: 'No API key needed. Conch keeps a separate encrypted connection.',
      status: { ...provider().status, engine: 'codex-cli', label: 'Codex', state: 'signed-out' },
    });
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({ ...baseProviders, providers: [codex] }),
        'POST /api/providers/codex-cli/login': () => ({ ok: true }),
      }),
    );
    render();
    await userEvent.click(
      within(await screen.findByRole('article', { name: 'Codex' })).getByRole('button', {
        name: 'Connect',
      }),
    );
    expect(await screen.findByText(/No API key needed/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign in with your ChatGPT subscription' }),
    );
    expect(calls.some((c) => c.path === '/api/providers/codex-cli/login')).toBe(true);
    act(() =>
      FakeSocket.last?.push({
        type: 'engine.login',
        login: {
          loginId: 'device',
          phase: 'waiting-for-browser',
          url: 'https://auth.openai.com/codex/device',
          code: 'TEST-1234',
        },
      }),
    );
    // The code is there to read, and one button copies it and opens the page it goes on.
    expect(
      await screen.findByRole('group', { name: 'Sign-in code T E S T - 1 2 3 4' }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const open = screen.getByRole('link', { name: 'Copy code and open sign-in page' });
    expect(open).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
    await user.click(open);
    expect(writeText).toHaveBeenCalledWith('TEST-1234');
    expect(await screen.findByText(/Code copied/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
  it('still offers the sign-in page alone when a provider has no code to enter', async () => {
    const claude = provider({
      connect: 'program',
      status: { ...provider().status, state: 'signed-out' },
    });
    mockFetch(
      routes({
        'GET /api/providers': () => ({ ...baseProviders, providers: [claude] }),
        'POST /api/providers/claude-code/login': () => ({ ok: true }),
      }),
    );
    render();
    await userEvent.click(
      within(await screen.findByRole('article', { name: 'Claude Code' })).getByRole('button', {
        name: 'Connect',
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /Sign in to Claude Code/ }));
    act(() =>
      FakeSocket.last?.push({
        type: 'engine.login',
        login: {
          loginId: 'browser',
          phase: 'waiting-for-browser',
          url: 'https://claude.ai/oauth/authorize',
        },
      }),
    );
    expect(await screen.findByRole('link', { name: /Open the sign-in page/ })).toHaveAttribute(
      'href',
      'https://claude.ai/oauth/authorize',
    );
    expect(screen.queryByRole('group', { name: /Sign-in code/ })).toBeNull();
  });
  it('disconnects only the Conch-managed account', async () => {
    const codex = provider({
      id: 'codex-cli',
      name: 'Codex',
      active: false,
      disconnectable: true,
      status: { ...provider().status, engine: 'codex-cli', label: 'Codex' },
    });
    const calls = mockFetch(
      routes({
        'GET /api/providers': () => ({ ...baseProviders, providers: [codex] }),
        'DELETE /api/providers/codex-cli/key': () => baseProviders,
      }),
    );
    render();
    await userEvent.click(
      within(await screen.findByRole('article', { name: 'Codex' })).getByRole('button', {
        name: 'Disconnect',
      }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Your sign-ins in other apps are not changed.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(
      calls.some((c) => c.method === 'DELETE' && c.path === '/api/providers/codex-cli/key'),
    ).toBe(true);
  });
});
