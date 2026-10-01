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
import { existsSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

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

/**
 * Whether this computer can seal commands, and what's missing when it can't:
 * a Mac always can; Linux needs bubblewrap (and socat); Windows can't yet.
 */
export function sandboxSupport(
  has: (program: string) => boolean = onPath,
  os: NodeJS.Platform = platform(),
): { available: true } | { available: false; reason: string; command?: string } {
  if (os === 'darwin') return { available: true };
  if (os === 'linux') {
    const missing = ['bwrap', 'socat'].filter((p) => !has(p));
    return missing.length
      ? {
          available: false,
          reason: 'Sealing commands on Linux needs bubblewrap and socat.',
          command: 'sudo apt install bubblewrap socat   # or your system’s package manager',
        }
      : { available: true };
  }
  return {
    available: false,
    reason: 'Windows can’t seal commands yet. The other checks still apply.',
  };
}
