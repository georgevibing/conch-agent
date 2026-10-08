/**
 * A disposable Node process for reading files Conch didn't make (a PDF to
 * read or merge, a zip to unpack, a workbook to convert). The bytes go in on
 * stdin and the answer comes back on stdout: the process may read only its
 * own code and the parsers it imports (Node's permission model), never
 * writes, never spawns, has no environment, a small heap and a deadline. A
 * file built to crash or exhaust its parser takes only this process with it.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class WorkerFailed extends Error {
  constructor(
    readonly reason: 'timeout' | 'overflow' | 'crashed',
    message: string,
  ) {
    super(message);
  }
}

export interface WorkerOptions {
  /** The worker module, next to this file. */
  worker: string;
  /** Packages it imports: their folders become readable. */
  modules: readonly string[];
  input: string;
  signal: AbortSignal;
  timeoutMs?: number;
  maxOutput?: number;
  heapMb?: number;
}

/** The worker's whole stdout, or a `WorkerFailed` saying why there is none. */
export async function runWorker(options: WorkerOptions): Promise<string> {
  const { signal } = options;
  signal.throwIfAborted();
  const worker = fileURLToPath(new URL(options.worker, import.meta.url));
  const folders = options.modules.map((id) => dirname(fileURLToPath(import.meta.resolve(id))));
  // Package modules import neighbouring files; permission is read-only and restricted to dependencies.
  const store = `${sep}node_modules${sep}.pnpm`;
  const roots = folders.map((path) =>
    path.includes(`${store}${sep}`)
      ? path.slice(0, path.indexOf(`${store}${sep}`) + store.length)
      : dirname(path),
  );
  const child = spawn(
    process.execPath,
    [
      '--permission',
      ...[
        ...new Set([
          worker,
          resolve(dirname(worker), '../../node_modules'),
          resolve(dirname(worker), '../../package.json'),
          ...roots,
        ]),
      ].map((path) => `--allow-fs-read=${path}`),
      `--max-old-space-size=${options.heapMb ?? 256}`,
      worker,
    ],
    { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  const max = options.maxOutput ?? 2_000_000;
  const chunks: Buffer[] = [];
  let size = 0;
  let timeout = false;
  let overflow = false;
  const stop = () => {
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => {
    timeout = true;
    stop();
  }, options.timeoutMs ?? 30_000).unref();
  signal.addEventListener('abort', stop, { once: true });
  child.stdin.on('error', () => {});
  child.stderr.resume();
  child.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > max) {
      overflow = true;
      stop();
      return;
    }
    chunks.push(chunk);
  });
  const ended = new Promise<number | null>((done, failed) => {
    child.once('error', failed);
    child.once('close', done);
  });
  child.stdin.end(options.input);
  try {
    const code = await ended;
    signal.throwIfAborted();
    if (timeout) throw new WorkerFailed('timeout', 'It took too long.');
    if (overflow) throw new WorkerFailed('overflow', 'The result was too large.');
    if (code !== 0) throw new WorkerFailed('crashed', 'The file exceeded the reader’s limits.');
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    stop();
  }
}
