import type { WorkPlacesStatus } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { WhereWorkRuns } from './WhereWorkRuns';
import { CLOUD_KEY_FOCUS, CONTAINER_FOCUS } from './words';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ settingsFocus: undefined });
});

const status: WorkPlacesStatus = {
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
      name: 'A container',
      description: 'A box.',
      state: 'needs-setup',
      need: 'container',
      message: 'Needs Docker or Podman on this computer.',
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
};

function routes() {
  return {
    'GET /api/state': () => appState(),
    'GET /api/auth': () => ({ method: 'none', signedIn: true, setupRequired: false, secure: true }),
    'GET /api/models': () => ({ default: 'claude-code', providers: [] }),
    'GET /api/workplaces': () => status,
    'GET /api/setup/needs/container': () => ({
      id: 'container',
      name: 'Podman',
      short: 'Podman',
      present: false,
      install: { command: 'brew install podman', label: 'Install Podman' },
    }),
  };
}

describe('Where work runs in Settings', () => {
  it('opens at the Daytona key, ready to type in, with a gentle glow', async () => {
    mockFetch(routes());
    useUi.setState({ settingsFocus: CLOUD_KEY_FOCUS });
    renderApp(<WhereWorkRuns />);
    const key = await screen.findByLabelText('Daytona key, for the cloud');
    await waitFor(() => expect(key).toHaveFocus());
    expect(key.closest('[data-setup="cloud"]')).toHaveAttribute('data-nc-flash');
    expect(useUi.getState().settingsFocus).toBeUndefined();
  });

  it('opens at what gets Docker or Podman, for a container', async () => {
    mockFetch(routes());
    useUi.setState({ settingsFocus: CONTAINER_FOCUS });
    renderApp(<WhereWorkRuns />);
    await waitFor(() => expect(useUi.getState().settingsFocus).toBeUndefined());
    const setup = document.querySelector('[data-setup="container"]');
    expect(setup).toHaveAttribute('data-nc-flash');
  });
});
