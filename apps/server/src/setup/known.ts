import { readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { sandboxSupport } from '../conversations/sandbox';
import { bundledClaude } from '../engines/claude-code/bundled';
import { findClaude } from '../engines/claude-code/detect';
import { ACP_AGENTS, findAgent } from '../engines/acp/agents';
import { lmStudioInstall } from '../engines/api/lmstudio';
import { findCodex } from '../engines/codex/detect';
import { findExecutable, presentSync, run } from '../lib/proc';
import { parseVersion } from '../updates/version';
import { findContainerProgram } from '../workplaces/container';
import type { InstallRecipe, LatestLookup, NeedSpec, Platform } from './needs';
import { fetchedBin, fetchedTool } from './release';

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

/** A project's own release on GitHub, fetched and checked by Conch (`release.ts`). */
const github = (repo: string, asset: string, program: string): InstallRecipe => ({
  manager: 'github',
  args: [repo, asset, program],
});

/** A Python program installed by uv as a tool of its own (getting uv first if needed). */
const uvTool = (pkg: string): InstallRecipe => ({
  manager: 'uv',
  args: ['tool', 'install', pkg],
  via: 'uv',
});

/** The version of a uv tool, as `uv tool list` says it (`piper-tts v1.8.0`). */
export async function uvToolVersion(pkg: string): Promise<string | undefined> {
  const uv = await findExecutable('uv', {
    extraDirs: [join(homedir(), '.local', 'bin'), ...fetchedBin('uv')],
  });
  if (!uv) return undefined;
  const result = await run(uv, ['tool', 'list'], { timeout: 15_000 });
  const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith(`${pkg} `));
  return line ? parseVersion(line) : undefined;
}

const WHISPER_REPO = 'ggml-org/whisper.cpp';
/** The release files for this computer, when the project makes one. */
const WHISPER_WINDOWS = process.arch === 'x64' ? 'whisper-bin-x64.zip' : undefined;
const WHISPER_LINUX =
  process.arch === 'x64'
    ? 'whisper-bin-ubuntu-x64.tar.gz'
    : process.arch === 'arm64'
      ? 'whisper-bin-ubuntu-arm64.tar.gz'
      : undefined;
const UV_LINUX =
  process.arch === 'x64'
    ? 'uv-x86_64-unknown-linux-gnu.tar.gz'
    : process.arch === 'arm64'
      ? 'uv-aarch64-unknown-linux-gnu.tar.gz'
      : undefined;

/**
 * Versions and updates for a program Conch may have fetched itself: that copy
 * follows its GitHub releases; one from a package manager follows that.
 */
function fetchedOr(
  need: string,
  repo: string,
  asset: string | undefined,
  ids: PackageIds,
): Pick<NeedSpec, 'update' | 'latest' | 'version'> {
  const fetched = (path: string) => {
    const tool = fetchedTool(need);
    return tool && asset && path.startsWith(tool.bin) ? tool : undefined;
  };
  const program = (path: string) => basename(path).replace(/\.exe$/i, '');
  return {
    update: (path, platform) =>
      fetched(path) && asset ? [github(repo, asset, program(path))] : updateBy(path, platform, ids),
    latest: (path, platform, lookup) =>
      fetched(path) && asset ? lookup.github(repo, asset) : latestBy(path, platform, ids, lookup),
    version: async (path) => fetched(path)?.version ?? versionOf(path),
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
    id: 'command-sandbox',
    name: 'The command sandbox',
    short: 'Command sandbox',
    platforms: ['linux', 'darwin'],
    find: async (platform) =>
      !sandboxSupport(undefined, platform).available
        ? undefined
        : platform === 'darwin'
          ? '/usr/bin/sandbox-exec'
          : (await findExecutable('bwrap')) &&
              (await findExecutable('socat')) &&
              (await findExecutable('rg'))
            ? await findExecutable('bwrap')
            : undefined,
    download: {
      linux: 'https://github.com/anthropics/sandbox-runtime#prerequisites',
      darwin: 'https://github.com/anthropics/sandbox-runtime#prerequisites',
    },
    hint: () =>
      'Sealing keeps the assistant’s commands to your work folder, with no network or secrets. Until it’s set up, each command runs with your access and asks first.',
    admin: (platform) => {
      if (platform !== 'linux') return undefined;
      const support = sandboxSupport(undefined, platform);
      return !support.available && support.command
        ? {
            command: support.command,
            what: 'Installs bubblewrap, socat and ripgrep with your system’s packages. Where Ubuntu restricts sandboxes, it also lets the system’s bubblewrap make one (an AppArmor profile, as Flatpak needs). Everything that runs is on the line.',
          }
        : undefined;
    },
  },
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
    // GitHub Copilot's own program (ADR 0053); Conch runs it as an ACP agent.
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    short: 'Copilot',
    find: () => findAgent(ACP_AGENTS.copilot),
    install: {
      win32: [winget('GitHub.Copilot'), npmGlobal('@github/copilot')],
      darwin: [
        { manager: 'brew', args: ['install', '--cask', 'copilot-cli'] },
        npmGlobal('@github/copilot'),
      ],
      linux: npmGlobal('@github/copilot'),
    },
    ...updatable({
      winget: 'GitHub.Copilot',
      brew: 'copilot-cli',
      cask: true,
      npm: '@github/copilot',
    }),
    download: {
      win32:
        'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
      darwin:
        'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
      linux:
        'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
    },
  },
  {
    // Google's Gemini CLI; npm is its one current package (Homebrew's lags behind).
    id: 'gemini-cli',
    name: 'Gemini CLI',
    short: 'Gemini CLI',
    find: () => findAgent(ACP_AGENTS['gemini-cli']),
    install: {
      win32: npmGlobal('@google/gemini-cli'),
      darwin: npmGlobal('@google/gemini-cli'),
      linux: npmGlobal('@google/gemini-cli'),
    },
    ...updatable({ npm: '@google/gemini-cli' }),
    download: {
      win32: 'https://github.com/google-gemini/gemini-cli',
      darwin: 'https://github.com/google-gemini/gemini-cli',
      linux: 'https://github.com/google-gemini/gemini-cli',
    },
  },
  {
    // xAI's Grok Build.
    id: 'grok',
    name: 'Grok Build',
    short: 'Grok',
    find: () => findAgent(ACP_AGENTS.grok),
    install: {
      win32: npmGlobal('@xai-official/grok'),
      darwin: npmGlobal('@xai-official/grok'),
      linux: npmGlobal('@xai-official/grok'),
    },
    ...updatable({ npm: '@xai-official/grok' }),
    download: {
      win32: 'https://x.ai/cli',
      darwin: 'https://x.ai/cli',
      linux: 'https://x.ai/cli',
    },
  },
  {
    // LM Studio keeps itself up to date, so Updates leaves it alone.
    id: 'lm-studio',
    name: 'LM Studio',
    short: 'LM Studio',
    find: () => lmStudioInstall(),
    install: {
      win32: winget('ElementLabs.LMStudio'),
      darwin: { manager: 'brew', args: ['install', '--cask', 'lm-studio'] },
    },
    download: {
      win32: 'https://lmstudio.ai/download',
      darwin: 'https://lmstudio.ai/download',
      linux: 'https://lmstudio.ai/download',
    },
    opens: 'lm-studio',
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
    find: () =>
      findExecutable('uvx', {
        extraDirs: [join(homedir(), '.local', 'bin'), ...fetchedBin('uv')],
      }),
    install: {
      win32: winget('astral-sh.uv'),
      darwin: { manager: 'brew', args: ['install', 'uv'] },
      // Its installer is a script piped into a shell, which Conch never does: its release instead.
      ...(UV_LINUX && { linux: github('astral-sh/uv', UV_LINUX, 'uv') }),
    },
    ...fetchedOr('uv', 'astral-sh/uv', UV_LINUX, { winget: 'astral-sh.uv', brew: 'uv' }),
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
    // Your phone's secure address (ADR 0027). Every Tailscale installer asks
    // for an administrator (it adds a network adapter), so a person runs it;
    // Conch opens the app afterwards so you can sign in.
    id: 'tailscale',
    name: 'Tailscale',
    short: 'Tailscale',
    async find(platform) {
      if (platform === 'darwin') return macApp('Tailscale.app');
      return findExecutable('tailscale', {
        extraDirs: platform === 'win32' ? ['C:\\Program Files\\Tailscale'] : [],
      });
    },
    download: {
      win32: 'https://tailscale.com/download/windows',
      darwin: 'https://tailscale.com/download/mac',
      linux: 'https://tailscale.com/download/linux',
    },
    opens: 'tailscale',
  },
  {
    // Private dictation and voice notes (ADR 0027, ADR 0077): whisper.cpp turns
    // speech into text on this computer, so a voice never leaves it. Homebrew
    // has it on a Mac and on Linux; on Windows (and Linux without Homebrew)
    // Conch fetches the project's own release itself, checked against the
    // SHA-256 GitHub publishes for it.
    id: 'whisper',
    name: 'whisper.cpp (private listening)',
    short: 'whisper.cpp',
    find: () => findExecutable('whisper-cli', { extraDirs: fetchedBin('whisper') }),
    install: {
      ...(WHISPER_WINDOWS && { win32: github(WHISPER_REPO, WHISPER_WINDOWS, 'whisper-cli') }),
      darwin: { manager: 'brew', args: ['install', 'whisper-cpp'] },
      linux: [
        { manager: 'brew', args: ['install', 'whisper-cpp'] },
        ...(WHISPER_LINUX ? [github(WHISPER_REPO, WHISPER_LINUX, 'whisper-cli')] : []),
      ],
    },
    ...fetchedOr('whisper', WHISPER_REPO, WHISPER_WINDOWS ?? WHISPER_LINUX, {
      brew: 'whisper-cpp',
    }),
    download: {
      win32: 'https://github.com/ggml-org/whisper.cpp/releases',
      darwin: 'https://github.com/ggml-org/whisper.cpp#quick-start',
      linux: 'https://github.com/ggml-org/whisper.cpp#quick-start',
    },
  },
  {
    // Voice notes (ADR 0077) arrive as Opus, AAC or AMR, which whisper.cpp
    // can't read, and a voice reply goes back as Opus: FFmpeg turns one into
    // the other, on this computer.
    id: 'ffmpeg',
    name: 'FFmpeg (for voice notes)',
    short: 'FFmpeg',
    find: () => findExecutable('ffmpeg'),
    install: {
      win32: winget('Gyan.FFmpeg'),
      darwin: { manager: 'brew', args: ['install', 'ffmpeg'] },
      linux: { manager: 'brew', args: ['install', 'ffmpeg'] },
    },
    ...updatable({ winget: 'Gyan.FFmpeg', brew: 'ffmpeg' }),
    // FFmpeg says its version with one dash.
    version: async (path) => {
      const result = await run(path, ['-version'], { timeout: 15_000 });
      return result.code === 0 ? parseVersion(result.stdout.split('\n')[0] ?? '') : undefined;
    },
    download: {
      win32: 'https://ffmpeg.org/download.html#build-windows',
      darwin: 'https://ffmpeg.org/download.html#build-mac',
      linux: 'https://ffmpeg.org/download.html#build-linux',
    },
  },
  {
    // A natural voice on this computer (ADR 0077): Piper reads answers aloud
    // with a neural voice, offline. It's a Python program, so uv installs it
    // as a tool of its own, with the Python it needs, for this user only.
    id: 'piper',
    name: 'Piper (natural voices)',
    short: 'Piper',
    find: () => findExecutable('piper', { extraDirs: [join(homedir(), '.local', 'bin')] }),
    install: {
      win32: uvTool('piper-tts'),
      darwin: uvTool('piper-tts'),
      linux: uvTool('piper-tts'),
    },
    update: () => [{ manager: 'uv', args: ['tool', 'upgrade', 'piper-tts'], via: 'uv' }],
    latest: (_path, _platform, lookup) => lookup.pypi('piper-tts'),
    version: () => uvToolVersion('piper-tts'),
    download: {
      win32: 'https://github.com/OHF-Voice/piper1-gpl#readme',
      darwin: 'https://github.com/OHF-Voice/piper1-gpl#readme',
      linux: 'https://github.com/OHF-Voice/piper1-gpl#readme',
    },
    hint: (has) =>
      has('uv') ? undefined : 'Conch gets uv first, which brings the Python it runs on.',
  },
  {
    // Building Conch's menu bar helper (ADR 0029). Apple's own installer asks
    // for it in a window, so a person presses Install there.
    id: 'command-line-tools',
    name: 'Apple’s Command Line Tools',
    short: 'Command Line Tools',
    find: async (platform) => {
      if (platform !== 'darwin') return undefined;
      const result = await run('xcode-select', ['-p'], { timeout: 5_000 });
      return result.code === 0 ? result.stdout.trim() : undefined;
    },
    // Only a Mac needs it; the other systems get the same page, which says so.
    download: {
      darwin: 'https://developer.apple.com/download/all/?q=command%20line%20tools',
      win32: 'https://developer.apple.com/download/all/?q=command%20line%20tools',
      linux: 'https://developer.apple.com/download/all/?q=command%20line%20tools',
    },
    hint: () => 'Or run xcode-select --install in Terminal, and press Install.',
  },
  {
    // Conch in the Linux panel (ADR 0029): Python's GObject bindings and AppIndicator.
    id: 'appindicator',
    name: 'AppIndicator for Python',
    short: 'AppIndicator',
    find: async (platform) => {
      if (platform !== 'linux') return undefined;
      const result = await run(
        'python3',
        [
          '-c',
          'import gi\ngi.require_version("Gtk","3.0")\ntry:\n  gi.require_version("AyatanaAppIndicator3","0.1")\nexcept ValueError:\n  gi.require_version("AppIndicator3","0.1")',
        ],
        { timeout: 5_000 },
      );
      return result.code === 0 ? 'python3' : undefined;
    },
    download: {
      linux: 'https://github.com/AyatanaIndicators/libayatana-appindicator',
      darwin: 'https://github.com/AyatanaIndicators/libayatana-appindicator',
      win32: 'https://github.com/AyatanaIndicators/libayatana-appindicator',
    },
    hint: () => 'On Debian or Ubuntu: sudo apt install python3-gi gir1.2-ayatanaappindicator3-0.1',
  },
  {
    // Signal (ADR 0043) runs through signal-cli, which needs Java 25 or later.
    // Homebrew brings both on a Mac and on Linux; on Windows it's a download
    // from its releases (Conch then starts it with Java, not its batch file).
    id: 'signal-cli',
    name: 'signal-cli (for Signal)',
    short: 'signal-cli',
    find: (platform) => findSignalCli(platform),
    install: {
      darwin: { manager: 'brew', args: ['install', 'signal-cli'] },
      linux: { manager: 'brew', args: ['install', 'signal-cli'] },
    },
    ...updatable({ brew: 'signal-cli' }),
    download: {
      win32: 'https://github.com/AsamK/signal-cli/releases/latest',
      darwin: 'https://github.com/AsamK/signal-cli#installation',
      linux: 'https://github.com/AsamK/signal-cli/releases/latest',
    },
    hint: (has) =>
      has('java')
        ? undefined
        : 'It needs Java 25 or later too. Homebrew brings it; on Windows, install Java first.',
  },
  {
    // What signal-cli runs on. A Mac's /usr/bin/java is only a stub until a
    // Java is installed, so a Java counts only when it says it's 25 or later.
    id: 'java',
    name: 'Java 25 or later (for Signal)',
    short: 'Java',
    find: () => findJava(),
    install: {
      win32: winget('EclipseAdoptium.Temurin.25.JRE'),
      darwin: { manager: 'brew', args: ['install', 'openjdk'] },
      linux: { manager: 'brew', args: ['install', 'openjdk'] },
    },
    ...updatable({ winget: 'EclipseAdoptium.Temurin.25.JRE', brew: 'openjdk' }),
    download: {
      win32: 'https://adoptium.net/temurin/releases/?version=25',
      darwin: 'https://adoptium.net/temurin/releases/?version=25',
      linux: 'https://adoptium.net/temurin/releases/?version=25',
    },
  },
  {
    // iMessage (ADR 0044): Messages comes with every Mac; it only needs signing in.
    id: 'messages-app',
    name: 'Messages',
    short: 'Messages',
    platforms: ['darwin'],
    find: async (platform) =>
      platform === 'darwin'
        ? ['/System/Applications/Messages.app', '/Applications/Messages.app'].find(presentSync)
        : undefined,
    // Only a Mac has it; the other systems get the same page, which says so.
    download: {
      darwin: 'https://support.apple.com/guide/messages/welcome/mac',
      win32: 'https://support.apple.com/guide/messages/welcome/mac',
      linux: 'https://support.apple.com/guide/messages/welcome/mac',
    },
    opens: 'messages-app',
    hint: () => 'Comes with macOS. Open Messages and sign in with your Apple ID.',
  },
  {
    // Publishing an app on GitHub (ADR 0061 §5) goes through GitHub's own
    // program, so Conch never keeps a GitHub token of its own.
    id: 'gh',
    name: 'GitHub CLI',
    short: 'GitHub CLI',
    find: (platform) => findGh(platform),
    install: {
      win32: winget('GitHub.cli'),
      darwin: { manager: 'brew', args: ['install', 'gh'] },
    },
    ...updatable({ winget: 'GitHub.cli', brew: 'gh' }),
    // Linux packages need sudo and GitHub's package repository.
    download: {
      win32: 'https://cli.github.com/',
      darwin: 'https://cli.github.com/',
      linux: 'https://github.com/cli/cli/blob/trunk/docs/install_linux.md',
    },
  },
  {
    // Git, for pushing what Conch publishes (ADR 0061 §5).
    id: 'git',
    name: 'Git',
    short: 'Git',
    find: (platform) => findGit(platform),
    install: {
      win32: winget('Git.Git'),
      darwin: { manager: 'brew', args: ['install', 'git'] },
    },
    ...updatable({ winget: 'Git.Git', brew: 'git' }),
    // Linux packages need sudo.
    download: {
      win32: 'https://git-scm.com/downloads/win',
      darwin: 'https://git-scm.com/downloads/mac',
      linux: 'https://git-scm.com/downloads/linux',
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
  {
    // Where work runs (ADR 0106): a container needs Docker or Podman, whichever
    // is here. Docker Desktop installs as an administrator; Podman doesn't, so
    // it's the one Conch installs, and starts its machine itself on first use.
    id: 'container',
    name: 'Docker or Podman',
    short: 'Podman',
    find: async () => (await findContainerProgram())?.path,
    install: {
      darwin: { manager: 'brew', args: ['install', 'podman'] },
      win32: winget('RedHat.Podman'),
    },
    version: versionOf,
    download: {
      win32: 'https://podman.io/docs/installation#windows',
      darwin: 'https://podman.io/docs/installation#macos',
      linux: 'https://podman.io/docs/installation#installing-on-linux',
    },
    hint: () =>
      'Runs the assistant’s commands in a locked-down box that sees only the work folder.',
    admin: (platform) =>
      platform === 'linux'
        ? {
            command:
              'if command -v apt-get >/dev/null; then sudo apt-get update && sudo apt-get install -y podman; elif command -v dnf >/dev/null; then sudo dnf install -y podman; elif command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm podman; elif command -v zypper >/dev/null; then sudo zypper --non-interactive install podman; fi',
            what: 'Installs Podman with your system’s packages. It runs containers as you, with no service in the background.',
          }
        : undefined,
  },
);

/** Java's own folder for Homebrew's `openjdk`, which isn't linked onto `PATH`. */
const BREW_JAVA = ['/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'];

/** The major version a `java -version` reports (it writes to stderr). */
export function javaMajor(text: string): number | undefined {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text) ?? /\b(?:openjdk|java) (\d+)/i.exec(text);
  if (!match?.[1]) return undefined;
  const major = Number(match[1]);
  // Java 8 and older call themselves 1.8.
  return major === 1 && match[2] ? Number(match[2]) : major;
}

/** A Java new enough for signal-cli: `JAVA_HOME`'s, then Homebrew's, then the one on `PATH`. */
export async function findJava(): Promise<string | undefined> {
  const name = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    ...(process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, 'bin', name)] : []),
    ...BREW_JAVA.map((dir) => join(dir, name)),
  ].filter(presentSync);
  const onPath = await findExecutable('java');
  if (onPath) candidates.push(onPath);
  for (const path of candidates) {
    const result = await run(path, ['-version'], { timeout: 15_000 });
    const major = javaMajor(`${result.stderr}\n${result.stdout}`);
    if (result.code === 0 && major !== undefined && major >= 25) return path;
  }
  return undefined;
}

/** The folder a Java lives in (what `JAVA_HOME` names), from its program. */
export function javaHomeOf(java: string): string {
  let real = java;
  try {
    real = realpathSync(java);
  } catch {
    // A path that can't be resolved is used as it is.
  }
  return dirname(dirname(real));
}

/**
 * signal-cli: on `PATH` or where Homebrew puts it; on Windows the release's
 * `bin\signal-cli.bat`, which Conch reads rather than runs (`signal-cli.ts`).
 */
export async function findSignalCli(platform: Platform): Promise<string | undefined> {
  if (platform !== 'win32') return findExecutable('signal-cli');
  for (const dir of (process.env.PATH ?? '').split(';').filter(Boolean)) {
    const bat = join(dir, 'signal-cli.bat');
    if (presentSync(bat)) return bat;
  }
  return undefined;
}

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

/**
 * GitHub's program: on `PATH`, where its installer puts it, or in the folder
 * winget unpacks it to (`WinGet\Packages\GitHub.cli_…\bin`), which isn't
 * always on the `PATH` Conch started with.
 */
export async function findGh(platform: Platform = process.platform as Platform) {
  const dirs: string[] = [];
  if (platform === 'win32') {
    dirs.push(
      join(process.env.ProgramFiles ?? join('C:', 'Program Files'), 'GitHub CLI'),
      join(localAppData(), 'Programs', 'GitHub CLI'),
    );
    const packages = join(localAppData(), 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const name of readdirSync(packages))
        if (name.startsWith('GitHub.cli_')) dirs.push(join(packages, name, 'bin'));
    } catch {
      // No winget packages here.
    }
  }
  return findExecutable('gh', { extraDirs: dirs });
}

/** Homebrew's git, before the one macOS keeps in `/usr/bin`. */
const BREW_GIT = ['/opt/homebrew/bin/git', '/usr/local/bin/git'];

/**
 * Git. On a Mac `/usr/bin/git` is there even without Apple's Command Line
 * Tools, and running it then opens Apple's installer, so it only counts when
 * they're installed.
 */
export async function findGit(platform: Platform = process.platform as Platform) {
  if (platform === 'darwin') {
    const brew = BREW_GIT.find(presentSync);
    if (brew) return brew;
    const tools = await run('xcode-select', ['-p'], { timeout: 5_000 });
    return tools.code === 0 && presentSync('/usr/bin/git') ? '/usr/bin/git' : undefined;
  }
  return findExecutable('git', {
    extraDirs:
      platform === 'win32'
        ? [
            join(process.env.ProgramFiles ?? join('C:', 'Program Files'), 'Git', 'cmd'),
            join(localAppData(), 'Programs', 'Git', 'cmd'),
          ]
        : [],
  });
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
