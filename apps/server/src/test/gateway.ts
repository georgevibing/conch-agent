import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../..', import.meta.url));

/** Ask until `read` gives something `matches` accepts; tests fail rather than hang. */
export async function until<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (matches(value)) return value;
    if (Date.now() > deadline) throw new Error('It did not settle in time.');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** The process is gone (a zombie on Linux counts: it can no longer run). */
export async function gone(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux')
      return /\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'));
    return false;
  } catch (error) {
    return ['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '');
  }
}

export interface StandIn {
  child: ChildProcess;
  output: () => string;
  /** End it the way a crash or the watchdog does: SIGKILL, no clean-up. */
  crash: () => Promise<void>;
}

/**
 * A gateway of its own for a test to crash: Node with Conch's TypeScript, running
 * `source` (an ES module that may import `./src/…`) from the server package.
 */
export function standInGateway(source: string): StandIn {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: SERVER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  return {
    child,
    output: () => output,
    crash: async () => {
      child.kill('SIGKILL');
      await closed;
    },
  };
}

/** Kill what a test started, whatever state it was left in. */
export function cleanUp(...pids: (number | undefined)[]): void {
  for (const pid of pids) {
    if (!pid) continue;
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        /* Already gone. */
      }
    }
  }
}
