/**
 * The `conch` command: type `conch devices` anywhere, instead of `cd`-ing to
 * Conch's folder and typing `pnpm conch devices`.
 *
 * - **macOS and Linux:** a small `sh` script, `~/.local/bin/conch`. It runs
 *   the CLI with the Node Conch runs on, from the release Conch is running
 *   now (`~/.conch/versions/current`, ADR 0051) or else the folder it was
 *   installed to, so an update never leaves it pointing at an old copy.
 *   When `~/.local/bin` isn't on `PATH`, one marked line in your shell's
 *   profile puts it there (and comes out again with `removeShim`).
 * - **Windows:** `%LOCALAPPDATA%\Conch\bin\conch.cmd`, and that folder on
 *   your own `PATH` (the user's, never the system's).
 *
 * `cliName()` is what Conch tells people to type: `conch` once the command
 * is there, `pnpm conch` in a checkout without it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

import { run, type RunResult } from '../lib/proc';

/** Marks a file (or a profile line) as Conch's own, so it's only ever changed by Conch. */
export const SHIM_MARK = 'conch-shim v1';
const PROFILE_MARK = '# added by Conch: the conch command';

type Env = Record<string, string | undefined>;
export type Exec = (file: string, args: string[], env?: Env) => Promise<RunResult>;

export interface ShimOptions {
  /** Where Conch's code is (the checkout or the installed folder). */
  installDir: string;
  /** `CONCH_HOME`, where `versions/current` lives. */
  conchHome: string;
  /** The Node to run with (default: the one running now). */
  node?: string;
  home?: string;
  platform?: NodeJS.Platform;
  env?: Env;
  exec?: Exec;
}

/** Where the command goes on this computer. */
export function shimPlace(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: Env = process.env,
): { dir: string; file: string } {
  if (platform === 'win32') {
    const dir = join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Conch', 'bin');
    return { dir, file: join(dir, 'conch.cmd') };
  }
  const dir = join(home, '.local', 'bin');
  return { dir, file: join(dir, 'conch') };
}

/** `'it'\''s'`: single quotes keep everything literal in sh. */
const sh = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** The command's own text. */
export function shimScript(options: {
  installDir: string;
  conchHome: string;
  node: string;
  platform: NodeJS.Platform;
}): string {
  if (options.platform === 'win32') {
    return [
      '@echo off',
      `rem ${SHIM_MARK}: runs Conch's command line. Made by Conch; conch command off takes it away.`,
      'setlocal',
      `set "DIR=${options.installDir}"`,
      `if not defined CONCH_HOME set "CONCH_HOME=${options.conchHome}"`,
      'if exist "%CONCH_HOME%\\versions\\current" (',
      '  set /p CURRENT=<"%CONCH_HOME%\\versions\\current"',
      ')',
      'if defined CURRENT if exist "%CURRENT%\\apps\\server\\src\\cli.ts" set "DIR=%CURRENT%"',
      `set "NODE=${options.node}"`,
      'if not exist "%NODE%" set "NODE=node"',
      'if not defined INIT_CWD set "INIT_CWD=%CD%"',
      'set "LOADER=file:///%DIR:\\=/%/apps/server/node_modules/tsx/dist/loader.mjs"',
      '"%NODE%" --import "%LOADER%" "%DIR%\\apps\\server\\src\\cli.ts" %*',
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    `# ${SHIM_MARK}: runs Conch's command line. Made by Conch; \`conch command off\` takes it away.`,
    `DIR=${sh(options.installDir)}`,
    `CONCH_HOME=\${CONCH_HOME:-${sh(options.conchHome)}}`,
    'export CONCH_HOME',
    '# An update swaps in a new release: run the one Conch runs.',
    'if [ -f "$CONCH_HOME/versions/current" ]; then',
    '  CURRENT=$(head -n 1 "$CONCH_HOME/versions/current")',
    '  [ -f "$CURRENT/apps/server/src/cli.ts" ] && DIR=$CURRENT',
    'fi',
    `NODE=${sh(options.node)}`,
    '[ -x "$NODE" ] || NODE=$(command -v node) || { echo "Conch needs Node.js; run its installer again." >&2; exit 1; }',
    'INIT_CWD=${INIT_CWD:-$PWD}',
    'export INIT_CWD',
    'exec "$NODE" --import "$DIR/apps/server/node_modules/tsx/dist/loader.mjs" "$DIR/apps/server/src/cli.ts" "$@"',
    '',
  ].join('\n');
}

const samePath = (a: string, b: string, platform: NodeJS.Platform) =>
  platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

/** `dir` is one of the folders on `PATH`. */
export function onPath(
  dir: string,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const path = env.PATH ?? env.Path ?? '';
  const sep = platform === 'win32' ? ';' : platform === process.platform ? delimiter : ':';
  return path
    .split(sep)
    .filter(Boolean)
    .some((entry) => samePath(entry, dir, platform));
}

/** The shell profile that puts `~/.local/bin` on `PATH`, and the line that does it. */
export function profileFor(
  shell: string | undefined,
  platform: NodeJS.Platform,
  home: string,
): { file: string; line: string } {
  const name = basename(shell ?? '');
  if (name === 'fish')
    return {
      file: join(home, '.config', 'fish', 'conf.d', 'conch.fish'),
      line: `contains $HOME/.local/bin $PATH; or set -gx PATH $HOME/.local/bin $PATH ${PROFILE_MARK}`,
    };
  const line = `export PATH="$HOME/.local/bin:$PATH" ${PROFILE_MARK}`;
  if (name === 'zsh') return { file: join(home, '.zshrc'), line };
  if (name === 'bash')
    return { file: join(home, platform === 'darwin' ? '.bash_profile' : '.bashrc'), line };
  return { file: join(home, '.profile'), line };
}

export interface ShimResult {
  file: string;
  /** The folder was on `PATH` already: `conch` works in this terminal now. */
  ready: boolean;
  /** The profile Conch added its line to, when it had to. */
  profile?: string;
}

async function writeShim(file: string, text: string, platform: NodeJS.Platform) {
  await mkdir(dirname(file), { recursive: true });
  // Never replace someone else's `conch`: only a file Conch made (or none).
  if (existsSync(file) && !(await readFile(file, 'utf8')).includes(SHIM_MARK))
    throw new Error(
      `There's already a program called conch at ${file}, and it isn't Conch's. Conch left it alone; use pnpm conch instead.`,
    );
  await writeFile(file, text, 'utf8');
  if (platform !== 'win32') await chmod(file, 0o755);
}

const windowsPathScript = (add: boolean) =>
  add
    ? "$d=$env:CONCH_BIN; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; if (-not (($p -split ';') -contains $d)) { [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $d).TrimStart(';')), 'User') }"
    : "$d=$env:CONCH_BIN; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p) { [Environment]::SetEnvironmentVariable('Path', ((($p -split ';') | Where-Object { $_ -and $_ -ne $d }) -join ';'), 'User') }";

const defaultExec: Exec = (file, args, env) => {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env }))
    if (v !== undefined) merged[k] = v;
  return run(file, args, { timeout: 20_000, env: merged });
};

/** Put the `conch` command where the shell finds it. Safe to run again. */
export async function installShim(options: ShimOptions): Promise<ShimResult> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const { dir, file } = shimPlace(platform, home, env);
  await writeShim(
    file,
    shimScript({
      installDir: resolve(options.installDir),
      conchHome: resolve(options.conchHome),
      node: options.node ?? process.execPath,
      platform,
    }),
    platform,
  );
  if (onPath(dir, env, platform)) return { file, ready: true };
  if (platform === 'win32') {
    const result = await (options.exec ?? defaultExec)(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', windowsPathScript(true)],
      { CONCH_BIN: dir },
    );
    if (result.code !== 0)
      throw new Error(
        `Windows didn’t add ${dir} to your PATH: ${result.stderr.trim() || 'no reason given'}`,
      );
    return { file, ready: false };
  }
  const profile = profileFor(env.SHELL, platform, home);
  const existing = existsSync(profile.file) ? await readFile(profile.file, 'utf8') : '';
  if (!existing.includes(PROFILE_MARK)) {
    await mkdir(dirname(profile.file), { recursive: true });
    const gap = existing && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(profile.file, `${existing}${gap}${profile.line}\n`, 'utf8');
  }
  return { file, ready: false, profile: profile.file };
}

/** Take the command away again, and Conch's line from every profile it might be in. */
export async function removeShim(
  options: Omit<ShimOptions, 'installDir' | 'conchHome' | 'node'>,
): Promise<{ removed: boolean }> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const { dir, file } = shimPlace(platform, home, env);
  let removed = false;
  if (existsSync(file) && (await readFile(file, 'utf8')).includes(SHIM_MARK)) {
    await rm(file, { force: true });
    removed = true;
  }
  if (platform === 'win32') {
    await (options.exec ?? defaultExec)(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', windowsPathScript(false)],
      { CONCH_BIN: dir },
    ).catch(() => undefined);
    return { removed };
  }
  for (const shell of ['zsh', 'bash', 'fish', 'sh']) {
    const { file: profile } = profileFor(shell, platform, home);
    if (!existsSync(profile)) continue;
    const text = await readFile(profile, 'utf8');
    if (!text.includes(PROFILE_MARK)) continue;
    const kept = text
      .split('\n')
      .filter((line) => !line.includes(PROFILE_MARK))
      .join('\n');
    if (shell === 'fish' && !kept.trim()) await rm(profile, { force: true });
    else await writeFile(profile, kept, 'utf8');
  }
  return { removed };
}

let named: string | undefined;

/**
 * What to tell people to type: `conch` when Conch's own command is on
 * `PATH`, `pnpm conch` otherwise. Worked out once per run.
 */
export function cliName(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  fresh = false,
): 'conch' | 'pnpm conch' {
  if (named && !fresh) return named as 'conch' | 'pnpm conch';
  const file = platform === 'win32' ? 'conch.cmd' : 'conch';
  const sep = platform === 'win32' ? ';' : ':';
  const ours = (path: string) => {
    try {
      return readFileSync(path, 'utf8').includes(SHIM_MARK);
    } catch {
      return false;
    }
  };
  // On PATH here, or where Conch put it: a background Conch's PATH may not have the
  // folder yet, but new terminals do (the profile line), and that's where people type.
  const found =
    (env.PATH ?? env.Path ?? '')
      .split(sep)
      .filter(Boolean)
      .some((dir) => ours(join(dir, file))) ||
    ours(shimPlace(platform, env.HOME ?? env.USERPROFILE ?? homedir(), env).file);
  named = found ? 'conch' : 'pnpm conch';
  return named as 'conch' | 'pnpm conch';
}
