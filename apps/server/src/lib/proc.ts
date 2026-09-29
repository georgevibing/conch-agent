/**
 * Running other people's programs, carefully.
 *
 * Every helper here takes an argument array — never a shell string — so a value
 * from a settings file or a browser can't become a command. Child environments
 * are scrubbed: Conch's own configuration (`CONCH_TOKEN` is a sign-in
 * credential) never reaches a process the agent can influence.
 */
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Variables that describe a *parent* agent session. Conch is often launched
 * from inside one, and a child that sees them believes it's nested.
 */
const SESSION_VARS = [
  /^CLAUDECODE$/,
  /^CLAUDE_CODE_ENTRYPOINT$/,
  /^CLAUDE_CODE_SESSION/,
  /^CLAUDE_CODE_CHILD_SESSION$/,
  /^CLAUDE_CODE_MESSAGING_/,
  /^CLAUDE_CODE_EXECPATH$/,
  /^CLAUDE_CODE_PATH$/,
  /^CLAUDE_PID$/,
  /^CODEX_SANDBOX/,
  /^CODEX_INTERNAL_/,
];

/** Conch's own configuration, which the agent must never be able to read. */
const CONCH_VARS = /^CONCH_/;

/** The parent environment minus Conch's secrets and any parent agent session, plus `extra`. */
export function agentEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || CONCH_VARS.test(key) || SESSION_VARS.some((re) => re.test(key)))
      continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where tools land when they aren't on the PATH a desktop app inherits. */
export function commonBinDirs(): string[] {
  const home = homedir();
  return [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

/**
 * Find a program: an explicit path if given, then the PATH, then the places
 * installers use. Returns the absolute path so we never re-resolve later.
 */
export async function findExecutable(
  name: string,
  options: { explicit?: string; extraDirs?: string[] } = {},
): Promise<string | undefined> {
  if (options.explicit)
    return (await isExecutable(options.explicit)) ? options.explicit : undefined;
  const names = platform() === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...(options.extraDirs ?? []),
    ...commonBinDirs(),
  ];
  for (const dir of dirs) {
    for (const candidate of names) {
      const path = join(dir, candidate);
      if (await isExecutable(path)) return path;
    }
  }
  return undefined;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Unset when the program was killed by a signal or never started. */
  code?: number;
}

/**
 * Run a program to completion. Never throws for a non-zero exit: callers decide
 * what a failure means, and they need `stdout` either way (several CLIs print
 * useful JSON and then exit 1).
 */
export async function run(
  file: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    /** Bytes of output to keep. Guards against a program that never stops talking. */
    maxBuffer?: number;
  } = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec(file, args, {
      env: options.env ?? agentEnv(),
      cwd: options.cwd,
      timeout: options.timeout ?? 15_000,
      signal: options.signal,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message: string;
    };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      code: typeof e.code === 'number' ? e.code : undefined,
    };
  }
}
