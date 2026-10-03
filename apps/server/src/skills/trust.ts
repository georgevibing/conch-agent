/**
 * Whose skills you trust, and your own signing key (ADR 0031, ADR 0047).
 *
 * - `skills.trust.json`: the publishers you said you trust, by their key's
 *   fingerprint. Kept in backups, and named in a restore's preview: a backup
 *   can't quietly bring trust back (`backup/powers.ts`).
 * - `skills.signing.json`: your own Ed25519 key, for `pnpm conch skills
 *   sign`, trusted from the moment it's made. It's locked with this
 *   computer's device key (`lib/sealed.ts`), like Conch's other keys; the
 *   terminal command opens the device key the same way the gateway does. A
 *   key written in the clear (an older Conch, a restored backup) is locked
 *   the first time it's opened, in one atomic replace. One that can't be
 *   opened, or doesn't hold together, is never replaced by itself: it fails
 *   in words, and Repair everything says so.
 *
 * Both are protected paths (`lib/protect.ts`): the assistant's file and
 * shell tools can't read or change them, sealed or not.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { TrustedPublisher } from '@conch/protocol';
import { z } from 'zod';

import { Mutex, writeFileAtomic, writeJson } from '../lib/fs';
import { readStore, setAside } from '../lib/recover';
import { isSealed, SealedError, sealerFor, type Sealer } from '../lib/sealed';
import { fingerprintOf, newSigner, publicKeyFrom, type Signer } from './signing';
import { cliName } from '../cli/command';

const TrustFile = z.object({
  publishers: z
    .array(
      z.object({
        fingerprint: z.string(),
        key: z.string(),
        name: z.string().max(80),
        trustedAt: z.number(),
        you: z.boolean().optional(),
      }),
    )
    .default([]),
});

const SignerFile = z.object({
  name: z.string().min(1).max(80),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  privateKey: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

export const TRUST_FILE = 'skills.trust.json';
export const SIGNER_FILE = 'skills.signing.json';

/** What to do when the key can't be used, for the terminal and Repair everything. */
export const newKeyCommand = () => `${cliName()} skills key --new`;

/** Your signing key can't be used. The message is for a person, and says nothing was signed. */
export class SigningKeyError extends Error {
  constructor(
    readonly reason: 'changed' | 'damaged' | 'keychain',
    message: string,
  ) {
    super(message);
  }
}

const CHANGED =
  'Your key for signing skills can’t be opened: the file was changed, or it was locked on another computer.';
const DAMAGED = 'Your key for signing skills is damaged, so Conch won’t use it.';
const KEYCHAIN =
  'Conch couldn’t reach this computer’s keychain, which locks your key for signing skills.';

/** Where your signing key stands. */
export type SigningKeyState =
  | { state: 'none' }
  | { state: 'locked'; publicKey: string; name: string; migrated?: boolean }
  /** Written in the clear (an older Conch, a restored backup), when asked only to look. */
  | { state: 'clear'; publicKey: string; name: string }
  | { state: 'unusable'; reason: SigningKeyError['reason']; problem: string };

/** A signing key that holds together: an Ed25519 private key whose public half is the one named. */
function signerFrom(plain: Buffer): Signer {
  let parsed: z.infer<typeof SignerFile>;
  try {
    const result = SignerFile.safeParse(JSON.parse(plain.toString('utf8')));
    if (!result.success) throw new Error('shape');
    parsed = result.data;
  } catch {
    throw new SigningKeyError('damaged', DAMAGED);
  }
  try {
    const key = createPrivateKey({
      key: Buffer.from(parsed.privateKey, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    const x = createPublicKey(key).export({ format: 'jwk' }).x;
    if (key.asymmetricKeyType !== 'ed25519' || x !== parsed.publicKey) throw new Error('mismatch');
  } catch {
    throw new SigningKeyError('damaged', DAMAGED);
  }
  return { name: parsed.name, publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

export class SkillTrust {
  readonly #mutex = new Mutex();
  /** The signing key's own: making one also trusts it, which takes `#mutex`. */
  readonly #keyMutex = new Mutex();
  #version = 0;

  /**
   * `sealer`: what locks the signing key. Unset, it's the one this home
   * registered (`Services`, and `pnpm conch` for the terminal).
   */
  constructor(
    private readonly home: string,
    private readonly options: { sealer?: Sealer } = {},
  ) {}

  /** Changes whenever the list does: what's verified is worked out again. */
  get version() {
    return this.#version;
  }

  async #read() {
    return (await readStore(join(this.home, TRUST_FILE), TrustFile)).value;
  }

  async list(): Promise<TrustedPublisher[]> {
    return (await this.#read()).publishers.map(({ fingerprint, name, trustedAt, you }) => ({
      fingerprint,
      name,
      trustedAt,
      ...(you && { you }),
    }));
  }

  async fingerprints(): Promise<Set<string>> {
    return new Set((await this.#read()).publishers.map((p) => p.fingerprint));
  }

  /** Trust a key. Its fingerprint is worked out here, never taken on faith. */
  trust(entry: { key: string; name: string; you?: boolean }): Promise<TrustedPublisher> {
    return this.#mutex.run(async () => {
      if (!publicKeyFrom(entry.key)) throw new Error('That isn’t a key Conch accepts.');
      const file = await this.#read();
      const fingerprint = fingerprintOf(entry.key);
      const kept = file.publishers.filter((p) => p.fingerprint !== fingerprint);
      const added = {
        fingerprint,
        key: entry.key,
        name: entry.name.slice(0, 80),
        trustedAt: Date.now(),
        ...(entry.you && { you: true }),
      };
      await writeJson(join(this.home, TRUST_FILE), { publishers: [...kept, added] });
      this.#version++;
      return {
        fingerprint,
        name: added.name,
        trustedAt: added.trustedAt,
        ...(entry.you && { you: true }),
      };
    });
  }

  forget(fingerprint: string): Promise<boolean> {
    return this.#mutex.run(async () => {
      const file = await this.#read();
      const kept = file.publishers.filter((p) => p.fingerprint !== fingerprint);
      if (kept.length === file.publishers.length) return false;
      await writeJson(join(this.home, TRUST_FILE), { publishers: kept });
      this.#version++;
      return true;
    });
  }

  get #signerPath() {
    return join(this.home, SIGNER_FILE);
  }

  #sealer(): Sealer {
    const sealer = this.options.sealer ?? sealerFor(this.#signerPath);
    if (!sealer) throw new SigningKeyError('keychain', KEYCHAIN);
    return sealer;
  }

  /** Lock a signing key with this computer's key, replacing what was there in one rename. */
  async #write(signer: Signer): Promise<void> {
    const plain = Buffer.from(`${JSON.stringify(signer, null, 2)}\n`);
    let sealed: string;
    try {
      sealed = await this.#sealer().seal(SIGNER_FILE, plain);
    } catch (error) {
      if (error instanceof SigningKeyError) throw error;
      throw new SigningKeyError('keychain', KEYCHAIN);
    } finally {
      plain.fill(0);
    }
    await writeFileAtomic(this.#signerPath, sealed, 0o600);
  }

  /**
   * Your signing key, or undefined when there's none yet. One in the clear
   * is locked now (`migrated`). Throws `SigningKeyError`, never makes a new
   * key over one it couldn't open.
   */
  async #open(
    lock = true,
  ): Promise<{ signer: Signer; migrated: boolean; clear?: boolean } | undefined> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.#signerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new SigningKeyError('changed', CHANGED);
    }
    const text = bytes.toString('utf8');
    if (!isSealed(text)) {
      const signer = signerFrom(bytes);
      bytes.fill(0);
      if (!lock) return { signer, migrated: false, clear: true };
      await this.#write(signer);
      return { signer, migrated: true };
    }
    let plain: Buffer;
    try {
      plain = await this.#sealer().open(SIGNER_FILE, text);
    } catch (error) {
      if (error instanceof SigningKeyError) throw error;
      // A device key the keychain wouldn't give isn't a changed file.
      if (!(error instanceof SealedError)) throw new SigningKeyError('keychain', KEYCHAIN);
      throw new SigningKeyError('changed', CHANGED);
    }
    try {
      return { signer: signerFrom(plain), migrated: false };
    } finally {
      plain.fill(0);
    }
  }

  /**
   * Where your signing key stands, locking one left in the clear (unless
   * `lock: false`: only look). Never makes one.
   */
  signingKey(options: { lock?: boolean } = {}): Promise<SigningKeyState> {
    return this.#keyMutex.run(async () => {
      try {
        const opened = await this.#open(options.lock ?? true);
        if (!opened) return { state: 'none' };
        if (opened.clear)
          return { state: 'clear', publicKey: opened.signer.publicKey, name: opened.signer.name };
        return {
          state: 'locked',
          publicKey: opened.signer.publicKey,
          name: opened.signer.name,
          ...(opened.migrated && { migrated: true }),
        };
      } catch (error) {
        if (!(error instanceof SigningKeyError)) throw error;
        return { state: 'unusable', reason: error.reason, problem: error.message };
      }
    });
  }

  /**
   * Lock a signing key left in the clear, without opening a sealed one (so a
   * start never reaches for the keychain it doesn't need). True when it did.
   */
  async lockIfClear(): Promise<boolean> {
    const text = await readFile(this.#signerPath, 'utf8').catch(() => undefined);
    if (text === undefined || isSealed(text)) return false;
    const key = await this.signingKey({ lock: true });
    return key.state === 'locked' && key.migrated === true;
  }

  /** Your own signing key, made (and trusted) the first time it's needed. */
  signer(name: string): Promise<Signer> {
    return this.#keyMutex.run(async () => {
      const opened = await this.#open();
      if (opened) return opened.signer;
      return this.#make(name);
    });
  }

  /**
   * A new key in place of one that can't be used (`pnpm conch skills key
   * --new`). The old file is set aside, still locked, in case the keychain
   * comes back; one in the clear that doesn't hold together is removed, so
   * no copy of a private key is left in the clear. A key that works is kept:
   * `replaced: false`.
   */
  replaceSigner(name: string): Promise<{ signer: Signer; replaced: boolean }> {
    return this.#keyMutex.run(async () => {
      try {
        const opened = await this.#open();
        if (opened) return { signer: opened.signer, replaced: false };
      } catch (error) {
        if (!(error instanceof SigningKeyError)) throw error;
        // Can't lock anything without the keychain: making a new key wouldn't either.
        if (error.reason === 'keychain') throw error;
        const text = await readFile(this.#signerPath, 'utf8').catch(() => '');
        if (isSealed(text)) await setAside(this.#signerPath);
        else await rm(this.#signerPath, { force: true });
      }
      return { signer: await this.#make(name), replaced: true };
    });
  }

  async #make(name: string): Promise<Signer> {
    const made = newSigner(name);
    await this.#write(made);
    await this.trust({ key: made.publicKey, name: made.name, you: true });
    return made;
  }
}
