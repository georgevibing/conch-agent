/**
 * Access keys sit beside every way of signing in (ADR 0153): making one never
 * changes how people sign in, signs nobody out and erases nothing; one made in
 * this computer's terminal needs no approving; one made for a while stops by
 * itself; and revoking one never changes how anyone else signs in.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readKeyLifetime } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureUi } from '../cli/ui';
import { listKeys, makeKey, readKeyArgs, revokeKey } from './keysCli';
import { AccessError, AccessStore } from './store';

vi.mock('../cli/command', () => ({ cliName: () => 'conch' }));
// Password hashing is deliberately slow (scrypt, N=2^17).
vi.setConfig({ testTimeout: 20_000 });

const PASSWORD = 'purple otters juggle at dawn';
const HOUR = 60 * 60 * 1000;

const passkey = (id = 'passkey-credential-0001') => ({
  id,
  publicKey: 'cHVibGlj',
  counter: 0,
  rpId: 'conch.example.com',
  name: 'iCloud Keychain',
  synced: true,
  createdAt: Date.now(),
});

async function fresh() {
  const home = await mkdtemp(join(tmpdir(), 'conch-keys-'));
  return { home, store: new AccessStore(home) };
}

/** A Conch whose owner signs in with a passkey, signed in on two devices. */
async function onPasskeys() {
  const { home, store } = await fresh();
  await store.addPasskey(passkey());
  const phone = await store.createSession({ via: 'passkey', passkeyId: passkey().id });
  const laptop = await store.createSession({ via: 'passkey', passkeyId: passkey().id });
  return { home, store, tokens: [phone.token, laptop.token] };
}

afterEach(() => {
  vi.useRealTimers();
  process.exitCode = undefined;
});

describe('making a key changes nothing else', () => {
  it('keeps passkeys as the way in, and every session signed in', async () => {
    const { store, tokens } = await onPasskeys();
    const { key, info } = await store.addKey('Hermes handoff');
    expect(await store.method()).toBe('passkey');
    for (const token of tokens) expect(await store.findSession(token)).toBeDefined();
    expect(await store.passkeyRecords()).toHaveLength(1);
    expect((await store.verifyKey(key)).keyId).toBe(info.id);
    expect(info.signIn).toBeUndefined();
  });

  it('keeps the password, its sessions, and the password working', async () => {
    const { store } = await fresh();
    await store.setPassword('george', PASSWORD);
    const { token } = await store.createSession({ via: 'password' });
    const before = (await store.get()).passwordHash;
    await store.addKey('Script');
    expect(await store.method()).toBe('password');
    expect((await store.get()).passwordHash).toBe(before);
    expect(await store.findSession(token)).toBeDefined();
    expect((await store.verify({ username: 'george', secret: PASSWORD })).ok).toBe(true);
  });

  it('leaves sign-in off when it was off', async () => {
    const { store } = await fresh();
    const { key } = await store.addKey('Script');
    expect(await store.method()).toBe('none');
    expect((await store.verifyKey(key)).ok).toBe(true);
  });

  it('never lets a script’s key sign a browser in, or confirm it’s you', async () => {
    const { store } = await fresh();
    await store.setPassword('george', PASSWORD);
    const { key } = await store.addKey('Script');
    expect((await store.verifyKey(key, { signIn: true })).ok).toBe(false);
    expect((await store.verify({ secret: key })).ok).toBe(false);
  });

  it('keeps it where the version before can’t mistake it for key sign-in (ADR 0051)', async () => {
    const { home, store } = await fresh();
    await store.setPassword('george', PASSWORD);
    await store.addKey('Script');
    const onDisk = JSON.parse(await readFile(join(home, 'access.json'), 'utf8'));
    // The version before reads `keys` as "keys are how you sign in": they stay empty here, so
    // revoking there can't turn this Conch's sign-in off, and the key simply doesn't work there.
    expect(onDisk.method).toBe('password');
    expect(onDisk.keys).toEqual([]);
    expect(onDisk.scriptKeys).toHaveLength(1);
  });

  it('loses a key, never gains one, when the version before writes the file back', async () => {
    const { home, store } = await fresh();
    await store.setPassword('george', PASSWORD);
    const { key } = await store.addKey('For an hour', { expiresAt: Date.now() + HOUR });
    // The version before parses with its own schema, which drops fields it doesn't know.
    const before = z.object({
      version: z.literal(1),
      method: z.enum(['none', 'password', 'key', 'passkey']),
      username: z.string().optional(),
      passwordHash: z.string().optional(),
      keys: z.array(z.object({ id: z.string(), name: z.string(), hash: z.string() }).loose()),
      sessions: z.array(z.unknown()),
    });
    const path = join(home, 'access.json');
    const old = before.parse(JSON.parse(await readFile(path, 'utf8')));
    expect(old.keys).toEqual([]);
    await writeFile(path, JSON.stringify(old));
    const reopened = new AccessStore(home);
    expect(await reopened.method()).toBe('password');
    expect((await reopened.verifyKey(key)).ok).toBe(false);
    expect((await reopened.verify({ username: 'george', secret: PASSWORD })).ok).toBe(true);
  });

  it('makes keys the way in only when asked, and says so', async () => {
    const { store } = await fresh();
    await store.setPassword('george', PASSWORD);
    const kept = await store.createSession({ via: 'password' });
    const other = await store.createSession({ via: 'password' });
    const made = await store.addKey('My devices', { signIn: true, keepSessionId: kept.session.id });
    expect(made.turnedOn).toBe(true);
    expect(made.info.signIn).toBe(true);
    expect(await store.method()).toBe('key');
    expect(await store.findSession(kept.token)).toBeDefined();
    expect(await store.findSession(other.token)).toBeUndefined();
    expect((await store.verifyKey(made.key, { signIn: true })).ok).toBe(true);
  });

  it('won’t make a key people sign in with that runs out', async () => {
    const { store } = await fresh();
    await expect(
      store.addKey('Mine', { signIn: true, expiresAt: Date.now() + HOUR }),
    ).rejects.toThrow(AccessError);
    expect(await store.method()).toBe('none');
  });

  it('keeps keys working for scripts when a password replaces key sign-in', async () => {
    const { store } = await fresh();
    const { key } = await store.addKey('Laptop', { signIn: true });
    await store.setPassword('george', PASSWORD);
    expect(await store.method()).toBe('password');
    expect((await store.verifyKey(key)).ok).toBe(true);
    expect((await store.verifyKey(key, { signIn: true })).ok).toBe(false);
  });
});

describe('approving a key', () => {
  it('lets a key made on this computer in from the start', async () => {
    const { store } = await onPasskeys();
    await store.setApproval(true);
    const { info } = await store.addKey('Hermes', { approvedHow: 'terminal' });
    const access = await store.scriptAccess({ keyId: info.id, keyName: info.name });
    expect(access.approved).toBe(true);
    expect(await store.requests()).toEqual([]);
    const device = (await store.devices()).find((d) => d.script);
    expect(device).toMatchObject({ approved: true, approvedHow: 'terminal' });
  });

  it('still asks for a key made anywhere else', async () => {
    const { store } = await onPasskeys();
    await store.setApproval(true);
    const { info } = await store.addKey('From my phone');
    const access = await store.scriptAccess({ keyId: info.id, keyName: info.name });
    expect(access.approved).toBe(false);
    expect(await store.requests()).toHaveLength(1);
  });
});

describe('a key made for a while', () => {
  it('stops by itself, and what it signed in goes with it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    const { store } = await onPasskeys();
    const { key, info } = await store.addKey('Handoff', {
      expiresAt: Date.now() + HOUR,
      approvedHow: 'terminal',
    });
    const signedIn = await store.createSession({ via: 'key', keyId: info.id });
    expect((await store.verifyKey(key)).ok).toBe(true);
    expect((await store.keys()).map((k) => k.expiresAt)).toEqual([Date.now() + HOUR]);

    vi.setSystemTime(Date.now() + HOUR + 1);
    // It stops at once, before anything tidies it away.
    expect((await store.verifyKey(key)).ok).toBe(false);
    expect(await store.keys()).toEqual([]);
    expect(await store.findSession(signedIn.token)).toBeUndefined();
    expect(await store.sessionActive(signedIn.session.id)).toBe(false);

    const gone = await store.expireKeys();
    expect(gone).toEqual({ keys: [info.id], sessions: [signedIn.session.id] });
    const file = await store.get();
    expect(file.scriptKeys).toEqual([]);
    expect(file.devices.some((d) => d.keyId === info.id)).toBe(false);
    // Nobody else noticed.
    expect(await store.method()).toBe('passkey');
    expect(file.sessions.filter((s) => s.via === 'passkey')).toHaveLength(2);
    expect(await store.expireKeys()).toEqual({ keys: [], sessions: [] });
  });
});

describe('revoking a key', () => {
  it('never changes how people sign in', async () => {
    const { store, tokens } = await onPasskeys();
    const { info } = await store.addKey('Script');
    await store.revokeKey(info.id);
    expect(await store.method()).toBe('passkey');
    for (const token of tokens) expect(await store.findSession(token)).toBeDefined();

    const { store: withPassword } = await fresh();
    await withPassword.setPassword('george', PASSWORD);
    const only = await withPassword.addKey('Only key');
    await withPassword.revokeKey(only.info.id);
    expect(await withPassword.method()).toBe('password');
    expect((await withPassword.get()).passwordHash).toBeDefined();
  });

  it('signs out what signed in with it, and nothing else', async () => {
    const { store, tokens } = await onPasskeys();
    const { info } = await store.addKey('Script');
    const scripted = await store.createSession({ via: 'key', keyId: info.id });
    expect(await store.revokeKey(info.id)).toEqual([scripted.session.id]);
    for (const token of tokens) expect(await store.findSession(token)).toBeDefined();
  });

  it('won’t take away the last way in', async () => {
    const { store } = await fresh();
    const { info } = await store.addKey('Mine', { signIn: true });
    await expect(store.revokeKey(info.id)).rejects.toThrow('only way to sign in');
    expect(await store.method()).toBe('key');
  });
});

describe('conch key', () => {
  async function terminal() {
    const { home, store } = await onPasskeys();
    const { ui, text } = captureUi();
    const io = { store, ui, conch: (args: string) => `conch ${args}`, now: () => Date.now() };
    return { home, store, io, text };
  }

  it('says what the key can do, that nothing else changed, and how to revoke it', async () => {
    const { store, io, text } = await terminal();
    await store.setApproval(true);
    await makeKey(['Hermes', 'handoff', '(temporary)', '--for', '1h'], io);
    const said = text();
    const [info] = await store.keys();
    expect(info?.name).toBe('Hermes handoff (temporary)');
    expect(info?.expiresAt).toBeGreaterThan(Date.now());
    expect(said).toContain('Made the access key “Hermes handoff (temporary)”');
    expect(said).toContain('then stops by itself');
    expect(said).toContain('can do what you can do in Conch');
    expect(said).toContain('needs no approving');
    expect(said).toContain('You still sign in with your passkeys, and nobody was signed out.');
    expect(said).toContain(`conch revoke ${info?.id}`);
    expect(await store.method()).toBe('passkey');
    expect((await store.scriptAccess({ keyId: info?.id ?? '', keyName: 'Hermes' })).approved).toBe(
      true,
    );
  });

  it('makes nothing from a time it doesn’t understand', async () => {
    const { store, io, text } = await terminal();
    await makeKey(['Script', '--for', 'soon'], io);
    expect(text()).toContain('“soon” isn’t a time Conch understands');
    expect(await store.keys()).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('says plainly when --sign-in changes how people sign in', async () => {
    const { store, io, text } = await terminal();
    await makeKey(['Mine', '--sign-in'], io);
    expect(await store.method()).toBe('key');
    expect(text()).toContain('Access keys are now how you sign in');
    expect(text()).toContain('Every other device was signed out');
    expect(text()).toContain('Your passkeys still work');
  });

  it('lists keys with when they stop, and revokes one without touching sign-in', async () => {
    const { store, io, text } = await terminal();
    await makeKey(['Handoff', '--for=2d'], io);
    const [info] = await store.keys();
    await listKeys(io);
    expect(text()).toContain('Handoff');
    expect(text()).toContain('for scripts');
    await revokeKey([info?.id ?? ''], io);
    expect(text()).toContain('Revoked “Handoff”. It stopped working at once.');
    expect(text()).toContain('You still sign in with your passkeys.');
    expect(await store.keys()).toEqual([]);
  });

  it('reads how long a key lasts', () => {
    expect(readKeyLifetime('1h')).toBe(HOUR);
    expect(readKeyLifetime('30 minutes')).toBe(30 * 60 * 1000);
    expect(readKeyLifetime('2d')).toBe(48 * HOUR);
    expect(readKeyLifetime('1w')).toBe(7 * 24 * HOUR);
    expect(readKeyLifetime('1m')).toBeUndefined(); // shorter than five minutes
    expect(readKeyLifetime('400d')).toBeUndefined(); // longer than a year
    expect(readKeyLifetime('-1h')).toBeUndefined();
    expect(readKeyArgs(['My', 'script', '--for', '2', 'days'])).toEqual({
      name: 'My script',
      lifetime: 48 * HOUR,
      signIn: false,
    });
    expect(readKeyArgs([])).toEqual({ name: 'Terminal', signIn: false });
  });
});
