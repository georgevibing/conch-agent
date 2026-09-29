import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AccessMethod,
  SignInVia,
  checkPassword,
  type AccessKeyInfo,
  type CreatedKey,
  type SessionInfo,
} from '@conch/protocol';
import { z } from 'zod';

import { newId } from '../lib/ids';
import { Mutex, readJson, writeJson } from '../lib/fs';
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
  kind: z.enum(['desktop', 'phone', 'tablet', 'other']),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  verifiedAt: z.number(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

const PairingRecord = z.object({ hash: z.string(), createdAt: z.number(), expiresAt: z.number() });

const AccessFile = z.object({
  version: z.literal(1).default(1),
  method: AccessMethod.default('none'),
  username: z.string().optional(),
  passwordHash: z.string().optional(),
  keys: z.array(KeyRecord).default([]),
  sessions: z.array(SessionRecord).default([]),
  pairings: z.array(PairingRecord).default([]),
});
export type AccessFile = z.infer<typeof AccessFile>;

export class AccessError extends Error {
  constructor(
    readonly code: 'invalid' | 'weak-password' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

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
  /** Two concurrent password hashes at most (128 MiB each). */
  #hashing = new Semaphore(2);
  readonly path: string;

  constructor(home: string) {
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
      this.#cache = AccessFile.parse((await readJson(this.path)) ?? {});
      this.#mtime = mtime;
    }
    return this.#cache;
  }

  #update<T>(fn: (file: AccessFile) => T | Promise<T>): Promise<T> {
    return this.#mutex.run(async () => {
      this.#checkedAt = 0;
      const file = structuredClone(await this.get());
      const result = await fn(file);
      const now = Date.now();
      file.sessions = file.sessions.filter((s) => alive(s, now));
      file.pairings = file.pairings.filter((p) => p.expiresAt > now);
      await writeJson(this.path, file);
      this.#cache = file;
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
    await this.#update((file) => {
      file.method = 'password';
      file.username = username.trim();
      file.passwordHash = passwordHash;
      file.keys = [];
      file.sessions = file.sessions.filter((s) => s.id === keepSessionId);
    });
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
    await this.#update((file) => {
      if (file.method !== 'key') {
        file.method = 'key';
        delete file.username;
        delete file.passwordHash;
        file.sessions = file.sessions.filter((s) => s.id === keepSessionId);
      }
      file.keys.push(record);
    });
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
    return this.#update((file) => {
      const ended = file.sessions.map((s) => s.id);
      file.method = 'none';
      delete file.username;
      delete file.passwordHash;
      file.keys = [];
      file.sessions = [];
      file.pairings = [];
      return ended;
    });
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
    };
    await this.#update((file) => void file.sessions.push(session));
    return { token, session };
  }

  /** The live session for a cookie value, if any. Refreshes lastSeenAt now and then. */
  async findSession(token: string): Promise<SessionRecord | undefined> {
    const file = await this.get();
    if (file.method === 'none' && !file.sessions.length) return undefined;
    const hash = hashToken(token);
    const now = Date.now();
    const session = file.sessions.find((s) => safeEqual(s.hash, hash));
    if (!session || !alive(session, now)) return undefined;
    if (now - session.lastSeenAt > TOUCH_EVERY_MS) {
      await this.#update((f) => {
        const s = f.sessions.find((x) => x.id === session.id);
        if (s) s.lastSeenAt = now;
      });
    }
    return session;
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
      .filter((s) => alive(s, now))
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
