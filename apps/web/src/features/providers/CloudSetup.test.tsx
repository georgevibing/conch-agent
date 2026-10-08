import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CloudPicker, Provider, ProvidersList } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, baseProviders, mockFetch, provider, renderApp } from '../../test/harness';
import { ProvidersTab } from './ProvidersTab';

afterEach(() => vi.unstubAllGlobals());

const bedrock = (patch: Partial<Provider> = {}): Provider =>
  provider({
    id: 'bedrock',
    name: 'Amazon Bedrock',
    tagline: 'Claude in your AWS account',
    connect: 'key',
    group: 'key',
    cloud: 'aws',
    active: false,
    ready: false,
    status: {
      ...provider().status,
      engine: 'bedrock',
      label: 'Amazon Bedrock',
      state: 'signed-out',
      auth: undefined,
      message: 'Choose the AWS account Conch should use. It found the ones on this computer.',
    },
    ...patch,
  });

const list = (p: Provider): ProvidersList => ({
  ...baseProviders,
  providers: [baseProviders.providers[0] as Provider, p],
});

const picker = (patch: Partial<CloudPicker> = {}): CloudPicker => ({
  provider: 'bedrock',
  cloud: 'aws',
  name: 'Amazon Bedrock',
  tool: { need: 'aws-cli', name: 'AWS CLI', present: true, outdated: false },
  accounts: [
    {
      id: 'admin',
      label: 'admin',
      detail: 'Single sign-on · AdministratorAccess · account …3333',
      state: 'ready',
      kind: 'sso',
      isDefault: false,
      broad: true,
    },
    {
      id: 'dev',
      label: 'dev',
      detail: 'Single sign-on · BedrockDeveloper · account …3333',
      state: 'ready',
      kind: 'sso',
      region: 'eu-west-1',
      isDefault: false,
      broad: false,
    },
    {
      id: 'old',
      label: 'old',
      detail: 'Single sign-on · ReadOnly · account …9012',
      state: 'expired',
      kind: 'sso',
      isDefault: false,
      broad: false,
    },
  ],
  regions: [
    { id: 'us-east-1', label: 'US East (N. Virginia)' },
    { id: 'eu-west-1', label: 'Europe (Ireland)' },
  ],
  region: 'eu-west-1',
  ...patch,
});

describe('your company’s cloud', () => {
  it('picks an AWS sign-in found on this computer with one press', async () => {
    const ready = bedrock({
      ready: true,
      status: {
        ...bedrock().status,
        state: 'ready',
        message: undefined,
        auth: { method: 'bedrock', description: 'Amazon Bedrock · dev · eu-west-1 · 2 models' },
      },
    });
    let chosen = false;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(chosen ? ready : bedrock()),
      'GET /api/clouds/bedrock': () => picker(),
      'PUT /api/clouds/bedrock': () => {
        chosen = true;
        return picker({ chosen: { account: 'dev', region: 'eu-west-1', label: 'dev' } });
      },
      'POST /api/providers/bedrock/check': () => (chosen ? ready : bedrock()),
      'GET /api/models': () => ({
        default: 'claude-code',
        providers: [
          {
            engine: 'bedrock',
            label: 'Amazon Bedrock',
            local: false,
            models: [
              { id: 'anthropic.claude-opus-5-5', label: 'Claude Opus 5.5' },
              { id: 'anthropic.claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
            ],
            commands: [],
            permissionModes: ['default'],
          },
        ],
      }),
    });
    renderApp(<ProvidersTab />, { route: '/settings/providers/bedrock' });
    const accounts = await screen.findByRole('list', { name: 'AWS accounts on this computer' });
    // A narrower role is recommended over the administrator.
    const dev = within(accounts).getByText('dev').closest('li') as HTMLElement;
    expect(dev).toHaveTextContent('Recommended');
    await userEvent.click(within(dev).getByRole('button', { name: 'Use dev' }));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/api/clouds/bedrock',
      body: { account: 'dev', region: 'eu-west-1' },
    });
    expect(await screen.findByText('dev · eu-west-1 · 2 models')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Models it can use' })).toHaveTextContent(
      'Claude Sonnet 5.5',
    );
  });

  it('signs an ended sign-in in again with one press', async () => {
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(bedrock()),
      'GET /api/clouds/bedrock': () => picker(),
      'PUT /api/clouds/bedrock': () => picker({ chosen: { account: 'old', region: 'eu-west-1' } }),
      'POST /api/providers/bedrock/check': () => bedrock(),
      'POST /api/providers/bedrock/login': () => ({ ok: true }),
    });
    renderApp(<ProvidersTab />, { route: '/settings/providers/bedrock' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to AWS again: old' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/api/providers/bedrock/login')).toBeTruthy(),
    );
    // The account is chosen first, so the sign-in is for that profile.
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ account: 'old' });
  });

  it('offers to install the cloud’s own program when a sign-in needs it', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/providers': () => list(bedrock()),
      'GET /api/clouds/bedrock': () =>
        picker({
          accounts: [],
          tool: { need: 'aws-cli', name: 'AWS CLI', present: false, outdated: false },
        }),
      'GET /api/setup/needs/aws-cli': () => ({
        id: 'aws-cli',
        name: 'AWS CLI',
        short: 'AWS CLI',
        present: false,
      }),
    });
    renderApp(<ProvidersTab />, { route: '/settings/providers/bedrock' });
    expect(
      await screen.findByText(/with the AWS CLI, the cloud’s own program/),
    ).toBeInTheDocument();
  });
});
