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
 * is using. A folder of this process that no run of it is using was left by a
 * run that couldn't remove it; another process's stays while that process is
 * alive. `live` are the folders of runs still going here (Codex and Codex CLI
 * run side by side, and a turn can last an hour): those are never touched.
 */
export async function cleanCodexRuntime(
  root: string,
  live: ReadonlySet<string> = new Set(),
): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^run-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const dir = join(root, entry.name);
    if (live.has(dir)) continue;
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

/** A run going on now: its folder, and the sign-in it was last given or last saved. */
interface Run {
  dir: string;
  last: string | undefined;
  /** You signed out while it ran: nothing it renews is kept. */
  stale?: boolean;
}

/**
 * What every run of one Conch home shares, whichever provider started it
 * (Codex and Codex CLI use one ChatGPT sign-in): a lock held only while the
 * saved sign-in is read or written, and the runs going on now.
 */
interface Shared {
  mutex: Mutex;
  runs: Set<Run>;
}
const shared = new Map<string, Shared>();
function sharedFor(home: string): Shared {
  let entry = shared.get(home);
  if (!entry) shared.set(home, (entry = { mutex: new Mutex(), runs: new Set() }));
  return entry;
}

const authText = (dir: string) => readFile(join(dir, 'auth.json'), 'utf8').catch(() => undefined);

/**
 * Codex renews its ChatGPT sign-in as it goes, and an old one is refused once
 * it has been renewed. A renewal is saved as soon as it lands (Conch can stop
 * mid-run: a restart, a crash), and handed to every other run going on, so
 * none of them goes on with the one that was just replaced.
 */
async function keep(path: string, all: Shared, run: Run, text: string): Promise<void> {
  if (run.stale) return;
  let auth: z.infer<typeof Auth>;
  try {
    auth = Auth.parse(JSON.parse(text));
  } catch {
    return; // Still being written: the next look gets it whole.
  }
  await writeJson(path, { auth });
  run.last = text;
  for (const other of all.runs) {
    if (other === run || other.last === text) continue;
    await writeFile(join(other.dir, 'auth.json'), text, { mode: 0o600 }).catch(() => undefined);
    other.last = text;
  }
}

function keepRenewals(path: string, all: Shared, run: Run) {
  let saving = Promise.resolve();
  const look = async () => {
    const text = await authText(run.dir);
    if (text === undefined || text === run.last) return;
    await all.mutex.run(() => keep(path, all, run, text));
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

/**
 * Keep the sign-in as Codex left it, when this run changed it. A run that ends
 * without one only means "signed out" when signing out was the run: otherwise
 * (Codex tidied up, the run stopped short) the saved sign-in stays. A run that
 * ends with what it was given changed nothing, and never puts back a sign-in
 * another run has renewed since.
 */
async function saveCredentials(
  path: string,
  all: Shared,
  run: Run,
  signOut: boolean,
): Promise<void> {
  const text = await authText(run.dir);
  if (text === undefined) {
    if (signOut) {
      await writeJson(path, {});
      // A turn still going can't bring the sign-in back by renewing it.
      for (const other of all.runs) if (other !== run) other.stale = true;
    }
    return;
  }
  if (text === run.last) return;
  try {
    Auth.parse(JSON.parse(text));
  } catch {
    throw new Error('Conch could not safely save the Codex sign-in. Please reconnect.');
  }
  await keep(path, all, run, text);
}

/**
 * Isolated Codex state for one Conch home. Every run gets a folder of its own
 * (Codex's state and a copy of the sign-in), so runs go on side by side: a
 * background task never holds up the chat, or the check that says Codex is
 * ready.
 */
export class CodexHome {
  readonly #shared: Shared;
  constructor(readonly home: string) {
    this.#shared = sharedFor(home);
  }

  async withClient<T>(
    executable: string,
    run: (rpc: CodexRpc) => Promise<T>,
    options: {
      signal?: AbortSignal;
      config?: string[];
      /** The longest message this run reads from Codex (`rpc.ts`, `MAX_LINE` unless set). */
      maxLine?: number;
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
    options.signal?.throwIfAborted();
    const path = join(this.home, 'codex.secrets.json');
    if (!sealerFor(path))
      throw new Error('Conch’s protected key storage is not ready. Open Settings → Health.');
    const all = this.#shared;
    // Read the sign-in and make the folder under the lock, so a renewal saved
    // by another run is never missed in between. A cancelled turn stops here.
    const current = await all.mutex.run(async () => {
      options.signal?.throwIfAborted();
      const saved = await readStore(path, Credentials, { fallback: () => ({}) });
      const root = join(this.home, 'codex-runtime');
      await mkdir(root, { recursive: true, mode: 0o700 });
      await cleanCodexRuntime(root, new Set([...all.runs].map((r) => r.dir)));
      const dir = await mkdtemp(join(root, 'run-'));
      const entry: Run = {
        dir,
        last: saved.value.auth ? JSON.stringify(saved.value.auth) : undefined,
      };
      all.runs.add(entry);
      try {
        await writeFile(join(dir, 'owner.json'), String(process.pid), { mode: 0o600 });
        if (entry.last) await writeFile(join(dir, 'auth.json'), entry.last, { mode: 0o600 });
      } catch (error) {
        all.runs.delete(entry);
        await discard(dir);
        throw error;
      }
      return entry;
    });
    let rpc: CodexRpc | undefined;
    const stopKeeping = keepRenewals(path, all, current);
    const stop = () => {
      void rpc?.close();
    };
    try {
      await options.prepare?.(current.dir);
      options.signal?.throwIfAborted();
      rpc = new CodexRpc(executable, {
        cwd: current.dir,
        env: { ...hostEnvironment(), CODEX_HOME: current.dir },
        config: ['cli_auth_credentials_store="file"', ...(options.config ?? [])],
        ...(options.maxLine && { maxLine: options.maxLine }),
      });
      options.signal?.addEventListener('abort', stop, { once: true });
      await rpc.initialize();
      return await run(rpc);
    } finally {
      options.signal?.removeEventListener('abort', stop);
      await rpc?.close();
      await stopKeeping();
      if (rpc) await options.after?.(current.dir).catch(() => undefined);
      try {
        if (rpc)
          await all.mutex.run(() => saveCredentials(path, all, current, options.signOut === true));
      } finally {
        all.runs.delete(current);
        await discard(current.dir);
      }
    }
  }
}
