/**
 * The sealed box for commands (ADR 0028): what a command may change, and
 * what it may never read. Claude Code runs commands in the computer's own
 * sandbox (Seatbelt on a Mac, bubblewrap on Linux) with these lists; leaving
 * the box asks first (the guard).
 *
 * Measured on macOS before choosing (Sept 2026): with the sandbox on and no
 * lists, a command can write only to its working folder — not even `/tmp`
 * or `~/.npm` — while reading and the network stay open. So the lists add
 * the places installs and builds need, and take away where keys live.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const home = homedir();
const lib = (...parts: string[]) => join(home, 'Library', ...parts);

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
    allowWrite: [workspace, tmpdir(), '/tmp', '/private/tmp', ...writableCaches()],
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

/**
 * Conch's own script that seals commands on Linux (`setup/seal-commands.sh`):
 * installs bubblewrap, socat and ripgrep with the system's package manager,
 * lets bubblewrap make its sandbox where Ubuntu restricts it, and checks.
 */
export const SEAL_SCRIPT = fileURLToPath(new URL('../setup/seal-commands.sh', import.meta.url));

/** The one line that runs it: typed into Conch's terminal for you, never run by itself. */
export function sealCommand(script = SEAL_SCRIPT): string {
  return `sudo sh '${script.replaceAll("'", "'\\''")}'`;
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
    const missing = ['bwrap', 'socat', 'rg'].filter((p) => !has(p));
    if (missing.length)
      return {
        available: false,
        reason:
          'Sealing commands needs bubblewrap, a small sandbox program this system doesn’t come with. One command installs it; it needs your password once.',
        command: sealCommand(),
      };
    if (ready(os)) return { available: true };
    // Installed, but Ubuntu won't let it make its sandbox yet: the same command allows it.
    return restricted()
      ? {
          available: false,
          reason:
            'This system keeps bubblewrap from making its sandbox until it’s allowed. One command allows it; it needs your password once.',
          command: sealCommand(),
        }
      : blocked;
  }
  return {
    available: false,
    reason: 'Windows can’t seal commands yet. The other checks still apply.',
  };
}
