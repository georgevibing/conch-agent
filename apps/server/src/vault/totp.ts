/**
 * One-time codes (RFC 6238 TOTP over RFC 4226 HOTP), from a secret pasted as
 * base32 or an `otpauth://totp/…` link (Google Authenticator's Key URI
 * Format). Bounds are strict: SHA-1/256/512, 6–8 digits, 15–120 second
 * periods, at least 80 bits of secret.
 */
import { createHmac } from 'node:crypto';

export interface TotpConfig {
  secret: Buffer;
  algorithm: 'sha1' | 'sha256' | 'sha512';
  digits: number;
  period: number;
  issuer?: string;
  account?: string;
}

export class TotpError extends Error {}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new TotpError('That code key isn’t valid base32.');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const MAX_URI = 2048;

/**
 * What a person pasted as a one-time code setup: an `otpauth://` link, or the
 * secret on its own (with or without spaces). Throws `TotpError` in words.
 */
export function parseTotp(input: string): TotpConfig {
  const text = input.trim();
  if (text.length > MAX_URI) throw new TotpError('That code setup is too long.');
  let config: TotpConfig;
  if (/^otpauth:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new TotpError('That otpauth link isn’t valid.');
    }
    if (url.hostname.toLowerCase() !== 'totp')
      throw new TotpError('Only time-based codes (TOTP) are supported, not counter-based ones.');
    const params = url.searchParams;
    const secret = params.get('secret');
    if (!secret) throw new TotpError('That link has no secret in it.');
    const algorithm = (params.get('algorithm') ?? 'SHA1').toLowerCase();
    if (algorithm !== 'sha1' && algorithm !== 'sha256' && algorithm !== 'sha512')
      throw new TotpError('That code uses an algorithm Conch doesn’t know.');
    const digits = Number(params.get('digits') ?? 6);
    const period = Number(params.get('period') ?? 30);
    const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const [prefix, account] = label.includes(':') ? label.split(/:(.*)/s) : [undefined, label];
    config = {
      secret: base32Decode(secret),
      algorithm,
      digits,
      period,
      issuer: params.get('issuer') ?? prefix?.trim() ?? undefined,
      account: account?.trim() || undefined,
    };
  } else {
    config = { secret: base32Decode(text), algorithm: 'sha1', digits: 6, period: 30 };
  }
  if (!Number.isInteger(config.digits) || config.digits < 6 || config.digits > 8)
    throw new TotpError('Codes must be 6 to 8 digits.');
  if (!Number.isInteger(config.period) || config.period < 15 || config.period > 120)
    throw new TotpError('Codes must last between 15 and 120 seconds.');
  if (config.secret.length < 10)
    throw new TotpError('That code key is too short to be safe (it needs at least 16 characters).');
  return config;
}

/** RFC 4226 §5.3 dynamic truncation. */
export function hotp(
  secret: Buffer,
  counter: number,
  digits = 6,
  algorithm: TotpConfig['algorithm'] = 'sha1',
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code right now, and when it stops working. */
export function totpNow(
  config: TotpConfig,
  now = Date.now(),
): { code: string; period: number; expiresAt: number } {
  const step = Math.floor(now / 1000 / config.period);
  return {
    code: hotp(config.secret, step, config.digits, config.algorithm),
    period: config.period,
    expiresAt: (step + 1) * config.period * 1000,
  };
}

/** Whether what was pasted can make codes. */
export function isValidTotp(input: string): boolean {
  try {
    parseTotp(input);
    return true;
  } catch {
    return false;
  }
}
