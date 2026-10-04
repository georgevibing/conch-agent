/** Isolated Codex state. Only the active child sees a plaintext credential file. */
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { Mutex, removeTree, writeJson } from '../../lib/fs';
import { readStore } from '../../lib/recover';
import { sealerFor } from '../../lib/sealed';
import { hostEnvironment } from '../host';
import { CodexRpc } from './rpc';

const Auth = z.record(z.string(), z.unknown());
const Credentials = z.object({ auth: Auth.optional() });

/** How often a run's sign-in is looked at, so a renewed one is kept straight away. */
const RENEWAL_CHECK_MS = 500;

/**
 * Take a run folder away: the credential first, so it never waits in the clear,
 * then the rest. Codex keeps databases open in there, and Windows holds a
 * program's files for a moment after it has exited. A folder that's still held
 * after waiting is left for the next run to sweep. It's never a reason to fail
 * the run that used it: by now its answer is in hand and its sign-in is saved.
 */
async function discard(dir: string): Promise<void> {
  await removeTree(join(dir, 'auth.json')).catch(() => undefined);
  await removeTree(dir).catch(() => undefined);
}

/**
 * A crash leaves no reusable plaintext cache: remove every run folder nothing
 * is using. Runs take turns (the mutex), so a folder of this process found here
 * was left by a run that couldn't remove it; another process's stays while that
 * process is alive.
 */
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
      if (owner !== process.pid)
        try {
          process.kill(owner, 0);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
    } else {
      const made = await stat(dir).catch(() => undefined);
      if (made && Date.now() - made.mtimeMs < 60_000) continue;
    }
    await discard(dir);
  }
}

/**
 * Keep the sign-in as Codex left it. A run that ends without one only means
 * "signed out" when signing out was the run: otherwise (Codex tidied up, the
 * run stopped short) the saved sign-in stays.
 */
async function saveCredentials(path: string, dir: string, signOut: boolean): Promise<void> {
  try {
    const auth = Auth.parse(JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8')));
    await writeJson(path, { auth });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Conch could not safely save the Codex sign-in. Please reconnect.');
    if (signOut) await writeJson(path, {});
  }
}

/**
 * Codex renews its ChatGPT sign-in as it goes, and an old one is refused once
 * it has been renewed. Save each new one as soon as it lands: Conch can stop
 * mid-run (a restart, a crash), and the renewal would go with the run folder.
 */
function keepRenewals(path: string, dir: string, written: string | undefined) {
  let last = written;
  let saving = Promise.resolve();
  const look = async () => {
    const text = await readFile(join(dir, 'auth.json'), 'utf8').catch(() => undefined);
    if (text === undefined || text === last) return;
    let auth: z.infer<typeof Auth>;
    try {
      auth = Auth.parse(JSON.parse(text));
    } catch {
      return; // Still being written: the next look gets it whole.
    }
    await writeJson(path, { auth });
    last = text;
  };
  const timer = setInterval(() => {
    saving = saving.then(look).catch(() => undefined);
  }, RENEWAL_CHECK_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await saving;
  };
}

export class CodexHome {
  #mutex = new Mutex();
  constructor(readonly home: string) {}

  /** Serialize refresh ownership. A waiting cancelled turn never starts a child. */
  async withClient<T>(
    executable: string,
    run: (rpc: CodexRpc) => Promise<T>,
    options: {
      signal?: AbortSignal;
      config?: string[];
      /** This run signs out: a sign-in that's gone afterwards is forgotten. */
      signOut?: boolean;
      /** Before Codex starts, with the run's home (put a kept thread back: `threads.ts`). */
      prepare?: (home: string) => Promise<void>;
      /**
       * After Codex has stopped, before the run's home goes (keep the thread it
       * wrote). A failure here is never the run's: its answer is in hand.
       */
      after?: (home: string) => Promise<void>;
    } = {},
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
      let stopKeeping: (() => Promise<void>) | undefined;
      const stop = () => {
        void rpc?.close();
      };
      try {
        await writeFile(join(dir, 'owner.json'), String(process.pid), { mode: 0o600 });
        const written = saved.value.auth ? JSON.stringify(saved.value.auth) : undefined;
        if (written) await writeFile(join(dir, 'auth.json'), written, { mode: 0o600 });
        stopKeeping = keepRenewals(path, dir, written);
        await options.prepare?.(dir);
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
        await stopKeeping?.();
        if (rpc) await options.after?.(dir).catch(() => undefined);
        try {
          if (rpc) await saveCredentials(path, dir, options.signOut === true);
        } finally {
          await discard(dir);
        }
      }
    });
  }
}
