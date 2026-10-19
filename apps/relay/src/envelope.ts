/**
 * The relay's envelope (ADR 0140): what the relay stores is sealed to a key
 * only the gateway holds, so the relay keeps ciphertext and nothing it can read.
 *
 * It is HPKE, RFC 9180, base mode, single shot: DHKEM(X25519, HKDF-SHA256),
 * HKDF-SHA256 and AES-256-GCM (ids 0x0020, 0x0001, 0x0002). Neither
 * `node:crypto` nor WebCrypto offers HPKE itself, so this file composes it from
 * WebCrypto's own X25519, HMAC and AES-GCM exactly as the RFC writes it, and
 * `envelope.test.ts` holds it to the RFC's published test vector (A.1.1, which
 * uses AES-128-GCM: the AEAD is the only part that differs). Nothing here is a
 * new primitive; it is the standard construction with standard parts.
 *
 * Each delivery gets its own ephemeral key, thrown away once it's sealed: the
 * relay can't open what it stored even a second later.
 *
 * Self-contained on purpose (no imports): the relay runs it on Cloudflare
 * Workers and on Node as it is, and the gateway imports it to open.
 */

/** The AEADs HPKE names: 1 is AES-128-GCM (the RFC's vector), 2 is AES-256-GCM (what Conch uses). */
export type Aead = 1 | 2;

const KEM_ID = 0x0020;
const KDF_ID = 0x0001;
const NH = 32;
const NN = 12;
/** A PKCS #8 X25519 private key is this prefix and the 32-byte scalar (RFC 8410). */
const PKCS8_X25519 = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

const text = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
/** A WebCrypto key, named the same in Node's types and the DOM's. */
type Key = Awaited<ReturnType<ReturnType<typeof subtle>['importKey']>>;

/** A copy backed by a plain ArrayBuffer, which every WebCrypto accepts. */
const own = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
};

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const i2osp = (value: number, length: number) => {
  const out = new Uint8Array(length);
  for (let i = length - 1, v = value; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
};

// ── HKDF (RFC 5869) over WebCrypto's HMAC ─────────────────────────────────

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey(
    'raw',
    own(key.length ? key : new Uint8Array(NH)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle().sign('HMAC', k, own(data)));
}

const extract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);

async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  let t: Uint8Array = new Uint8Array(0);
  for (let i = 1; out.reduce((n, p) => n + p.length, 0) < length; i++) {
    t = await hmac(prk, concat(t, info, Uint8Array.of(i)));
    out.push(t);
  }
  return concat(...out).slice(0, length);
}

const labeledExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) =>
  extract(salt, concat(text.encode('HPKE-v1'), suite, text.encode(label), ikm));

const labeledExpand = (
  suite: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) =>
  expand(
    prk,
    concat(i2osp(length, 2), text.encode('HPKE-v1'), suite, text.encode(label), info),
    length,
  );

// ── X25519 ─────────────────────────────────────────────────────────────────

const X25519 = { name: 'X25519' } as const;

function importPrivate(raw: Uint8Array) {
  if (raw.length !== 32) throw new Error('An X25519 private key is 32 bytes.');
  return subtle().importKey('pkcs8', concat(PKCS8_X25519, raw), X25519, true, ['deriveBits']);
}

function importPublic(raw: Uint8Array) {
  if (raw.length !== 32) throw new Error('An X25519 public key is 32 bytes.');
  return subtle().importKey('raw', own(raw), X25519, true, []);
}

async function dh(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  const bits = await subtle().deriveBits(
    { name: 'X25519', public: await importPublic(publicKey) },
    await importPrivate(privateKey),
    256,
  );
  const out = new Uint8Array(bits);
  // RFC 9180 § 7.1.4: an all-zero shared secret (a small-order point) is refused.
  if (out.every((b) => b === 0)) throw new Error('That public key isn’t usable.');
  return out;
}

export interface KeyPair {
  /** 32 bytes. */
  publicKey: Uint8Array;
  /** 32 bytes. Never leaves the gateway. */
  privateKey: Uint8Array;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await subtle().generateKey(X25519, true, ['deriveBits'])) as { privateKey: Key };
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  if (!jwk.d || !jwk.x) throw new Error('This runtime can’t export an X25519 key.');
  return { publicKey: b64url.decode(jwk.x), privateKey: b64url.decode(jwk.d) };
}

/** The public key that goes with a private one. */
export async function publicKeyOf(privateKey: Uint8Array): Promise<Uint8Array> {
  const jwk = await subtle().exportKey('jwk', await importPrivate(privateKey));
  if (!jwk.x) throw new Error('This runtime can’t export an X25519 key.');
  return b64url.decode(jwk.x);
}

// ── HPKE base mode ─────────────────────────────────────────────────────────

const kemSuite = concat(text.encode('KEM'), i2osp(KEM_ID, 2));
const hpkeSuite = (aead: Aead) =>
  concat(text.encode('HPKE'), i2osp(KEM_ID, 2), i2osp(KDF_ID, 2), i2osp(aead, 2));

async function sharedSecret(dhValue: Uint8Array, enc: Uint8Array, pkR: Uint8Array) {
  const prk = await labeledExtract(kemSuite, new Uint8Array(0), 'eae_prk', dhValue);
  return labeledExpand(kemSuite, prk, 'shared_secret', concat(enc, pkR), NH);
}

async function keySchedule(shared: Uint8Array, info: Uint8Array, aead: Aead) {
  const suite = hpkeSuite(aead);
  const empty = new Uint8Array(0);
  const pskIdHash = await labeledExtract(suite, empty, 'psk_id_hash', empty);
  const infoHash = await labeledExtract(suite, empty, 'info_hash', info);
  const context = concat(Uint8Array.of(0), pskIdHash, infoHash);
  const secret = await labeledExtract(suite, shared, 'secret', empty);
  const nk = aead === 1 ? 16 : 32;
  return {
    key: await labeledExpand(suite, secret, 'key', context, nk),
    nonce: await labeledExpand(suite, secret, 'base_nonce', context, NN),
  };
}

const gcm = (key: Uint8Array, usage: 'encrypt' | 'decrypt') =>
  subtle().importKey('raw', own(key), { name: 'AES-GCM' }, false, [usage]);

export interface SealOptions {
  info: Uint8Array;
  aad: Uint8Array;
  aead?: Aead;
  /** Tests only: the RFC's ephemeral key, so its vector can be checked. */
  ephemeral?: KeyPair;
}

export interface Sealed {
  /** The ephemeral public key (HPKE's `enc`). */
  enc: Uint8Array;
  ct: Uint8Array;
}

/** Seal `plaintext` to `publicKey`: only the matching private key opens it. */
export async function seal(
  publicKey: Uint8Array,
  plaintext: Uint8Array,
  options: SealOptions,
): Promise<Sealed> {
  const aead = options.aead ?? 2;
  const ephemeral = options.ephemeral ?? (await generateKeyPair());
  const enc = ephemeral.publicKey;
  const shared = await sharedSecret(await dh(ephemeral.privateKey, publicKey), enc, publicKey);
  const { key, nonce } = await keySchedule(shared, options.info, aead);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: own(nonce), additionalData: own(options.aad) },
    await gcm(key, 'encrypt'),
    own(plaintext),
  );
  return { enc, ct: new Uint8Array(ct) };
}

/** Open what `seal` made. Throws when the key, the `aad` or a single byte is wrong. */
export async function open(
  privateKey: Uint8Array,
  sealed: Sealed,
  options: Omit<SealOptions, 'ephemeral'>,
): Promise<Uint8Array> {
  const aead = options.aead ?? 2;
  const pkR = await publicKeyOf(privateKey);
  const shared = await sharedSecret(await dh(privateKey, sealed.enc), sealed.enc, pkR);
  const { key, nonce } = await keySchedule(shared, options.info, aead);
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: own(nonce), additionalData: own(options.aad) },
    await gcm(key, 'decrypt'),
    own(sealed.ct),
  );
  return new Uint8Array(pt);
}

// ── What the relay and the gateway agree on ────────────────────────────────

/** HPKE's `info` for every delivery: binds the ciphertext to this use. */
export const RELAY_INFO = text.encode('conch-relay/1 delivery');

/** HPKE's `aad`: the delivery's id and time, which the relay keeps beside it in the clear. */
export const relayAad = (id: string, receivedAt: number) =>
  text.encode(`conch-relay/1|${id}|${receivedAt}`);

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', own(bytes)));
}

/** A short, public name for a key, so both ends can say they hold the same one. */
export async function keyId(publicKey: Uint8Array): Promise<string> {
  return b64url.encode(
    (await sha256(concat(text.encode('conch-relay key '), publicKey))).slice(0, 12),
  );
}

/** The relay knows a hook only by this: SHA-256 of its id. */
export async function hookTag(hookId: string): Promise<string> {
  return b64url.encode(await sha256(text.encode(`conch-relay hook ${hookId}`)));
}

/** Compare two byte strings without stopping at the first difference. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export const b64url = {
  encode(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(value: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Not base64url.');
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  },
};

// ── The setup code ─────────────────────────────────────────────────────────

/**
 * What a relay is deployed with: the gateway's public key and the SHA-256 of
 * the token the gateway will present. Neither is a secret, so the code can sit
 * in a command, a dashboard field or an environment variable.
 */
export interface RelaySetup {
  publicKey: Uint8Array;
  tokenHash: Uint8Array;
}

const SETUP_PREFIX = 'conch-relay-1.';

export function setupCode(setup: RelaySetup): string {
  return `${SETUP_PREFIX}${b64url.encode(setup.publicKey)}.${b64url.encode(setup.tokenHash)}`;
}

export function parseSetupCode(code: string): RelaySetup {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SETUP_PREFIX)) throw new Error('That isn’t a Conch relay setup code.');
  const [pk, th, ...rest] = trimmed.slice(SETUP_PREFIX.length).split('.');
  const publicKey = b64url.decode(pk ?? '');
  const tokenHash = b64url.decode(th ?? '');
  if (rest.length || publicKey.length !== 32 || tokenHash.length !== 32)
    throw new Error('That Conch relay setup code is incomplete.');
  return { publicKey, tokenHash };
}
