import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  APPROVAL_CODE_ALPHABET,
  APPROVAL_CODE_LENGTH,
  AccessMethod,
  ApprovedHow,
  DeviceKind,
  SignInVia,
  checkPassword,
  formatApprovalCode,
  normalizeApprovalCode,
  type AccessKeyInfo,
  type CreatedKey,
  type DeviceInfo,
  type DeviceRequest,
  type SessionInfo,
  type WaitingApproval,
} from '@conch/protocol';
import { z } from 'zod';

import { newId } from '../lib/ids';
import { Mutex, writeJson } from '../lib/fs';
import { setAside, type Heal } from '../lib/recover';
import { describeDevice } from './device';
import {
  Semaphore,
  dummyHash,
  hashPassword,
  hashToken,
  needsRehash,
  newAccessKey,
  randomToken,
  safeEqual,
  verifyPassword,
} from './secrets';

/** Sessions end 30 days after sign-in (NIST SP 800-63B-4 AAL1) … */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** … or after a week without use. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** Sensitive changes need a password/key entered this recently ("sudo mode"). */
export const VERIFY_WINDOW_MS = 10 * 60 * 1000;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** A device waits this long for its approval, then signs in again to ask anew. */
export const APPROVAL_TTL_MS = 10 * 60 * 1000;
/** At most this many devices wait at once, so nobody can bury yours in requests. */
export const MAX_WAITING = 10;
/** A device never approved and not signed in is forgotten this long after it was last seen. */
const FORGET_UNAPPROVED_MS = 30 * 24 * 60 * 60 * 1000;
/** Devices kept at most; the longest-unseen unapproved ones go first. */
const MAX_DEVICES = 200;
/** lastSeenAt is only written this often, so browsing doesn't hammer the disk. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const KeyRecord = z.object({
  id: z.string(),
  name: z.string(),
  /** SHA-256 of the key; the key itself is never stored. */
  hash: z.string(),
  hint: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
});

const SessionRecord = z.object({
  id: z.string(),
  /** SHA-256 of the cookie value. */
  hash: z.string(),
  via: SignInVia,
  keyId: z.string().optional(),
  device: z.string(),
  kind: DeviceKind,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  verifiedAt: z.number(),
  /** The device it was signed in on. */
  deviceId: z.string().optional(),
  /** Signed in, but the device is waiting for approval: it can't use Conch yet. */
  pending: z.boolean().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

const DeviceRecord = z.object({
  id: z.string(),
  /**
   * SHA-256 of the device cookie. Empty for a device that was signed in
   * before Conch kept devices, until its next request brings it a cookie.
   */
  hash: z.string(),
  /** What its browser says it is: "Safari on iPhone". */
  name: z.string(),
  /** The name the person gave it, if they renamed it. */
  label: z.string().optional(),
  kind: DeviceKind,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  address: z.string().optional(),
  via: SignInVia.optional(),
  approvedAt: z.number().optional(),
  approvedHow: ApprovedHow.optional(),
  /** Not a browser: scripts on other devices using this access key (`Authorization: Bearer`). */
  keyId: z.string().optional(),
});
export type DeviceRecord = z.infer<typeof DeviceRecord>;

const RequestRecord = z.object({
  /** Normalised: "K7MQ2X". */
  code: z.string(),
  deviceId: z.string(),
  /** The waiting browser's session; none for a script. */
  sessionId: z.string().optional(),
  via: z.enum(['password', 'key']),
  keyId: z.string().optional(),
  address: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  rejectedAt: z.number().optional(),
});
type RequestRecord = z.infer<typeof RequestRecord>;

const PairingRecord = z.object({ hash: z.string(), createdAt: z.number(), expiresAt: z.number() });

const AccessFile = z.object({
  version: z.literal(1).default(1),
  method: AccessMethod.default('none'),
  username: z.string().optional(),
  passwordHash: z.string().optional(),
  keys: z.array(KeyRecord).default([]),
  sessions: z.array(SessionRecord).default([]),
  pairings: z.array(PairingRecord).default([]),
  /** Approve new devices: a device seen for the first time needs the person's OK. */
  approval: z.boolean().default(false),
  devices: z.array(DeviceRecord).default([]),
  requests: z.array(RequestRecord).default([]),
});
export type AccessFile = z.infer<typeof AccessFile>;

export class AccessError extends Error {
  constructor(
    readonly code: 'invalid' | 'weak-password' | 'not-found' | 'locked' | 'busy',
    message: string,
  ) {
    super(message);
  }
}

/** Where the way back in is: having this computer's terminal is the proof it's you. */
export const LOCKED_MESSAGE =
  'Sign-in is locked because Conch couldn’t read who may sign in. On the computer running Conch, run: pnpm conch reset';

/**
 * What a damaged `access.json` reads as: password sign-in with no password.
 * Every sign-in fails, every session is gone, and this computer has to sign
 * in too.
 *
 * Why not the defaults, like every other store? The default is *no* sign-in,
 * which lets this computer in without a password (and, through a proxy on
 * this computer, maybe others). A file that won't read may have held a
 * password, so Conch never guesses: it locks, keeps a copy, and waits for
 * `pnpm conch reset` (or `password`, or `key`) on this computer, whose
 * terminal is the proof that it's you. OWASP ASVS 5.0: errors fail closed,
 * never open (V16.5), and recovery is no weaker than signing in (V6.4). A
 * `CONCH_TOKEN` from the environment still works: whoever started Conch set
 * it, so it grants nothing new.
 */
const LOCKED: AccessFile = {
  version: 1,
  method: 'password',
  keys: [],
  sessions: [],
  pairings: [],
  approval: false,
  devices: [],
  requests: [],
};

/**
 * Keep what's safe to keep from a damaged file. Signed-in devices, approved
 * devices, waiting ones and pairing links may be dropped: the worst outcome is
 * signing in (or being approved) again. Everything about *who may sign in*
 * (the method, username, password hash, keys and whether new devices need
 * approval) must read cleanly, and the method must be written out, never
 * defaulted to "none". Otherwise `undefined`, and sign-in locks.
 */
function salvageAccess(raw: unknown): AccessFile | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const fields = raw as Record<string, unknown>;
  if (!AccessMethod.safeParse(fields.method).success) return undefined;
  const credentials = AccessFile.omit({
    sessions: true,
    pairings: true,
    devices: true,
    requests: true,
  }).safeParse(fields);
  if (!credentials.success) return undefined;
  const valid = <T>(schema: z.ZodType<T>, list: unknown): T[] =>
    Array.isArray(list)
      ? list.flatMap((item) => {
          const parsed = schema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  return {
    ...credentials.data,
    sessions: valid(SessionRecord, fields.sessions),
    pairings: valid(PairingRecord, fields.pairings),
    devices: valid(DeviceRecord, fields.devices),
    requests: valid(RequestRecord, fields.requests),
  };
}

/** A fresh approval code none of `taken` already uses: 6 symbols, 30 bits, read aloud easily. */
function newApprovalCode(taken: Set<string>): string {
  for (;;) {
    const code = Array.from(randomBytes(APPROVAL_CODE_LENGTH), (b) =>
      APPROVAL_CODE_ALPHABET.charAt(b % APPROVAL_CODE_ALPHABET.length),
    ).join('');
    if (!taken.has(code)) return code;
  }
}

/** Drop what has run out, and what belonged to something that's gone. */
function tidy(file: AccessFile, now: number) {
  file.sessions = file.sessions.filter((s) => alive(s, now));
  file.pairings = file.pairings.filter((p) => p.expiresAt > now);
  const devices = new Set(file.devices.map((d) => d.id));
  const sessions = new Set(file.sessions.map((s) => s.id));
  file.requests = file.requests.filter(
    (r) =>
      r.expiresAt > now &&
      devices.has(r.deviceId) &&
      (r.sessionId === undefined || sessions.has(r.sessionId)),
  );
  // A waiting session lives only as long as its request.
  const waiting = new Set(file.requests.flatMap((r) => (r.sessionId ? [r.sessionId] : [])));
  file.sessions = file.sessions.filter((s) => !s.pending || waiting.has(s.id));
  const inUse = new Set([
    ...file.sessions.flatMap((s) => (s.deviceId ? [s.deviceId] : [])),
    ...file.requests.map((r) => r.deviceId),
  ]);
  const keys = new Set(file.keys.map((k) => k.id));
  file.devices = file.devices.filter(
    (d) =>
      (d.keyId === undefined || d.keyId === 'env' || keys.has(d.keyId)) &&
      (d.approvedAt !== undefined || inUse.has(d.id) || now - d.lastSeenAt < FORGET_UNAPPROVED_MS),
  );
  if (file.devices.length > MAX_DEVICES) {
    const spare = new Set(
      file.devices
        .filter((d) => d.approvedAt === undefined && !inUse.has(d.id))
        .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
        .slice(0, file.devices.length - MAX_DEVICES)
        .map((d) => d.id),
    );
    file.devices = file.devices.filter((d) => !spare.has(d.id));
  }
}

const deviceName = (d: DeviceRecord) => d.label ?? d.name;

export interface SignInResult {
  ok: boolean;
  keyId?: string;
}

const alive = (s: SessionRecord, now: number) =>
  s.expiresAt > now && now - s.lastSeenAt < SESSION_IDLE_MS;

/**
 * `~/.conch/access.json` (0600) — how Conch is protected. Only hashes are
 * stored: a copy of this file can't be used to sign in. The file is re-read
 * when it changes on disk, so `pnpm conch …` works while Conch is running.
 */
export class AccessStore {
  #mutex = new Mutex();
  #cache?: AccessFile;
  #mtime = -1;
  #checkedAt = 0;
  /** `access.json` couldn't be read: nobody may sign in until it's reset (see `LOCKED`). */
  #locked = false;
  /** Two concurrent password hashes at most (128 MiB each). */
  #hashing = new Semaphore(2);
  readonly path: string;

  constructor(
    home: string,
    private readonly heal?: Heal,
  ) {
    this.path = join(home, 'access.json');
  }

  async get(): Promise<AccessFile> {
    const now = Date.now();
    if (this.#cache && now - this.#checkedAt < 500) return this.#cache;
    this.#checkedAt = now;
    const mtime = await stat(this.path).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    if (!this.#cache || mtime !== this.#mtime) {
      this.#cache = await this.#read();
      this.#mtime = mtime;
    }
    return this.#cache;
  }

  /** Sign-in is locked because `access.json` couldn't be read. */
  async locked(): Promise<boolean> {
    await this.get();
    return this.#locked;
  }

  async #read(): Promise<AccessFile> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.path);
    } catch (error) {
      // No file is a new install: nothing was ever set up to protect.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.#locked = false;
      return AccessFile.parse({});
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      return this.#lock(bytes);
    }
    const parsed = AccessFile.safeParse(raw);
    if (parsed.success) {
      this.#locked = false;
      return parsed.data;
    }
    const salvaged = salvageAccess(raw);
    if (!salvaged) return this.#lock(bytes);
    this.#locked = false;
    // Saved with the next change; until then it's read (and salvaged) again, quietly.
    const aside = await setAside(this.path, { bytes }).catch(() => undefined);
    if (aside?.fresh)
      this.heal?.(
        'access',
        'Some signed-in devices couldn’t be read, so Conch kept a copy and they’ll be asked to sign in again.',
      );
    return salvaged;
  }

  /** Fail closed: a damaged file never reads as "no sign-in". It stays put, so a restart stays locked. */
  async #lock(bytes: Buffer): Promise<AccessFile> {
    this.#locked = true;
    const aside = await setAside(this.path, { bytes }).catch(() => undefined);
    if (aside?.fresh)
      this.heal?.(
        'access',
        'Conch couldn’t read who may sign in, so it kept a copy and locked sign-in until it’s reset on this computer.',
      );
    return structuredClone(LOCKED);
  }

  /**
   * Read, change and save `access.json`. While sign-in is locked, only a
   * change that sets who may sign in from scratch (`resets`) is allowed:
   * anything else would save the locked stand-in as if it were real.
   */
  #update<T>(
    fn: (file: AccessFile) => T | Promise<T>,
    { resets = false }: { resets?: boolean } = {},
  ): Promise<T> {
    return this.#mutex.run(async () => {
      this.#checkedAt = 0;
      const file = structuredClone(await this.get());
      if (this.#locked && !resets) throw new AccessError('locked', LOCKED_MESSAGE);
      const result = await fn(file);
      tidy(file, Date.now());
      await writeJson(this.path, file);
      this.#cache = file;
      this.#locked = false;
      this.#mtime = await stat(this.path).then((s) => s.mtimeMs);
      return result;
    });
  }

  async method(): Promise<AccessMethod> {
    return (await this.get()).method;
  }

  // ── Credentials ───────────────────────────────────────────────────────

  /** Switch to password sign-in. Keys are removed and other sessions end. */
  async setPassword(username: string, password: string, keepSessionId?: string): Promise<void> {
    const check = checkPassword(password, { username });
    if (!check.ok) throw new AccessError('weak-password', check.message);
    const passwordHash = await this.#hashing.run(() => hashPassword(password));
    await this.#update(
      (file) => {
        file.method = 'password';
        file.username = username.trim();
        file.passwordHash = passwordHash;
        file.keys = [];
        file.sessions = file.sessions.filter((s) => s.id === keepSessionId);
      },
      { resets: true },
    );
  }

  /** Add an access key (switching to key sign-in if needed). Returned once. */
  async addKey(name: string, keepSessionId?: string): Promise<CreatedKey> {
    const key = newAccessKey();
    const record = {
      id: newId('key'),
      name: name.trim(),
      hash: hashToken(key),
      hint: key.slice(-4),
      createdAt: Date.now(),
    };
    await this.#update(
      (file) => {
        if (file.method !== 'key') {
          file.method = 'key';
          delete file.username;
          delete file.passwordHash;
          file.sessions = file.sessions.filter((s) => s.id === keepSessionId);
        }
        file.keys.push(record);
      },
      // While locked, the stand-in is "password", so this starts a fresh key list.
      { resets: true },
    );
    return { key, info: keyInfo(record) };
  }

  /** Revoke a key and sign out every device that used it. */
  async revokeKey(id: string): Promise<string[]> {
    return this.#update((file) => {
      if (!file.keys.some((k) => k.id === id)) throw new AccessError('not-found', 'No such key.');
      file.keys = file.keys.filter((k) => k.id !== id);
      const ended = file.sessions.filter((s) => s.keyId === id).map((s) => s.id);
      file.sessions = file.sessions.filter((s) => s.keyId !== id);
      if (file.keys.length === 0) file.method = 'none';
      return ended;
    });
  }

  /** Turn sign-in off: forget every credential and end every session. */
  async disable(): Promise<string[]> {
    return this.#update(
      (file) => {
        const ended = file.sessions.map((s) => s.id);
        file.method = 'none';
        delete file.username;
        delete file.passwordHash;
        file.keys = [];
        file.sessions = [];
        file.pairings = [];
        file.approval = false;
        file.devices = [];
        file.requests = [];
        return ended;
      },
      { resets: true },
    );
  }

  async keys(): Promise<AccessKeyInfo[]> {
    return (await this.get()).keys.map(keyInfo);
  }

  /**
   * Check a password or key. Always does the same work whether or not the
   * username exists, and compares hashes in constant time.
   */
  async verify(input: { username?: string; secret: string }): Promise<SignInResult> {
    const file = await this.get();
    if (file.method === 'password') {
      const stored = file.passwordHash ?? (await dummyHash());
      const passwordOk = await this.#hashing.run(() => verifyPassword(input.secret, stored));
      const userOk =
        input.username === undefined ||
        safeEqual(input.username.trim().toLowerCase(), (file.username ?? '').toLowerCase());
      const ok = passwordOk && userOk && Boolean(file.passwordHash);
      if (ok && file.passwordHash && needsRehash(file.passwordHash)) {
        const rehashed = await this.#hashing.run(() => hashPassword(input.secret));
        await this.#update((f) => void (f.passwordHash = rehashed));
      }
      return { ok };
    }
    if (file.method === 'key') return this.verifyKey(input.secret);
    return { ok: false };
  }

  async verifyKey(key: string): Promise<SignInResult> {
    const file = await this.get();
    const hash = hashToken(key.trim());
    let match: string | undefined;
    // Compare against every key so timing doesn't reveal how many there are or which matched.
    for (const record of file.keys) if (safeEqual(record.hash, hash)) match = record.id;
    if (!match) return { ok: false };
    const keyId = match;
    const now = Date.now();
    const record = file.keys.find((k) => k.id === keyId);
    if (record && now - (record.lastUsedAt ?? 0) > TOUCH_EVERY_MS) {
      await this.#update((f) => {
        const k = f.keys.find((x) => x.id === keyId);
        if (k) k.lastUsedAt = now;
      });
    }
    return { ok: true, keyId };
  }

  // ── Pairing (add a device with a one-time link) ──────────────────────────

  async createPairing(): Promise<{ code: string; expiresAt: number }> {
    const code = randomToken(32);
    const now = Date.now();
    const expiresAt = now + PAIRING_TTL_MS;
    await this.#update((file) => {
      file.pairings.push({ hash: hashToken(code), createdAt: now, expiresAt });
    });
    return { code, expiresAt };
  }

  /** Single use: a code works once, then it's gone. */
  async consumePairing(code: string): Promise<boolean> {
    const hash = hashToken(code.trim());
    return this.#update((file) => {
      const now = Date.now();
      const match = file.pairings.find((p) => safeEqual(p.hash, hash) && p.expiresAt > now);
      file.pairings = file.pairings.filter((p) => p !== match);
      return Boolean(match) && file.method !== 'none';
    });
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /** A fresh session per sign-in (never reuse one — prevents fixation). */
  async createSession(input: {
    via: SignInVia;
    userAgent?: string;
    keyId?: string;
    deviceId?: string;
  }): Promise<{ token: string; session: SessionRecord }> {
    const token = randomToken(32);
    const now = Date.now();
    const { device, kind } = describeDevice(input.userAgent);
    const session: SessionRecord = {
      id: newId('s'),
      hash: hashToken(token),
      via: input.via,
      ...(input.keyId && { keyId: input.keyId }),
      device,
      kind,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_MAX_AGE_MS,
      verifiedAt: now,
      ...(input.deviceId && { deviceId: input.deviceId }),
    };
    await this.#update((file) => void file.sessions.push(session));
    return { token, session };
  }

  /**
   * The live session for a cookie value, if any — never one still waiting for
   * its device to be approved (`waitingFor`). Refreshes lastSeenAt now and then,
   * and its device's with it.
   */
  async findSession(token: string): Promise<SessionRecord | undefined> {
    const file = await this.get();
    if (file.method === 'none' && !file.sessions.length) return undefined;
    const hash = hashToken(token);
    const now = Date.now();
    const session = file.sessions.find((s) => safeEqual(s.hash, hash));
    if (!session || session.pending || !alive(session, now)) return undefined;
    if (now - session.lastSeenAt > TOUCH_EVERY_MS) {
      await this.#update((f) => {
        const s = f.sessions.find((x) => x.id === session.id);
        if (s) s.lastSeenAt = now;
        const d = f.devices.find((x) => x.id === session.deviceId);
        if (d) d.lastSeenAt = now;
      });
    }
    return session;
  }

  /** Is this session still signed in (and not waiting)? For closing sockets it opened. */
  async sessionActive(id: string): Promise<boolean> {
    const now = Date.now();
    return (await this.get()).sessions.some((s) => s.id === id && !s.pending && alive(s, now));
  }

  /**
   * Is this device still let in: not removed, approved when approval is on,
   * and signed in on at least one live session? For its notifications (ADR 0027).
   */
  async deviceActive(id: string): Promise<boolean> {
    const now = Date.now();
    const file = await this.get();
    const device = file.devices.find((d) => d.id === id);
    if (!device || (file.approval && device.approvedAt === undefined)) return false;
    return file.sessions.some((s) => s.deviceId === id && !s.pending && alive(s, now));
  }

  /** End the session (signed in or waiting) this cookie value belongs to. */
  async endSession(token: string): Promise<string | undefined> {
    const hash = hashToken(token);
    if (!(await this.get()).sessions.some((s) => safeEqual(s.hash, hash))) return undefined;
    return this.#update((file) => {
      const session = file.sessions.find((s) => safeEqual(s.hash, hash));
      file.sessions = file.sessions.filter((s) => s !== session);
      return session?.id;
    });
  }

  async markVerified(sessionId: string): Promise<void> {
    await this.#update((file) => {
      const s = file.sessions.find((x) => x.id === sessionId);
      if (s) s.verifiedAt = Date.now();
    });
  }

  async sessions(currentId?: string): Promise<SessionInfo[]> {
    const now = Date.now();
    return (await this.get()).sessions
      .filter((s) => !s.pending && alive(s, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({
        id: s.id,
        device: s.device,
        kind: s.kind,
        via: s.via,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: Math.min(s.expiresAt, s.lastSeenAt + SESSION_IDLE_MS),
        current: s.id === currentId,
      }));
  }

  async revokeSession(id: string): Promise<boolean> {
    return this.#update((file) => {
      const before = file.sessions.length;
      file.sessions = file.sessions.filter((s) => s.id !== id);
      return file.sessions.length < before;
    });
  }

  /** Sign out everywhere except `keepId`. Returns the ended session ids. */
  async revokeOtherSessions(keepId?: string): Promise<string[]> {
    return this.#update((file) => {
      const ended = file.sessions.filter((s) => s.id !== keepId).map((s) => s.id);
      file.sessions = file.sessions.filter((s) => s.id === keepId);
      return ended;
    });
  }

  // ── Devices, and approving new ones ──────────────────────────────────────

  /** New devices need approval (and sign-in is on, so there's something to approve). */
  async approvalOn(): Promise<boolean> {
    const file = await this.get();
    return file.approval && file.method !== 'none';
  }

  /**
   * Turn **Approve new devices** on or off. Turning it on approves the
   * devices signed in right now: they already proved who they are, and the
   * person sees them listed to remove any they don't recognise. Turning it
   * off turns down nobody: devices waiting are simply let go, to sign in again.
   */
  async setApproval(on: boolean, options: { hereDeviceId?: string } = {}): Promise<void> {
    await this.#update((file) => {
      if (on && file.method === 'none')
        throw new AccessError('invalid', 'Choose a password or access key first.');
      if (on && !file.approval) {
        const now = Date.now();
        for (const s of file.sessions) {
          if (s.pending || !alive(s, now)) continue;
          let device = file.devices.find((d) => d.id === s.deviceId);
          if (!device) {
            // Signed in before Conch kept devices: it gets its cookie on its next request.
            device = {
              id: newId('dev'),
              hash: '',
              name: s.device,
              kind: s.kind,
              createdAt: s.createdAt,
              lastSeenAt: s.lastSeenAt,
              via: s.via,
            };
            file.devices.push(device);
            s.deviceId = device.id;
          }
          if (device.approvedAt === undefined) {
            device.approvedAt = now;
            // The device turning it on, on this computer, is this computer.
            device.approvedHow =
              device.id === options.hereDeviceId ? 'this-computer' : 'already-signed-in';
          }
        }
      }
      if (!on) file.requests = [];
      file.approval = on;
    });
  }

  /**
   * The device a sign-in comes from: the one its device cookie names, or a
   * new one. Returns the cookie value to (re)send. Only called once the
   * password or key was right, so nobody can fill the list without it.
   */
  async signInDevice(input: {
    token?: string;
    userAgent?: string;
    address?: string;
    via: SignInVia;
  }): Promise<{ device: DeviceRecord; token: string }> {
    const { device: name, kind } = describeDevice(input.userAgent);
    const hash = input.token ? hashToken(input.token) : undefined;
    return this.#update((file) => {
      const now = Date.now();
      let token = input.token;
      let device = hash
        ? file.devices.find((d) => !d.keyId && d.hash && safeEqual(d.hash, hash))
        : undefined;
      if (!device || !token) {
        token = randomToken(32);
        device = {
          id: newId('dev'),
          hash: hashToken(token),
          name,
          kind,
          createdAt: now,
          lastSeenAt: now,
        };
        file.devices.push(device);
      }
      device.name = name;
      device.kind = kind;
      device.lastSeenAt = now;
      device.via = input.via;
      if (input.address) device.address = input.address;
      else delete device.address;
      return { device: structuredClone(device), token };
    });
  }

  /**
   * A session signed in before Conch kept devices (or whose device has no
   * cookie yet) gets one now. Returns the cookie value to send, if one was made.
   */
  async adoptDevice(
    sessionId: string,
    address?: string,
  ): Promise<{ token: string; deviceId: string } | undefined> {
    const file = await this.get();
    const session = file.sessions.find((s) => s.id === sessionId);
    if (!session || session.pending) return undefined;
    const device = file.devices.find((d) => d.id === session.deviceId);
    if (device?.hash) return undefined;
    const token = randomToken(32);
    const made = await this.#update((f) => {
      const s = f.sessions.find((x) => x.id === sessionId);
      if (!s) return undefined;
      let d = f.devices.find((x) => x.id === s.deviceId);
      if (d?.hash) return undefined;
      if (!d) {
        d = {
          id: newId('dev'),
          hash: '',
          name: s.device,
          kind: s.kind,
          createdAt: s.createdAt,
          lastSeenAt: Date.now(),
          via: s.via,
          ...(address && { address }),
        };
        f.devices.push(d);
        s.deviceId = d.id;
      }
      d.hash = hashToken(token);
      return d.id;
    });
    return made ? { token, deviceId: made } : undefined;
  }

  async deviceApproved(deviceId: string | undefined): Promise<boolean> {
    if (!deviceId) return false;
    return (await this.get()).devices.some((d) => d.id === deviceId && d.approvedAt !== undefined);
  }

  /** Approve a device without asking: it signed in on this computer, or with a one-time link. */
  async approveDevice(deviceId: string, how: ApprovedHow): Promise<void> {
    await this.#update((file) => {
      const device = file.devices.find((d) => d.id === deviceId);
      if (!device || device.approvedAt !== undefined) return;
      device.approvedAt = Date.now();
      device.approvedHow = how;
      file.requests = file.requests.filter((r) => r.deviceId !== deviceId);
    });
  }

  /**
   * Sign a browser in as waiting: a fresh session that can't use Conch yet,
   * and a request with a code to approve it by. Signing in again from the same
   * device keeps its code (so the one in the terminal still works) and starts
   * the wait over; after a "no", it asks anew.
   */
  async startWaiting(input: {
    deviceId: string;
    via: 'password' | 'key';
    keyId?: string;
    userAgent?: string;
    address?: string;
  }): Promise<{ token: string; session: SessionRecord; request: WaitingApproval }> {
    const token = randomToken(32);
    const { device: name, kind } = describeDevice(input.userAgent);
    return this.#update((file) => {
      const now = Date.now();
      const previous = file.requests.find((r) => r.deviceId === input.deviceId);
      const keep = previous && previous.rejectedAt === undefined ? previous : undefined;
      // Its earlier wait (and that session) is over either way.
      file.requests = file.requests.filter((r) => r.deviceId !== input.deviceId);
      file.sessions = file.sessions.filter((s) => !(s.pending && s.deviceId === input.deviceId));
      const waiting = file.requests.filter((r) => r.rejectedAt === undefined && r.expiresAt > now);
      if (!keep && waiting.length >= MAX_WAITING)
        throw new AccessError(
          'busy',
          'Too many devices are waiting to be approved. On the computer running Conch, approve or turn them down first: pnpm conch devices',
        );
      const expiresAt = now + APPROVAL_TTL_MS;
      const session: SessionRecord = {
        id: newId('s'),
        hash: hashToken(token),
        via: input.via,
        ...(input.keyId && { keyId: input.keyId }),
        device: name,
        kind,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        verifiedAt: now,
        deviceId: input.deviceId,
        pending: true,
      };
      file.sessions.push(session);
      const request: RequestRecord = {
        code: keep?.code ?? newApprovalCode(new Set(file.requests.map((r) => r.code))),
        deviceId: input.deviceId,
        sessionId: session.id,
        via: input.via,
        ...(input.keyId && { keyId: input.keyId }),
        ...(input.address && { address: input.address }),
        createdAt: keep?.createdAt ?? now,
        expiresAt,
      };
      file.requests.push(request);
      const device = file.devices.find((d) => d.id === input.deviceId);
      return {
        token,
        session,
        request: {
          code: formatApprovalCode(request.code),
          device: device ? deviceName(device) : name,
          expiresAt,
          state: 'waiting' as const,
        },
      };
    });
  }

  /** The approval this browser's session is waiting for, if it is. */
  async waitingFor(token: string): Promise<WaitingApproval | undefined> {
    const file = await this.get();
    const hash = hashToken(token);
    const now = Date.now();
    const session = file.sessions.find((s) => s.pending && safeEqual(s.hash, hash));
    if (!session || !alive(session, now)) return undefined;
    const request = file.requests.find((r) => r.sessionId === session.id && r.expiresAt > now);
    if (!request) return undefined;
    const device = file.devices.find((d) => d.id === request.deviceId);
    return {
      code: formatApprovalCode(request.code),
      device: device ? deviceName(device) : session.device,
      expiresAt: request.expiresAt,
      state: request.rejectedAt === undefined ? 'waiting' : 'rejected',
    };
  }

  /**
   * May a script using this key reach Conch from another device? Its
   * "device" is the key itself: approved once, it works from anywhere until
   * removed (or the key is revoked). Until then it asks, once, and every
   * call says the code. Writes only when something changed.
   */
  async scriptAccess(input: {
    keyId: string;
    keyName: string;
    userAgent?: string;
    address?: string;
  }): Promise<{ approved: true } | { approved: false; request: WaitingApproval }> {
    const now = Date.now();
    const file = await this.get();
    const device = file.devices.find((d) => d.keyId === input.keyId);
    if (device?.approvedAt !== undefined) {
      if (now - device.lastSeenAt > TOUCH_EVERY_MS)
        await this.#update((f) => {
          const d = f.devices.find((x) => x.id === device.id);
          if (d) d.lastSeenAt = now;
        });
      return { approved: true };
    }
    const asked = (f: AccessFile) => {
      const d = f.devices.find((x) => x.keyId === input.keyId);
      const r = d && f.requests.find((x) => x.deviceId === d.id && x.expiresAt > now);
      return d && r
        ? {
            approved: false as const,
            request: {
              code: formatApprovalCode(r.code),
              device: deviceName(d),
              expiresAt: r.expiresAt,
              state: r.rejectedAt === undefined ? ('waiting' as const) : ('rejected' as const),
            },
          }
        : undefined;
    };
    const already = asked(file);
    if (already) return already;
    return this.#update((f) => {
      const again = asked(f);
      if (again) return again;
      if (f.devices.find((x) => x.keyId === input.keyId)?.approvedAt !== undefined)
        return { approved: true as const };
      let d = f.devices.find((x) => x.keyId === input.keyId);
      if (!d) {
        d = {
          id: newId('dev'),
          hash: '',
          name: `Scripts using “${input.keyName}”`,
          kind: 'other',
          createdAt: now,
          lastSeenAt: now,
          keyId: input.keyId,
          via: 'key',
        };
        f.devices.push(d);
      }
      d.lastSeenAt = now;
      if (input.address) d.address = input.address;
      const waiting = f.requests.filter((r) => r.rejectedAt === undefined && r.expiresAt > now);
      if (waiting.length >= MAX_WAITING)
        throw new AccessError('busy', 'Too many devices are waiting to be approved.');
      f.requests = f.requests.filter((r) => r.deviceId !== d.id);
      const request: RequestRecord = {
        code: newApprovalCode(new Set(f.requests.map((r) => r.code))),
        deviceId: d.id,
        via: 'key',
        keyId: input.keyId,
        ...(input.address && { address: input.address }),
        createdAt: now,
        expiresAt: now + APPROVAL_TTL_MS,
      };
      f.requests.push(request);
      return {
        approved: false as const,
        request: {
          code: formatApprovalCode(request.code),
          device: deviceName(d),
          expiresAt: request.expiresAt,
          state: 'waiting' as const,
        },
      };
    });
  }

  /**
   * Approve the device waiting with this code. Its browser is let in where it
   * waits, without signing in again. A request turned down by mistake can
   * still be approved while it lasts.
   */
  async approve(code: string, how: ApprovedHow): Promise<DeviceRequest> {
    const wanted = normalizeApprovalCode(code);
    return this.#update((file) => {
      const now = Date.now();
      const request = file.requests.find((r) => r.code === wanted && r.expiresAt > now);
      const device = request && file.devices.find((d) => d.id === request.deviceId);
      if (!request || !device) throw new AccessError('not-found', NO_REQUEST);
      const info = requestInfo(file, request);
      device.approvedAt = now;
      device.approvedHow = how;
      const session = file.sessions.find((s) => s.id === request.sessionId);
      if (session) {
        session.pending = false;
        session.lastSeenAt = now;
        session.expiresAt = now + SESSION_MAX_AGE_MS;
      }
      file.requests = file.requests.filter((r) => r.deviceId !== device.id);
      return info;
    });
  }

  /**
   * Turn a device down. Its browser is told so, and the request stays (so it
   * can still be approved if that was a mistake) until it runs out.
   */
  async reject(code: string): Promise<DeviceRequest> {
    const wanted = normalizeApprovalCode(code);
    return this.#update((file) => {
      const request = file.requests.find((r) => r.code === wanted && r.expiresAt > Date.now());
      if (!request) throw new AccessError('not-found', NO_REQUEST);
      request.rejectedAt ??= Date.now();
      return requestInfo(file, request);
    });
  }

  /** Turn down every device waiting. Returns how many. */
  async rejectAll(): Promise<number> {
    return this.#update((file) => {
      const waiting = file.requests.filter((r) => r.rejectedAt === undefined);
      for (const r of waiting) r.rejectedAt = Date.now();
      return waiting.length;
    });
  }

  /**
   * Forget a device: it's signed out, and with approval on it has to be
   * approved again. Returns the sessions that ended.
   */
  async removeDevice(id: string): Promise<{ name: string; ended: string[] }> {
    return this.#update((file) => {
      const device = file.devices.find((d) => d.id === id);
      if (!device) throw new AccessError('not-found', 'No such device.');
      const ended = file.sessions.filter((s) => s.deviceId === id).map((s) => s.id);
      file.sessions = file.sessions.filter((s) => s.deviceId !== id);
      file.requests = file.requests.filter((r) => r.deviceId !== id);
      file.devices = file.devices.filter((d) => d.id !== id);
      return { name: deviceName(device), ended };
    });
  }

  /** Sign a device out, keeping it (and its approval). Returns the sessions that ended. */
  async signOutDevice(id: string): Promise<string[]> {
    return this.#update((file) => {
      if (!file.devices.some((d) => d.id === id))
        throw new AccessError('not-found', 'No such device.');
      const ended = file.sessions.filter((s) => s.deviceId === id).map((s) => s.id);
      file.sessions = file.sessions.filter((s) => s.deviceId !== id);
      return ended;
    });
  }

  async renameDevice(id: string, name: string): Promise<void> {
    await this.#update((file) => {
      const device = file.devices.find((d) => d.id === id);
      if (!device) throw new AccessError('not-found', 'No such device.');
      device.label = name.trim().slice(0, 64);
    });
  }

  /** Every device kept, signed in first, then by when it was last seen. */
  async devices(current?: { deviceId?: string }): Promise<DeviceInfo[]> {
    const file = await this.get();
    const now = Date.now();
    const signedIn = new Set(
      file.sessions.flatMap((s) => (!s.pending && alive(s, now) && s.deviceId ? [s.deviceId] : [])),
    );
    // A device that's neither approved nor signed in is remembered (to recognise it), not listed.
    return file.devices
      .filter((d) => d.approvedAt !== undefined || signedIn.has(d.id))
      .map((d) => ({
        id: d.id,
        name: deviceName(d),
        kind: d.kind,
        firstSeenAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        ...(d.address && { address: d.address }),
        approved: d.approvedAt !== undefined,
        ...(d.approvedAt !== undefined && { approvedAt: d.approvedAt }),
        ...(d.approvedHow && { approvedHow: d.approvedHow }),
        signedIn: signedIn.has(d.id),
        ...(d.via && { via: d.via }),
        script: d.keyId !== undefined,
        current: d.id === current?.deviceId,
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          Number(b.signedIn) - Number(a.signedIn) ||
          b.lastSeenAt - a.lastSeenAt,
      );
  }

  /** Devices waiting for approval (and those just turned down), newest first. */
  async requests(): Promise<DeviceRequest[]> {
    const file = await this.get();
    const now = Date.now();
    return file.requests
      .filter((r) => r.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => requestInfo(file, r));
  }
}

const NO_REQUEST =
  'No device is waiting with that code. It may have run out: sign in again on that device to get a new one.';

function requestInfo(file: AccessFile, r: RequestRecord): DeviceRequest {
  const device = file.devices.find((d) => d.id === r.deviceId);
  const key = r.keyId && file.keys.find((k) => k.id === r.keyId);
  return {
    code: formatApprovalCode(r.code),
    deviceId: r.deviceId,
    device: device ? deviceName(device) : 'Unknown device',
    kind: device?.kind ?? 'other',
    via: r.via,
    ...(key ? { keyName: key.name } : r.keyId === 'env' ? { keyName: 'CONCH_TOKEN' } : {}),
    ...(r.address && { address: r.address }),
    script: device?.keyId !== undefined,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    rejected: r.rejectedAt !== undefined,
  };
}

function keyInfo(record: z.infer<typeof KeyRecord>): AccessKeyInfo {
  return {
    id: record.id,
    name: record.name,
    hint: record.hint,
    createdAt: record.createdAt,
    ...(record.lastUsedAt && { lastUsedAt: record.lastUsedAt }),
  };
}
