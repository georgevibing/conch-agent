/**
 * Access — who may open Conch, and how they prove it.
 *
 * Conch can run commands on the host as the user, so the gateway is treated
 * like an SSH server. The owner picks one way to sign in:
 *
 * - `none`     — only this computer (loopback) may connect; every other
 *                request is refused until sign-in is set up.
 * - `password` — a username and password (NIST SP 800-63B-4 rules below).
 * - `key`      — one or more long random access keys, revocable per device.
 *
 * The password policy and generator live here so the web app, the gateway and
 * the `pnpm conch` CLI all agree on what is acceptable.
 */
import { z } from 'zod';

// ── Wire schemas ────────────────────────────────────────────────────────────

export const AccessMethod = z.enum(['none', 'password', 'key']);
export type AccessMethod = z.infer<typeof AccessMethod>;

/** How far Conch listens: this computer only, or the network too. */
export const Exposure = z.enum(['local', 'network']);
export type Exposure = z.infer<typeof Exposure>;

/** Public: answered for everyone so the web app knows whether to ask for sign-in. */
export const AuthStatus = z.object({
  method: AccessMethod,
  /** This browser may use Conch (signed in, or a local request with sign-in off). */
  signedIn: z.boolean(),
  /** A remote request arrived but sign-in hasn't been set up on the host yet. */
  setupRequired: z.boolean(),
  /** The connection is encrypted (HTTPS), or it never leaves this computer. */
  secure: z.boolean(),
  /**
   * Who may sign in couldn't be read (a damaged `access.json`), so nobody
   * can until it's reset on the computer running Conch (`pnpm conch reset`).
   * Conch never guesses "no sign-in" instead: that would let anyone in.
   */
  locked: z.boolean().optional(),
});
export type AuthStatus = z.infer<typeof AuthStatus>;

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 256;
export const USERNAME_MAX = 64;

export const SignInBody = z.discriminatedUnion('with', [
  z.object({
    with: z.literal('password'),
    username: z.string().max(USERNAME_MAX),
    password: z.string().min(1).max(PASSWORD_MAX),
  }),
  z.object({ with: z.literal('key'), key: z.string().trim().min(1).max(512) }),
  z.object({ with: z.literal('pairing'), code: z.string().trim().min(1).max(512) }),
]);
export type SignInBody = z.infer<typeof SignInBody>;

/** Re-enter your password or key before a sensitive change ("sudo mode"). */
export const VerifyBody = z.object({ secret: z.string().min(1).max(512) });

export const SetPasswordBody = z.object({
  username: z.string().trim().min(1).max(USERNAME_MAX),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export type SetPasswordBody = z.infer<typeof SetPasswordBody>;

export const CreateKeyBody = z.object({ name: z.string().trim().min(1).max(40) });

export const AccessKeyInfo = z.object({
  id: z.string(),
  name: z.string(),
  /** Last four characters, so you can tell keys apart. */
  hint: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
});
export type AccessKeyInfo = z.infer<typeof AccessKeyInfo>;

/** Returned exactly once, when the key is created. */
export const CreatedKey = z.object({ key: z.string(), info: AccessKeyInfo });
export type CreatedKey = z.infer<typeof CreatedKey>;

export const SignInVia = z.enum(['password', 'key', 'pairing', 'setup']);
export type SignInVia = z.infer<typeof SignInVia>;

export const SessionInfo = z.object({
  id: z.string(),
  /** e.g. "Safari on iPhone". */
  device: z.string(),
  kind: z.enum(['desktop', 'phone', 'tablet', 'other']),
  via: SignInVia,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const CheckLevel = z.enum(['ok', 'info', 'warn', 'danger']);
export type CheckLevel = z.infer<typeof CheckLevel>;

/** One line of the security checkup. */
export const CheckupItem = z.object({
  id: z.string(),
  level: CheckLevel,
  title: z.string(),
  detail: z.string(),
  /** A terminal command that fixes it, if there is one. */
  command: z.string().optional(),
});
export type CheckupItem = z.infer<typeof CheckupItem>;

export const AccessSettings = z.object({
  method: AccessMethod,
  username: z.string().optional(),
  /** Your account name on this computer, to pre-fill the username. */
  suggestedUsername: z.string(),
  keys: z.array(AccessKeyInfo),
  sessions: z.array(SessionInfo),
  checkup: z.array(CheckupItem),
  exposure: Exposure,
  port: z.number(),
  /** Addresses other devices can use to reach this computer. */
  urls: z.array(z.string()),
  /** This computer's Tailscale address, when Tailscale is running. */
  tailscale: z.string().optional(),
  /** You confirmed your password or key in the last few minutes. */
  verified: z.boolean(),
});
export type AccessSettings = z.infer<typeof AccessSettings>;

/** A one-time link that signs a new device in. Put the code in the URL *fragment*. */
export const PairingCode = z.object({ code: z.string(), expiresAt: z.number() });
export type PairingCode = z.infer<typeof PairingCode>;

// ── Password policy (NIST SP 800-63B-4 §3.1.1.2) ─────────────────────────────
//
// Length over complexity: at least 15 characters, no composition rules, every
// character (including spaces and emoji) allowed, paste allowed, and the whole
// password checked against a blocklist of common and predictable choices.

/** Long passwords that still show up in breach corpora. Compared case-insensitively. */
const BLOCKLIST = new Set([
  'passwordpassword',
  'password1234567',
  'password12345678',
  'password123456789',
  '123456789012345',
  '1234567890123456',
  '12345678901234567890',
  'qwertyuiopasdfgh',
  'qwertyuiopasdfghjkl',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertyuiop123456',
  '1q2w3e4r5t6y7u8i',
  '1qaz2wsx3edc4rfv',
  'iloveyouiloveyou',
  'letmeinletmein1',
  'administrator123',
  'correcthorsebatterystaple',
  'thequickbrownfox',
  'thequickbrownfoxjumpsoverthelazydog',
  'welcometoconch123',
  'changemechangeme',
  'aaaaaaaaaaaaaaa',
  'abcdefghijklmnop',
  'abcdefghijklmnopqrstuvwxyz',
  'trustno1trustno1',
  'superman12345678',
  'baseball12345678',
  'football12345678',
  'monkey1234567890',
  'dragon1234567890',
  'sunshine12345678',
  'princess12345678',
]);

const KEYBOARD_ROWS = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'abcdefghijklmnopqrstuvwxyz',
];

export interface PasswordCheck {
  /** Meets the policy and may be saved. */
  ok: boolean;
  /** 0 = unusable … 4 = strong. */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Too easy to guess' | 'Okay' | 'Good' | 'Strong';
  /** The reason it was rejected, or a tip to make it stronger. */
  message: string;
}

const chars = (s: string) => Array.from(s);

/** Characters in `s` that add little: repeats and runs like "aaa", "abc", "321". */
function predictableCount(s: string): number {
  const cs = chars(s.toLowerCase());
  let count = 0;
  cs.forEach((c, i) => {
    const prev = cs[i - 1];
    if (prev === undefined) return;
    const gap = Math.abs((prev.codePointAt(0) ?? 0) - (c.codePointAt(0) ?? 0));
    if (gap <= 1 || KEYBOARD_ROWS.some((row) => row.includes(prev + c))) count++;
  });
  return count;
}

/** "abcabcabc…" — the whole thing is one short chunk repeated. */
function isRepetition(s: string): boolean {
  const lower = s.toLowerCase();
  for (let size = 1; size <= Math.min(8, lower.length / 2); size++) {
    if (
      lower
        .slice(0, size)
        .repeat(Math.ceil(lower.length / size))
        .startsWith(lower)
    )
      return true;
  }
  return false;
}

/** Rough guessing entropy in bits — a guide for the meter, not a guarantee. */
export function estimateBits(password: string): number {
  const cs = chars(password);
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
  if (pool === 0) return 0;
  const predictable = predictableCount(password);
  const effective = cs.length - predictable * 0.75;
  // Words are guessed as words: a lowercase-and-spaces passphrase is roughly
  // 11 bits per word (a 2,000-word vocabulary), whichever estimate is lower wins.
  const words = password
    .trim()
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  const perChar = effective * Math.log2(pool);
  const perWord =
    /^[a-z\s\-_.]+$/i.test(password) && words.length > 1 ? words.length * 11 : perChar;
  return Math.max(0, Math.min(perChar, perWord));
}

export function checkPassword(
  password: string,
  context: { username?: string } = {},
): PasswordCheck {
  const length = chars(password).length;
  const lower = password.toLowerCase();
  const compact = lower.replace(/[\s\-_.]/g, '');
  if (length < PASSWORD_MIN) {
    return {
      ok: false,
      score: 0,
      label: 'Too short',
      message: `Use at least ${PASSWORD_MIN} characters — a short sentence works well.`,
    };
  }
  if (length > PASSWORD_MAX) {
    return {
      ok: false,
      score: 0,
      label: 'Too short',
      message: `Use at most ${PASSWORD_MAX} characters.`,
    };
  }
  const reject = (message: string): PasswordCheck => ({
    ok: false,
    score: 1,
    label: 'Too easy to guess',
    message,
  });
  if (BLOCKLIST.has(lower) || BLOCKLIST.has(compact))
    return reject(
      'That’s one of the most common passwords. Try something only you would think of.',
    );
  if (isRepetition(compact)) return reject('Avoid repeating the same few characters.');
  if (predictableCount(password) >= length - 3)
    return reject('Avoid runs like “abcdef” or “123456” — they’re guessed first.');
  const username = context.username?.trim().toLowerCase();
  if (username && username.length >= 3 && compact.replaceAll(username, '').length < 8)
    return reject('Don’t build your password around your username.');
  if (compact.replace(/conch/g, '').length < 8)
    return reject('Don’t build your password around the word “Conch”.');

  const bits = estimateBits(password);
  if (bits < 50)
    return {
      ok: true,
      score: 2,
      label: 'Okay',
      message: 'Acceptable. Adding a few more unexpected words makes it much stronger.',
    };
  if (bits < 70) return { ok: true, score: 3, label: 'Good', message: 'Good password.' };
  return { ok: true, score: 4, label: 'Strong', message: 'Strong password.' };
}

// ── Generators ──────────────────────────────────────────────────────────────

/** 32 symbols (no l/o/0/1), so each random byte maps without bias: 5 bits each. */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Web Crypto exists in browsers and Node ≥ 19; the protocol has neither's typings. */
const webCrypto = (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): void } })
  .crypto;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  webCrypto.getRandomValues(bytes);
  return bytes;
}

/**
 * A strong password in the style of Apple's suggestions: `k7mbqe-x3tnzr-wd8pha`.
 * 18 random symbols = 90 bits, easy to type on a phone, lowercase only.
 */
export function suggestPassword(): string {
  const bytes = randomBytes(18);
  const symbols = Array.from(bytes, (b) => PASSWORD_ALPHABET.charAt(b % 32)).join('');
  return `${symbols.slice(0, 6)}-${symbols.slice(6, 12)}-${symbols.slice(12)}`;
}

/** Access keys carry a prefix so secret scanners and people recognise them. */
export const ACCESS_KEY_PREFIX = 'conch_';

export function looksLikeAccessKey(value: string): boolean {
  return /^conch_[A-Za-z0-9_-]{32,}$/.test(value.trim());
}
