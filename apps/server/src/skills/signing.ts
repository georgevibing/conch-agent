/**
 * Who made a skill, provably (ADR 0031).
 *
 * A signed skill carries `SKILL.sig` next to its `SKILL.md`: an Ed25519
 * signature (RFC 8032, `node:crypto`) over the skill's name and the
 * fingerprint of everything else in its folder (`skillHash`). Change one
 * byte, rename it, or copy the signature onto another skill, and it no
 * longer holds.
 *
 * A signature proves which *key* signed; the name next to it is only what
 * the signer typed. So trust is in keys: you trust a publisher by its key's
 * fingerprint, once, on purpose (sudo mode), and from then on its skills say
 * "Verified: signed by …" — and updates it signs carry on without being
 * turned off. Someone else claiming the same name with another key is just
 * an unknown signer.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SkillSignature } from '@conch/protocol';
import { z } from 'zod';

import { skillHash } from './scan';

export const SIG_FILE = 'SKILL.sig';
const DOMAIN = 'conch-skill-signature/1';

/** The bytes signed: what it is, its name, and everything in it. */
export function signedMessage(name: string, hash: string): Buffer {
  return Buffer.from(`${DOMAIN}\n${name}\n${hash}`, 'utf8');
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export const SignatureFile = z.object({
  v: z.literal(1),
  alg: z.literal('ed25519'),
  name: z.string().min(1).max(64),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  publisher: z.object({
    name: z.string().trim().min(1).max(80),
    /** The raw 32-byte Ed25519 public key, base64url. */
    key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  signedAt: z.number(),
  /** 64 bytes, base64url. */
  sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type SignatureFile = z.infer<typeof SignatureFile>;

/** An Ed25519 public key from its raw 32 bytes, or undefined for anything else. */
export function publicKeyFrom(raw: string): KeyObject | undefined {
  const bytes = Buffer.from(raw, 'base64url');
  if (bytes.length !== 32) return undefined;
  try {
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(bytes) }, format: 'jwk' });
  } catch {
    return undefined;
  }
}

/** A key's fingerprint, for people: SHA-256 of the raw key, 16 hex digits in fours. */
export function fingerprintOf(rawKey: string): string {
  const hex = createHash('sha256').update(Buffer.from(rawKey, 'base64url')).digest('hex');
  return (hex.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join(' ');
}

export interface Signer {
  name: string;
  /** Raw public key, base64url. */
  publicKey: string;
  /** PKCS#8 DER, base64url. */
  privateKey: string;
}

export function newSigner(name: string): Signer {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    name,
    publicKey: jwk.x ?? '',
    privateKey: b64u(privateKey.export({ format: 'der', type: 'pkcs8' })),
  };
}

/** Sign a skill's folder as it is now, writing its `SKILL.sig`. */
export async function signSkill(
  folder: string,
  name: string,
  signer: Signer,
): Promise<SignatureFile> {
  const hash = await skillHash(folder);
  const key = createPrivateKey({
    key: Buffer.from(signer.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('That isn’t an Ed25519 signing key.');
  const file: SignatureFile = {
    v: 1,
    alg: 'ed25519',
    name,
    hash,
    publisher: { name: signer.name, key: signer.publicKey },
    signedAt: Date.now(),
    sig: b64u(sign(null, signedMessage(name, hash), key)),
  };
  await writeFile(join(folder, SIG_FILE), `${JSON.stringify(file, null, 2)}\n`);
  return file;
}

/**
 * Whether a skill's signature holds. `trusted`: fingerprints you trust. The
 * name checked is the skill's own (its front matter or folder): a signature
 * made for another skill doesn't hold here.
 */
export async function checkSignature(
  folder: string,
  name: string,
  trusted: ReadonlySet<string>,
): Promise<SkillSignature & { key?: string }> {
  let text: string;
  try {
    text = await readFile(join(folder, SIG_FILE), 'utf8');
  } catch {
    return { state: 'unsigned' };
  }
  const invalid = (problem: string, extra: Partial<SkillSignature> = {}) =>
    ({ state: 'invalid', problem, ...extra }) as const;
  let parsed: SignatureFile;
  try {
    const result = SignatureFile.safeParse(JSON.parse(text));
    if (!result.success)
      return invalid('Its signature file isn’t one Conch can read, so it can’t say who made it.');
    parsed = result.data;
  } catch {
    return invalid('Its signature file isn’t one Conch can read, so it can’t say who made it.');
  }
  const key = publicKeyFrom(parsed.publisher.key);
  // Only Ed25519, only 32-byte keys: nothing else is accepted in its place.
  if (!key || key.asymmetricKeyType !== 'ed25519')
    return invalid('Its signature uses a key Conch doesn’t accept.');
  const fingerprint = fingerprintOf(parsed.publisher.key);
  const who = { publisher: parsed.publisher.name, fingerprint };
  if (parsed.name !== name)
    return invalid(`It carries a signature made for another skill (“${parsed.name}”).`, who);
  const signatureHolds = verify(
    null,
    signedMessage(parsed.name, parsed.hash),
    key,
    Buffer.from(parsed.sig, 'base64url'),
  );
  if (!signatureHolds)
    return invalid('Its signature doesn’t hold: it wasn’t made by the key it names.', who);
  if ((await skillHash(folder)) !== parsed.hash)
    return invalid(`It was changed after ${parsed.publisher.name} signed it.`, who);
  return {
    state: trusted.has(fingerprint) ? 'verified' : 'untrusted',
    ...who,
    key: parsed.publisher.key,
  };
}
