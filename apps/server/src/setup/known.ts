import { homedir } from 'node:os';
import { join } from 'node:path';

import { findExecutable, presentSync } from '../lib/proc';
import type { NeedSpec } from './needs';

/** Where macOS keeps apps: for everyone, then just for you. */
const macApp = (name: string) =>
  [join('/Applications', name), join(homedir(), 'Applications', name)].find(presentSync);

const localAppData = () => process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');

/**
 * Everything Conch knows how to find and get. Checked on real installs
 * (Sept 2026): 1Password for Windows comes from winget as an MSIX package
 * that puts `1Password.exe` and `1password-mcp.exe` on `PATH` as app aliases;
 * on macOS both live in the app bundle, which isn't on `PATH`.
 */
const list: NeedSpec[] = [
  {
    id: '1password-app',
    name: 'The 1Password app',
    short: '1Password',
    async find(platform) {
      if (platform === 'darwin') return macApp('1Password.app');
      if (platform === 'win32')
        return findExecutable('1Password', {
          // The classic installer, before 1Password moved to MSIX.
          extraDirs: [join(localAppData(), '1Password', 'app', '8')],
        });
      return findExecutable('1password', { extraDirs: ['/opt/1Password'] });
    },
    install: {
      win32: {
        manager: 'winget',
        args: [
          'install',
          '--id',
          'AgileBits.1Password',
          '--exact',
          '--source',
          'winget',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity',
        ],
      },
      darwin: { manager: 'brew', args: ['install', '--cask', '1password'] },
    },
    download: {
      win32: 'https://1password.com/downloads/windows',
      darwin: 'https://1password.com/downloads/mac',
      linux: 'https://1password.com/downloads/linux',
    },
    opens: '1password-app',
  },
  {
    id: '1password-mcp',
    name: '1Password’s MCP server',
    short: '1Password’s MCP server',
    async find(platform) {
      if (platform === 'darwin') {
        const app = macApp('1Password.app');
        const inside = app && join(app, 'Contents', 'MacOS', '1password-mcp');
        if (inside && presentSync(inside)) return inside;
      }
      // On Linux, next to the app, where the 1Password packages put it (PATH is checked first).
      return findExecutable('1password-mcp', {
        extraDirs: platform === 'linux' ? ['/opt/1Password'] : [],
      });
    },
    comesWith: '1password-app',
    opens: '1password-app',
    hint: (has) =>
      has('1password-app')
        ? 'This 1Password is too old to have it. Open 1Password and update it.'
        : 'Comes with the 1Password app.',
  },
];

export const KNOWN_NEEDS: ReadonlyMap<string, NeedSpec> = new Map(list.map((n) => [n.id, n]));
