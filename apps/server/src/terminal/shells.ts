import { existsSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { basename, delimiter, posix, win32 } from 'node:path';

import type { TerminalShell } from '@conch/protocol';

/**
 * The shells a terminal can run (ADR 0015). The one you use every day comes first:
 * PowerShell 7 or Windows PowerShell on Windows, your login `$SHELL` elsewhere.
 */

export interface Shell extends TerminalShell {
  /** Arguments for a normal start. */
  args: string[];
  /** Arguments that skip your profile, for when it breaks the shell at start. */
  safeArgs: string[];
}

type Env = Record<string, string | undefined>;

export interface ShellOptions {
  env?: Env;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}

function onPath(
  env: Env,
  names: string[],
  exists: (p: string) => boolean,
  join: (...p: string[]) => string,
  sep: string,
) {
  const path = Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const dir of path.split(sep).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

function windowsShells(env: Env, exists: (p: string) => boolean): Shell[] {
  const { join } = win32;
  const system = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  const found: Shell[] = [];
  const pwsh =
    onPath(env, ['pwsh.exe'], exists, join, ';') ??
    [env.ProgramFiles, env.PROGRAMFILES, env.ProgramW6432]
      .filter((r): r is string => Boolean(r))
      .map((root) => join(root, 'PowerShell', '7', 'pwsh.exe'))
      .find((p) => exists(p));
  if (pwsh) {
    found.push({
      id: 'pwsh',
      name: 'PowerShell 7',
      path: pwsh,
      args: ['-NoLogo'],
      safeArgs: ['-NoLogo', '-NoProfile'],
    });
  }
  const powershell = join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(powershell)) {
    found.push({
      id: 'powershell',
      name: 'Windows PowerShell',
      path: powershell,
      args: ['-NoLogo'],
      safeArgs: ['-NoLogo', '-NoProfile'],
    });
  }
  const cmd = env.ComSpec ?? env.COMSPEC ?? join(system, 'System32', 'cmd.exe');
  if (exists(cmd)) {
    found.push({ id: 'cmd', name: 'Command Prompt', path: cmd, args: [], safeArgs: ['/D'] });
  }
  const bash = [env.ProgramFiles, env.PROGRAMFILES]
    .filter((r): r is string => Boolean(r))
    .map((root) => join(root, 'Git', 'bin', 'bash.exe'))
    .find((p) => exists(p));
  if (bash) {
    found.push({
      id: 'git-bash',
      name: 'Git Bash',
      path: bash,
      args: ['--login', '-i'],
      safeArgs: ['--noprofile', '--norc', '-i'],
    });
  }
  return found;
}

function posixShells(env: Env, exists: (p: string) => boolean): Shell[] {
  const { join } = posix;
  const known: Record<string, { name: string; args: string[]; safeArgs: string[] }> = {
    zsh: { name: 'zsh', args: ['-l'], safeArgs: ['-f'] },
    bash: { name: 'bash', args: ['-l'], safeArgs: ['--noprofile', '--norc'] },
    fish: { name: 'fish', args: ['-l'], safeArgs: ['--no-config'] },
    sh: { name: 'sh', args: [], safeArgs: [] },
  };
  const found: Shell[] = [];
  const add = (path: string | undefined) => {
    if (!path || !exists(path) || found.some((s) => s.path === path)) return;
    const id = basename(path);
    const info = known[id] ?? { name: id, args: [], safeArgs: [] };
    if (found.some((s) => s.id === id)) return;
    found.push({ id, name: info.name, path, args: info.args, safeArgs: info.safeArgs });
  };
  add(env.SHELL);
  for (const name of ['zsh', 'bash', 'fish']) {
    add(onPath(env, [name], exists, join, delimiter === ';' ? ':' : delimiter));
    add(join('/bin', name));
    add(join('/usr/bin', name));
  }
  add('/bin/sh');
  return found;
}

/** Every shell a terminal can run here, your usual one first. */
export function findShells(options: ShellOptions = {}): Shell[] {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  return (options.platform ?? osPlatform()) === 'win32'
    ? windowsShells(env, exists)
    : posixShells(env, exists);
}

/** The shell to run: the one asked for if it's there, else your usual one. */
export function pickShell(shells: Shell[], wanted: string | undefined): Shell | undefined {
  return (
    (wanted && wanted !== 'auto' ? shells.find((s) => s.id === wanted) : undefined) ?? shells[0]
  );
}
