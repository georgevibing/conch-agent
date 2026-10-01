/**
 * `~/.conch/vault/vault.json` — Conch's own passwords, encrypted (ADR 0025).
 *
 * On disk only ids and version numbers are readable. Opening the vault
 * decrypts every item into memory (a vault is small; search and health need
 * it all); every change rewrites the file atomically.
 */
import { hkdfSync, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Id,
  VAULT_LIMITS,
  VaultField,
  VaultItemType,
  VaultPasskey,
  VaultSourceId,
  VaultUrl,
} from '@conch/protocol';
import { z } from 'zod';

import { deriveKey, SCRYPT } from '../auth/secrets';
import { Mutex, writeJson } from '../lib/fs';
import {
  indexMac,
  macMatches,
  newVaultKey,
  openItem,
  Sealed,
  sealItem,
  unwrapKey,
  VaultCryptoError,
  wrapKey,
} from './crypto';
import type { Keystore, KeystoreKind } from './keystore';

export const Use = z.object({
  at: z.number(),
  how: z.enum(['revealed', 'copied', 'filled', 'agent', 'code']),
  /** The site or the thing it went to ("OpenRouter key"). */
  where: z.string().max(300).optional(),
});
export type Use = z.infer<typeof Use>;

/** An item as it is once decrypted. Never leaves the gateway as it is. */
export const ItemRecord = z.object({
  id: Id,
  type: VaultItemType,
  title: z.string().max(VAULT_LIMITS.maxTitle),
  fields: z.array(VaultField).max(VAULT_LIMITS.maxFields),
  urls: z.array(VaultUrl).max(VAULT_LIMITS.maxUrls),
  tags: z.array(z.string()).max(VAULT_LIMITS.maxTags),
  notes: z.string().max(VAULT_LIMITS.maxNotes),
  favorite: z.boolean(),
  agentAccess: z.enum(['ask', 'allow', 'never']),
  agentRead: z.enum(['ask', 'allow']).default('ask'),
  allowedSites: z.array(z.string()).max(20),
  createdAt: z.number(),
  updatedAt: z.number(),
  usedAt: z.number().optional(),
  deletedAt: z.number().optional(),
  history: z.array(z.object({ fieldId: Id, value: z.string(), changedAt: z.number() })).default([]),
  uses: z.array(Use).default([]),
  passkeys: z.array(VaultPasskey).max(20).default([]),
  /**
   * Copied from another password manager (ADR 0025 § Moving in): which item
   * it was, and a keyed fingerprint of what it held, to tell when it changed.
   * `detached` once edited here, so a sync never overwrites your edit.
   */
  origin: z
    .object({
      source: VaultSourceId,
      ref: z.string().min(1).max(300),
      fp: z.string().max(64),
      syncedAt: z.number(),
      detached: z.boolean().default(false),
    })
    .optional(),
  /** Breach results per field, valid while the field's fingerprint is the same. */
  breach: z
    .record(z.string(), z.object({ fp: z.string(), count: z.number(), checkedAt: z.number() }))
    .default({}),
});
export type ItemRecord = z.infer<typeof ItemRecord>;

/**
 * The password lock (ADR 0025 § The lock): VK wrapped under
 * HKDF(scrypt(password) ‖ device key), so a copied `~/.conch` can't be
 * guessed at elsewhere. Bounded so a crafted file can't ask for minutes of work.
 */
const Lock = z.object({
  kdf: z.object({
    name: z.literal('scrypt'),
    N: z
      .number()
      .int()
      .min(2 ** 15)
      .max(2 ** 20),
    r: z.number().int().min(8).max(16),
    p: z.number().int().min(1).max(4),
  }),
  salt: z.string().regex(/^[A-Za-z0-9_-]{22,}$/),
  sealed: Sealed,
});

const VaultFile = z.object({
  format: z.literal(1),
  keystore: z.enum(['keychain', 'file']),
  /** Opened by the device key alone. Absent while the lock is on. */
  wrap: Sealed.optional(),
  lock: Lock.optional(),
  items: z.array(z.object({ id: Id, v: z.number().int().positive(), s: Sealed })),
  mac: z.string(),
});
type VaultFile = z.infer<typeof VaultFile>;

export class VaultLockedError extends Error {}

/** The lock is on and Passwords hasn't been unlocked since. */
export class VaultIsLocked extends VaultLockedError {
  constructor() {
    super('Passwords is locked. Unlock it with its password.');
  }
}

export class WrongPassword extends Error {
  constructor() {
    super('That isn’t the password for Passwords.');
  }
}

export interface OpenedVault {
  /** Items that opened. */
  items: Map<string, ItemRecord>;
  /** Items whose ciphertext didn't open: kept, never silently dropped. */
  damaged: string[];
  /** The file's item list didn't match its check: something changed it outside Conch. */
  tampered: boolean;
}

export class VaultStore {
  readonly #mutex = new Mutex();
  #vk?: Buffer;
  #file?: VaultFile;
  #opened?: OpenedVault;
  #versions = new Map<string, number>();

  constructor(
    readonly dir: string,
    private readonly keystore: () => Promise<Keystore>,
  ) {}

  get path() {
    return join(this.dir, 'vault.json');
  }

  async #read(): Promise<VaultFile | undefined> {
    const text = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (text === undefined) return undefined;
    const parsed = VaultFile.safeParse(JSON.parse(text));
    if (!parsed.success) throw new VaultCryptoError('The passwords file is damaged.');
    return parsed.data;
  }

  /** How the vault on disk is locked (or will be, once made). */
  async protection(): Promise<KeystoreKind> {
    const file = this.#file ?? (await this.#read().catch(() => undefined));
    return file?.keystore ?? (await this.keystore()).kind;
  }

  /**
   * A restored backup left the vault's key beside it (`key.json`): move it
   * into this computer's keystore and delete the file, so the restored
   * passwords open here.
   */
  async #adoptRestored(keystore: Keystore): Promise<void> {
    const path = join(this.dir, 'key.json');
    const text = await readFile(path, 'utf8').catch(() => undefined);
    if (text === undefined) return;
    try {
      const parsed = z.object({ format: z.literal(1), key: z.string() }).parse(JSON.parse(text));
      const vk = Buffer.from(parsed.key, 'base64url');
      const file = await this.#read();
      if (vk.length !== 32 || !file) throw new VaultCryptoError('damaged');
      if (!macMatches(file.mac, indexMac(vk, file.items)))
        throw new VaultCryptoError('The restored passwords don’t match their key.');
      const kek = await keystore.deviceKey();
      const { lock: _lock, ...unlocked } = file;
      await writeJson(this.path, { ...unlocked, keystore: keystore.kind, wrap: wrapKey(kek, vk) });
      kek.fill(0);
      vk.fill(0);
    } finally {
      // Never left lying around, whether it worked or not.
      await rm(path, { force: true });
    }
  }

  /** Decrypt everything. Makes an empty vault the first time. */
  open(): Promise<OpenedVault> {
    return this.#mutex.run(async () => {
      if (this.#opened) return this.#opened;
      const keystore = await this.keystore();
      await this.#adoptRestored(keystore).catch(() => undefined);
      let file = await this.#read();
      if (!file) {
        const vk = newVaultKey();
        const kek = await keystore.deviceKey();
        file = {
          format: 1,
          keystore: keystore.kind,
          wrap: wrapKey(kek, vk),
          items: [],
          mac: indexMac(vk, []),
        };
        kek.fill(0);
        await writeJson(this.path, file);
        this.#vk = vk;
      } else if (!file.wrap) {
        // The lock is on: only `unlock()` can bring the key back.
        if (!this.#vk) {
          this.#file = file;
          throw new VaultIsLocked();
        }
      } else {
        const kek = await keystore.deviceKey();
        try {
          this.#vk = unwrapKey(kek, file.wrap);
        } catch {
          throw new VaultLockedError(
            'Conch can’t open your passwords on this computer: the key that opens them isn’t the one here. Restore a backup with its passphrase to bring them back.',
          );
        } finally {
          kek.fill(0);
        }
      }
      const vk = this.#vk;
      if (!vk) throw new VaultIsLocked();
      const items = new Map<string, ItemRecord>();
      const damaged: string[] = [];
      for (const entry of file.items) {
        this.#versions.set(entry.id, entry.v);
        try {
          const record = ItemRecord.parse(openItem(vk, entry.id, entry.v, entry.s));
          if (record.id !== entry.id) throw new VaultCryptoError('damaged');
          items.set(entry.id, record);
        } catch {
          damaged.push(entry.id);
        }
      }
      const tampered = !macMatches(file.mac, indexMac(vk, file.items));
      this.#file = file;
      this.#opened = { items, damaged, tampered };
      return this.#opened;
    });
  }

  async #write(file: VaultFile) {
    if (!this.#vk) throw new VaultLockedError('The vault isn’t open.');
    file.mac = indexMac(this.#vk, file.items);
    await writeJson(this.path, file);
    this.#file = file;
    if (this.#opened) this.#opened.tampered = false;
  }

  /** Save one item (new or changed). */
  async put(record: ItemRecord): Promise<void> {
    await this.open();
    return this.#mutex.run(async () => {
      const vk = this.#vk;
      const file = this.#file;
      if (!vk || !file || !this.#opened) throw new VaultLockedError('The vault isn’t open.');
      const parsed = ItemRecord.parse(record);
      const v = (this.#versions.get(parsed.id) ?? 0) + 1;
      const sealed = sealItem(vk, parsed.id, v, parsed);
      const items = file.items.filter((e) => e.id !== parsed.id);
      items.push({ id: parsed.id, v, s: sealed });
      await this.#write({ ...file, items });
      this.#versions.set(parsed.id, v);
      this.#opened.items.set(parsed.id, parsed);
      this.#opened.damaged = this.#opened.damaged.filter((d) => d !== parsed.id);
    });
  }

  /** Many at once (an import): one write. */
  async putMany(records: ItemRecord[]): Promise<void> {
    await this.open();
    return this.#mutex.run(async () => {
      const vk = this.#vk;
      const file = this.#file;
      if (!vk || !file || !this.#opened) throw new VaultLockedError('The vault isn’t open.');
      const byId = new Map(file.items.map((e) => [e.id, e]));
      const done: [ItemRecord, number][] = [];
      for (const record of records) {
        const parsed = ItemRecord.parse(record);
        const v = (this.#versions.get(parsed.id) ?? 0) + 1;
        byId.set(parsed.id, { id: parsed.id, v, s: sealItem(vk, parsed.id, v, parsed) });
        done.push([parsed, v]);
      }
      await this.#write({ ...file, items: [...byId.values()] });
      for (const [parsed, v] of done) {
        this.#versions.set(parsed.id, v);
        this.#opened.items.set(parsed.id, parsed);
      }
    });
  }

  /** Gone for good (emptying Recently deleted). */
  async remove(ids: readonly string[]): Promise<void> {
    await this.open();
    return this.#mutex.run(async () => {
      const file = this.#file;
      if (!file || !this.#opened) throw new VaultLockedError('The vault isn’t open.');
      const drop = new Set(ids);
      await this.#write({ ...file, items: file.items.filter((e) => !drop.has(e.id)) });
      for (const id of drop) {
        this.#opened.items.delete(id);
        this.#versions.delete(id);
      }
      this.#opened.damaged = this.#opened.damaged.filter((d) => !drop.has(d));
    });
  }

  // ── The lock ────────────────────────────────────────────────────────────

  async #lockKey(
    password: string,
    salt: Buffer,
    deviceKey: Buffer,
    kdf: z.infer<typeof Lock>['kdf'],
  ) {
    const stretched = await deriveKey(password, salt, kdf);
    try {
      return Buffer.from(
        hkdfSync(
          'sha256',
          Buffer.concat([stretched, deviceKey]),
          salt,
          Buffer.from('conch-vault/1 lock'),
          32,
        ),
      );
    } finally {
      stretched.fill(0);
    }
  }

  /** Whether the lock is on, and whether it's open right now. */
  async lockState(): Promise<{ enabled: boolean; locked: boolean }> {
    const file = this.#file ?? (await this.#read().catch(() => undefined));
    const enabled = Boolean(file?.lock && !file.wrap);
    return { enabled, locked: enabled && !this.#vk };
  }

  /** Open a locked vault with its password. Throws `WrongPassword`. */
  async unlock(password: string): Promise<void> {
    const file = await this.#read();
    if (!file?.lock) return;
    const keystore = await this.keystore();
    const device = await keystore.deviceKey();
    const kek = await this.#lockKey(
      password,
      Buffer.from(file.lock.salt, 'base64url'),
      device,
      file.lock.kdf,
    );
    let vk: Buffer;
    try {
      vk = unwrapKey(kek, file.lock.sealed, 'lock');
    } catch {
      throw new WrongPassword();
    } finally {
      kek.fill(0);
      device.fill(0);
    }
    this.reset();
    this.#vk = vk;
    await this.open();
  }

  /** Turn the lock on: from now on the vault opens only with this password. */
  async enableLock(password: string): Promise<void> {
    await this.open();
    return this.#mutex.run(async () => {
      const file = this.#file;
      const vk = this.#vk;
      if (!file || !vk) throw new VaultIsLocked();
      const salt = randomBytes(16);
      const device = await (await this.keystore()).deviceKey();
      const kek = await this.#lockKey(password, salt, device, {
        name: 'scrypt',
        N: SCRYPT.N,
        r: SCRYPT.r,
        p: SCRYPT.p,
      });
      device.fill(0);
      const { wrap: _, ...rest } = file;
      await this.#write({
        ...rest,
        lock: {
          kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
          salt: salt.toString('base64url'),
          sealed: wrapKey(kek, vk, 'lock'),
        },
      });
      kek.fill(0);
    });
  }

  /** Turn the lock off (it must be open): the device key alone opens it again. */
  async disableLock(): Promise<void> {
    await this.open();
    return this.#mutex.run(async () => {
      const file = this.#file;
      const vk = this.#vk;
      if (!file || !vk) throw new VaultIsLocked();
      const kek = await (await this.keystore()).deviceKey();
      const { lock: _, ...rest } = file;
      await this.#write({ ...rest, wrap: wrapKey(kek, vk) });
      kek.fill(0);
    });
  }

  /** Close it: the key and every item leave memory. A no-op without the lock. */
  async lock(): Promise<void> {
    const { enabled } = await this.lockState();
    if (enabled) this.reset();
  }

  /** The vault key, wrapped for a passphrase-locked backup (`wrapKey(backupKey, vk, 'backup')`). */
  async wrapFor(key: Buffer): Promise<Sealed> {
    await this.open();
    if (!this.#vk) throw new VaultLockedError('The vault isn’t open.');
    return wrapKey(key, this.#vk, 'backup');
  }

  /**
   * A vault file from a backup, with its key: re-wrapped for this computer's
   * keystore and written in place of the current one. The file itself (items,
   * check) comes over untouched, so nothing can be added on the way.
   */
  async adopt(text: string, vk: Buffer): Promise<void> {
    return this.#mutex.run(async () => {
      const incoming = VaultFile.parse(JSON.parse(text));
      if (!macMatches(incoming.mac, indexMac(vk, incoming.items)))
        throw new VaultCryptoError('The passwords in that backup don’t match their key.');
      const keystore = await this.keystore();
      const kek = await keystore.deviceKey();
      // A restored vault opens with this computer's key; the lock (if it had one) is set up again here.
      const { lock: _lock, ...unlocked } = incoming;
      const file: VaultFile = { ...unlocked, keystore: keystore.kind, wrap: wrapKey(kek, vk) };
      kek.fill(0);
      await writeJson(this.path, file);
      this.#vk = Buffer.from(vk);
      this.#file = undefined;
      this.#opened = undefined;
      this.#versions.clear();
    });
  }

  /** Forget what's in memory (after a restore wrote a new file). */
  reset(): void {
    this.#vk?.fill(0);
    this.#vk = undefined;
    this.#file = undefined;
    this.#opened = undefined;
    this.#versions.clear();
  }

  /** The raw file, for a backup (ciphertext only). */
  async rawFile(): Promise<string | undefined> {
    await this.open();
    return readFile(this.path, 'utf8');
  }

  /** The vault key, for keyed fingerprints. Only while open. */
  async key(): Promise<Buffer> {
    await this.open();
    if (!this.#vk) throw new VaultLockedError('The vault isn’t open.');
    return this.#vk;
  }
}
