import type { TerminalInfo, TerminalStatus } from '@conch/protocol';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUi } from '../../app/ui';
import { appState, mockFetch, renderApp } from '../../test/harness';
import { tabTitle, TerminalDock } from './TerminalDock';
import { isShellCode, RunInTerminal, TerminalToggle } from './TerminalToggle';

afterEach(() => {
  vi.unstubAllGlobals();
  useUi.setState({ terminalOpen: false, terminalPaste: null });
});

const info = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id: 't1',
  title: '',
  shell: 'zsh',
  cwd: '/Users/sam/projects/conch',
  createdAt: 1,
  status: 'running',
  safeMode: false,
  openedFrom: 'this-computer',
  ...over,
});

const status = (over: Partial<TerminalStatus> = {}, enabled = true): TerminalStatus => ({
  available: enabled,
  unavailable: enabled ? undefined : 'Turned off in Settings › Terminal.',
  backend: 'pty',
  settings: {
    enabled,
    allowRemote: false,
    shell: 'auto',
    fontSize: 13,
    cursorBlink: true,
    screenReader: false,
  },
  shells: [],
  terminals: [],
  remote: false,
  ...over,
});

describe('terminal tabs', () => {
  it('names a tab after what the shell says, unless that is only its program', () => {
    expect(tabTitle(info({ title: 'npm run dev' }))).toBe('npm run dev');
    expect(tabTitle(info())).toBe('zsh · conch');
    expect(tabTitle(info({ title: 'zsh' }))).toBe('zsh · conch');
    expect(
      tabTitle(
        info({
          shell: 'PowerShell',
          title: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          cwd: 'C:\\Users\\sam\\work',
        }),
      ),
    ).toBe('PowerShell · work');
  });
});

describe('Run in terminal', () => {
  it('only offers itself on shell code', () => {
    expect(isShellCode('bash')).toBe(true);
    expect(isShellCode('PowerShell')).toBe(true);
    expect(isShellCode('console')).toBe(true);
    expect(isShellCode('ts')).toBe(false);
    expect(isShellCode(undefined)).toBe(false);
  });

  it('types the command without its prompt, and never presses Enter', async () => {
    const user = userEvent.setup();
    mockFetch({ 'GET /api/state': () => appState() });
    renderApp(<RunInTerminal code={'$ npm install\nPS C:\\work> npm test\n'} />);
    await user.click(screen.getByRole('button', { name: 'Run in terminal' }));
    const { terminalPaste, terminalOpen } = useUi.getState();
    expect(terminalPaste).toBe('npm install\nnpm test');
    expect(terminalPaste?.endsWith('\n')).toBe(false);
    expect(terminalOpen).toBe(true);
  });
});

describe('the terminal toggle', () => {
  it('shows and hides the drawer, and steps aside while terminals are off', async () => {
    const user = userEvent.setup();
    let enabled = true;
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/terminal': () => status({}, enabled),
    });
    const { client } = renderApp(<TerminalToggle />);
    await user.click(screen.getByRole('button', { name: 'Show the terminal' }));
    expect(useUi.getState().terminalOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide the terminal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Hide the terminal' }));

    enabled = false;
    await act(() => client.invalidateQueries({ queryKey: ['terminal'] }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /the terminal/ })).toBeNull());
  });
});

describe('the terminal drawer', () => {
  it('turns terminals back on in one click, then opens one', async () => {
    const user = userEvent.setup();
    let enabled = false;
    const calls = mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/terminal': () => status({}, enabled),
      'PATCH /api/terminal/settings': () => {
        enabled = true;
        return status({}, true);
      },
      'POST /api/terminal': () => info(),
    });
    act(() => useUi.getState().setTerminalOpen(true));
    renderApp(<TerminalDock />);
    expect(await screen.findByText('The terminal is turned off')).toBeInTheDocument();
    // Nothing opens by itself while it's off.
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/terminal')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Turn it on' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/terminal')).toBe(true),
    );
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: true });
  });

  it('points other devices at Settings instead of switching it on from there', async () => {
    mockFetch({
      'GET /api/state': () => appState(),
      'GET /api/terminal': () =>
        status({ remote: true, unavailable: 'Turn on “From other devices” first.' }, false),
    });
    act(() => useUi.getState().setTerminalOpen(true));
    renderApp(<TerminalDock />);
    expect(await screen.findByText('The terminal is turned off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn it on' })).toBeNull();
  });
});
