/**
 * The sealed box for commands (ADR 0028): what a command may change, what it
 * may never read, and where it may reach (ADR 0148). Claude Code runs commands
 * in the computer's own sandbox (Seatbelt on a Mac, bubblewrap on Linux) with
 * these lists, and so do Conch's own commands (`engines/host.ts`, `process_start`);
 * leaving the box asks first (the guard).
 *
 * Measured on macOS before choosing (Sept 2026): with the sandbox on and no
 * lists, a command can write only to its working folder — not even `/tmp`
 * or `~/.npm`. So the lists add the places installs and builds need, and take
 * away where keys live. Claude Code asks Conch about each host one of its
 * sealed commands reaches (`SandboxNetworkAccess`), unless the host is on
 * the list it's given; Conch's own box reaches only the hosts on its list.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { remoteHosts } from './git-remotes';

const home = homedir();
const lib = (...parts: string[]) => join(home, 'Library', ...parts);

/**
 * The hosts a sealed command may reach (ADR 0148), over HTTPS only: package
 * registries, code hosts and the languages' own tooling (the hosts
 * `packages.ts` `TOOLING_HOSTS` names). Every one serves downloads to anyone
 * and takes an upload only with an account's key, and the keys that publish
 * are kept out of the box (`publishingKeys`). So `npm install`, `pip install`,
 * `cargo fetch`, `go mod download` and `git clone`/`pull` over HTTPS work sealed.
 *
 * Left out on purpose: `upload.pypi.org` (where Python packages are published),
 * `api.github.com` (issues and gists), and the cloud's buckets
 * (`storage.googleapis.com`, S3): anyone can upload to a bucket with a signed
 * address, and that would be a way out for what a command read.
 */
export const REGISTRY_HOSTS = {
  npm: ['registry.npmjs.org', 'registry.yarnpkg.com', 'repo.yarnpkg.com'],
  pypi: ['pypi.org', 'files.pythonhosted.org'],
  crates: ['crates.io', 'index.crates.io', 'static.crates.io'],
  go: ['proxy.golang.org', 'sum.golang.org', 'golang.org'],
  rubygems: ['rubygems.org', 'index.rubygems.org'],
  homebrew: ['formulae.brew.sh', 'ghcr.io', 'pkg-containers.githubusercontent.com'],
  code: [
    'github.com',
    'codeload.github.com',
    'objects.githubusercontent.com',
    'raw.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'gitlab.com',
    'bitbucket.org',
  ],
  tooling: [
    'bootstrap.pypa.io',
    'python.org',
    'www.python.org',
    'nodejs.org',
    'static.rust-lang.org',
    'sh.rustup.rs',
    'astral.sh',
    'get.pnpm.io',
    'bun.sh',
    'go.dev',
    'dl.google.com',
  ],
} as const satisfies Record<string, readonly string[]>;

export type HostGroup = keyof typeof REGISTRY_HOSTS;

/**
 * Where the keys that publish packages and push code live (ADR 0148): never
 * read from inside Conch's own box, which now reaches the registries. Not in
 * `secretPlaces`, so a command outside the box that names one is asked about
 * (risk.ts reads these as keys) rather than refused. A project's own `.npmrc`
 * is in the work folder and stays readable.
 */
export function publishingKeys(): { path: string; what: string }[] {
  return [
    { path: join(home, '.npmrc'), what: 'npm sign-ins' },
    { path: join(home, '.yarnrc'), what: 'Yarn sign-ins' },
    { path: join(home, '.yarnrc.yml'), what: 'Yarn sign-ins' },
    { path: join(home, '.bunfig.toml'), what: 'Bun sign-ins' },
    { path: join(home, '.config', 'configstore'), what: 'sign-ins kept by npm tools' },
    { path: join(home, '.pypirc'), what: 'PyPI sign-ins' },
    ...pipConfigs().map((path) => ({ path, what: 'pip index sign-ins' })),
    { path: join(home, '.cargo', 'credentials'), what: 'crates.io sign-ins' },
    { path: join(home, '.cargo', 'credentials.toml'), what: 'crates.io sign-ins' },
    { path: join(home, '.gem', 'credentials'), what: 'RubyGems sign-ins' },
    { path: join(home, '.config', 'hub'), what: 'hub’s GitHub sign-in' },
    { path: join(home, '.config', 'glab-cli'), what: 'GitLab CLI sign-in' },
    { path: join(home, '.config', 'git', 'credentials'), what: 'saved Git passwords' },
    { path: join(home, '.gcm'), what: 'Git Credential Manager' },
    { path: join(home, '.terraformrc'), what: 'Terraform sign-ins' },
    { path: join(home, '.terraform.d', 'credentials.tfrc.json'), what: 'Terraform sign-ins' },
  ];
}

/** Where pip reads a person's own settings, index addresses and their passwords among them. */
function pipConfigs(): string[] {
  return [
    join(home, '.config', 'pip', 'pip.conf'),
    join(home, '.pip', 'pip.conf'),
    ...(platform() === 'darwin' ? [lib('Application Support', 'pip', 'pip.conf')] : []),
  ];
}

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8').slice(0, 64_000);
  } catch {
    return '';
  }
};

/**
 * The registries a person points their own settings elsewhere for: their
 * `~/.npmrc` (or `~/.bunfig.toml`) names another npm registry, their pip
 * settings another index. Those settings can't be read inside the box, so
 * there the tool would ask the public registry instead, and a name meant for
 * the person's own registry could come from a stranger's package of the same
 * name. So the public one stays out of the box too, and such installs leave
 * it as before.
 */
export function elsewhere(
  files: { npmrc: string; bunfig: string; pip: string[] } = {
    npmrc: join(home, '.npmrc'),
    bunfig: join(home, '.bunfig.toml'),
    pip: pipConfigs(),
  },
): Set<HostGroup> {
  const out = new Set<HostGroup>();
  const own = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\/?$/i;
  for (const match of read(files.npmrc).matchAll(/^\s*(?:@[\w.-]+:)?registry\s*=\s*(\S+)/gim))
    if (!own.test((match[1] ?? '').replace(/^["']|["']$/g, ''))) out.add('npm');
  // Bun's own registry or scopes, whatever they say: TOML is too many shapes to read here.
  if (/^\s*(?:registry\s*=|\[install\.scopes\])/im.test(read(files.bunfig))) out.add('npm');
  const pypi = /^https?:\/\/pypi\.org\/simple\/?$/i;
  for (const text of files.pip.map(read))
    for (const match of text.matchAll(/^\s*(?:extra-)?index-url\s*=\s*(\S+)/gim))
      if (!pypi.test(match[1] ?? '')) out.add('pypi');
  return out;
}

/** An entry the runtime takes: a host on HTTPS's port, or with the remote's own port. */
const https = (host: string) => (/:\d+$/.test(host) ? host : `${host}:443`);

/**
 * Where one work folder's sealed commands may reach (ADR 0148): the
 * registries and code hosts, and the hosts of the folder's own HTTPS remotes
 * (read from its Git settings, on this computer). `keysDenied`: the box can't
 * read the publishing keys, so a registry the person moved elsewhere stays out.
 */
export async function sealedHosts(
  workspace: string,
  { keysDenied = true, moved }: { keysDenied?: boolean; moved?: Set<HostGroup> } = {},
): Promise<string[]> {
  moved ??= keysDenied ? elsewhere() : new Set();
  const listed = (Object.keys(REGISTRY_HOSTS) as HostGroup[])
    .filter((registry) => !moved.has(registry))
    .flatMap((registry) => REGISTRY_HOSTS[registry]);
  const remotes = await remoteHosts(workspace).catch(() => []);
  return [...new Set([...listed, ...remotes].map(https))];
}

/**
 * The whole box for Conch's own sealed commands (the host tools and
 * `process_start`), for one work folder: writes in it and the caches an
 * install needs (never `.git`), no keys, and the network to `sealedHosts`.
 */
export async function sealedConfig(
  cwd: string,
  { protectedPaths = [], denyRead = [] }: { protectedPaths?: string[]; denyRead?: string[] },
): Promise<{
  network: { allowedDomains: string[]; deniedDomains: string[] };
  filesystem: { allowWrite: string[]; denyWrite: string[]; denyRead: string[] };
}> {
  return {
    network: { allowedDomains: await sealedHosts(cwd), deniedDomains: [] },
    filesystem: {
      allowWrite: [...new Set([cwd, ...writableCaches()])],
      denyWrite: [...protectedPaths, resolve(cwd, '.git')],
      denyRead: [
        ...new Set([
          ...denyRead,
          ...protectedPaths,
          ...secretPlaces().map((p) => p.path),
          ...publishingKeys().map((p) => p.path),
        ]),
      ],
    },
  };
}

/** Where package managers and build tools keep their caches: an install must work in the box. */
export function writableCaches(): string[] {
  return [
    join(home, '.npm'),
    join(home, '.cache'),
    join(home, '.pnpm-store'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, '.yarn'),
    join(home, '.bun'),
    join(home, '.cargo', 'registry'),
    join(home, '.cargo', 'git'),
    join(home, 'go', 'pkg'),
    join(home, '.gradle'),
    join(home, '.m2'),
    join(home, '.nuget', 'packages'),
    join(home, '.deno'),
    ...(platform() === 'darwin' ? [lib('Caches'), lib('pnpm')] : []),
  ];
}

/** Where keys, sign-ins and saved passwords live: never read from inside the box. */
export function secretPlaces(): { path: string; what: string }[] {
  const mac = platform() === 'darwin';
  return [
    { path: join(home, '.openclaw'), what: 'other assistant credentials' },
    { path: join(home, '.codex'), what: 'Codex credentials' },
    { path: join(home, '.claude'), what: 'Claude Code credentials' },
    { path: join(home, '.ssh'), what: 'SSH keys' },
    { path: join(home, '.gnupg'), what: 'GPG keys' },
    { path: join(home, '.aws'), what: 'AWS sign-ins' },
    { path: join(home, '.azure'), what: 'Azure sign-ins' },
    { path: join(home, '.config', 'gcloud'), what: 'Google Cloud sign-ins' },
    { path: join(home, '.kube'), what: 'Kubernetes sign-ins' },
    { path: join(home, '.docker', 'config.json'), what: 'Docker sign-ins' },
    { path: join(home, '.netrc'), what: 'saved logins (.netrc)' },
    { path: join(home, '.git-credentials'), what: 'saved Git passwords' },
    { path: join(home, '.config', 'gh'), what: 'GitHub CLI sign-in' },
    { path: join(home, '.password-store'), what: 'pass' },
    { path: join(home, '.mozilla'), what: 'Firefox profiles' },
    { path: join(home, '.config', 'google-chrome'), what: 'Chrome profiles' },
    { path: join(home, '.config', 'chromium'), what: 'Chromium profiles' },
    { path: join(home, '.config', 'Bitwarden CLI'), what: 'Bitwarden' },
    ...(mac
      ? [
          { path: lib('Keychains'), what: 'your keychains' },
          { path: lib('Cookies'), what: 'cookies' },
          { path: lib('Safari'), what: 'Safari' },
          { path: lib('Messages'), what: 'Messages' },
          { path: lib('Mail'), what: 'Mail' },
          { path: lib('Application Support', 'Google', 'Chrome'), what: 'Chrome profiles' },
          { path: lib('Application Support', 'Microsoft Edge'), what: 'Edge profiles' },
          { path: lib('Application Support', 'BraveSoftware'), what: 'Brave profiles' },
          { path: lib('Application Support', 'Firefox'), what: 'Firefox profiles' },
          { path: lib('Group Containers', '2BUA8C4S2C.com.1password'), what: '1Password' },
        ]
      : []),
  ];
}

/** The lists for one chat's work folder. `conch`: Conch's own protected places (vault, keys). */
export function sandboxFor(
  workspace: string,
  conch: { protectedPaths: string[]; home: string },
): { allowWrite: string[]; denyRead: string[] } {
  return {
    allowWrite: [...new Set([workspace, tmpdir(), '/tmp', '/private/tmp', ...writableCaches()])],
    denyRead: [
      ...secretPlaces().map((p) => p.path),
      ...conch.protectedPaths,
      // Conch's own browser keeps its sign-ins and cookies here.
      join(conch.home, 'browser', 'profile'),
    ],
  };
}

/** A program on `PATH` (or where Linux keeps them), checked without running it. */
export function onPath(program: string): boolean {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/usr/bin', '/usr/local/bin', '/bin'];
  return dirs.some((dir) => dir && existsSync(join(dir, program)));
}

let probeCache: { until: number; available: boolean } | undefined;
/** A harmless real sandbox probe: installed binaries alone do not prove kernel permission. */
export function sandboxRuntimeReady(os: NodeJS.Platform = platform()): boolean {
  if (probeCache && probeCache.until > Date.now()) return probeCache.available;
  const probe =
    os === 'linux'
      ? spawnSync(
          'bwrap',
          [
            '--unshare-user',
            '--unshare-pid',
            '--unshare-net',
            '--ro-bind',
            '/',
            '/',
            '--',
            '/bin/true',
          ],
          { timeout: 1500, stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } },
        )
      : os === 'darwin'
        ? spawnSync(
            '/usr/bin/sandbox-exec',
            ['-p', '(version 1)(allow default)(deny network*)', '/usr/bin/true'],
            { timeout: 1500, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } },
          )
        : undefined;
  const available = probe?.status === 0;
  probeCache = { until: Date.now() + 30_000, available };
  return available;
}

/** Each package manager Conch knows, and the fixed line that installs the three with it. */
const INSTALLS: [manager: string, command: string][] = [
  ['apt-get', 'sudo apt-get update && sudo apt-get install -y bubblewrap socat ripgrep'],
  ['dnf', 'sudo dnf install -y bubblewrap socat ripgrep'],
  ['pacman', 'sudo pacman -S --needed --noconfirm bubblewrap socat ripgrep'],
  ['zypper', 'sudo zypper --non-interactive install bubblewrap socat ripgrep'],
  ['apk', 'sudo apk add bubblewrap socat ripgrep'],
];

/**
 * The system's own bubblewrap, where every distribution puts it. Never one
 * found earlier on PATH: a profile for a program you can replace would let
 * anything you run make a user namespace.
 */
export const SYSTEM_BWRAP = '/usr/bin/bwrap';
export const BWRAP_PROFILE = '/etc/apparmor.d/conch-bwrap';

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * Ubuntu 23.10+ lets a program make a user namespace (what bubblewrap's
 * sandbox is) only when an AppArmor profile says it may. This one says so for
 * the system's bubblewrap alone, as Flatpak needs too; written with `tee`, in
 * full on the line, so what runs as root is what's on the screen.
 */
function allowBwrap(): string {
  const profile = [
    '# Conch: bubblewrap may make the user namespace its sandbox needs.',
    'abi <abi/4.0>,',
    'include <tunables/global>',
    `profile conch-bwrap ${SYSTEM_BWRAP} flags=(unconfined) {`,
    '  userns,',
    '}',
  ];
  return `printf '%s\\n' ${profile.map(quote).join(' ')} | sudo tee ${BWRAP_PROFILE} >/dev/null && sudo apparmor_parser -r ${BWRAP_PROFILE}`;
}

/**
 * The one line that seals commands here, typed into Conch's terminal for the
 * person, who presses Enter and types their own password. Everything that
 * runs as root is on that line: nothing is read from a file anyone could
 * change (Conch's own folder is writable by you, and so by the assistant).
 * Undefined when no line would help.
 */
export function sealCommand({
  missing,
  restricted,
  has,
}: {
  missing: boolean;
  restricted: boolean;
  has: (program: string) => boolean;
}): string | undefined {
  const parts: string[] = [];
  if (missing) {
    const install = INSTALLS.find(([manager]) => has(manager));
    if (!install) return undefined;
    parts.push(install[1]);
  }
  if (restricted) parts.push(allowBwrap());
  return parts.length ? parts.join(' && ') : undefined;
}

/** Ubuntu 23.10+ keeps programs from making their own sandbox until AppArmor allows it. */
function userNamespacesRestricted(): boolean {
  try {
    return (
      readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
    );
  } catch {
    return false;
  }
}

/**
 * Whether this computer can seal commands, and what's missing when it can't:
 * macOS needs Seatbelt; Linux needs bubblewrap, socat and ripgrep; Windows cannot yet.
 */
export function sandboxSupport(
  has: (program: string) => boolean = onPath,
  os: NodeJS.Platform = platform(),
  ready: (os: NodeJS.Platform) => boolean = sandboxRuntimeReady,
  restricted: () => boolean = userNamespacesRestricted,
): { available: true } | { available: false; reason: string; command?: string } {
  const blocked = {
    available: false as const,
    reason:
      'This host does not permit the OS command sandbox. Check container/kernel permissions; files and connected apps still work.',
  };
  if (os === 'darwin') return ready(os) ? { available: true } : blocked;
  if (os === 'linux') {
    const missing = ['bwrap', 'socat', 'rg'].some((p) => !has(p));
    if (missing) {
      const command = sealCommand({ missing, restricted: restricted(), has });
      return {
        available: false,
        reason: command
          ? 'Sealing commands needs bubblewrap, a small sandbox program this system doesn’t come with. One command installs it; it needs your password once.'
          : 'Sealing commands needs bubblewrap, socat and ripgrep. Install them with your system’s package manager.',
        ...(command && { command }),
      };
    }
    if (ready(os)) return { available: true };
    // Installed, but Ubuntu won't let it make its sandbox yet: one line allows it.
    const command = restricted()
      ? sealCommand({ missing: false, restricted: true, has })
      : undefined;
    return command
      ? {
          available: false,
          reason:
            'This system keeps bubblewrap from making its sandbox until it’s allowed (as Flatpak needs too). One command allows it; it needs your password once.',
          command,
        }
      : blocked;
  }
  return {
    available: false,
    reason: 'Windows can’t seal commands yet. The other checks still apply.',
  };
}
