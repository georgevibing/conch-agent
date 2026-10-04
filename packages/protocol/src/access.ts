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
 * - `passkey`  — passkeys only: Touch ID, Windows Hello, Face ID (ADR 0065).
 *
 * Passkeys can also sit beside a password or keys: then either way works.
 *
 * The password policy and generator live here so the web app, the gateway and
 * the `pnpm conch` CLI all agree on what is acceptable.
 */
import { z } from 'zod';

// ── Wire schemas ────────────────────────────────────────────────────────────

export const AccessMethod = z.enum(['none', 'password', 'key', 'passkey']);
export type AccessMethod = z.infer<typeof AccessMethod>;

/** How far Conch listens: this computer only, or the network too. */
export const Exposure = z.enum(['local', 'network']);
export type Exposure = z.infer<typeof Exposure>;

/** This browser signed in, and is waiting for its approval. */
export const WaitingApproval = z.object({
  code: z.string(),
  device: z.string(),
  expiresAt: z.number(),
  state: z.enum(['waiting', 'rejected']),
});
export type WaitingApproval = z.infer<typeof WaitingApproval>;

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
  /** Signed in, but this device is waiting to be approved (see `DeviceRequest`). */
  approval: WaitingApproval.optional(),
  /** A passkey made for this address can sign in here (ADR 0065). */
  passkeys: z.boolean().optional(),
  /**
   * Sign-in is off, and this looks like the computer running Conch, but this
   * browser hasn't been opened from Conch yet (ADR 0063): open it from your apps.
   */
  hereRequired: z.boolean().optional(),
  /**
   * Only when the request looks like it's from the computer running Conch:
   * whether this browser has proven it is (opened from Conch) or not yet.
   */
  here: z.enum(['proven', 'unproven']).optional(),
});
export type AuthStatus = z.infer<typeof AuthStatus>;

/**
 * "This computer" (ADR 0063): a program holding the key asks for a one-time
 * link to a page of Conch (`POST /api/here/link`, or the menu bar helper's
 * `POST /api/tray/open`). With `file`, it gets a private file to open instead
 * of the address, so the code is never on a command line.
 */
export const HereLinkBody = z
  .object({ page: z.string().max(512).optional(), file: z.boolean().optional() })
  .strict();
export type HereLinkBody = z.infer<typeof HereLinkBody>;

export const HereLink = z.object({
  /** `http://localhost:<port>/<page>#here=<code>`. */
  url: z.string(),
  code: z.string(),
  /** The private file that opens `url`, when one was asked for. */
  file: z.string().optional(),
});
export type HereLink = z.infer<typeof HereLink>;

/** The web app hands in the code it took from `#here=` (`POST /api/here`). */
export const HereRedeemBody = z.object({ code: z.string().trim().min(1).max(128) }).strict();

// ── Passkeys (ADR 0065) ─────────────────────────────────────────────────────
//
// What the browser's WebAuthn calls return, as JSON (`@simplewebauthn/browser`
// on the web app's side). The gateway checks every byte with
// `@simplewebauthn/server`; these only bound the shapes and sizes.

const B64 = z
  .string()
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]*={0,2}$/, 'Not base64url.');
const Transports = z.array(z.string().max(32)).max(8).optional();

export const PasskeyRegistration = z.object({
  id: B64,
  rawId: B64,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64,
    attestationObject: B64,
    authenticatorData: B64.optional(),
    transports: Transports,
    publicKeyAlgorithm: z.number().optional(),
    publicKey: B64.optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});
export type PasskeyRegistration = z.infer<typeof PasskeyRegistration>;

export const PasskeyAssertion = z.object({
  id: B64,
  rawId: B64,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64,
    authenticatorData: B64,
    signature: B64,
    userHandle: B64.optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});
export type PasskeyAssertion = z.infer<typeof PasskeyAssertion>;

/** What a passkey challenge is for: it can only be answered for that. */
export const PasskeyPurpose = z.enum(['sign-in', 'add', 'verify', 'hello']);
export type PasskeyPurpose = z.infer<typeof PasskeyPurpose>;

/** Ask the gateway for a challenge. `hello` carries the link's code (ADR 0064). */
export const PasskeyOptionsBody = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('sign-in') }),
  z.object({ purpose: z.literal('add') }),
  z.object({ purpose: z.literal('verify') }),
  z.object({ purpose: z.literal('hello'), code: z.string().trim().min(1).max(512) }),
]);
export type PasskeyOptionsBody = z.infer<typeof PasskeyOptionsBody>;

/**
 * The WebAuthn options for the browser, as JSON, handed untouched to
 * `navigator.credentials` (through `@simplewebauthn/browser`).
 */
export const PasskeyOptions = z.object({ options: z.record(z.string(), z.unknown()) });
export type PasskeyOptions = z.infer<typeof PasskeyOptions>;

export const PasskeyInfo = z.object({
  id: z.string(),
  /** What a person recognises: "iCloud Keychain", "Windows Hello", or the device's name. */
  name: z.string(),
  /** The address it's for (its relying party): it works there only. */
  rpId: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
  /** Kept in a password manager that syncs it to the person's other devices. */
  synced: z.boolean(),
  /** Usable at the address this page is open at. */
  here: z.boolean(),
});
export type PasskeyInfo = z.infer<typeof PasskeyInfo>;

export const AddPasskeyBody = z.object({ response: PasskeyRegistration }).strict();
export const RenamePasskeyBody = z.object({ name: z.string().trim().min(1).max(64) }).strict();

// ── The hello link: a new Conch is made yours (ADR 0064) ────────────────────

export const HelloCheckBody = z.object({ code: z.string().trim().min(1).max(512) }).strict();

/** What the page opened from `#hello=` learns before it asks anything. */
export const HelloCheck = z.object({
  ok: z.boolean(),
  /** Why it can't be used: used or run out, or this Conch is already someone's. */
  reason: z.enum(['expired', 'claimed']).optional(),
  expiresAt: z.number().optional(),
  /** Where Conch is, so the person knows which Conch this is. */
  address: z.string(),
  /** This computer's account name, to fill in the username for a password. */
  suggestedUsername: z.string(),
  /** Passkeys can be made at this address. */
  passkeys: z.boolean(),
});
export type HelloCheck = z.infer<typeof HelloCheck>;

export const HelloFinishBody = z.discriminatedUnion('with', [
  z.object({
    with: z.literal('passkey'),
    code: z.string().trim().min(1).max(512),
    response: PasskeyRegistration,
  }),
  z.object({
    with: z.literal('password'),
    code: z.string().trim().min(1).max(512),
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
  }),
]);
export type HelloFinishBody = z.infer<typeof HelloFinishBody>;

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
  z.object({ with: z.literal('passkey'), response: PasskeyAssertion }),
]);
export type SignInBody = z.infer<typeof SignInBody>;

/** Re-enter your password or key, or use a passkey, before a sensitive change ("sudo mode"). */
export const VerifyBody = z.union([
  z.object({ secret: z.string().min(1).max(512) }).strict(),
  z.object({ passkey: PasskeyAssertion }).strict(),
]);
export type VerifyBody = z.infer<typeof VerifyBody>;

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

/** A key nobody has used for this long is worth revoking (the checkup says so). */
export const STALE_KEY_DAYS = 90;

export function isStaleKey(
  key: { createdAt: number; lastUsedAt?: number | undefined },
  now = Date.now(),
): boolean {
  return now - (key.lastUsedAt ?? key.createdAt) > STALE_KEY_DAYS * 24 * 60 * 60 * 1000;
}

/** Returned exactly once, when the key is created. */
export const CreatedKey = z.object({ key: z.string(), info: AccessKeyInfo });
export type CreatedKey = z.infer<typeof CreatedKey>;

export const SignInVia = z.enum(['password', 'key', 'pairing', 'setup', 'passkey', 'hello']);
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

// ── Devices and approving new ones ─────────────────────────────────────────
//
// Every browser that signs in is remembered as a *device* (an HttpOnly cookie
// the gateway knows only the hash of), so Settings → Security can show what
// has used Conch. With **Approve new devices** on, a device seen for the first
// time from somewhere other than this computer still needs the person's OK
// after the right password or key: `pnpm conch devices approve <code>` in a
// terminal on this computer, or Settings on this computer.

export const DeviceKind = z.enum(['desktop', 'phone', 'tablet', 'other']);
export type DeviceKind = z.infer<typeof DeviceKind>;

/** How a device came to be approved. */
export const ApprovedHow = z.enum([
  /** Signed in on the computer running Conch. */
  'this-computer',
  /** `pnpm conch devices approve` in a terminal on the computer running Conch. */
  'terminal',
  /** Settings → Security on the computer running Conch. */
  'settings',
  /** A one-time sign-in link (the QR code), made by a device already allowed in. */
  'link',
  /** It was signed in when approval was turned on. */
  'already-signed-in',
  /** It signed in with a passkey, which is the device and the person at once (ADR 0065). */
  'passkey',
  /** It opened the hello link that made Conch the person's own (ADR 0064). */
  'hello',
  /** Another approved device let it in, after confirming it's the person (ADR 0065). */
  'device',
]);
export type ApprovedHow = z.infer<typeof ApprovedHow>;

/** The approval code a waiting device shows, e.g. "K7M-Q2X". */
export const APPROVAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const APPROVAL_CODE_LENGTH = 6;

/** "k7m q2x", "K7MQ2X" and "K7M-Q2X" are all the same code. */
export function normalizeApprovalCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatApprovalCode(code: string): string {
  const c = normalizeApprovalCode(code);
  return c.length === APPROVAL_CODE_LENGTH ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

/** A device waiting for the person's OK. */
export const DeviceRequest = z.object({
  /** Shown on the waiting device too, so the person approves the right one. */
  code: z.string(),
  deviceId: z.string(),
  /** e.g. "Safari on iPhone", or "Scripts using “Work laptop”". */
  device: z.string(),
  kind: DeviceKind,
  /** What it proved before asking: the password, or an access key (by name). */
  via: z.enum(['password', 'key']),
  keyName: z.string().optional(),
  /** Where it connected from (an IP address), to help recognise it. */
  address: z.string().optional(),
  /** A script with an access key rather than a browser. */
  script: z.boolean(),
  createdAt: z.number(),
  expiresAt: z.number(),
  /** Turned down: the device is told, until the request runs out. */
  rejected: z.boolean(),
});
export type DeviceRequest = z.infer<typeof DeviceRequest>;

export const DeviceInfo = z.object({
  id: z.string(),
  name: z.string(),
  kind: DeviceKind,
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  address: z.string().optional(),
  /** Allowed in without asking again (always true in meaning while approval is off). */
  approved: z.boolean(),
  approvedAt: z.number().optional(),
  approvedHow: ApprovedHow.optional(),
  /** The device that approved it, when another one did. */
  approvedBy: z.string().optional(),
  /** Signed in now (has a session that hasn't ended). */
  signedIn: z.boolean(),
  /** How it last signed in. */
  via: SignInVia.optional(),
  script: z.boolean(),
  /** The device this page is open on. */
  current: z.boolean(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

/** An approved device nobody has used for this long is worth removing. */
export const STALE_DEVICE_DAYS = 90;

export function isStaleDevice(device: { lastSeenAt: number }, now = Date.now()): boolean {
  return now - device.lastSeenAt > STALE_DEVICE_DAYS * 24 * 60 * 60 * 1000;
}

export const DeviceApproval = z.object({
  on: z.boolean(),
  /**
   * This page is on the computer running Conch, so it may turn approval off.
   * Elsewhere, only the terminal there can.
   */
  here: z.boolean(),
  /**
   * This page may let a waiting device in: it's on this computer, or it's an
   * approved device (which confirms it's you first, ADR 0065).
   */
  canApprove: z.boolean(),
});
export type DeviceApproval = z.infer<typeof DeviceApproval>;

export const SetApprovalBody = z.object({ on: z.boolean() }).strict();
export const RenameDeviceBody = z.object({ name: z.string().trim().min(1).max(64) }).strict();

export const CheckLevel = z.enum(['ok', 'info', 'warn', 'danger']);
export type CheckLevel = z.infer<typeof CheckLevel>;

/**
 * Where a finding's fix can take you. A closed list: the gateway names a
 * place, the web app knows how to get there, and nothing else is reachable.
 */
export const CheckupPlace = z.enum([
  /** Settings › Security › How you sign in. */
  'sign-in',
  /** Settings › Security › the access keys (making one, or revoking old ones). */
  'keys',
  /** Settings › Security › Use Conch on your phone (Tailscale). */
  'reach',
  /** Settings › Models, where new chats' mode is chosen. */
  'models',
  /** The Channels page: who may talk to your assistant from each chat app. */
  'channels',
  /** Settings › Security › Devices: what's signed in, what's waiting, and approving new ones. */
  'devices',
  /** Settings › Security › Live data in pages: the sites pages may read (ADR 0046). */
  'live-data',
  /** Settings › Security › Passkeys (ADR 0065). */
  'passkeys',
  /** Settings › Security › Your address: a domain of your own, over HTTPS (ADR 0064). */
  'address',
  /** Settings › Other apps: the apps paired with Conch, and what each may use (ADR 0073). */
  'other-apps',
]);
export type CheckupPlace = z.infer<typeof CheckupPlace>;

/**
 * A change the gateway makes for you, in one click. Every action only takes
 * trust away (back to asking, off, or private); none can grant it, so a
 * finding can never become a shortcut to a riskier setting.
 */
export const CheckupAction = z.enum([
  /** New chats: Full trust → Ask first. */
  'ask-first',
  /** Integrations on “Don’t ask” → “Ask before changes”. */
  'integrations-ask',
  /** The agent's browser stops opening pages on this computer and your network. */
  'browser-local-off',
  /** The browser goes back to Conch's own, away from your own Chrome (ADR 0080). */
  'browser-own-chrome-off',
  /** Other devices can no longer open a terminal. */
  'terminal-remote-off',
  /** The work folder's own Claude Code rules are set aside (renamed, never deleted). */
  'workspace-rules-off',
  /** `~/.conch` is made readable by you alone. */
  'secure-files',
  /** Check before acting on what was read goes back on (ADR 0028). */
  'check-after-reading',
  /** Commands are sealed again (ADR 0028). */
  'sealed-commands',
  /** A memory that looks planted is held and asked about again (ADR 0087). */
  'check-memories',
]);
export type CheckupAction = z.infer<typeof CheckupAction>;

const FixLabel = z.string().min(1).max(40);

/** The one button a finding offers: go somewhere, or have the gateway fix it. */
export const CheckupFix = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open'), label: FixLabel, place: CheckupPlace }),
  z.object({ kind: z.literal('act'), label: FixLabel, action: CheckupAction }),
]);
export type CheckupFix = z.infer<typeof CheckupFix>;

/** One line of the security checkup. */
export const CheckupItem = z.object({
  id: z.string(),
  level: CheckLevel,
  title: z.string(),
  detail: z.string(),
  /** A terminal command that fixes it, when only a person can (one line to copy). */
  command: z.string().optional(),
  /** The button that fixes it, when Conch can help. */
  fix: CheckupFix.optional(),
});
export type CheckupItem = z.infer<typeof CheckupItem>;

/** Run a finding's `act` fix. Unknown actions are refused. */
export const CheckupFixBody = z.object({ action: CheckupAction }).strict();
export type CheckupFixBody = z.infer<typeof CheckupFixBody>;

export const AccessSettings = z.object({
  method: AccessMethod,
  username: z.string().optional(),
  /** Your account name on this computer, to pre-fill the username. */
  suggestedUsername: z.string(),
  keys: z.array(AccessKeyInfo),
  passkeys: z.array(PasskeyInfo),
  /** Passkeys can be made at the address this page is open at (an HTTPS name, or localhost). */
  passkeysHere: z.boolean(),
  sessions: z.array(SessionInfo),
  devices: z.array(DeviceInfo),
  /** Devices waiting for approval, newest first. */
  requests: z.array(DeviceRequest),
  approval: DeviceApproval,
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

/** A fix ran: what changed, in a few plain words, and the checkup without it. */
export const CheckupFixResult = z.object({ done: z.string(), access: AccessSettings });
export type CheckupFixResult = z.infer<typeof CheckupFixResult>;

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

/** One of the most common passwords (or that with its separators taken out). */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  return BLOCKLIST.has(lower) || BLOCKLIST.has(lower.replace(/[\s\-_.]/g, ''));
}

/** "abcabcabc…" — the whole thing is one short chunk repeated. */
export function isRepetition(s: string): boolean {
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
 * A strong password in three groups of six: `k7mbqe-x3tnzr-wd8pha`.
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
