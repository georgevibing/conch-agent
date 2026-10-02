/**
 * People on iMessage and email are known by an address (a phone number, an
 * Apple ID, an email address); Conch's ids are letters, digits, `_` and `-`.
 */
import { createHash } from 'node:crypto';

/**
 * An address (an email, a phone number) as a Conch id (`Id`: letters, digits,
 * `_` and `-`). Reversible, so a reply can find its way back without a table;
 * an address too long for that gets a hash, and the address travels in the
 * person's `username`.
 */
export function handleId(prefix: 'm' | 'i', handle: string): string {
  const encoded = Buffer.from(normalHandle(handle)).toString('base64url');
  if (encoded.length <= 120) return `${prefix}${encoded}`;
  return `${prefix}h${createHash('sha256').update(normalHandle(handle)).digest('hex').slice(0, 40)}`;
}

/** The address behind `handleId`, or undefined for a hashed one. */
export function handleOf(id: string): string | undefined {
  if (!/^[mi][A-Za-z0-9_-]+$/.test(id) || /^[mi]h[0-9a-f]{40}$/.test(id)) return undefined;
  const decoded = Buffer.from(id.slice(1), 'base64url').toString('utf8');
  return decoded && handleId(id[0] as 'm' | 'i', decoded) === id ? decoded : undefined;
}

/** Emails compare without case; phone numbers without spaces, dashes or brackets. */
export function normalHandle(handle: string): string {
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return trimmed.replace(/[\s().-]/g, '');
}
