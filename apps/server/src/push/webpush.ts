/**
 * Web Push, as the standards write it (ADR 0027), on `node:crypto` alone:
 *
 * - RFC 8291 — Message Encryption for Web Push: the payload is encrypted to
 *   the browser's own key (ECDH P-256 + HKDF-SHA-256 + AES-128-GCM,
 *   `aes128gcm` content coding, RFC 8188). The push service (Apple, Google,
 *   Mozilla, Microsoft) carries bytes it can't read.
 * - RFC 8292 — VAPID: each request is signed (ES256 JWT) with this Conch's
 *   own key, so a subscription only accepts pushes from the Conch that made it.
 *
 * Nothing here is new cryptography: it composes the primitives exactly as the
 * RFCs specify, and the tests check the RFC 8291 §5 example byte for byte.
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64u = (text: string) => Buffer.from(text, 'base64url');

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url: the browser's `applicationServerKey`. */
  publicKey: string;
  /** PKCS#8 DER, base64url. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), fromB64u(jwk.x ?? ''), fromB64u(jwk.y ?? '')]);
  return {
    publicKey: b64u(point),
    privateKey: b64u(privateKey.export({ format: 'der', type: 'pkcs8' })),
  };
}

/**
 * The push services browsers use. A subscription's endpoint is a URL the
 * browser hands over, so anything else is refused: Conch must never be made
 * to send requests to an address of someone's choosing (SSRF).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function allowedEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (url.port === '' || url.port === '443') &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

/** The `Authorization` header for one push service (RFC 8292 §2–3). */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  options: { subject: string; now?: number; ttlSeconds?: number },
): string {
  const audience = new URL(endpoint).origin;
  const exp = Math.floor((options.now ?? Date.now()) / 1000) + (options.ttlSeconds ?? 12 * 3600);
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: audience, exp, sub: options.subject })));
  const key = createPrivateKey({ key: fromB64u(keys.privateKey), format: 'der', type: 'pkcs8' });
  // JWS wants the raw r‖s signature, not DER.
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** For tests: the sender's key pair and salt are random otherwise. */
export interface EncryptOverrides {
  senderPrivate?: Buffer;
  salt?: Buffer;
}

/**
 * Encrypt `plaintext` for one browser (RFC 8291 §3–4, one record): the body
 * to POST, with `Content-Encoding: aes128gcm`.
 */
export function encrypt(
  plaintext: Uint8Array,
  subscriber: { p256dh: string; auth: string },
  overrides: EncryptOverrides = {},
): Buffer {
  const uaPublic = fromB64u(subscriber.p256dh);
  const authSecret = fromB64u(subscriber.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('Not a P-256 public key.');
  if (authSecret.length !== 16) throw new Error('The auth secret must be 16 bytes.');

  const ecdh = createECDH('prime256v1');
  if (overrides.senderPrivate) ecdh.setPrivateKey(overrides.senderPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

  const salt = overrides.salt ?? randomBytes(16);
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  );

  // One record: the plaintext, then the 0x02 delimiter of the last record.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // Header: salt ‖ record size (uint32) ‖ key id length ‖ key id (the sender's public key).
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

export type PushOutcome =
  | { kind: 'sent' }
  /** The browser unsubscribed, or the subscription expired: forget it. */
  | { kind: 'gone' }
  /** Try again later (the service is busy or down). */
  | { kind: 'retry'; afterMs: number }
  | { kind: 'failed'; message: string };

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Send one push. Never throws: what happened comes back as an outcome. */
export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapid: VapidKeys;
    subject: string;
    ttlSeconds?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    /** Replaces an earlier push with the same topic that hasn't been delivered yet. */
    topic?: string;
    fetch?: Fetcher;
  },
): Promise<PushOutcome> {
  if (!allowedEndpoint(subscription.endpoint))
    return { kind: 'failed', message: 'That isn’t a push service Conch knows.' };
  let body: Buffer;
  try {
    body = encrypt(Buffer.from(payload), subscription.keys);
  } catch (error) {
    return { kind: 'failed', message: (error as Error).message };
  }
  const headers: Record<string, string> = {
    authorization: vapidAuthorization(subscription.endpoint, options.vapid, {
      subject: options.subject,
    }),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: String(options.ttlSeconds ?? 3600),
    urgency: options.urgency ?? 'normal',
  };
  // Topics are at most 32 base64url characters (RFC 8030 §5.4).
  if (options.topic) headers.topic = options.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const response = await (options.fetch ?? fetch)(subscription.endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { kind: 'sent' };
    if (response.status === 404 || response.status === 410) return { kind: 'gone' };
    if (response.status === 429 || response.status >= 500) {
      const after = Number(response.headers.get('retry-after'));
      return {
        kind: 'retry',
        afterMs: Number.isFinite(after) && after > 0 ? after * 1000 : 30_000,
      };
    }
    const text = (await response.text().catch(() => '')).slice(0, 200);
    return {
      kind: 'failed',
      message: `The push service said ${response.status}${text ? `: ${text}` : ''}.`,
    };
  } catch (error) {
    void error;
    return { kind: 'retry', afterMs: 30_000 };
  }
}

/** A key from its stored form, to check it's well formed. */
export function vapidKeysValid(keys: VapidKeys): boolean {
  try {
    const priv: KeyObject = createPrivateKey({
      key: fromB64u(keys.privateKey),
      format: 'der',
      type: 'pkcs8',
    });
    const jwk = createPublicKey(priv).export({ format: 'jwk' });
    const point = Buffer.concat([
      Buffer.from([0x04]),
      fromB64u(jwk.x ?? ''),
      fromB64u(jwk.y ?? ''),
    ]);
    return b64u(point) === keys.publicKey;
  } catch {
    return false;
  }
}
