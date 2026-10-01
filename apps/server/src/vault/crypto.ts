/**
 * The vault's encryption (ADR 0025). `node:crypto` only, nothing novel:
 *
 * - one random 256-bit vault key (VK), wrapped with AES-256-GCM under the
 *   device key the operating system keeps (`keystore.ts`);
 * - every item has its own key, HKDF-SHA256(VK, salt = item id), so a nonce
 *   is never reused under one key however often items change (NIST SP 800-38D
 *   caps random 96-bit nonces at 2^32 per key);
 * - every item is AES-256-GCM with a fresh random nonce, and its id and
 *   version as associated data: a ciphertext moved to another item, or an
 *   older copy put back in place of a newer one, doesn't open;
 * - names, sites, usernames and notes are encrypted with the rest: which bank
 *   you use is private too. Only ids and versions are in the clear;
 * - an HMAC (its own HKDF subkey) over the list of ids and versions catches an
 *   item deleted, duplicated or swapped for an older one in the file.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { z } from 'zod';

const VERSION = 'conch-vault/1';
const NONCE = 12;
const TAG = 16;

const b64 = z.string().regex(/^[A-Za-z0-9_-]+$/);

/** A sealed blob: nonce and ciphertext with its tag, base64url. */
export const Sealed = z.object({ n: b64, c: b64 });
export type Sealed = z.infer<typeof Sealed>;

export class VaultCryptoError extends Error {}

function subkey(vk: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', vk, Buffer.from(salt, 'utf8'), Buffer.from(info), 32));
}

function seal(key: Buffer, plain: Buffer, aad: Buffer): Sealed {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { n: nonce.toString('base64url'), c: body.toString('base64url') };
}

function open(key: Buffer, sealed: Sealed, aad: Buffer): Buffer {
  const nonce = Buffer.from(sealed.n, 'base64url');
  const body = Buffer.from(sealed.c, 'base64url');
  if (nonce.length !== NONCE || body.length < TAG) throw new VaultCryptoError('damaged');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
  decipher.setAAD(aad);
  decipher.setAuthTag(body.subarray(body.length - TAG));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG)), decipher.final()]);
  } catch {
    throw new VaultCryptoError('damaged');
  }
}

export function newVaultKey(): Buffer {
  return randomBytes(32);
}

/** VK under the device key (or a backup's key). */
export function wrapKey(kek: Buffer, vk: Buffer, purpose = 'wrap'): Sealed {
  return seal(kek, vk, Buffer.from(`${VERSION}\0${purpose}`));
}

export function unwrapKey(kek: Buffer, sealed: Sealed, purpose = 'wrap'): Buffer {
  const vk = open(kek, sealed, Buffer.from(`${VERSION}\0${purpose}`));
  if (vk.length !== 32) throw new VaultCryptoError('damaged');
  return vk;
}

function itemAad(id: string, version: number): Buffer {
  return Buffer.from(`${VERSION}\0item\0${id}\0${version}`);
}

export function sealItem(vk: Buffer, id: string, version: number, value: unknown): Sealed {
  const key = subkey(vk, id, `${VERSION} item`);
  try {
    return seal(key, Buffer.from(JSON.stringify(value), 'utf8'), itemAad(id, version));
  } finally {
    key.fill(0);
  }
}

export function openItem(vk: Buffer, id: string, version: number, sealed: Sealed): unknown {
  const key = subkey(vk, id, `${VERSION} item`);
  try {
    const plain = open(key, sealed, itemAad(id, version));
    try {
      return JSON.parse(plain.toString('utf8')) as unknown;
    } finally {
      plain.fill(0);
    }
  } finally {
    key.fill(0);
  }
}

/** The vault-wide check over which items exist, at which versions. */
export function indexMac(vk: Buffer, entries: { id: string; v: number }[]): string {
  const key = subkey(vk, 'index', `${VERSION} index`);
  try {
    const list = entries
      .map((e) => `${e.id}:${e.v}`)
      .sort()
      .join('\n');
    return createHmac('sha256', key).update(list).digest('base64url');
  } finally {
    key.fill(0);
  }
}

export function macMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A keyed fingerprint of a value, to tell whether a password changed since it
 * was checked against breaches, and to spot reuse, without keeping a plain
 * hash anyone could look up.
 */
export function fingerprint(vk: Buffer, value: string): string {
  const key = subkey(vk, 'fingerprint', `${VERSION} fingerprint`);
  try {
    return createHmac('sha256', key).update(value, 'utf8').digest('base64url').slice(0, 22);
  } finally {
    key.fill(0);
  }
}
