/**
 * Passkeys (ADR 0025 § Passkeys): WebAuthn credentials kept with a login,
 * in the shapes they arrive in (a Bitwarden export, Conch's own browser) and
 * the one Chrome's virtual authenticator takes.
 *
 * A key is only kept if it really is an ES256 (P-256) PKCS#8 private key:
 * anything else in a file is left out rather than stored as something it
 * isn't.
 */
import { createPrivateKey } from 'node:crypto';

import { VaultPasskey } from '@conch/protocol';

import { newId } from '../lib/ids';

/** What a passkey is before it's in the vault. */
export interface PasskeyInput {
  /** base64url. */
  credentialId: string;
  rpId: string;
  /** base64url. */
  userHandle?: string;
  userName?: string;
  /** PKCS#8 DER, base64url. */
  privateKey: string;
  signCount?: number;
}

/** Chrome DevTools Protocol `WebAuthn.Credential` (binary fields are standard base64). */
export interface CdpCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
  userName?: string;
}

const toUrl = (b64: string) => Buffer.from(b64, 'base64').toString('base64url');
const fromUrl = (b64url: string) => Buffer.from(b64url, 'base64url').toString('base64');

/** Whether it's a P-256 private key in PKCS#8: the only kind passkeys use here. */
export function isEs256Key(privateKey: string): boolean {
  try {
    const key = createPrivateKey({
      key: Buffer.from(privateKey, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

/** A passkey ready for the vault, or undefined if it isn't one Conch can use. */
export function toPasskey(input: PasskeyInput, now = Date.now()): VaultPasskey | undefined {
  if (!isEs256Key(input.privateKey)) return undefined;
  const parsed = VaultPasskey.safeParse({
    id: newId('pk'),
    credentialId: input.credentialId,
    rpId: input.rpId,
    ...(input.userHandle && { userHandle: input.userHandle }),
    ...(input.userName && { userName: input.userName.slice(0, 200) }),
    privateKey: input.privateKey,
    signCount: Math.max(0, Math.floor(input.signCount ?? 0)),
    createdAt: now,
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Bitwarden's credential ids are GUIDs (the 16 bytes, written out), or
 * `b64.` and base64 for any other length (its `guidToRawFormat`).
 */
function bitwardenCredentialId(id: string): string | undefined {
  if (id.startsWith('b64.')) return toUrl(id.slice(4));
  const hex = id.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(hex)) return Buffer.from(hex, 'hex').toString('base64url');
  // Imported from elsewhere: already the id, base64url.
  if (/^[A-Za-z0-9_-]{16,}$/.test(id)) return id;
  return undefined;
}

/** One entry of a Bitwarden export's `login.fido2Credentials`. */
export interface BitwardenFido2 {
  credentialId?: string | null;
  keyType?: string | null;
  keyAlgorithm?: string | null;
  keyCurve?: string | null;
  keyValue?: string | null;
  rpId?: string | null;
  userHandle?: string | null;
  userName?: string | null;
  counter?: string | number | null;
}

export function fromBitwarden(entry: BitwardenFido2): PasskeyInput | undefined {
  if (entry.keyAlgorithm && entry.keyAlgorithm !== 'ECDSA') return undefined;
  if (entry.keyCurve && entry.keyCurve !== 'P-256') return undefined;
  const credentialId = entry.credentialId ? bitwardenCredentialId(entry.credentialId) : undefined;
  if (!credentialId || !entry.keyValue || !entry.rpId) return undefined;
  // Exports write the key base64url; older ones plain base64.
  const privateKey = Buffer.from(
    entry.keyValue,
    /[+/=]/.test(entry.keyValue) ? 'base64' : 'base64url',
  ).toString('base64url');
  return {
    credentialId,
    rpId: entry.rpId,
    ...(entry.userHandle && {
      userHandle: Buffer.from(
        entry.userHandle,
        /[+/=]/.test(entry.userHandle) ? 'base64' : 'base64url',
      ).toString('base64url'),
    }),
    ...(entry.userName && { userName: entry.userName }),
    privateKey,
    signCount: Number(entry.counter ?? 0) || 0,
  };
}

/** A passkey Conch's browser just made for a site. */
export function fromCdp(credential: CdpCredential): PasskeyInput | undefined {
  if (!credential.rpId || !credential.privateKey) return undefined;
  return {
    credentialId: toUrl(credential.credentialId),
    rpId: credential.rpId,
    ...(credential.userHandle && { userHandle: toUrl(credential.userHandle) }),
    ...(credential.userName && { userName: credential.userName }),
    privateKey: toUrl(credential.privateKey),
    signCount: credential.signCount,
  };
}

/** The passkey as Chrome's virtual authenticator takes it, for one sign-in. */
export function toCdp(passkey: VaultPasskey): CdpCredential {
  return {
    credentialId: fromUrl(passkey.credentialId),
    isResidentCredential: true,
    rpId: passkey.rpId,
    privateKey: fromUrl(passkey.privateKey),
    ...(passkey.userHandle && { userHandle: fromUrl(passkey.userHandle) }),
    signCount: passkey.signCount,
  };
}

/** The credential id as CDP reports it, in the vault's form. */
export const cdpIdToVault = toUrl;
