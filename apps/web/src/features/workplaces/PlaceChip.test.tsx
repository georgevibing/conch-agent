import type { ModelCatalog, WorkPlacesStatus } from '@conch/protocol';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, mockFetch, renderApp } from '../../test/harness';
import { useTurnOptions } from '../models/useTurnOptions';
import { useUi } from '../../app/ui';
import { PlaceChip } from './PlaceChip';
import { CLOUD_KEY_FOCUS } from './words';

afterEach(() => vi.unstubAllGlobals());

const status = (patch: Partial<WorkPlacesStatus['places'][number]>[] = []): WorkPlacesStatus => ({
  default: 'computer',
  places: [
    {
      id: 'computer',
      kind: 'computer',
      name: 'This computer',
      description: 'Here.',
      state: 'ready',
    },
    {
      id: 'container',
      kind: 'container',
      name: 'Docker',
      description: 'A box.',
      state: 'ready',
      ...patch[0],
    },
    {
      id: 'cloud',
      kind: 'cloud',
      name: 'Daytona',
      description: 'The cloud.',
      state: 'needs-setup',
      needsKey: true,
      message: 'Needs a Daytona key.',
    },
  ],
});

const catalog = (places: boolean, label = 'Claude Code'): ModelCatalog => ({
  default: 'claude-code',
  providers: [
    {
      engine: 'claude-code',
      label,
      local: false,
      places,
      models: [{ id: 'default', label: 'Default', efforts: [], supportsFastMode: false } as never],
      commands: [],
      permissionModes: ['default', 'auto'],
    },
  ],
});

function Chip() {
  const turn = useTurnOptions();
  return <PlaceChip turn={turn} />;
}

describe('the place chip', () => {
  it('stays out of the way while nothing but this computer can be chosen', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/models': () => catalog(true),
      'GET /api/conversations': () => [],
      'GET /api/workplaces': () => ({
        default: 'computer',
        places: [
          status().places[0],
          { ...status().places[1], state: 'needs-setup', need: 'container' },
        ],
      }),
    });
    renderApp(<Chip />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /Where work runs/ })).toBeNull();
  });

  it('moves a new chat’s work to a container with one press', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/models': () => catalog(true),
      'GET /api/conversations': () => [],
      'GET /api/workplaces': () => status(),
    });
    renderApp(<Chip />);
    await user.click(await screen.findByRole('button', { name: 'Where work runs: This computer' }));
    await user.click(await screen.findByRole('radio', { name: /Docker/ }));
    expect(
      await screen.findByRole('button', { name: 'Where work runs: Docker' }),
    ).toBeInTheDocument();
  });

  it('takes a place that needs a key to Settings, with its box ready, instead of choosing it', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/models': () => catalog(true),
      'GET /api/conversations': () => [],
      'GET /api/workplaces': () => status(),
    });
    renderApp(<Chip />);
    await user.click(await screen.findByRole('button', { name: /^Where work runs: / }));
    const daytona = await screen.findByRole('radio', { name: /Daytona/ });
    expect(daytona).toHaveAccessibleDescription('Needs a Daytona key. Add a key, opens Settings');
    expect(screen.queryByRole('button', { name: 'Add a key' })).toBeNull();
    await user.click(daytona);
    expect(useUi.getState().settingsFocus).toBe(CLOUD_KEY_FOCUS);
    expect(screen.queryByRole('radio', { name: /Daytona/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Where work runs: Daytona/ })).toBeNull();
  });

  it('says plainly when the chat’s provider runs its own commands here', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/models': () => catalog(false, 'Codex CLI'),
      'GET /api/conversations': () => [],
      'GET /api/workplaces': () => status(),
    });
    renderApp(<Chip />);
    await user.click(await screen.findByRole('button', { name: /Where work runs/ }));
    expect(
      await screen.findByText(/Codex CLI runs its own commands on this computer/),
    ).toBeInTheDocument();
  });
});
