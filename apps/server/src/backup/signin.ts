/**
 * Who may sign in, after a restore (ADR 0020).
 *
 * A backup keeps the password hash and the access keys of the day it was
 * made. Since then a key may have been revoked (a lost phone) or the password
 * changed (it leaked). Bringing those back would undo the revocation, so:
 *
 * - **A Conch with sign-in set up keeps its own.** The password, the keys and
 *   every signed-in device stay exactly as they are; the backup's sign-in is
 *   left out.
 * - **Only a Conch without one (a new computer) takes the backup's**, so the
 *   person can sign in as before. No signed-in devices come with it (they
 *   could be ones signed out since), except the one restoring.
 * - **A key id this Conch doesn't have is never brought back**, whatever the
 *   backup: on a new computer that means no keys, so they're made again
 *   (`pnpm conch key`). A key sign-in left with no key isn't brought back.
 * - **An Undo copy** is this computer's own state from just before a restore,
 *   and goes back exactly: the sign-in a restore brought to a new computer
 *   is taken away again. Where there was sign-in before, it was kept by the
 *   restore, so it's kept by Undo too (a password changed or a key revoked
 *   since stays that way).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readJson } from '../lib/fs';

type AccessJson = Record<string, unknown>;

/** `access.json` here: absent, readable, or there but not readable (it may hold a password). */
export type CurrentAccess =
  { kind: 'none' } | { kind: 'read'; file: AccessJson } | { kind: 'unreadable' };

export async function currentAccess(home: string): Promise<CurrentAccess> {
  let text: string;
  try {
    text = await readFile(join(home, 'access.json'), 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'unreadable' };
  }
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { kind: 'read', file: raw as AccessJson }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

const methodOf = (file: AccessJson | undefined) =>
  typeof file?.method === 'string' ? file.method : 'none';

/**
 * Sign-in is set up here: a method other than none. A file that can't be
 * read counts too: it may have held a password, and never guessing is how
 * the store itself treats it (it locks).
 */
export function hasSignIn(current: CurrentAccess): boolean {
  if (current.kind === 'unreadable') return true;
  return current.kind === 'read' && methodOf(current.file) !== 'none';
}

const idsOf = (file: AccessJson | undefined) =>
  new Set(
    (Array.isArray(file?.keys) ? file.keys : []).flatMap((k: unknown) =>
      typeof k === 'object' && k !== null && typeof (k as { id?: unknown }).id === 'string'
        ? [(k as { id: string }).id]
        : [],
    ),
  );

export type SignInOutcome =
  /** `access.json` stays exactly as it is here. */
  | { kind: 'kept' }
  /** `access.json` becomes this. */
  | { kind: 'restored'; file: AccessJson };

/**
 * What `access.json` becomes when a restore brings `incoming` (the backup's,
 * credentials only). `exact`: an Undo copy. `keepSessionId`: the device
 * restoring, which stays signed in when sign-in changes.
 */
export function signInAfterRestore(
  current: CurrentAccess,
  incoming: AccessJson,
  options: { exact: boolean; keepSessionId?: string },
): SignInOutcome {
  if (hasSignIn(current)) {
    // Sign-in here stays as it is: the password and keys in use, and every
    // signed-in device. Only Undo takes away the sign-in a restore brought
    // to a Conch that had none, putting it back the way it was.
    if (!(options.exact && methodOf(incoming) === 'none')) return { kind: 'kept' };
  }
  const here = current.kind === 'read' ? current.file : undefined;
  // Never a key this Conch doesn't have: one revoked since stays revoked.
  const allowed = idsOf(here);
  const keys = (Array.isArray(incoming.keys) ? incoming.keys : []).filter(
    (k: unknown) =>
      typeof k === 'object' && k !== null && allowed.has(String((k as { id?: unknown }).id ?? '')),
  );
  // A key sign-in with no key left would let nobody in: leave sign-in be.
  if (methodOf(incoming) === 'key' && keys.length === 0) return { kind: 'kept' };
  const sessions = (Array.isArray(here?.sessions) ? here.sessions : []).filter(
    (s: unknown) =>
      options.keepSessionId !== undefined &&
      typeof s === 'object' &&
      s !== null &&
      (s as { id?: unknown }).id === options.keepSessionId,
  );
  return {
    kind: 'restored',
    file: {
      version: incoming.version ?? 1,
      method: methodOf(incoming),
      ...(typeof incoming.username === 'string' && { username: incoming.username }),
      ...(typeof incoming.passwordHash === 'string' && { passwordHash: incoming.passwordHash }),
      keys,
      sessions,
      pairings: [],
    },
  };
}

/** Read the staged `access.json` (credentials only, as `format.ts` writes it). */
export async function stagedAccess(path: string): Promise<AccessJson | undefined> {
  const raw = await readJson<unknown>(path).catch(() => undefined);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as AccessJson)
    : undefined;
}
