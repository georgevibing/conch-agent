import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

import { ACCESS_KEY_PREFIX } from '@conch/protocol';

/**
 * Cryptographic building blocks for sign-in. Nothing here is novel: random
 * tokens from the OS CSPRNG, SHA-256 for high-entropy secrets, and scrypt for
 * passwords with OWASP's recommended cost (N=2^17, r=8, p=1 — 128 MiB).
 */

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password.normalize('NFKC'), salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** OWASP Password Storage Cheat Sheet, scrypt option 1. */
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32 } as const;

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A new access key: `conch_` + 256 random bits. */
export function newAccessKey(): string {
  return `${ACCESS_KEY_PREFIX}${randomToken(32)}`;
}

/**
 * SHA-256 for secrets that are already random (keys, session and pairing
 * tokens). A slow hash adds nothing when the input has 256 bits of entropy.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

/** Constant-time string comparison (lengths may leak; contents don't). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still spend the time so the length check isn't a fast path.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Hash a password for storage: `scrypt$N$r$p$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * N * r });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** A real-looking hash, so unknown usernames cost the same time as wrong passwords. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomToken(16));
  return dummy;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const N = Number(n);
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: 256 * N * Number(r),
  });
  return timingSafeEqual(key, expected);
}

/** Stored hashes made with weaker settings than today's should be upgraded on next sign-in. */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$');
  return Number(n) < SCRYPT.N || Number(r) < SCRYPT.r || Number(p) < SCRYPT.p;
}

/**
 * At most `limit` password hashes run at once. Each needs 128 MiB, so without
 * this a burst of sign-in attempts could exhaust memory.
 */
export class Semaphore {
  #active = 0;
  #queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.limit) await new Promise<void>((r) => this.#queue.push(r));
    this.#active++;
    try {
      return await fn();
    } finally {
      this.#active--;
      this.#queue.shift()?.();
    }
  }

  get waiting() {
    return this.#queue.length;
  }
}
