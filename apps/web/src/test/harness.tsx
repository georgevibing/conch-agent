import type { AppState, EngineStatus, ServerEvent } from '@conch/protocol';
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

export function appState(patch: Partial<AppState> = {}): AppState {
  return {
    serverVersion: '0.2.0',
    protocolVersion: 2,
    onboarded: true,
    persona: { name: 'Conch', tone: 'warm', instructions: '' },
    profile: { name: 'Ada', about: '' },
    preferences: { engine: 'claude-code', autoMemory: true },
    engine: baseEngine,
    workspace: '/home/ada/.conch/workspace',
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
    return new Response(JSON.stringify(handler(body)), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function renderApp(ui: ReactElement, { route = '/' } = {}) {
  vi.stubGlobal('WebSocket', FakeSocket);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NacreProvider scope="local">
      <QueryClientProvider client={client}>
        <LiveProvider url="ws://test/ws">
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </LiveProvider>
      </QueryClientProvider>
    </NacreProvider>,
  );
}
