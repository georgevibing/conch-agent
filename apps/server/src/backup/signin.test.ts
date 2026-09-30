import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { currentAccess, hasSignIn, signInAfterRestore, type CurrentAccess } from './signin';

const key = (id: string) => ({ id, name: id, hash: `h-${id}`, hint: 'abcd', createdAt: 1 });
const session = (id: string) => ({ id, hash: `s-${id}`, via: 'password' });

/** What an old backup holds: yesterday's password, and a key revoked since. */
const OLD = {
  version: 1,
  method: 'password',
  username: 'ada',
  passwordHash: 'scrypt$old',
  keys: [key('key_revoked'), key('key_kept')],
};

const here = (file: Record<string, unknown>): CurrentAccess => ({ kind: 'read', file });

describe('who may sign in after a restore', () => {
  it('keeps this Conch’s own sign-in when it has one: an old backup brings back nothing revoked', () => {
    const current = here({
      version: 1,
      method: 'password',
      username: 'ada',
      passwordHash: 'scrypt$new',
      keys: [key('key_kept')],
      sessions: [session('s_phone'), session('s_laptop')],
    });
    expect(signInAfterRestore(current, OLD, { exact: false, keepSessionId: 's_laptop' })).toEqual({
      kind: 'kept',
    });
    // Key sign-in too.
    const keys = here({ method: 'key', keys: [key('key_kept')], sessions: [] });
    expect(signInAfterRestore(keys, { ...OLD, method: 'key' }, { exact: false })).toEqual({
      kind: 'kept',
    });
  });

  it('never trusts a sign-in file it can’t read: it may have held a password', () => {
    expect(hasSignIn({ kind: 'unreadable' })).toBe(true);
    expect(signInAfterRestore({ kind: 'unreadable' }, OLD, { exact: false })).toEqual({
      kind: 'kept',
    });
    expect(signInAfterRestore({ kind: 'unreadable' }, OLD, { exact: true })).toEqual({
      kind: 'kept',
    });
  });

  it('gives a new computer the backup’s password, but no key it doesn’t know', () => {
    for (const current of [{ kind: 'none' } as const, here({ method: 'none', keys: [] })]) {
      const outcome = signInAfterRestore(current, OLD, { exact: false });
      expect(outcome).toEqual({
        kind: 'restored',
        file: {
          version: 1,
          method: 'password',
          username: 'ada',
          passwordHash: 'scrypt$old',
          keys: [],
          sessions: [],
          pairings: [],
        },
      });
    }
  });

  it('leaves a new computer as it is rather than bring a key sign-in with no key', () => {
    const outcome = signInAfterRestore(
      { kind: 'none' },
      { version: 1, method: 'key', keys: [key('key_old')] },
      { exact: false },
    );
    expect(outcome).toEqual({ kind: 'kept' });
  });

  it('keeps only the device restoring signed in when sign-in changes', () => {
    const current = here({
      method: 'none',
      keys: [],
      sessions: [session('s_this'), session('s_other')],
    });
    const outcome = signInAfterRestore(current, OLD, { exact: false, keepSessionId: 's_this' });
    expect(outcome.kind === 'restored' && outcome.file.sessions).toEqual([session('s_this')]);
  });

  it('undoes exactly: a restore that brought sign-in to a new computer is taken back', () => {
    // After restoring onto a new computer, sign-in is the backup's; the Undo copy had none.
    const now = here({ method: 'password', passwordHash: 'scrypt$old', keys: [], sessions: [] });
    const undo = { version: 1, method: 'none', keys: [] };
    expect(signInAfterRestore(now, undo, { exact: true })).toEqual({
      kind: 'restored',
      file: { version: 1, method: 'none', keys: [], sessions: [], pairings: [] },
    });
  });

  it('undoes exactly where sign-in was kept: it stays as it is now', () => {
    const now = here({ method: 'password', passwordHash: 'scrypt$changed-since', keys: [] });
    expect(signInAfterRestore(now, OLD, { exact: true })).toEqual({ kind: 'kept' });
  });

  it('reads what’s here: none, a file, or one that won’t read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-signin-'));
    expect(await currentAccess(home)).toEqual({ kind: 'none' });
    await writeFile(join(home, 'access.json'), '{"method":"password"');
    expect(await currentAccess(home)).toEqual({ kind: 'unreadable' });
    await writeFile(join(home, 'access.json'), '{"method":"none"}');
    expect(await currentAccess(home)).toEqual({ kind: 'read', file: { method: 'none' } });
    expect(hasSignIn(await currentAccess(home))).toBe(false);
  });
});
