import type { EngineStatus, LocalStatus, Need, Provider } from '@conch/protocol';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseProviders, mockFetch, provider, renderApp } from '../../test/harness';
import { ProvidersTab } from '../providers/ProvidersTab';

afterEach(() => vi.unstubAllGlobals());

const GB = 1e9;

const offers: LocalStatus['offers'] = [
  {
    name: 'qwen3:4b-instruct',
    label: 'Qwen3 4B',
    sizeBytes: 2.5 * GB,
    blurb: 'Quick on a computer like this one, and good at using your apps.',
    minutes: 4,
    fits: true,
    installed: false,
    recommended: true,
    tools: true,
  },
  {
    name: 'llama3.2:3b',
    label: 'Llama 3.2',
    sizeBytes: 2.0 * GB,
    blurb: 'Meta’s small all-rounder: quick, and it uses your apps.',
    minutes: 3,
    fits: true,
    installed: false,
    recommended: false,
    tools: true,
  },
];

function localStatus(patch: Partial<LocalStatus> = {}): LocalStatus {
  return {
    ollama: { state: 'running', version: '0.35.0' },
    models: [],
    offers,
    machine: { memoryBytes: 8 * GB, freeDiskBytes: 80 * GB },
    ...patch,
  };
}

function engine(patch: Partial<EngineStatus>): EngineStatus {
  return {
    engine: 'ollama',
    label: 'On this computer',
    state: 'not-installed',
    install: [],
    canSignIn: false,
    checkedAt: 1,
    ...patch,
  };
}

function local(status: Partial<EngineStatus>): Provider {
  return provider({
    id: 'ollama',
    name: 'On this computer',
    tagline: 'Private, free, and works offline',
    description: 'An open model that runs right here, through Ollama.',
    active: false,
    local: true,
    ready: status.state === 'ready',
    highlights: ['Private', 'Free', 'Works offline'],
    limits: [
      'Slower and less capable than the big cloud models: best for everyday questions, drafts and quick jobs.',
    ],
    install: [],
    color: '#2F6B5E',
    status: engine(status),
  });
}

const ollamaNeed = (patch: Partial<Need> = {}): { ready: boolean; needs: Need[] } => ({
  ready: patch.state === 'ready',
  needs: [
    {
      id: 'ollama',
      name: 'Ollama',
      short: 'Ollama',
      openable: false,
      state: 'missing',
      install: { label: 'Install Ollama', command: 'winget install --id Ollama.Ollama --exact' },
      download: 'https://ollama.com/download/windows',
      ...patch,
    },
  ],
});

function render() {
  return renderApp(<ProvidersTab />, { route: '/' });
}

async function open(name = 'Set up') {
  const card = await screen.findByRole('article', { name: 'On this computer' });
  await userEvent.click(within(card).getByRole('button', { name }));
  return screen.findByRole('region', { name: /on this computer/i });
}

describe('A model on this computer', () => {
  it('installs Ollama and gets the model with one press, with real progress, and pauses', async () => {
    let status = localStatus({ ollama: { state: 'missing' } });
    let need = ollamaNeed();
    let provided = local({
      state: 'not-installed',
      message: 'Ollama runs the model. It isn’t on this computer yet.',
      fix: { need: 'ollama', kind: 'install' },
    });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => ({
        ...baseProviders,
        providers: [...baseProviders.providers, provided],
      }),
      'POST /api/providers/ollama/check': () => provided,
      'GET /api/local': () => status,
      'GET /api/needs/ollama': () => need,
      'POST /api/needs/ollama/install': () => {
        need = ollamaNeed({
          state: 'installing',
          progress: { percent: 40, label: 'Downloading Ollama · 40%' },
        });
        return need;
      },
      'POST /api/local/pull': () => {
        status = localStatus({
          pull: {
            model: 'qwen3:4b-instruct',
            label: 'Qwen3 4B',
            state: 'pulling',
            phase: 'Downloading',
            completedBytes: 1 * GB,
            totalBytes: 2.5 * GB,
            bytesPerSecond: 12_000_000,
            secondsLeft: 125,
          },
        });
        return status;
      },
      'POST /api/local/pull/pause': () => {
        status = localStatus({
          pull: {
            model: 'qwen3:4b-instruct',
            label: 'Qwen3 4B',
            state: 'paused',
            phase: 'Paused',
            completedBytes: 1 * GB,
            totalBytes: 2.5 * GB,
          },
        });
        return status;
      },
    });
    render();

    // Not set up is an invitation, not a problem.
    const card = await screen.findByRole('article', { name: 'On this computer' });
    expect(card).toHaveTextContent('Ollama runs the model. It isn’t on this computer yet.');
    const page = await open();
    expect(
      within(page).getByRole('heading', { name: 'Run a model on this computer' }),
    ).toBeVisible();
    // Honest about what it is.
    expect(page).toHaveTextContent('Slower and less capable than the big cloud models');

    const steps = within(page).getByRole('list', { name: 'What a model on this computer needs' });
    expect(steps).toHaveTextContent('To do: Ollama');
    expect(steps).toHaveTextContent('Later: Get Qwen3 4B');
    expect(steps).toHaveTextContent('2.5 GB, about 4 minutes to download.');
    expect(page).toHaveTextContent('Installs Ollama first, then downloads Qwen3 4B');
    // The exact command, before it runs.
    expect(page).toHaveTextContent('Runs winget install --id Ollama.Ollama …');

    // One press: Ollama installs, with the installer's own progress…
    await userEvent.click(within(page).getByRole('button', { name: 'Get Qwen3 4B' }));
    expect(
      await within(page).findByRole('progressbar', { name: 'Downloading Ollama · 40%' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/needs/ollama/install')).toBe(
      true,
    );
    expect(calls.some((c) => c.path === '/api/local/pull')).toBe(false);

    // …and once it's here, the model follows by itself. No second press.
    need = ollamaNeed({ state: 'ready' });
    status = localStatus();
    provided = local({
      state: 'not-installed',
      message: 'Get a model to start chatting. It’s free, and it runs on this computer.',
    });
    await waitFor(
      () =>
        expect(
          calls.find((c) => c.method === 'POST' && c.path === '/api/local/pull')?.body,
        ).toEqual({ model: 'qwen3:4b-instruct' }),
      { timeout: 5000 },
    );
    expect(
      await within(page).findByRole('progressbar', {
        name: '1.0 GB of 2.5 GB · about 2 minutes left',
      }),
    ).toBeInTheDocument();

    await userEvent.click(within(page).getByRole('button', { name: 'Pause' }));
    expect(
      await within(page).findByText('Paused at 1.0 GB of 2.5 GB. It carries on from there.'),
    ).toBeVisible();
    expect(within(page).getByRole('button', { name: 'Resume' })).toBeVisible();
  }, 15_000);

  it('says plainly when there isn’t room, and offers nothing that won’t fit', async () => {
    const short = offers.map((o) => ({
      ...o,
      fits: false,
      reason: `${o.label} needs 4.5 GB of free space, and this computer has 1.2 GB. Free up about 3.3 GB, then try again.`,
    }));
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => ({
        ...baseProviders,
        providers: [
          ...baseProviders.providers,
          local({ state: 'not-installed', message: 'Get a model to start chatting.' }),
        ],
      }),
      'POST /api/providers/ollama/check': () => local({ state: 'not-installed' }),
      'GET /api/local': () => localStatus({ offers: short }),
      'GET /api/needs/ollama': () => ollamaNeed({ state: 'ready' }),
    });
    render();
    // Installed, waiting for a model: it says so in its own words.
    const card = await screen.findByRole('article', { name: 'On this computer' });
    expect(card).toHaveTextContent('Needs a model');
    const page = await open();
    const steps = await within(page).findByRole('list', {
      name: 'What a model on this computer needs',
    });
    expect(steps).toHaveTextContent('Done: Ollama');
    expect(steps).toHaveTextContent(
      'Qwen3 4B needs 4.5 GB of free space, and this computer has 1.2 GB. Free up about 3.3 GB, then try again.',
    );
    expect(within(page).queryByRole('button', { name: /^Get / })).toBeNull();
  });

  it('once it’s ready, picks among the models here and gets another', async () => {
    let chosen = 'qwen3:4b-instruct';
    const models: LocalStatus['models'] = [
      {
        name: 'qwen3:4b-instruct',
        label: 'Qwen3 4B',
        sizeBytes: 2.5 * GB,
        tools: true,
        vision: false,
        thinking: false,
      },
      {
        name: 'gemma3:1b',
        label: 'Gemma3 1B',
        sizeBytes: 0.8 * GB,
        tools: false,
        vision: false,
        thinking: false,
      },
    ];
    const status = () =>
      localStatus({
        models,
        chosen,
        offers: offers.map((o) => ({ ...o, installed: o.name === 'qwen3:4b-instruct' })),
      });
    const ready = local({
      state: 'ready',
      version: '0.35.0',
      auth: { method: 'other', description: 'Qwen3 4B and 1 more · works offline' },
    });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => ({
        ...baseProviders,
        providers: [...baseProviders.providers, ready],
      }),
      'GET /api/local': status,
      'GET /api/needs/ollama': () => ollamaNeed({ state: 'ready' }),
      'PUT /api/local/model': (body) => {
        chosen = (body as { model: string }).model;
        return status();
      },
      'POST /api/local/pull': () => status(),
    });
    render();
    const card = await screen.findByRole('article', { name: 'On this computer' });
    expect(card).toHaveTextContent('Qwen3 4B and 1 more · works offline');
    await userEvent.click(within(card).getByRole('button', { name: 'Make default' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Details' }));
    const page = await screen.findByRole('region', { name: 'Your model on this computer' });

    const list = within(page).getByRole('radiogroup', { name: 'Models on this computer' });
    expect(within(list).getByRole('radio', { name: /Qwen3 4B/ })).toBeChecked();
    expect(list).toHaveTextContent('800 MB · can’t use your apps or memory');
    await userEvent.click(within(list).getByRole('radio', { name: /Gemma3 1B/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ model: 'gemma3:1b' }),
    );

    // Another model: only ones that fit and aren't here yet.
    await userEvent.click(within(page).getByRole('button', { name: 'Get another model' }));
    const more = within(page).getByRole('radiogroup', { name: 'Models that fit this computer' });
    expect(within(more).queryByRole('radio', { name: /Qwen3 4B/ })).toBeNull();
    expect(within(more).getByRole('radio', { name: /Llama 3.2/ })).toBeChecked();
    await userEvent.click(within(page).getByRole('button', { name: 'Get Llama 3.2' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/local/pull')?.body).toEqual({
        model: 'llama3.2:3b',
      }),
    );
  });

  it('offers to start Ollama when it’s installed but didn’t start', async () => {
    let status = localStatus({
      ollama: { state: 'stopped', message: 'Ollama is installed but isn’t running.' },
    });
    const stuck = local({
      state: 'error',
      message: 'Ollama is installed but didn’t start. Open Ollama once, or press Repair.',
    });
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => ({
        ...baseProviders,
        providers: [...baseProviders.providers, stuck],
      }),
      'POST /api/providers/ollama/check': () => stuck,
      'GET /api/local': () => status,
      'GET /api/needs/ollama': () => ollamaNeed({ state: 'ready' }),
      'POST /api/local/start': () => {
        status = localStatus();
        return status;
      },
    });
    render();
    const page = await open();
    const steps = await within(page).findByRole('list', {
      name: 'What a model on this computer needs',
    });
    expect(steps).toHaveTextContent('Didn’t work: Ollama');
    expect(within(page).queryByRole('button', { name: /^Get / })).toBeNull();
    await userEvent.click(within(page).getByRole('button', { name: 'Start Ollama' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/local/start')).toBe(true));
  });
});
