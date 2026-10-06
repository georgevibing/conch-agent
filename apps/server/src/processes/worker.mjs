/** The command dies with its stdin pipe if the gateway crashes. No inherited credentials. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setPriority } from 'node:os';

// Inherited by the shell and its descendants: keep the gateway ahead of builds.
// This is a scheduling preference, not a CPU or memory hard limit.
try {
  setPriority(0, 10);
} catch {
  /* Unsupported hosts retain their normal priority. */
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let child;
let manager;
let configured = false;
let ending = false;
let pending = [];
const kill = () => {
  if (ending) return;
  ending = true;
  if (process.platform !== 'win32') {
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch {
      process.exit(1);
    }
  } else if (child?.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('exit', () => process.exit(1));
    killer.once('error', () => {
      child.kill();
      process.exit(1);
    });
  } else process.exit(1);
};
lines.on('close', kill);
process.on('SIGTERM', kill);
lines.on('line', async (line) => {
  try {
    if (line.length > 100_000) throw new Error('Input is too long.');
    const message = JSON.parse(line);
    if (configured) {
      if (message.stop) return kill();
      const text = typeof message.data === 'string' ? message.data : '';
      if (child) child.stdin.write(text);
      else {
        if (pending.length > 8) throw new Error('Too much pending input.');
        pending.push(text);
      }
      return;
    }
    configured = true;
    let command = message.command;
    if (message.sandbox) {
      const { SandboxManager } = await import(message.module);
      manager = SandboxManager;
      await manager.initialize(message.sandbox);
      command = await manager.wrapWithSandbox(command);
    }
    if (ending) return;
    child = spawn(command, {
      cwd: message.cwd,
      env: process.env,
      shell: process.platform === 'win32' ? true : '/bin/sh',
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.stdin.on('error', () => {});
    for (const text of pending) child.stdin.write(text);
    pending = [];
    child.once('error', () => {
      process.stderr.write('The command could not start.\n');
      kill();
    });
    child.once('close', async (code) => {
      ending = true;
      lines.close();
      await manager?.reset();
      process.exitCode = code ?? 1;
      process.stdin.destroy();
    });
  } catch {
    process.stderr.write('The command could not start or its input was invalid.\n');
    kill();
  }
});
