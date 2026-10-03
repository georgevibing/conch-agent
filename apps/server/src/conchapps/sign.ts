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

/**
 * Letters from other scripts that look like Latin ones, and a few other
 * stand-ins (digits, symbols), each with the Latin letter it passes for.
 * Read after NFKC, so full-width and styled letters are already plain.
 */
const CAPITALS: Record<string, string> = {
  // Cyrillic and Greek capitals that pass for Latin ones (before lower case changes what they look like).
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  Ѕ: 'S',
  І: 'I',
  Ј: 'J',
  Ԁ: 'D',
  Ԛ: 'Q',
  Ԝ: 'W',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  // A capital I is a small l in most typefaces.
  I: 'l',
};

const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ԁ: 'd',
  һ: 'h',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  ь: 'b',
  г: 'r',
  п: 'n',
  ц: 'u',
  ш: 'w',
  ү: 'y',
  ҡ: 'k',
  ո: 'n',
  ս: 'u',
  // Greek
  α: 'a',
  β: 'b',
  γ: 'y',
  ε: 'e',
  ζ: 'z',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  σ: 'o',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
  ϲ: 'c',
  ϳ: 'j',
  ς: 'c',
  // Latin look-alikes and stand-ins
  ı: 'i',
  ȷ: 'j',
  ɑ: 'a',
  ɡ: 'g',
  ɩ: 'i',
  ʟ: 'l',
  ᴏ: 'o',
  ꞵ: 'b',
  ł: 'l',
  ø: 'o',
  đ: 'd',
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '5': 's',
  '|': 'l',
  '!': 'i',
  $: 's',
  '@': 'a',
};

/** Characters nobody sees: joiners, marks for text direction, variation selectors. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Mn}]/gu;

/**
 * A name as it looks rather than as it's spelled: NFKC, nothing invisible,
 * accents off, look-alike letters as the Latin ones (capitals first), lower case, and
 * `rn`/`vv` as the `m`/`w` they pass for. Two names with the same skeleton
 * read the same to a person, so an untrusted key using one is a look-alike.
 */
export function nameSkeleton(name: string): string {
  let capitals = '';
  for (const char of name.normalize('NFKC').normalize('NFD').replace(INVISIBLE, ''))
    capitals += CAPITALS[char] ?? char;
  let out = '';
  for (const char of capitals.toLowerCase()) out += CONFUSABLES[char] ?? char;
  return out.replaceAll('rn', 'm').replaceAll('vv', 'w').replace(/\s+/g, ' ').trim();
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
  const name = nameSkeleton(parsed.publisher.name);
  const lookalike = Boolean(name) && publishers.some((p) => nameSkeleton(p.name) === name);
  return { state: 'untrusted', ...who, ...(lookalike && { lookalike }) };
}
