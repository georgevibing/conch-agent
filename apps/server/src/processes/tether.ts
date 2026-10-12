/**
 * Commands that die with this gateway (ADR 0094): the gateway's half of link.mjs.
 *
 * A command runs in its own process group so it can be stopped as a whole, which
 * also puts it out of reach of the supervisor's group kill, and only Linux can find
 * it again through /proc. So each one is started by a Node runtime holding a pipe
 * from this gateway: when the gateway goes away, the runtime ends the command's tree.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LINK = fileURLToPath(new URL('./link.mjs', import.meta.url));

/**
 * For a runtime of its own that imports this and calls `tie(() => child)`. A URL, not
 * a path: run as a script, link.mjs would start a command of its own.
 */
export const LINK_MODULE = pathToFileURL(LINK).href;

export interface LinkedOptions {
  cwd?: string;
  env: Record<string, string>;
  stdin: 'pipe' | 'ignore';
}

/**
 * Node with `args`, in its own process group, holding this gateway's pipe on fd 3.
 * A command the runtime could not start is this child's `error`, as with spawn.
 * SIGUSR1 can't open its debugger: the command, or anyone on this computer, could
 * otherwise reach it on 127.0.0.1:9229 with no password and run code as you.
 */
export function spawnLinked(args: string[], options: LinkedOptions): ChildProcess {
  const child = spawn(process.execPath, ['--disable-sigusr1', ...args], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: [options.stdin, 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const link = child.stdio[3] as Readable | null;
  let reply = '';
  link?.on('error', () => undefined);
  link?.on('data', (chunk: Buffer) => {
    reply = (reply + chunk.toString('utf8')).slice(0, 4096);
  });
  link?.on('end', () => {
    if (!reply) return;
    try {
      const { code, message } = JSON.parse(reply) as { code?: string; message?: string };
      child.emit(
        'error',
        Object.assign(new Error(message ?? 'The command could not start.'), { code }),
      );
    } catch {
      /* Not a report: the exit code says what happened. */
    }
  });
  return child;
}

/** `program` with `args` (through `shell` when given), as spawn would run it, tied to this gateway. */
export function spawnTethered(
  program: string,
  args: string[],
  options: LinkedOptions & { shell?: string | boolean },
): ChildProcess {
  const plan = { program, args, shell: options.shell ?? false, env: Object.keys(options.env) };
  return spawnLinked([LINK, JSON.stringify(plan)], options);
}

/** Stop a linked runtime with everything it started. */
export function stopTree(child: ChildProcess): void {
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else if (child.pid && child.exitCode === null && child.signalCode === null) {
      const killer = spawn(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.once('error', () => child.kill('SIGKILL'));
    } else child.kill('SIGKILL');
  } catch {
    /* Already gone. */
  }
}
