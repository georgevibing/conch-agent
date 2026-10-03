/**
 * Who made an app, provably (ADR 0061 §5). The same Ed25519 key that signs
 * skills (ADR 0031, `skills/signing.ts`) signs apps, kept sealed in
 * `skills.signing.json` and made the first time it's needed (`SkillTrust`).
 *
 * `conch-app.sig` signs `conch-app-signature/1\n<id>\n<hash>`: its own
 * domain, so an app's signature never holds as a skill's, nor a skill's as
 * an app's; the app's id, so it can't be moved to another app; and the hash
 * of every other file, so a changed byte breaks it. Trust is in keys: a
 * signer you trust is `verified`, anyone else `untrusted`, and an untrusted
 * key using a name you trust is a `lookalike`.
 */
import { createPrivateKey, sign, verify } from 'node:crypto';
import { userInfo } from 'node:os';

import { AppId, type SkillSignature } from '@conch/protocol';
import { z } from 'zod';

import { fingerprintOf, publicKeyFrom } from '../skills/signing';
import { SkillTrust } from '../skills/trust';
import { appHash, SIGNATURE_FILE } from './package';
import type { AppPackage, VerifyApp } from './types';

const DOMAIN = 'conch-app-signature/1';

/** The bytes signed: what it is, which app, and everything in it. */
export function appSignedMessage(id: string, hash: string): Buffer {
  return Buffer.from(`${DOMAIN}\n${id}\n${hash}`, 'utf8');
}

export const AppSignatureFile = z
  .object({
    v: z.literal(1),
    alg: z.literal('ed25519'),
    app: AppId,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    publisher: z
      .object({
        name: z.string().trim().min(1).max(80),
        /** The raw 32-byte Ed25519 public key, base64url. */
        key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict(),
    signedAt: z.number(),
    /** 64 bytes, base64url. */
    sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();
export type AppSignatureFile = z.infer<typeof AppSignatureFile>;

const defaultName = () => {
  try {
    return userInfo().username || 'Me';
  } catch {
    return 'Me';
  }
};

/**
 * Sign an app as it is now with your signing key (made, and trusted, if you
 * have none yet): the `conch-app.sig` to put beside its manifest.
 */
export async function signApp(
  app: AppPackage,
  home: string,
  options: { trust?: SkillTrust; name?: string; now?: () => number } = {},
): Promise<Buffer> {
  const trust = options.trust ?? new SkillTrust(home);
  const signer = await trust.signer(options.name ?? defaultName());
  const key = createPrivateKey({
    key: Buffer.from(signer.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('That isn’t an Ed25519 signing key.');
  const hash = appHash(app.files);
  const file: AppSignatureFile = {
    v: 1,
    alg: 'ed25519',
    app: app.manifest.id,
    hash,
    publisher: { name: signer.name.slice(0, 80), key: signer.publicKey },
    signedAt: options.now?.() ?? Date.now(),
    sig: sign(null, appSignedMessage(app.manifest.id, hash), key).toString('base64url'),
  };
  return Buffer.from(`${JSON.stringify(file, null, 2)}\n`);
}

const UNREADABLE = 'Its signature file isn’t one Conch can read, so it can’t say who made it.';

/** Whether an app's signature holds, and whether you trust who made it. */
export const verifyApp: VerifyApp = async (app, home) => verifyAppWith(app, new SkillTrust(home));

export async function verifyAppWith(app: AppPackage, trust: SkillTrust): Promise<SkillSignature> {
  const raw = app.files.get(SIGNATURE_FILE);
  if (!raw) return { state: 'unsigned' };
  const invalid = (problem: string, extra: Partial<SkillSignature> = {}): SkillSignature => ({
    state: 'invalid',
    problem,
    ...extra,
  });
  let parsed: AppSignatureFile;
  try {
    const result = AppSignatureFile.safeParse(JSON.parse(raw.toString('utf8')));
    if (!result.success) return invalid(UNREADABLE);
    parsed = result.data;
  } catch {
    return invalid(UNREADABLE);
  }
  const key = publicKeyFrom(parsed.publisher.key);
  // Only Ed25519, only 32-byte keys: nothing else is accepted in its place.
  if (!key || key.asymmetricKeyType !== 'ed25519')
    return invalid('Its signature uses a key Conch doesn’t accept.');
  const fingerprint = fingerprintOf(parsed.publisher.key);
  const who = { publisher: parsed.publisher.name, fingerprint };
  if (parsed.app !== app.manifest.id)
    return invalid(`It carries a signature made for another app (“${parsed.app}”).`, who);
  const holds = verify(
    null,
    appSignedMessage(parsed.app, parsed.hash),
    key,
    Buffer.from(parsed.sig, 'base64url'),
  );
  if (!holds)
    return invalid('Its signature doesn’t hold: it wasn’t made by the key it names.', who);
  if (appHash(app.files) !== parsed.hash)
    return invalid(`It was changed after ${parsed.publisher.name} signed it.`, who);
  const publishers = await trust.list();
  if (publishers.some((p) => p.fingerprint === fingerprint)) return { state: 'verified', ...who };
  const name = parsed.publisher.name.trim().toLowerCase();
  const lookalike = publishers.some((p) => p.name.trim().toLowerCase() === name);
  return { state: 'untrusted', ...who, ...(lookalike && { lookalike }) };
}
