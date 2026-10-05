import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { sealerFor } from './sealed';

/**
 * `join(dir, name)` for a name that must be a plain file name. Throws on
 * anything that could escape `dir` (`..`, slashes, NUL) — the last line of
 * defence behind id validation at the edges.
 */
export function safeJoin(dir: string, name: string): string {
  if (!name || name !== basename(name) || name.startsWith('..') || /[\\/\0]/.test(name)) {
    throw new Error(`Unsafe file name: ${JSON.stringify(name)}`);
  }
  return join(dir, name);
}

/** Write a file atomically (temp file + rename) so crashes never leave half-written state. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  const file = await open(tmp, 'wx', mode);
  try {
    try {
      await file.writeFile(data);
      // Restore the requested mode exactly, including when Conch itself runs
      // with a restrictive umask. Use the descriptor, never a mutable path.
      await file.chmod(mode);
    } finally {
      await file.close();
    }
    await replace(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Errors Windows gives for a moment while another handle — a reader, a virus scan — has the file open. */
const SHARING = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** `rename` over an existing file, waiting out Windows' brief sharing refusals. */
async function replace(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (platform() !== 'win32' || !SHARING.has(code) || attempt >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(20 * 2 ** attempt, 500)));
    }
  }
}

/**
 * Remove a file or a whole folder, waiting out Windows' brief sharing refusals.
 * A program that has just exited still holds its open files for a moment there
 * (a database, a log), and removing them in that moment fails with `EBUSY`.
 * Nothing at `path` is fine.
 */
export async function removeTree(path: string): Promise<void> {
  // Node waits `retryDelay` longer before each new try: about a second in all.
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  // Conch's own key files are sealed under this computer's device key (`sealed.ts`).
  const sealer = sealerFor(path);
  if (sealer) return writeFileAtomic(path, await sealer.seal(basename(path), Buffer.from(text)));
  return writeFileAtomic(path, text);
}

/**
 * Puts a file's bytes on stable storage before anything that depends on them
 * goes ahead. Windows flushes only a handle that may write (FlushFileBuffers
 * needs write access: a read-only handle fails with EPERM), so it's opened
 * for writing there, without changing a byte.
 */
export async function syncFile(path: string): Promise<void> {
  const file = await open(path, process.platform === 'win32' ? 'r+' : 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Serialises async operations so read-modify-write cycles never interleave. */
export class Mutex {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(fn, fn);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}
