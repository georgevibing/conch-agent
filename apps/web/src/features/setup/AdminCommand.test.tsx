import type { Readiness, TerminalStatus } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { AdminCommand } from './AdminCommand';
import { NeedWatcher } from './NeedWatcher';

const COMMAND = "sudo sh '/opt/conch/apps/server/src/setup/seal-commands.sh'";

const terminal = (available: boolean): TerminalStatus => ({
  available,
  ...(!available && { unavailable: 'Turned off in Settings › Terminal.' }),
  backend: 'pty',
  settings: {
    enabled: available,
    allowRemote: false,
    shell: 'auto',
    fontSize: 13,
    cursorBlink: true,
    screenReader: false,
  },
  shells: [],
  terminals: [],
  remote: false,
  healed: [],
});

const sandbox = (state: 'missing' | 'ready'): Readiness => ({
  ready: state === 'ready',
  needs: [
    {
      id: 'command-sandbox',
      name: 'The command sandbox',
      short: 'Command sandbox',
      state,
      openable: false,
    },
  ],
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useUi.setState({ terminalPaste: null, terminalOpen: false, watchingNeed: null });
});

describe('something only an administrator can do', () => {
  it('types the command into Conch’s terminal for you, never runs it, and watches for it', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/terminal': () => terminal(true) });
    const closeSettings = vi.fn();
    const before = useUi.getState().closeSettings;
    useUi.setState({ closeSettings });
    renderApp(
      <AdminCommand
        command={COMMAND}
        label="Seal commands"
        what="Installs bubblewrap, socat and ripgrep."
        watch="command-sandbox"
      />,
    );
    expect(screen.getByText(COMMAND)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Seal commands' }));
    expect(closeSettings).toHaveBeenCalled();
    expect(useUi.getState()).toMatchObject({
      terminalPaste: COMMAND,
      terminalOpen: true,
      watchingNeed: 'command-sandbox',
    });
    useUi.setState({ closeSettings: before });
  });

  it('offers the command to copy where there’s no terminal', async () => {
    mockFetch({ 'GET /api/state': () => appState(), 'GET /api/terminal': () => terminal(false) });
    renderApp(<AdminCommand command={COMMAND} label="Seal commands" watch="command-sandbox" />);
    expect(await screen.findByRole('button', { name: /Copy command/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seal commands' })).toBeNull();
    expect(screen.getByText(/Run it in a terminal on the computer Conch runs on/)).toBeVisible();
  });
});

describe('watching for it', () => {
  it('says when it lands, wherever you are by then, and stops watching', async () => {
    let state: 'missing' | 'ready' = 'missing';
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/needs/command-sandbox': () => sandbox(state),
    });
    renderApp(
      <>
        <NeedWatcher />
        <Toaster />
      </>,
    );
    act(() => useUi.getState().watchNeed('command-sandbox'));
    // Still installing in the terminal: nothing to say yet.
    await new Promise((r) => setTimeout(r, 3300));
    expect(useUi.getState().watchingNeed).toBe('command-sandbox');
    state = 'ready';
    await waitFor(() => expect(useUi.getState().watchingNeed).toBeNull(), { timeout: 5000 });
    expect(await screen.findByText(/commands are sealed from now on/)).toBeInTheDocument();
  }, 15_000);
});
