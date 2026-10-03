import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Provider, ProvidersList } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseProviders, mockFetch, provider, renderApp } from '../../test/harness';
import { ProvidersTab } from './ProvidersTab';

afterEach(() => vi.unstubAllGlobals());

const keyProvider = (patch: Partial<Provider>): Provider =>
  provider({
    connect: 'key',
    group: 'key',
    active: false,
    ready: false,
    status: { ...provider().status, state: 'signed-out', auth: undefined },
    ...patch,
  });

const groq = keyProvider({
  id: 'groq',
  name: 'Groq',
  tagline: 'Open models, instantly fast',
  free: 'Free tier',
  keyForm: {
    label: 'Groq API key',
    placeholder: 'gsk_…',
    help: 'Create one in the Groq console.',
    url: 'https://console.groq.com/keys',
    pattern: '^gsk_',
    canSignIn: false,
    recognise: { distinct: '^gsk_' },
  },
});
const deepseek = keyProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  tagline: 'Strong models, tiny prices',
  keyForm: {
    label: 'DeepSeek API key',
    placeholder: '',
    help: '',
    pattern: '^sk-',
    canSignIn: false,
    recognise: { loose: '^sk-[a-f0-9]{32}$' },
  },
});
const qwen = keyProvider({
  id: 'qwen',
  name: 'Qwen',
  tagline: 'Qwen models, tiny to frontier',
  keyForm: {
    label: 'Qwen key',
    placeholder: '',
    help: '',
    pattern: '^sk-',
    canSignIn: false,
    recognise: { distinct: '^sk-ws', loose: '^sk-[a-f0-9]{32}$' },
  },
});

const list = (patch: Partial<ProvidersList> = {}): ProvidersList => ({
  ...baseProviders,
  providers: [baseProviders.providers[0] as Provider, groq, deepseek, qwen],
  ...patch,
});

function paste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  act(() => {
    document.body.dispatchEvent(event);
  });
}

describe('more providers', () => {
  it('knows a pasted key by its shape and connects it, from anywhere on the page', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(),
      'PUT /api/providers/groq/key': () =>
        list({
          providers: [
            baseProviders.providers[0] as Provider,
            { ...groq, ready: true, status: { ...groq.status, state: 'ready' } },
            deepseek,
            qwen,
          ],
        }),
    });
    renderApp(<ProvidersTab />, { route: '/' });
    await screen.findByText('Have a key?');
    paste('gsk_0123456789abcdefghijklmn');
    expect(await screen.findByText(/Groq is connected/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/providers/groq/key',
      body: { value: 'gsk_0123456789abcdefghijklmn' },
    });
  });

  it('asks whose a key is when it could be more than one company’s', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(),
      'PUT /api/providers/qwen/key': () => list(),
    });
    renderApp(<ProvidersTab />, { route: '/' });
    await screen.findByText('Have a key?');
    paste('sk-0123456789abcdef0123456789abcdef');
    expect(await screen.findByText(/more than one place/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    const catcher = screen.getByRole('region', { name: 'Have a key?' });
    await userEvent.click(within(catcher).getByRole('button', { name: 'Qwen' }));
    expect(calls.find((c) => c.method === 'PUT')?.path).toBe('/api/providers/qwen/key');
  });

  it('uses a key found on this computer with one press, without ever seeing it', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () =>
        list({
          found: [
            {
              id: 'env-groq-groq_api_key',
              kind: 'key',
              provider: 'groq',
              name: 'Groq',
              detail: 'GROQ_API_KEY · ends mnop',
              brand: 'groq',
            },
          ],
        }),
      'POST /api/providers/found/env-groq-groq_api_key/use': () => list(),
    });
    renderApp(<ProvidersTab />, { route: '/' });
    const found = await screen.findByRole('region', { name: 'Found on this computer' });
    expect(found).toHaveTextContent('GROQ_API_KEY · ends mnop');
    await userEvent.click(within(found).getByRole('button', { name: 'Use this key to Groq' }));
    expect(calls.find((c) => c.method === 'POST')?.path).toBe(
      '/api/providers/found/env-groq-groq_api_key/use',
    );
  });

  it('walks through getting a key, and takes one pasted anywhere on its page', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(),
      'POST /api/providers/groq/check': () => groq,
      'PUT /api/providers/groq/key': () => list(),
    });
    renderApp(<ProvidersTab />, { route: '/' });
    const tile = await screen.findByRole('article', { name: 'Groq' });
    await userEvent.click(within(tile).getByRole('button', { name: 'Groq' }));
    const steps = await screen.findByRole('list', { name: 'Get a Groq key' });
    expect(within(steps).getByRole('link', { name: /Open console\.groq\.com/ })).toHaveAttribute(
      'href',
      'https://console.groq.com/keys',
    );
    expect(screen.getByText('Free tier')).toBeInTheDocument();
    paste('gsk_0123456789abcdefghijklmn');
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  });

  it('adds a server after looking at its address, and opens its page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const server = provider({
        id: 'server-abcdefgh',
        name: 'llama.cpp',
        tagline: 'llama.cpp · localhost:8080',
        connect: 'key',
        group: 'server',
        brand: 'server',
        // On this computer, like Ollama, but with its own models: not Ollama's page.
        local: true,
        active: false,
        server: {
          id: 'server-abcdefgh',
          name: 'llama.cpp',
          url: 'http://localhost:8080/v1',
          kind: 'llama.cpp',
          addedAt: 1,
        },
      });
      const calls = mockFetch({
        'GET /api/state': () => appState(),
        'GET /api/providers': () => list(),
        'POST /api/providers/servers/probe': () => ({
          ok: true,
          url: 'http://localhost:8080/v1',
          models: 3,
          kind: 'llama.cpp',
        }),
        'POST /api/providers/servers': () => ({
          id: 'server-abcdefgh',
          list: list({ providers: [...list().providers, server] }),
        }),
        'POST /api/providers/server-abcdefgh/check': () => server,
      });
      renderApp(<ProvidersTab />, { route: '/' });
      const tile = await screen.findByRole('article', { name: 'Another server' });
      await userEvent.click(within(tile).getByRole('button', { name: 'Another server' }));
      fireEvent.change(await screen.findByLabelText('Address'), {
        target: { value: 'localhost:8080' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(
        await screen.findByText('llama.cpp, with 3 models. Ready to add.'),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Add server' }));
      expect(calls.find((c) => c.path === '/api/providers/servers')?.body).toEqual({
        url: 'localhost:8080',
      });
      expect(
        await screen.findByRole('heading', { name: 'llama.cpp is connected' }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what’s wrong with an address, and points Ollama to its own card', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetch({
        'GET /api/state': () => appState(),
        'GET /api/providers': () => list(),
        'POST /api/providers/servers/probe': () => ({
          ok: false,
          kind: 'Ollama',
          message:
            'That’s Ollama, which has its own card in Providers — connect it there for the most it can do.',
        }),
      });
      renderApp(<ProvidersTab />, { route: '/' });
      const tile = await screen.findByRole('article', { name: 'Another server' });
      await userEvent.click(within(tile).getByRole('button', { name: 'Another server' }));
      fireEvent.change(await screen.findByLabelText('Address'), {
        target: { value: 'localhost:11434' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(await screen.findByText(/That’s Ollama, which has its own card/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open Ollama' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add server' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
