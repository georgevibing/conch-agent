/**
 * A command that dies with its gateway (ADR 0094), on every system. The gateway
 * holds a pipe on fd 3 and never writes to it; when the gateway goes away, however
 * it goes (a crash, the watchdog's SIGKILL), the pipe ends and this runtime kills
 * its own process group, or the command's tree with taskkill on Windows, as
 * worker.mjs does when its stdin closes. Nothing is inherited beyond what the
 * gateway passed, and the command's stdin, stdout and stderr are this runtime's own.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { constants } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Signals this runtime passes on to itself when its command died of one. Only those
 * whose default is to end a program and that Node leaves alone: never one it handles.
 */
const ENDING = new Set(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGABRT', 'SIGKILL', 'SIGALRM', 'SIGTERM']);

/** Watch the gateway's pipe; `current` names the command to stop on Windows. */
export function tie(current) {
  const link = new Socket({ fd: 3, readable: true, writable: true });
  let gone = false;
  const die = () => {
    if (gone) return;
    gone = true;
    if (process.platform !== 'win32') {
      try {
        process.kill(-process.pid, 'SIGKILL');
      } catch {
        /* Not a group leader: only this runtime can go. */
      }
      process.exit(1);
    }
    const child = current();
    if (!child?.pid) process.exit(1);
    const killer = spawn(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    killer.once('exit', () => process.exit(1));
    killer.once('error', () => {
      child.kill();
      process.exit(1);
    });
  };
  link.on('end', die);
  link.on('close', die);
  link.on('error', die);
  link.resume();
  // The command keeps this runtime alive; the pipe alone must not.
  link.unref();
  return {
    /** A command that could not start: the gateway reports it as spawn would have. */
    failed: (error) => {
      gone = true;
      const report = { code: error.code, message: error.message };
      link.write(`${JSON.stringify(report)}\n`, () => process.exit(1));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { program, args, shell, env: names } = JSON.parse(process.argv[2]);
  let child;
  const link = tie(() => child);
  // Only the names the gateway chose: the system may add its own to this runtime.
  const env = {};
  for (const name of names) if (process.env[name] !== undefined) env[name] = process.env[name];
  child = spawn(program, args, { env, shell, stdio: 'inherit', windowsHide: true });
  child.once('error', (error) => link.failed(error));
  child.once('exit', (code, signal) => {
    // Ended by a signal that ends any program: so does this runtime, and the gateway
    // sees no exit code, as before.
    if (signal && ENDING.has(signal)) process.kill(process.pid, signal);
    // One Node keeps for itself (SIGUSR1 would open its debugger to anyone on this
    // computer) or ignores (SIGPIPE): the shell's 128 + its number instead.
    process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1));
  });
}
