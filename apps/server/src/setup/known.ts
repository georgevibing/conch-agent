import { homedir } from 'node:os';
import { join } from 'node:path';

import { bundledClaude } from '../engines/claude-code/bundled';
import { findClaude } from '../engines/claude-code/detect';
import { findCodex } from '../engines/codex/detect';
import { findExecutable, presentSync } from '../lib/proc';
import type { InstallRecipe, NeedSpec, Platform } from './needs';

/** Where macOS keeps apps: for everyone, then just for you. */
const macApp = (name: string) =>
  [join('/Applications', name), join(homedir(), 'Applications', name)].find(presentSync);

const localAppData = () => process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');

/** winget's flags for installing without questions, the person having pressed Install. */
const WINGET_QUIET = [
  '--exact',
  '--source',
  'winget',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity',
];
const winget = (id: string): InstallRecipe => ({
  manager: 'winget',
  args: ['install', '--id', id, ...WINGET_QUIET],
});
const npmGlobal = (pkg: string): InstallRecipe => ({
  manager: 'npm',
  args: ['install', '--global', `${pkg}@latest`],
});

/**
 * Update a program the way it was installed, judged by where it lives: winget
 * keeps its programs under `WinGet`, Homebrew under its prefix; anything else
 * came from npm.
 */
export function updateBy(
  path: string,
  platform: Platform,
  ids: { winget?: string; brew?: string; cask?: boolean; npm?: string },
): InstallRecipe[] {
  const where = path.replaceAll('\\', '/').toLowerCase();
  if (platform === 'win32' && ids.winget && where.includes('/winget/'))
    return [{ manager: 'winget', args: ['upgrade', '--id', ids.winget, ...WINGET_QUIET] }];
  if (ids.brew && /\/(homebrew|cellar|caskroom)\//.test(where))
    return [{ manager: 'brew', args: ['upgrade', ...(ids.cask ? ['--cask'] : []), ids.brew] }];
  return ids.npm ? [npmGlobal(ids.npm)] : [];
}

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

list.push(
  {
    id: 'claude-code',
    name: 'Claude Code',
    short: 'Claude Code',
    // The copy that comes with Conch counts: then only a sign-in is left.
    find: async () => (await findClaude()) ?? bundledClaude(),
    install: {
      win32: [winget('Anthropic.ClaudeCode'), npmGlobal('@anthropic-ai/claude-code')],
      darwin: [
        { manager: 'brew', args: ['install', '--cask', 'claude-code'] },
        npmGlobal('@anthropic-ai/claude-code'),
      ],
      linux: npmGlobal('@anthropic-ai/claude-code'),
    },
    update: (path, platform) =>
      updateBy(path, platform, {
        winget: 'Anthropic.ClaudeCode',
        brew: 'claude-code',
        cask: true,
        npm: '@anthropic-ai/claude-code',
      }),
    download: {
      win32: 'https://code.claude.com/docs/en/setup',
      darwin: 'https://code.claude.com/docs/en/setup',
      linux: 'https://code.claude.com/docs/en/setup',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    short: 'Codex',
    find: () => findCodex(),
    install: {
      win32: [winget('OpenAI.Codex'), npmGlobal('@openai/codex')],
      darwin: [{ manager: 'brew', args: ['install', 'codex'] }, npmGlobal('@openai/codex')],
      linux: npmGlobal('@openai/codex'),
    },
    update: (path, platform) =>
      updateBy(path, platform, { winget: 'OpenAI.Codex', brew: 'codex', npm: '@openai/codex' }),
    download: {
      win32: 'https://developers.openai.com/codex/cli',
      darwin: 'https://developers.openai.com/codex/cli',
      linux: 'https://developers.openai.com/codex/cli',
    },
  },
  {
    id: 'op',
    name: 'The 1Password command-line tool',
    short: '1Password CLI',
    find: () => findExecutable('op'),
    install: {
      win32: winget('AgileBits.1Password.CLI'),
      darwin: { manager: 'brew', args: ['install', '1password-cli'] },
    },
    update: (path, platform) =>
      updateBy(path, platform, { winget: 'AgileBits.1Password.CLI', brew: '1password-cli' }),
    // Linux needs sudo and 1Password's package repository.
    download: {
      win32: 'https://developer.1password.com/docs/cli/get-started/',
      darwin: 'https://developer.1password.com/docs/cli/get-started/',
      linux: 'https://developer.1password.com/docs/cli/get-started/',
    },
    opens: '1password-app',
  },
  {
    id: 'uv',
    name: 'uv (runs Python tools)',
    short: 'uv',
    find: () => findExecutable('uvx', { extraDirs: [join(homedir(), '.local', 'bin')] }),
    install: {
      win32: winget('astral-sh.uv'),
      darwin: { manager: 'brew', args: ['install', 'uv'] },
    },
    update: (path, platform) => updateBy(path, platform, { winget: 'astral-sh.uv', brew: 'uv' }),
    download: {
      win32: 'https://docs.astral.sh/uv/getting-started/installation/',
      darwin: 'https://docs.astral.sh/uv/getting-started/installation/',
      linux: 'https://docs.astral.sh/uv/getting-started/installation/',
    },
  },
  {
    id: 'docker',
    name: 'Docker',
    short: 'Docker',
    find: () => findExecutable('docker', { extraDirs: dockerDirs() }),
    // Docker Desktop installs as an administrator, so a person does it.
    download: {
      win32: 'https://www.docker.com/products/docker-desktop/',
      darwin: 'https://www.docker.com/products/docker-desktop/',
      linux: 'https://docs.docker.com/engine/install/',
    },
  },
);

/** Where Docker Desktop keeps its command-line tools. */
function dockerDirs(): string[] {
  return [
    join(
      process.env.ProgramFiles ?? join('C:', 'Program Files'),
      'Docker',
      'Docker',
      'resources',
      'bin',
    ),
    '/Applications/Docker.app/Contents/Resources/bin',
  ];
}

export const KNOWN_NEEDS: ReadonlyMap<string, NeedSpec> = new Map(list.map((n) => [n.id, n]));
