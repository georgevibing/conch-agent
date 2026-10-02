/** Isolated Codex state. Only the active child sees a plaintext credential file. */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { Mutex, writeJson } from '../../lib/fs';
import { readStore } from '../../lib/recover';
import { sealerFor } from '../../lib/sealed';
import { hostEnvironment } from '../host';
import { CodexRpc } from './rpc';

const Credentials = z.object({ auth: z.record(z.string(), z.unknown()).optional() });

/** A crash leaves no reusable plaintext cache: remove only dead owners' copies. */
export async function cleanCodexRuntime(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^run-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const dir = join(root, entry.name);
    let owner: unknown;
    try {
      owner = JSON.parse(await readFile(join(dir, 'owner.json'), 'utf8'));
    } catch {
      /* Creation may have been interrupted. */
    }
    if (typeof owner === 'number' && Number.isSafeInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
      }
    } else if (Date.now() - (await stat(dir)).mtimeMs < 60_000) continue;
    await rm(dir, { recursive: true, force: true });
  }
}

async function saveCredentials(path: string, dir: string): Promise<void> {
  try {
    const auth = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8')));
    await writeJson(path, { auth });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') await writeJson(path, {});
    else throw new Error('Conch could not safely save the Codex sign-in. Please reconnect.');
  }
}

export class CodexHome {
  #mutex = new Mutex();
  constructor(readonly home: string) {}

  /** Serialize refresh ownership. A waiting cancelled turn never starts a child. */
  async withClient<T>(
    executable: string,
    run: (rpc: CodexRpc) => Promise<T>,
    options: { signal?: AbortSignal; config?: string[] } = {},
  ): Promise<T> {
    return this.#mutex.run(async () => {
      options.signal?.throwIfAborted();
      const path = join(this.home, 'codex.secrets.json');
      if (!sealerFor(path))
        throw new Error('Conch’s protected key storage is not ready. Open Settings → Health.');
      const saved = await readStore(path, Credentials, { fallback: () => ({}) });
      const root = join(this.home, 'codex-runtime');
      await mkdir(root, { recursive: true, mode: 0o700 });
      await cleanCodexRuntime(root);
      const dir = await mkdtemp(join(root, 'run-'));
      let rpc: CodexRpc | undefined;
      const stop = () => {
        void rpc?.close();
      };
      try {
        await writeFile(join(dir, 'owner.json'), String(process.pid), { mode: 0o600 });
        if (saved.value.auth)
          await writeFile(join(dir, 'auth.json'), JSON.stringify(saved.value.auth), {
            mode: 0o600,
          });
        options.signal?.throwIfAborted();
        rpc = new CodexRpc(executable, {
          cwd: dir,
          env: { ...hostEnvironment(), CODEX_HOME: dir },
          config: ['cli_auth_credentials_store="file"', ...(options.config ?? [])],
        });
        options.signal?.addEventListener('abort', stop, { once: true });
        await rpc.initialize();
        return await run(rpc);
      } finally {
        options.signal?.removeEventListener('abort', stop);
        await rpc?.close();
        try {
          if (rpc) await saveCredentials(path, dir);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    });
  }
}
