/**
 * The gateway's environment (ADR 0054).
 *
 * An app opened from the Dock or a launcher doesn't get the PATH a Terminal
 * has: on a Mac it's `/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew, Claude
 * Code in `~/.local/bin` and everything else people install are invisible.
 * So the app asks the person's login shell for its PATH once, and the
 * gateway starts with that. Node's own folder goes last, so `npx` works for
 * people with no Node of their own while a Node they installed still wins.
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter as pathDelimiter, posix } from 'node:path';

import type { AppUpdates } from '@conch/protocol';

/** Folders, in order, without repeats or blanks. */
export function mergePath(lists: (string | undefined)[], delimiter = pathDelimiter): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists)
    for (const dir of (list ?? '').split(delimiter)) {
      const clean = dir.trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
    }
  return out.join(delimiter);
}

const MARK = '__CONCH_PATH__';

/** The PATH between the marks in a shell's output (profiles can print anything around it). */
export function pathFromShell(output: string): string | undefined {
  const match = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(output);
  const path = match?.[1]?.trim();
  return path || undefined;
}

/** Where people's programs usually are, for when the login shell can't be asked. */
export function usualPlaces(
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') return [];
  return [
    posix.join(home, '.local', 'bin'),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
    '/usr/local/bin',
    posix.join(home, '.cargo', 'bin'),
    posix.join(home, '.bun', 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
}

/**
 * The login shell's PATH, asked once (five seconds at most, while the window
 * opens). Windows apps already get the person's PATH from Explorer.
 */
export function loginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform === 'win32') return Promise.resolve(undefined);
  const shell = env.SHELL?.trim() || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    try {
      execFile(
        shell,
        ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`],
        { encoding: 'utf8', timeout: 5_000, env: { ...env, TERM: 'dumb' } },
        (_error, stdout) => resolve(pathFromShell(String(stdout ?? ''))),
      );
    } catch {
      resolve(undefined);
    }
  });
}

/** Variables that belong to Electron, or would change how the gateway's Node runs. */
const DROPPED = /^(ELECTRON_|NODE_OPTIONS$|NODE_PATH$|CONCH_DESKTOP_|CONCH_APP)/;

export interface GatewayEnvInput {
  env: NodeJS.ProcessEnv;
  home: string;
  /** The app's own program. */
  exe: string;
  updates: AppUpdates;
  /** Started at login: no window. */
  background: boolean;
  /** The login shell's PATH, if it answered. */
  loginPath?: string;
  /** Node's own folder (npm, npx). */
  nodeBin: string;
  platform?: NodeJS.Platform;
}

export function gatewayEnv(input: GatewayEnvInput): NodeJS.ProcessEnv {
  const platform = input.platform ?? process.platform;
  const delimiter = platform === 'win32' ? ';' : ':';
  // Windows spells it Path; one PATH, whatever its case.
  const pathKey = Object.keys(input.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const current = input.env[pathKey];
  const kept = Object.fromEntries(
    Object.entries(input.env).filter(
      ([key, value]) => value !== undefined && key !== pathKey && !DROPPED.test(key),
    ),
  );
  return {
    ...kept,
    [platform === 'win32' ? pathKey : 'PATH']: mergePath(
      [
        input.loginPath,
        current,
        platform === 'win32' ? undefined : usualPlaces(undefined, platform).join(delimiter),
        input.nodeBin,
      ],
      delimiter,
    ),
    CONCH_HOME: input.home,
    CONCH_SUPERVISED: '1',
    CONCH_OPEN: '0',
    CONCH_APP: input.exe,
    CONCH_APP_UPDATES: input.updates,
    ...(input.background && { CONCH_BACKGROUND: '1' }),
  };
}
