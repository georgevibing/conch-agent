/**
 * Conch's own keys, encrypted at rest (ADR 0025 § Keys Conch uses).
 *
 * `secrets.json` (provider keys), `integrations.secrets.json` and
 * `channels.secrets.json` are written as one AES-256-GCM blob under a key
 * derived from this computer's device key (the one the Keychain, DPAPI or
 * the Secret Service holds). They always open unattended — a routine at 3am,
 * a bot at noon — even when Passwords itself is locked.
 *
 * The layer sits under `readStore` and `writeJson`, so the stores don't know:
 * a home registers its sealer once (`Services`), and every read and write of
 * those three files goes through it. A plain file (an older Conch, a file a
 * backup just restored) is read as it is and sealed the moment it's read.
 *
 * Your key for signing skills (`skills.signing.json`, ADR 0047) is sealed
 * the same way, but opened by `SkillTrust` itself: a key that won't open
 * fails closed instead of going back to a default, as `readStore` would.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';

/** The files that hold keys Conch itself uses. */
export const SEALED_FILES = new Set([
  'secrets.json',
  'codex.secrets.json',
  'integrations.secrets.json',
  'google.secrets.json',
  'slack.secrets.json',
  // A cloud browser's key, or a browser address with its token (ADR 0080).
  'browser.secrets.json',
  'channels.secrets.json',
  'whatsapp.secrets.json',
  'push.secrets.json',
  'routines.secrets.json',
  'skills.signing.json',
  // The keys your Conch apps use (ADR 0061).
  'conch-apps.secrets.json',
]);

const MAGIC = 'conch-sealed';

export interface Sealer {
  seal(name: string, plain: Buffer): Promise<string>;
  open(name: string, text: string): Promise<Buffer>;
}

const sealers = new Map<string, Sealer>();

/** Seal this home's key files from now on. */
export function registerSealer(home: string, sealer: Sealer): void {
  sealers.set(resolve(home), sealer);
}

export function unregisterSealer(home: string): void {
  sealers.delete(resolve(home));
}

/** The sealer for a path, if it's one of the key files of a registered home. */
export function sealerFor(path: string): Sealer | undefined {
  if (!SEALED_FILES.has(basename(path))) return undefined;
  return sealers.get(resolve(dirname(path)));
}

export function isSealed(text: string): boolean {
  return text.trimStart().startsWith(`{"${MAGIC}"`);
}

export class SealedError extends Error {}

/**
 * The file is fine, but the key that opens it can't be had right now: the
 * keychain or DPAPI didn't answer, or this home's sealer isn't registered yet.
 * Never a reason to treat the file as damaged; try again later.
 */
export class KeyUnavailableError extends Error {}

/**
 * A sealer from a device key: one subkey per file name (HKDF), the name as
 * associated data, a fresh nonce each write.
 */
export function deviceSealer(deviceKey: () => Promise<Buffer>): Sealer {
  const keyFor = async (name: string) =>
    Buffer.from(
      hkdfSync(
        'sha256',
        await deviceKey(),
        Buffer.alloc(0),
        Buffer.from(`conch-system/1 ${name}`),
        32,
      ),
    );
  return {
    async seal(name, plain) {
      const key = await keyFor(name);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(name));
      const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      key.fill(0);
      return `${JSON.stringify({ [MAGIC]: 1, n: nonce.toString('base64url'), c: body.toString('base64url') })}\n`;
    },
    async open(name, text) {
      let parsed: { n?: unknown; c?: unknown };
      try {
        parsed = JSON.parse(text) as { n?: unknown; c?: unknown };
      } catch {
        throw new SealedError('damaged');
      }
      if (typeof parsed.n !== 'string' || typeof parsed.c !== 'string')
        throw new SealedError('damaged');
      let key: Buffer;
      try {
        key = await keyFor(name);
      } catch (error) {
        throw new KeyUnavailableError('This computer’s key for your saved keys couldn’t be had.', {
          cause: error,
        });
      }
      try {
        const body = Buffer.from(parsed.c, 'base64url');
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.n, 'base64url'));
        decipher.setAAD(Buffer.from(name));
        decipher.setAuthTag(body.subarray(body.length - 16));
        return Buffer.concat([
          decipher.update(body.subarray(0, body.length - 16)),
          decipher.final(),
        ]);
      } catch {
        throw new SealedError(
          'These keys were sealed on another computer, or the file was changed.',
        );
      } finally {
        key.fill(0);
      }
    },
  };
}

/** A key file's text as stored, or its plain JSON when it's sealed. */
export async function openIfSealed(
  path: string,
  bytes: Buffer,
): Promise<{ plain: Buffer; wasPlain: boolean }> {
  const text = bytes.toString('utf8');
  if (!isSealed(text)) return { plain: bytes, wasPlain: true };
  const sealer = sealerFor(path) ?? sealers.get(resolve(dirname(path)));
  if (!sealer)
    throw new KeyUnavailableError('These keys are sealed, and nothing here can open them yet.');
  return { plain: await sealer.open(basename(path), text), wasPlain: false };
}
