/**
 * WeChat's message signatures and encryption (ADR 0045), as Tencent's own
 * `WXBizMsgCrypt` samples do them, with `node:crypto` only:
 *
 * - **Signature**: SHA-1 of the token, timestamp and nonce (and, for an
 *   encrypted message, the ciphertext), sorted and joined. Compared in
 *   constant time.
 * - **Encryption** ("safe mode"): AES-256-CBC. The key is the 43-character
 *   EncodingAESKey plus `=`, read as base64 (32 bytes); the IV is its first
 *   16 bytes. The plaintext is 16 random bytes, the message length (4 bytes,
 *   big-endian), the message, then the AppID, padded PKCS#7 to a multiple of
 *   32 (not 16). The AppID inside must be this account's.
 * - **XML**: the flat `<xml><Tag><![CDATA[…]]></Tag>…</xml>` WeChat sends.
 *   Read with a small parser of our own that understands only that: no
 *   DOCTYPE, no entities beyond the five predefined ones, so nothing can
 *   expand or reach outside (XXE).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export class WeChatCryptoError extends Error {}

/**
 * WeChat requires `sha1(sort([token, timestamp, nonce, ...more]).join(''))`.
 * This is a wire-protocol compatibility requirement, never a choice for new
 * cryptography; changing it breaks verification of Tencent's signed callbacks.
 */
export function signature(
  token: string,
  timestamp: string,
  nonce: string,
  ...more: string[]
): string {
  return createHash('sha1')
    .update([token, timestamp, nonce, ...more].sort().join(''))
    .digest('hex');
}

/** Whether `given` is the signature of these values (constant time). */
export function signed(
  given: string | undefined,
  token: string,
  timestamp: string,
  nonce: string,
  ...more: string[]
): boolean {
  if (!given || !/^[0-9a-f]{40}$/i.test(given)) return false;
  const expected = Buffer.from(signature(token, timestamp, nonce, ...more), 'hex');
  return timingSafeEqual(expected, Buffer.from(given.toLowerCase(), 'hex'));
}

/** The 32-byte key from a 43-character EncodingAESKey. */
export function aesKeyOf(encodingAesKey: string): Buffer {
  if (!/^[A-Za-z0-9]{43}$/.test(encodingAesKey))
    throw new WeChatCryptoError('An EncodingAESKey is 43 letters and digits.');
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (key.length !== 32) throw new WeChatCryptoError('That EncodingAESKey doesn’t make a key.');
  return key;
}

/** A new EncodingAESKey: 43 characters of letters and digits, as WeChat's own "random" button makes. */
export function newAesKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 43 characters drawn without bias from 62 (bytes ≥ 248 are thrown away).
  let out = '';
  while (out.length < 43)
    for (const byte of randomBytes(64))
      if (byte < 248 && out.length < 43) out += alphabet[byte % 62];
  // The last character must leave the final base64 sextet's low bits at zero, or `=` won't decode cleanly.
  return out.slice(0, 42) + ('AQgw'[(randomBytes(1)[0] ?? 0) % 4] ?? 'A');
}

/** A new Token for the server settings (WeChat allows 3–32 letters and digits). */
export function newToken(): string {
  return randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, 32);
}

/** Decrypt an `Encrypt` value; `appId` must be the one inside. */
export function decrypt(encrypted: string, encodingAesKey: string, appId: string): string {
  const key = aesKeyOf(encodingAesKey);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    plain = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  } catch {
    throw new WeChatCryptoError('Couldn’t decrypt.');
  }
  const pad = plain.at(-1) ?? 0;
  if (pad < 1 || pad > 32 || pad > plain.length) throw new WeChatCryptoError('Bad padding.');
  for (let i = plain.length - pad; i < plain.length; i++)
    if (plain[i] !== pad) throw new WeChatCryptoError('Bad padding.');
  const body = plain.subarray(0, plain.length - pad);
  if (body.length < 20) throw new WeChatCryptoError('Too short.');
  const length = body.readUInt32BE(16);
  if (20 + length > body.length) throw new WeChatCryptoError('Bad length.');
  const message = body.subarray(20, 20 + length).toString('utf8');
  const from = body.subarray(20 + length).toString('utf8');
  if (from !== appId) throw new WeChatCryptoError('Not for this account.');
  return message;
}

/** Encrypt a reply for `appId` (the random prefix is fresh each time). */
export function encrypt(
  message: string,
  encodingAesKey: string,
  appId: string,
  random = randomBytes(16),
): string {
  const key = aesKeyOf(encodingAesKey);
  const text = Buffer.from(message, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(text.length);
  const body = Buffer.concat([random, length, text, Buffer.from(appId, 'utf8')]);
  const pad = 32 - (body.length % 32);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(Buffer.concat([body, Buffer.alloc(pad, pad)])),
    cipher.final(),
  ]).toString('base64');
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * The children of WeChat's `<xml>` element, as text (nested elements are
 * kept as their raw inner XML). Anything else (a DOCTYPE, an entity, more
 * than 64 KiB) is refused.
 */
export function parseXml(xml: string): Record<string, string> {
  if (xml.length > 64 * 1024) throw new WeChatCryptoError('Too big.');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))
    throw new WeChatCryptoError('Not accepted.');
  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?<xml>([\s\S]*)<\/xml>\s*$/.exec(xml);
  if (!root) throw new WeChatCryptoError('Not WeChat XML.');
  const out: Record<string, string> = {};
  const inner = root[1] ?? '';
  // Read element by element, stepping over CDATA whole: what a person wrote can
  // hold `</Content><FromUserName>…`, and must never become a field of its own.
  let at = 0;
  while (at < inner.length) {
    const open = /<([A-Za-z_][\w.-]*)>/y;
    open.lastIndex = inner.indexOf('<', at);
    if (open.lastIndex < 0) break;
    const tag = open.exec(inner);
    if (!tag) throw new WeChatCryptoError('Not WeChat XML.');
    const name = tag[1] ?? '';
    const start = open.lastIndex;
    let depth = 1;
    let i = start;
    let end = -1;
    while (i < inner.length) {
      if (inner.startsWith('<![CDATA[', i)) {
        const close = inner.indexOf(']]>', i + 9);
        if (close < 0) throw new WeChatCryptoError('Not WeChat XML.');
        i = close + 3;
      } else if (inner.startsWith(`</${name}>`, i)) {
        if (--depth === 0) {
          end = i;
          break;
        }
        i += name.length + 3;
      } else if (inner.startsWith(`<${name}>`, i)) {
        depth++;
        i += name.length + 2;
      } else i++;
    }
    if (end < 0) throw new WeChatCryptoError('Not WeChat XML.');
    const value = inner.slice(start, end);
    at = end + name.length + 3;
    // The first of a name is the one WeChat wrote.
    if (name in out) continue;
    // One CDATA section, or several back to back (how `]]>` itself is written).
    const cdata = readCdata(value);
    out[name] =
      cdata !== undefined
        ? cdata
        : value.includes('<')
          ? value
          : value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
              e[0] === '#'
                ? String.fromCodePoint(
                    e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
                  )
                : (ENTITIES[e.toLowerCase()] ?? ''),
            );
  }
  return out;
}

/** Read adjacent CDATA sections once each, including near-misses, without backtracking. */
function readCdata(value: string): string | undefined {
  const parts: string[] = [];
  let at = 0;
  while (at < value.length) {
    while (at < value.length && /\s/.test(value[at] ?? '')) at++;
    if (at === value.length) break;
    if (!value.startsWith('<![CDATA[', at)) return undefined;
    const end = value.indexOf(']]>', at + 9);
    if (end < 0) return undefined;
    parts.push(value.slice(at + 9, end));
    at = end + 3;
  }
  return parts.length ? parts.join('') : undefined;
}

/** WeChat's XML for a reply: every value in CDATA (with `]]>` split so it can't close early). */
export function buildXml(fields: Record<string, string | number>): string {
  const cdata = (v: string) => `<![CDATA[${v.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
  return `<xml>${Object.entries(fields)
    .map(([k, v]) => `<${k}>${typeof v === 'number' ? v : cdata(v)}</${k}>`)
    .join('')}</xml>`;
}
