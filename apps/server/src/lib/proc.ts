/**
 * Running other people's programs, carefully.
 *
 * Every helper here takes an argument array — never a shell string — so a value
 * from a settings file or a browser can't become a command. Child environments
 * are scrubbed: Conch's own configuration (`CONCH_TOKEN` is a sign-in
 * credential) never reaches a process the agent can influence.
 */
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { refreshPath } from './path';

const exec = promisify(execFile);

/** A program as Node can start it without a shell: what to run, and the arguments that go first. */
export interface Launch {
  command: string;
  prefix: string[];
}

/**
 * Where a `.cmd` shim hands over its arguments: `"%dp0%\node_modules\…\cli.js" %*`
 * (npm), `"%~dp0\..\…\cli.mjs" %*` (pnpm) or `"%~dp0\..\…\cli.cmd" %*` (Yarn).
 */
const SHIM_TARGET = /"%~?dp0%?\\([^"]+)"\s+%\*/i;

/**
 * How to start `file` without a shell. On Windows, npm, pnpm and Yarn install
 * command-line tools as `.cmd` batch files, which Node won't start except
 * through `cmd.exe` — and `cmd.exe` would read the arguments (a whole prompt,
 * say) as commands of its own. So the batch file is read for the program it
 * would run, and that starts directly. Anything else starts as itself.
 */
export function launch(file: string, depth = 0): Launch {
  if (platform() !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { command: file, prefix: [] };
  const dir = dirname(file);
  const shim = readFileSync(file, 'utf8');
  const target = SHIM_TARGET.exec(shim)?.[1];
  const program = target && resolve(dir, target);
  // npm's shim for a script with no extension (`bin/grok`) runs it with node too.
  const nodeScript = program && !extname(program) && /_prog=[^\r\n]*node/i.test(shim);
  if (program && (/\.[cm]?js$/i.test(program) || nodeScript)) {
    const node = join(dir, 'node.exe');
    return { command: existsSync(node) ? node : process.execPath, prefix: [program] };
  }
  if (program && /\.exe$/i.test(program)) return { command: program, prefix: [] };
  if (program && /\.cmd$/i.test(program) && depth < 3) return launch(program, depth + 1);
  throw new Error(
    `${basename(file)} is a batch file Conch can’t start safely. Point Conch at the program it runs instead.`,
  );
}

/**
 * The file to hand a library that starts the program itself: the script behind
 * a Windows shim (the Agent SDK runs a `.js` with Node), or the file as given.
 */
export function programFile(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const { command, prefix } = launch(file);
  return prefix[0] ?? command;
}

/**
 * Whether there's a file at `path`, including Windows app execution aliases:
 * the `WindowsApps\name.exe` links that Store and MSIX apps (1Password,
 * winget, Python) put on `PATH`. Following one lands in a folder only
 * Windows may open, so `existsSync` says no; the link itself is there, and
 * starting it works.
 */
export function presentSync(path: string): boolean {
  if (existsSync(path)) return true;
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Whether Windows would find `command` the way `cmd.exe` does: as a path, or in
 * the working folder or on `PATH`, with one of `PATHEXT`'s extensions.
 */
export function onWindowsPath(
  command: string,
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): boolean {
  // Windows variable names ignore case (`Path` is common).
  const variable = (name: string) =>
    Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1] ?? process.env[name];
  const extensions = (variable('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const names = [...(extname(command) ? [command] : []), ...extensions.map((ext) => command + ext)];
  const dirs = /[\\/]/.test(command)
    ? [cwd]
    : [cwd, ...(variable('PATH') ?? '').split(delimiter).filter(Boolean)];
  return dirs.some((dir) => names.some((name) => presentSync(resolve(dir, name))));
}

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
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const windows =
    platform() === 'win32'
      ? [
          join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm'),
          join(local, 'pnpm'),
          // Where winget links the programs it installs.
          join(local, 'Microsoft', 'WinGet', 'Links'),
          join(process.env.ProgramFiles ?? join('C:', 'Program Files'), 'nodejs'),
        ]
      : [];
  return [
    ...windows,
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
  // Something installed since Conch started is on the registry's PATH, not ours yet.
  await refreshPath();
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
    /**
     * Written to the program's stdin, which is then closed. Secrets go this way,
     * never as arguments: any user on the computer can read arguments in `ps`.
     */
    input?: string;
  } = {},
): Promise<RunResult> {
  try {
    const { command, prefix } = launch(file);
    const running = exec(command, [...prefix, ...args], {
      env: options.env ?? agentEnv(),
      cwd: options.cwd,
      timeout: options.timeout ?? 15_000,
      signal: options.signal,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
      windowsHide: true,
    });
    const stdin = running.child.stdin;
    if (stdin && options.input !== undefined) {
      stdin.on('error', () => undefined);
      stdin.end(options.input);
    }
    const { stdout, stderr } = await running;
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message: string;
    };
    // A program that never started (`ENOENT`, `EACCES`) printed nothing; its error says why.
    const neverRan = e.stderr === undefined || typeof e.code === 'string';
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr || (neverRan ? e.message : ''),
      code: typeof e.code === 'number' ? e.code : undefined,
    };
  }
}
