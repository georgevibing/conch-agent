import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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
export async function writeFileAtomic(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function writeJson(path: string, value: unknown): Promise<void> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
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
