import { homedir } from 'node:os';
import { join } from 'node:path';

import { bundledClaude } from '../engines/claude-code/bundled';
import { findClaude } from '../engines/claude-code/detect';
import { findCodex } from '../engines/codex/detect';
import { findExecutable, presentSync, run } from '../lib/proc';
import { parseVersion } from '../updates/version';
import type { InstallRecipe, LatestLookup, NeedSpec, Platform } from './needs';

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

/** A program's ids with each package manager, and whether it updates itself. */
export interface PackageIds {
  winget?: string;
  brew?: string;
  cask?: boolean;
  npm?: string;
  /**
   * Where the program's own installer puts it, when it updates itself
   * (`claude update`): a path containing one of these came from there.
   */
  self?: { dirs: string[]; args: string[] };
}

/**
 * How a program was installed, judged by where it lives: winget keeps its
 * programs under `WinGet`, Homebrew under its prefix, a self-updating
 * installer in its own folders; anything else came from npm.
 */
export function installedBy(
  path: string,
  platform: Platform,
  ids: PackageIds,
): 'winget' | 'brew' | 'self' | 'npm' | undefined {
  const where = path.replaceAll('\\', '/').toLowerCase();
  if (platform === 'win32' && ids.winget && where.includes('/winget/')) return 'winget';
  if (ids.brew && /\/(homebrew|cellar|caskroom)\//.test(where)) return 'brew';
  if (ids.self?.dirs.some((dir) => where.includes(dir))) return 'self';
  return ids.npm ? 'npm' : undefined;
}

/** Update a program the way it was installed (see `installedBy`). */
export function updateBy(path: string, platform: Platform, ids: PackageIds): InstallRecipe[] {
  switch (installedBy(path, platform, ids)) {
    case 'winget':
      return [{ manager: 'winget', args: ['upgrade', '--id', ids.winget ?? '', ...WINGET_QUIET] }];
    case 'brew':
      return [
        { manager: 'brew', args: ['upgrade', ...(ids.cask ? ['--cask'] : []), ids.brew ?? ''] },
      ];
    case 'self':
      return [{ manager: 'self', args: ids.self?.args ?? [] }];
    case 'npm':
      return [npmGlobal(ids.npm ?? '')];
    default:
      return [];
  }
}

/**
 * The newest version, from where the program came from — the same judgement
 * as `updateBy`. A program that updates itself follows its npm releases.
 */
export function latestBy(
  path: string,
  platform: Platform,
  ids: PackageIds,
  lookup: LatestLookup,
): Promise<string | undefined> {
  switch (installedBy(path, platform, ids)) {
    case 'winget':
      return lookup.winget(ids.winget ?? '');
    case 'brew':
      return lookup.brew(ids.brew ?? '', ids.cask);
    case 'self':
    case 'npm':
      return ids.npm ? lookup.npm(ids.npm) : Promise.resolve(undefined);
    default:
      return Promise.resolve(undefined);
  }
}

/** What `<program> --version` says, as a version number. */
export async function versionOf(path: string): Promise<string | undefined> {
  const result = await run(path, ['--version'], { timeout: 15_000 });
  return result.code === 0 ? parseVersion(`${result.stdout}\n${result.stderr}`) : undefined;
}

/** A need's `update`, `latest` and `version`, from its package ids. */
function updatable(ids: PackageIds): Pick<NeedSpec, 'update' | 'latest' | 'version'> {
  return {
    update: (path, platform) => updateBy(path, platform, ids),
    latest: (path, platform, lookup) => latestBy(path, platform, ids, lookup),
    version: versionOf,
  };
}

/**
 * Claude Code's own installer (`install.sh` / `install.ps1`) puts it in
 * `~/.local/bin`, with its versions under `~/.local/share/claude`; the older
 * local install lives in `~/.claude/local`. Those copies update themselves.
 */
const CLAUDE_SELF = {
  dirs: ['/.local/bin/', '/.local/share/claude/', '/.claude/local/'],
  args: ['update'],
};

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
    ...updatable({
      winget: 'Anthropic.ClaudeCode',
      brew: 'claude-code',
      cask: true,
      npm: '@anthropic-ai/claude-code',
      self: CLAUDE_SELF,
    }),
    // The copy that comes with Conch is updated with Conch, so it isn't listed.
    version: async (path) => (path === bundledClaude() ? undefined : versionOf(path)),
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
    ...updatable({ winget: 'OpenAI.Codex', brew: 'codex', npm: '@openai/codex' }),
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
    ...updatable({ winget: 'AgileBits.1Password.CLI', brew: '1password-cli' }),
    // Linux needs sudo and 1Password's package repository.
    download: {
      win32: 'https://developer.1password.com/docs/cli/get-started/',
      darwin: 'https://developer.1password.com/docs/cli/get-started/',
      linux: 'https://developer.1password.com/docs/cli/get-started/',
    },
    opens: '1password-app',
  },
  {
    id: 'bw',
    name: 'The Bitwarden command-line tool',
    short: 'Bitwarden CLI',
    find: () => findExecutable('bw'),
    install: {
      win32: [winget('Bitwarden.CLI'), npmGlobal('@bitwarden/cli')],
      darwin: [
        { manager: 'brew', args: ['install', 'bitwarden-cli'] },
        npmGlobal('@bitwarden/cli'),
      ],
      linux: npmGlobal('@bitwarden/cli'),
    },
    ...updatable({ winget: 'Bitwarden.CLI', brew: 'bitwarden-cli', npm: '@bitwarden/cli' }),
    download: {
      win32: 'https://bitwarden.com/help/cli/',
      darwin: 'https://bitwarden.com/help/cli/',
      linux: 'https://bitwarden.com/help/cli/',
    },
  },
  {
    id: 'keepassxc',
    name: 'KeePassXC',
    short: 'KeePassXC',
    // The command line comes inside the app on macOS and Windows.
    find: () =>
      findExecutable('keepassxc-cli', {
        extraDirs: [
          '/Applications/KeePassXC.app/Contents/MacOS',
          join(homedir(), 'Applications', 'KeePassXC.app', 'Contents', 'MacOS'),
          'C:\\Program Files\\KeePassXC',
        ],
      }),
    install: {
      win32: winget('KeePassXCTeam.KeePassXC'),
      darwin: { manager: 'brew', args: ['install', '--cask', 'keepassxc'] },
    },
    ...updatable({ winget: 'KeePassXCTeam.KeePassXC', brew: 'keepassxc', cask: true }),
    // Linux packages need sudo.
    download: {
      win32: 'https://keepassxc.org/download/',
      darwin: 'https://keepassxc.org/download/',
      linux: 'https://keepassxc.org/download/#linux',
    },
  },
  {
    id: 'pass-cli',
    name: 'The Proton Pass command-line tool',
    short: 'Proton Pass CLI',
    find: () => findExecutable('pass-cli', { extraDirs: [join(homedir(), '.local', 'bin')] }),
    install: {
      darwin: { manager: 'brew', args: ['install', 'protonpass/tap/pass-cli'] },
    },
    ...updatable({ brew: 'protonpass/tap/pass-cli' }),
    // Elsewhere Proton's own installer script: shown, not piped into a shell by Conch.
    download: {
      win32: 'https://proton.me/support/pass-cli',
      darwin: 'https://proton.me/support/pass-cli',
      linux: 'https://proton.me/support/pass-cli',
    },
  },
  {
    id: 'dcli',
    name: 'The Dashlane command-line tool',
    short: 'Dashlane CLI',
    find: () => findExecutable('dcli'),
    install: {
      darwin: { manager: 'brew', args: ['install', 'dashlane/tap/dashlane-cli'] },
    },
    ...updatable({ brew: 'dashlane/tap/dashlane-cli' }),
    // Dashlane ships signed binaries for Windows and Linux on its releases page.
    download: {
      win32: 'https://cli.dashlane.com/install',
      darwin: 'https://cli.dashlane.com/install',
      linux: 'https://cli.dashlane.com/install',
    },
  },
  {
    id: 'keeper',
    name: 'Keeper Commander',
    short: 'Keeper Commander',
    find: () =>
      findExecutable('keeper', {
        extraDirs: [
          join(homedir(), '.local', 'bin'),
          '/Applications/Keeper Commander.app/Contents/MacOS',
        ],
      }),
    // Keeper ships it as a Python package and signed installers, not through a package manager Conch drives.
    download: {
      win32: 'https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup',
      darwin: 'https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup',
      linux: 'https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup',
    },
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
    ...updatable({ winget: 'astral-sh.uv', brew: 'uv' }),
    download: {
      win32: 'https://docs.astral.sh/uv/getting-started/installation/',
      darwin: 'https://docs.astral.sh/uv/getting-started/installation/',
      linux: 'https://docs.astral.sh/uv/getting-started/installation/',
    },
  },
  {
    // A model on this computer (ADR 0022). Ollama for Windows installs per
    // user (no administrator) and puts itself on the user's PATH; the Mac app
    // keeps its command-line tool inside the bundle. Linux gets the page:
    // its installer is a script that needs sudo, and Conch never pipes one
    // into a shell.
    id: 'ollama',
    name: 'Ollama',
    short: 'Ollama',
    find: (platform) => findOllama(platform),
    install: {
      win32: winget('Ollama.Ollama'),
      darwin: { manager: 'brew', args: ['install', '--cask', 'ollama-app'] },
    },
    update: (path, platform) =>
      platform === 'win32'
        ? [{ manager: 'winget', args: ['upgrade', '--id', 'Ollama.Ollama', ...WINGET_QUIET] }]
        : updateBy(path, platform, { brew: 'ollama-app', cask: true }),
    // Its winget install lands in its own folder, not WinGet's: winget still knows it.
    latest: (path, platform, lookup) =>
      platform === 'win32'
        ? lookup.winget('Ollama.Ollama')
        : latestBy(path, platform, { brew: 'ollama-app', cask: true }, lookup),
    version: versionOf,
    download: {
      win32: 'https://ollama.com/download/windows',
      darwin: 'https://ollama.com/download/mac',
      linux: 'https://docs.ollama.com/linux',
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

/** Where Ollama puts its program on each system, when it isn't on `PATH`. */
export function ollamaDirs(platform: Platform): string[] {
  if (platform === 'win32') return [join(localAppData(), 'Programs', 'Ollama')];
  if (platform === 'darwin')
    return [
      '/Applications/Ollama.app/Contents/Resources',
      join(homedir(), 'Applications', 'Ollama.app', 'Contents', 'Resources'),
    ];
  return ['/usr/local/bin', '/usr/bin'];
}

export function findOllama(platform: Platform): Promise<string | undefined> {
  return findExecutable('ollama', { extraDirs: ollamaDirs(platform) });
}

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
