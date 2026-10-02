/**
 * Where each version of Conch lives, and which one runs (ADR 0048).
 *
 * A release is made ready in its own folder, `CONCH_HOME/versions/<version>`
 * (a git worktree of Conch's own checkout, at the release's commit), while
 * the version running keeps serving. Swapping is one small file:
 * `versions/current` holds the folder to run. Everything that starts Conch
 * reads it — the supervisor each time it starts the gateway, the login
 * launcher on every platform (a pointer file needs no symlink, so Windows
 * needs no special rights) — and falls back to Conch's checkout when it's
 * missing or names a folder that isn't a Conch.
 *
 * `versions/state.json` says what's current, what came before (kept for
 * going back at once), a swap that hasn't proved itself yet, and the
 * versions that didn't start here. The supervisor reads and writes it with
 * plain synchronous file calls: it must never need the gateway's code.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const versionsDir = (home: string) => join(home, 'versions');
export const pointerFile = (home: string) => join(versionsDir(home), 'current');
export const stateFile = (home: string) => join(versionsDir(home), 'state.json');
/** The folder for one version: `0.3.0`, `0.4.0-beta.2`. */
export const versionFolder = (home: string, version: string) => join(versionsDir(home), version);

/** How long a new version has to answer after it starts before it's called broken. */
export const PROVE_WITHIN_MS = 90_000;

export interface SwapState {
  /** The folder running now, and its version. */
  current?: { folder: string; version: string };
  /** The one before, kept to go back to at once. */
  previous?: { folder: string; version: string };
  /** Swapped in, not yet seen answering. */
  pending?: {
    folder: string;
    version: string;
    since: number;
    from: { folder: string; version: string };
  };
  /** Versions that didn't start here: never offered again. */
  failed: string[];
  /** The supervisor went back by itself; the gateway says so once. */
  wentBack?: { version: string; to: string; at: number };
}

/** A folder Conch can run from: it has the gateway's start file. */
export function runnable(folder: string | undefined): folder is string {
  return Boolean(folder && existsSync(join(folder, 'apps', 'server', 'src', 'start.ts')));
}

export function readState(home: string): SwapState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(home), 'utf8')) as Partial<SwapState>;
    const place = (v: unknown) => {
      const p = v as { folder?: unknown; version?: unknown } | undefined;
      return typeof p?.folder === 'string' && typeof p.version === 'string'
        ? { folder: p.folder, version: p.version }
        : undefined;
    };
    const pending = raw.pending as SwapState['pending'] | undefined;
    const from = place(pending?.from);
    return {
      ...(place(raw.current) && { current: place(raw.current) }),
      ...(place(raw.previous) && { previous: place(raw.previous) }),
      ...(pending && place(pending) && from && typeof pending.since === 'number'
        ? { pending: { ...place(pending)!, since: pending.since, from } }
        : {}),
      failed: Array.isArray(raw.failed)
        ? raw.failed.filter((v): v is string => typeof v === 'string').slice(-50)
        : [],
      ...(raw.wentBack &&
        typeof raw.wentBack.version === 'string' &&
        typeof raw.wentBack.to === 'string' && { wentBack: raw.wentBack }),
    };
  } catch {
    return { failed: [] };
  }
}

/** Write a file so a reader sees the old one or the new one, never half of either. */
function atomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, path);
}

export function writeState(home: string, state: SwapState): void {
  mkdirSync(versionsDir(home), { recursive: true, mode: 0o700 });
  atomic(stateFile(home), `${JSON.stringify(state, null, 2)}\n`);
}

/** Point everything that starts Conch at `folder`. */
export function point(home: string, folder: string): void {
  mkdirSync(versionsDir(home), { recursive: true, mode: 0o700 });
  atomic(pointerFile(home), `${resolve(folder)}\n`);
}

/** The folder to run, when one has been swapped in and it's still a Conch. */
export function currentFolder(home: string): string | undefined {
  try {
    const folder = readFileSync(pointerFile(home), 'utf8').trim();
    return runnable(folder) ? folder : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Swap `folder` in: the pointer moves, and the swap waits to be proved by
 * the new version answering. Until then the supervisor can go back.
 */
export function swapIn(
  home: string,
  next: { folder: string; version: string },
  from: { folder: string; version: string },
  now = Date.now(),
): void {
  const state = readState(home);
  writeState(home, { ...state, pending: { ...next, since: now, from } });
  point(home, next.folder);
}

/** The new version answered: it's current, and the one before is kept. */
export function prove(home: string, folder: string): SwapState | undefined {
  const state = readState(home);
  const pending = state.pending;
  if (!pending || resolve(pending.folder) !== resolve(folder)) return undefined;
  const next: SwapState = {
    ...state,
    current: { folder: pending.folder, version: pending.version },
    previous: pending.from,
  };
  delete next.pending;
  writeState(home, next);
  return next;
}

/**
 * The new version didn't start: back to the one before, at once, and the
 * one that failed isn't offered again. Returns what to say.
 */
export function goBack(
  home: string,
  now = Date.now(),
): { version: string; to: string } | undefined {
  const state = readState(home);
  const pending = state.pending;
  if (!pending) return undefined;
  point(home, pending.from.folder);
  const next: SwapState = {
    ...state,
    current: pending.from,
    failed: [...new Set([...state.failed, pending.version])],
    wentBack: { version: pending.version, to: pending.from.version, at: now },
  };
  delete next.pending;
  writeState(home, next);
  return { version: pending.version, to: pending.from.version };
}
