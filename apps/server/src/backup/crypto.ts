/**
 * Locking a backup's keys and sign-ins with a passphrase (ADR 0020). Nothing
 * novel, all `node:crypto`:
 *
 * - scrypt (OWASP Password Storage Cheat Sheet: N=2^17, r=8, p=1) over a
 *   random 16-byte salt turns the passphrase into a master key
 *   (`auth/secrets.ts`, shared with password hashing);
 * - HKDF-SHA256 splits it into an encryption key and a check key, so a wrong
 *   passphrase is told apart from a changed file;
 * - AES-256-GCM with a random 96-bit nonce encrypts, and authenticates the
 *   backup's header and file list as associated data: change any of them and
 *   the keys won't open.
 *
 * No passphrase hint is stored, and the passphrase never is.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

import { z } from 'zod';

import { SCRYPT, Semaphore, deriveKey, safeEqual } from '../auth/secrets';
import { BackupError, DAMAGED } from './archive';

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/);

/** What's stored to open the keys again: never the passphrase, never a hint. */
export const Lock = z.object({
  kdf: z.object({
    name: z.literal('scrypt'),
    // Bounded, so a crafted header can't ask for more than 512 MiB (128·N·r) or minutes of work.
    N: z
      .number()
      .int()
      .min(2 ** 15)
      .max(2 ** 18)
      .refine((n) => (n & (n - 1)) === 0, 'N must be a power of two'),
    r: z.number().int().min(8).max(16),
    p: z.number().int().min(1).max(2),
    salt: b64,
  }),
  cipher: z.literal('aes-256-gcm'),
  nonce: b64,
  /** HMAC of a fixed text with the check key: tells a wrong passphrase apart. */
  check: b64,
});
export type Lock = z.infer<typeof Lock>;

const CHECK_TEXT = 'conch-backup passphrase check';
const TAG_BYTES = 16;

/** One scrypt at a time: each takes 128 MiB. */
const hashing = new Semaphore(1);

function split(master: Buffer): { key: Buffer; checkKey: Buffer } {
  const derive = (info: string) =>
    Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  return { key: derive('conch-backup/1 encryption'), checkKey: derive('conch-backup/1 check') };
}

/** A new lock for a passphrase, and the key it opens with. */
export async function newLock(passphrase: string): Promise<{ lock: Lock; key: Buffer }> {
  const salt = randomBytes(16);
  const { N, r, p } = SCRYPT;
  const master = await hashing.run(() => deriveKey(passphrase, salt, { N, r, p }));
  const { key, checkKey } = split(master);
  const lock: Lock = {
    kdf: { name: 'scrypt', N, r, p, salt: salt.toString('base64url') },
    cipher: 'aes-256-gcm',
    nonce: randomBytes(12).toString('base64url'),
    check: createHmac('sha256', checkKey).update(CHECK_TEXT).digest('base64url'),
  };
  return { lock, key };
}

/** The key for a lock, or `wrong-passphrase`. */
export async function unlock(lock: Lock, passphrase: string): Promise<Buffer> {
  const { N, r, p, salt } = lock.kdf;
  const master = await hashing.run(() =>
    deriveKey(passphrase, Buffer.from(salt, 'base64url'), { N, r, p }),
  );
  const { key, checkKey } = split(master);
  const check = createHmac('sha256', checkKey).update(CHECK_TEXT).digest('base64url');
  if (!safeEqual(check, lock.check))
    throw new BackupError('wrong-passphrase', 'That passphrase doesn’t open this backup.');
  return key;
}

/** What the encryption authenticates besides the keys: the header and the list of files. */
export function associatedData(header: Buffer, seal: Buffer): Buffer {
  const sha = (data: Buffer) => createHash('sha256').update(data).digest();
  return Buffer.concat([Buffer.from('conch-backup/1\0'), sha(header), sha(seal)]);
}

export function encrypt(key: Buffer, lock: Lock, plain: Buffer, aad: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(lock.nonce, 'base64url'), {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

/** Decrypt, or `damaged` when anything it authenticates was changed. */
export function decrypt(key: Buffer, lock: Lock, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < TAG_BYTES) throw new BackupError('damaged', DAMAGED);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(lock.nonce, 'base64url'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new BackupError('damaged', DAMAGED);
  }
}
