import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { chooseOnComputer, FolderChooserHost } from './FolderChooser';

const HOME = '/Users/ada';

const listing = (path: string, folders: string[]) => ({
  path,
  name: path === HOME ? 'Home' : (path.split('/').at(-1) ?? path),
  shown: path.replace(HOME, '~'),
  ...(path !== HOME && { parent: path.slice(0, path.lastIndexOf('/')) }),
  crumbs: [
    { name: 'Home', path: HOME, top: 'home' },
    ...(path === HOME ? [] : [{ name: path.split('/').at(-1) ?? path, path }]),
  ],
  folders: folders.map((name) => ({ name, path: `${path}/${name}` })),
  hiddenCount: 0,
  more: false,
  writable: true,
});

let agent: PropertyDescriptor | undefined;
afterEach(async () => {
  // A closing browser leaves once its animation has had time.
  await new Promise((done) => setTimeout(done, 250));
  vi.unstubAllGlobals();
  localStorage.clear();
  if (agent) Object.defineProperty(navigator, 'userAgent', agent);
  agent = undefined;
});

describe('choosing a folder on the computer Conch runs on', () => {
  it('opens Conch’s folder browser from any device, and remembers what was chosen', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/pick/places': () => ({
        home: HOME,
        separator: '/',
        places: [{ kind: 'home', title: 'Home', path: HOME, shown: '~' }],
      }),
      'GET /api/pick/list': () => {
        const asked = new URL(String(calls.at(-1)?.path), 'http://x').searchParams.get('path');
        return asked === `${HOME}/Projects`
          ? listing(`${HOME}/Projects`, ['conch'])
          : listing(HOME, ['Documents', 'Projects']);
      },
    });
    renderApp(<FolderChooserHost />);
    let chosen: Promise<string | undefined> | undefined;
    act(() => {
      chosen = chooseOnComputer({ purpose: 'workspace' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Choose a working folder' });
    // It starts at home: nobody has chosen anything here yet.
    expect(calls.find((c) => c.path.startsWith('/api/pick/list'))?.path).toContain('path=%7E');
    await user.click(await within(dialog).findByRole('option', { name: /Projects/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Choose “Projects”' }));
    await expect(chosen).resolves.toBe(`${HOME}/Projects`);
    expect(JSON.parse(localStorage.getItem('conch.folders.recent') ?? '[]')).toEqual([
      `${HOME}/Projects`,
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancels with nothing chosen, and a missing folder starts at home instead', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/pick/places': () => ({ home: HOME, separator: '/', places: [] }),
      'GET /api/pick/list': () => {
        const asked = new URL(String(calls.at(-1)?.path), 'http://x').searchParams.get('path');
        return asked === '/Volumes/Gone'
          ? new Response(
              JSON.stringify({ error: 'folder-missing', message: 'There’s no folder there.' }),
              { status: 404 },
            )
          : listing(HOME, ['Documents']);
      },
    });
    renderApp(<FolderChooserHost />);
    let chosen: Promise<string | undefined> | undefined;
    act(() => {
      chosen = chooseOnComputer({ purpose: 'workspace', current: '/Volumes/Gone' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Choose a working folder' });
    // Healed quietly: no problem shown, home instead.
    expect(await within(dialog).findByRole('option', { name: /Documents/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expect(chosen).resolves.toBeUndefined();
  });

  it('in the desktop app, shows the system’s own Open dialog instead', async () => {
    agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 Conch/1.0.0 Chrome/140.0 Electron/38.0.0',
    });
    const calls = mockFetch({ 'POST /api/pick': () => ({ path: `${HOME}/Projects` }) });
    renderApp(<FolderChooserHost />);
    await expect(chooseOnComputer({ purpose: 'workspace' })).resolves.toBe(`${HOME}/Projects`);
    expect(calls.find((c) => c.path === '/api/pick')?.body).toEqual({ purpose: 'workspace' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('chooses a file the same way, from a phone', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/pick/places': () => ({ home: HOME, separator: '/', places: [] }),
      'GET /api/pick/list': () => ({
        ...listing(`${HOME}/Documents`, []),
        files: [{ name: 'Main.kdbx', path: `${HOME}/Documents/Main.kdbx` }],
      }),
    });
    renderApp(<FolderChooserHost />);
    let chosen: Promise<string | undefined> | undefined;
    act(() => {
      chosen = chooseOnComputer({
        purpose: 'keepassxc-database',
        current: `${HOME}/Documents/Old.kdbx`,
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Choose your KeePassXC database' });
    await user.dblClick(await within(dialog).findByRole('option', { name: /Main\.kdbx/ }));
    await expect(chosen).resolves.toBe(`${HOME}/Documents/Main.kdbx`);
  });
});
