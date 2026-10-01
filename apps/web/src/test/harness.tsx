import type { AppState, EngineStatus, Provider, ProvidersList, ServerEvent } from '@conch/protocol';
import { NacreProvider } from '@conch/nacre';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import { LiveProvider } from '../live/LiveProvider';

/** In-memory WebSocket so tests can assert what's sent and push server events. */
export class FakeSocket {
  static last?: FakeSocket;
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onclose?: () => void;

  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
  }

  push(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

export const baseEngine: EngineStatus = {
  engine: 'claude-code',
  label: 'Claude Code',
  state: 'ready',
  version: '2.1.284',
  executablePath: '/usr/local/bin/claude',
  auth: { method: 'subscription', description: 'Claude Max · you@example.com' },
  install: [
    { label: 'Install script', command: 'curl -fsSL https://claude.ai/install.sh | bash' },
    { label: 'npm', command: 'npm install -g @anthropic-ai/claude-code' },
  ],
  docsUrl: 'https://code.claude.com/docs/en/setup',
  canSignIn: true,
  checkedAt: 1,
};

/** One provider, ready to be tweaked per test. */
export function provider(patch: Partial<Provider> = {}): Provider {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    tagline: 'Claude, on this computer',
    description: 'Anthropic’s coding agent, already on this machine.',
    connect: 'program',
    status: baseEngine,
    active: true,
    local: false,
    ready: true,
    highlights: ['Works with your files'],
    limits: [],
    install: baseEngine.install,
    experimental: false,
    hidden: false,
    ...patch,
  };
}

export const baseProviders: ProvidersList = {
  active: 'claude-code',
  providers: [
    provider(),
    provider({
      id: 'codex-cli',
      name: 'Codex',
      tagline: 'OpenAI’s coding agent',
      description: 'OpenAI’s agent for your machine.',
      active: false,
      ready: false,
      experimental: true,
      limits: ['Codex decides inside its own sandbox, so Conch can’t ask you before each step.'],
      status: {
        engine: 'codex-cli',
        label: 'Codex',
        state: 'not-installed',
        message: 'Codex isn’t on this computer yet.',
        install: [{ label: 'npm', command: 'npm install -g @openai/codex' }],
        canSignIn: true,
        checkedAt: 1,
      },
      install: [{ label: 'npm', command: 'npm install -g @openai/codex' }],
    }),
    provider({
      id: 'openrouter',
      name: 'OpenRouter',
      tagline: 'Hundreds of models, one key',
      description: 'One key for models from every lab.',
      connect: 'key',
      active: false,
      ready: false,
      status: {
        engine: 'openrouter',
        label: 'OpenRouter',
        state: 'signed-out',
        install: [],
        canSignIn: false,
        checkedAt: 1,
      },
      install: [],
      keyForm: {
        label: 'OpenRouter key',
        placeholder: 'sk-or-v1-…',
        help: 'Or sign in and let OpenRouter make one.',
        url: 'https://openrouter.ai/settings/keys',
        pattern: '^sk-or-',
        patternHint: 'OpenRouter keys start with sk-or-.',
        canSignIn: true,
      },
    }),
  ],
  onePassword: {
    available: false,
    message: 'Install the 1Password command line tool to keep keys in 1Password.',
    installCommand: 'brew install 1password-cli',
  },
};

export function providersList(patch: Partial<ProvidersList> = {}): ProvidersList {
  return { ...baseProviders, ...patch };
}

export function appState(patch: Partial<AppState> = {}): AppState {
  return {
    serverVersion: '0.2.0',
    protocolVersion: 2,
    onboarded: true,
    persona: { name: 'Conch', tone: 'warm', instructions: '' },
    profile: { name: 'Ada', about: '' },
    preferences: {
      engine: 'claude-code',
      autoMemory: true,
      autoTitle: true,
      effort: 'auto',
      fastMode: false,
      permissionMode: 'default',
      offlineFallback: true,
      mutedSuggestions: [],
      checkAfterReading: true,
      sealedCommands: true,
      menuBar: true,
      keepAwake: false,
      tidyMemory: false,
    },
    engine: baseEngine,
    workspace: '/home/ada/.conch/workspace',
    network: { online: true },
    ...patch,
  };
}

/** Route fetch calls to handlers keyed by "METHOD /path". Unknown routes 404. */
export function mockFetch(routes: Record<string, (body: unknown) => unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 });
    const result = handler(body);
    // Handlers can return a Response to simulate errors (401, 429…).
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function renderApp(ui: ReactElement, { route = '/' } = {}) {
  vi.stubGlobal('WebSocket', FakeSocket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <NacreProvider scope="local">
      <QueryClientProvider client={client}>
        <LiveProvider url="ws://test/ws">
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </LiveProvider>
      </QueryClientProvider>
    </NacreProvider>,
  );
  return { ...view, client };
}
