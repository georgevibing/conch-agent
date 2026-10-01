/**
 * A `.conchbackup` file (ADR 0020): a tar.gz holding, in this order,
 *
 * 1. `conch-backup.json` — the header: format version, when, which Conch,
 *    what's inside and counted, and how the keys are locked;
 * 2. `files/<path>` — every kept file, by its path under `CONCH_HOME`;
 * 3. `seal.json` — each file's size and SHA-256, so damage is caught;
 * 4. `secrets.enc` — keys and sign-ins, when they're in it, encrypted with the
 *    passphrase. The encryption authenticates the header and the seal too.
 *
 * Reading checks everything before a single file lands anywhere but a
 * staging folder: paths, kinds of entry, sizes, sums and the passphrase.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import { BACKUP_LIMITS, BackupContents, BackupKind } from '@conch/protocol';
import { z } from 'zod';

import {
  BackupError,
  DAMAGED,
  readTar,
  TarWriter,
  type EntrySink,
  type ReadLimits,
  type Visit,
} from './archive';
import { associatedData, decrypt, encrypt, Lock, newLock, unlock } from './crypto';
import {
  classify,
  countContents,
  GROUP_DIRS,
  reader,
  walk,
  type BackupGroup,
  type BackupRule,
} from './manifest';
import { openIfSealed } from '../lib/sealed';
import { safeJoinPath, validRelPath } from './paths';

export const FORMAT = 'conch-backup';
/** This Conch writes format 1. */
export const FORMAT_VERSION = 1;
/** The oldest format this Conch can still read (after `migrate`). */
export const OLDEST_FORMAT = 1;

const HEADER = 'conch-backup.json';
const SEAL = 'seal.json';
const SECRETS = 'secrets.enc';
const FILES = 'files/';
const MAX_HEADER = 1024 * 1024;
const MAX_SEAL = 64 * 1024 * 1024;
const MAX_SECRETS = 16 * 1024 * 1024;
/**
 * The most a file the preview reads may hold (`integrations.json`, a
 * routine). One Conch wrote is a few kilobytes; a bigger one is refused
 * rather than left unread, so nothing in it can hide from the preview.
 */
export const MAX_CAPTURE = 8 * 1024 * 1024;

const Group = z.enum([
  'settings',
  'memory',
  'commands',
  'routines',
  'skills',
  'integrations',
  'chats',
  'secrets',
]);

export const Header = z.object({
  format: z.literal(FORMAT),
  version: z.literal(FORMAT_VERSION),
  createdAt: z.number(),
  conchVersion: z.string().max(64),
  kind: BackupKind,
  /** What it holds; a restore replaces exactly these. */
  groups: z.array(Group).max(16),
  /** Folders that existed, made again on restore even when empty. */
  dirs: z.array(z.string().max(64)).max(64),
  contents: BackupContents,
  secrets: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('passphrase'), lock: Lock }),
      /** The Undo copy: kept on this computer, never restored from a file. */
      z.object({ mode: z.literal('local') }),
    ])
    .optional(),
});
export type Header = z.infer<typeof Header>;

const Seal = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
type SealEntry = z.infer<typeof Seal>['files'][number];

const SecretFiles = z.object({
  files: z.array(z.object({ path: z.string(), data: z.string() })).max(16),
});

/**
 * Older formats are brought up to date here, one step at a time. Format 1 is
 * the first, so there's nothing to do yet; the table is where format 2 adds
 * `1: (header) => …`.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/** The header of a backup, checked, in today's format. */
export function parseHeader(bytes: Buffer): Header {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BackupError('not-backup', 'That file isn’t a Conch backup.');
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== FORMAT)
    throw new BackupError('not-backup', 'That file isn’t a Conch backup.');
  let version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number' || !Number.isInteger(version))
    throw new BackupError('damaged', DAMAGED);
  if (version > FORMAT_VERSION)
    throw new BackupError(
      'newer',
      'This backup was made by a newer Conch. Update Conch, then restore it.',
    );
  if (version < OLDEST_FORMAT)
    throw new BackupError(
      'older',
      'This backup is from an early Conch that this one can’t read. Restore it with the Conch that made it, then back up again.',
    );
  let current = raw as Record<string, unknown>;
  while (version < FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new BackupError('older', 'This backup’s format can’t be brought up to date.');
    current = { ...step(current), version: version + 1 };
    version += 1;
  }
  const parsed = Header.safeParse(current);
  if (!parsed.success) throw new BackupError('damaged', DAMAGED);
  return parsed.data;
}

/** An `access.json` with who may sign in, and nothing about signed-in devices or pairing codes. */
export function credentialsOnly(bytes: Buffer): Buffer | undefined {
  try {
    const raw = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const { version, method, username, passwordHash, keys } = raw;
    if (typeof method !== 'string') return undefined;
    return Buffer.from(
      `${JSON.stringify({ version, method, username, passwordHash, keys: Array.isArray(keys) ? keys : [] }, null, 2)}\n`,
    );
  } catch {
    // A damaged access.json isn't backed up: sign-in stays as it is on restore.
    return undefined;
  }
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export interface WriteOptions {
  kind: BackupKind;
  /** What goes in; `secrets` is decided by `secrets` below. */
  groups: BackupGroup[];
  secrets?: { mode: 'passphrase'; passphrase: string } | { mode: 'local' };
  /**
   * Secret files that only exist for a passphrase-locked backup (the key to
   * your passwords, `vault/key.json`): never on disk, never in a local copy.
   */
  extraSecrets?: () => Promise<{ path: string; data: Buffer }[]>;
  conchVersion: string;
  now?: number;
}

/**
 * Read a file under `home` as it will go in a backup, or undefined if it can't
 * go in. `unseal` opens Conch's sealed key files (`lib/sealed.ts`): their seal
 * is this computer's own, so a passphrase-locked backup carries them open
 * inside its encrypted part, and they're sealed again wherever they're restored.
 */
async function contentOf(
  home: string,
  path: string,
  options: { unseal?: boolean } = {},
): Promise<Buffer | undefined> {
  const full = join(home, ...path.split('/'));
  let bytes: Buffer | undefined = await readFile(full).catch(() => undefined);
  if (!bytes || bytes.length > BACKUP_LIMITS.maxFileBytes) return undefined;
  if (options.unseal) bytes = (await openIfSealed(full, bytes).catch(() => undefined))?.plain;
  if (!bytes) return undefined;
  return path === 'access.json' ? credentialsOnly(bytes) : bytes;
}

/**
 * Back up `home` into `out`. The file appears whole or not at all (written
 * aside, then renamed). Files that change while it's written are read once
 * each; a file removed meanwhile is simply not in it.
 */
export async function writeBackup(
  home: string,
  out: string,
  options: WriteOptions,
): Promise<{ header: Header; size: number }> {
  const all = await walk(home);
  const wants = (rule: BackupRule | undefined, cls: 'kept' | 'secret') =>
    rule?.class === cls && rule.group !== undefined && options.groups.includes(rule.group);
  const kept = all.filter((f) => wants(f.rule, 'kept') && validRelPath(f.path));
  const secret = options.secrets
    ? all.filter((f) => f.rule?.class === 'secret' && validRelPath(f.path))
    : [];
  const bytes = [...kept, ...secret].reduce((sum, f) => sum + f.size, 0);
  if (bytes > BACKUP_LIMITS.maxUnpackedBytes || kept.length > BACKUP_LIMITS.maxFiles)
    throw new BackupError(
      'too-big',
      'Your Conch is bigger than a backup can hold. Try it without chats.',
    );

  const groups: BackupGroup[] = [...options.groups.filter((g) => g !== 'secrets')];
  if (options.secrets) groups.push('secrets');
  const dirs: string[] = [];
  for (const group of groups)
    for (const dir of GROUP_DIRS[group] ?? [])
      if (
        await stat(join(home, dir)).then(
          (s) => s.isDirectory(),
          () => false,
        )
      )
        dirs.push(dir);

  const chats = groups.includes('chats');
  const lock =
    options.secrets?.mode === 'passphrase' ? await newLock(options.secrets.passphrase) : undefined;
  const header: Header = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: options.now ?? Date.now(),
    conchVersion: options.conchVersion,
    kind: options.kind,
    groups,
    dirs,
    contents: {
      ...(await countContents(kept, reader(home), { chats })),
      ...(options.secrets && { secrets: options.secrets.mode }),
    },
    ...(lock
      ? { secrets: { mode: 'passphrase' as const, lock: lock.lock } }
      : options.secrets && { secrets: { mode: 'local' as const } }),
  };
  const headerBytes = Buffer.from(JSON.stringify(header));

  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  const tmp = `${out}.${randomBytes(4).toString('hex')}.tmp`;
  const writer = new TarWriter();
  const done = pipeline(writer.gzip, createWriteStream(tmp, { mode: 0o600 }));
  // Surfaced by `done`; kept from being an unhandled rejection meanwhile.
  done.catch(() => undefined);
  try {
    await writer.add(HEADER, headerBytes, header.createdAt);
    const seal: SealEntry[] = [];
    const inFiles = options.secrets?.mode === 'local' ? [...kept, ...secret] : kept;
    for (const file of inFiles) {
      const data = await contentOf(home, file.path);
      if (!data) continue;
      await writer.add(`${FILES}${file.path}`, data, header.createdAt);
      seal.push({ path: file.path, size: data.length, sha256: sha256(data) });
    }
    const sealBytes = Buffer.from(JSON.stringify({ files: seal }));
    await writer.add(SEAL, sealBytes, header.createdAt);
    if (lock) {
      const files: { path: string; data: string }[] = [];
      for (const file of secret) {
        const data = await contentOf(home, file.path, { unseal: true });
        if (data) files.push({ path: file.path, data: data.toString('base64') });
      }
      for (const extra of (await options.extraSecrets?.()) ?? []) {
        if (!validRelPath(extra.path) || files.some((f) => f.path === extra.path)) continue;
        files.push({ path: extra.path, data: extra.data.toString('base64') });
      }
      const plain = Buffer.from(JSON.stringify({ files }));
      const sealed = encrypt(lock.key, lock.lock, plain, associatedData(headerBytes, sealBytes));
      await writer.add(SECRETS, sealed, header.createdAt);
    }
    await writer.end();
    await done;
    await rename(tmp, out);
  } catch (error) {
    writer.gzip.destroy();
    await done.catch(() => undefined);
    await rm(tmp, { force: true });
    throw error;
  }
  return { header, size: (await stat(out)).size };
}

/** Collects an entry's bytes (it's small: a header, a seal, the keys). */
function collector(max: number, done: (data: Buffer) => void | Promise<void>): EntrySink {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    write(chunk) {
      size += chunk.length;
      if (size > max) throw new BackupError('damaged', DAMAGED);
      chunks.push(chunk);
    },
    end: () => done(Buffer.concat(chunks)),
  };
}

/** The gunzipped bytes of a backup file, with gzip's errors put in plain words. */
async function* unpacked(path: string): AsyncGenerator<Buffer> {
  const gunzip = createGunzip();
  const input = createReadStream(path);
  input.on('error', (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  let any = false;
  try {
    for await (const chunk of gunzip) {
      any = true;
      yield chunk as Buffer;
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BackupError('not-found', 'That backup is gone.');
    throw any
      ? new BackupError('damaged', DAMAGED)
      : new BackupError('not-backup', 'That file isn’t a Conch backup.');
  } finally {
    input.destroy();
    gunzip.destroy();
  }
}

/** Just the header, for the list and the preview. Reads only the start of the file. */
export async function readHeader(path: string): Promise<Header> {
  // Assigned in callbacks: cast so the checks below aren't narrowed to `undefined`.
  let header = undefined as Header | undefined;
  await readTar(unpacked(path), (entry): Visit => {
    if (header) return 'stop';
    if (entry.name !== HEADER || entry.size > MAX_HEADER)
      throw new BackupError('not-backup', 'That file isn’t a Conch backup.');
    return collector(MAX_HEADER, (data) => {
      header = parseHeader(data);
    });
  });
  if (!header) throw new BackupError('not-backup', 'That file isn’t a Conch backup.');
  return header;
}

export interface Extracted {
  header: Header;
  /** Paths written under the staging folder (kept files, and the Undo copy's keys). */
  files: string[];
  /** Keys and sign-ins opened with the passphrase, also written there. */
  secrets: string[];
  /** The bytes of the files `capture` asked for, by path, once checked against the seal. */
  captured: Map<string, Buffer>;
}

export interface ExtractOptions {
  /**
   * Where the files go, never `CONCH_HOME` itself. Without it, every file is
   * read and checked just the same, and nothing is written: a preview.
   */
  staging?: string;
  passphrase?: string;
  /** Leave the keys and sign-ins out (a forgotten passphrase). */
  skipSecrets?: boolean;
  /** Keys that aren't locked are accepted: only for Undo copies this computer made. */
  allowLocal?: boolean;
  /** Tighter limits than `BACKUP_LIMITS` (tests), and the room on the disk. */
  limits?: ReadLimits;
  /** Files also kept in memory, for the preview to read (at most `MAX_CAPTURE` each). */
  capture?: (path: string) => boolean;
}

/**
 * Check a backup through and write its files under `staging`. Throws
 * `BackupError` — and has written nothing outside `staging` — on anything
 * wrong: an unsafe path, a link, damage, too much, a wrong passphrase.
 * Without `staging` it only reads (the preview): the same checks, the files
 * it holds, and the few the preview reads, from the file itself — never
 * what its header says it holds.
 */
export async function extractBackup(path: string, options: ExtractOptions): Promise<Extracted> {
  // Only a restore opens the locked keys: they have to be written somewhere.
  if (!options.staging) options = { ...options, skipSecrets: true };
  // Assigned in callbacks: cast so the checks below aren't narrowed to `undefined`.
  let header = undefined as Header | undefined;
  let headerBytes = undefined as Buffer | undefined;
  let sealBytes = undefined as Buffer | undefined;
  let secretsBytes = undefined as Buffer | undefined;
  let key = undefined as Buffer | undefined;
  const staged: SealEntry[] = [];
  const seen = new Set<string>();
  const captured = new Map<string, Buffer>();
  const files = options.staging ? join(options.staging, 'files') : undefined;
  if (files) await mkdir(files, { recursive: true, mode: 0o700 });

  const unsafe = () =>
    new BackupError('unsafe', 'This backup tries to write where Conch never restores to.');

  const fileSink = async (rel: string, size: number): Promise<EntrySink> => {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    if (files) {
      const target = safeJoinPath(files, rel);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // `wx`: never through something already there (a link, a second copy).
      handle = await open(target, 'wx', 0o600);
    }
    const keep = options.capture?.(rel) ? ([] as Buffer[]) : undefined;
    // Too big to read for the preview is too big to be real: nothing may hide in it.
    if (keep && size > MAX_CAPTURE) {
      await handle?.close();
      throw new BackupError('damaged', DAMAGED);
    }
    const hash = createHash('sha256');
    let written = 0;
    return {
      async write(chunk) {
        written += chunk.length;
        if (keep && written > MAX_CAPTURE) throw new BackupError('damaged', DAMAGED);
        hash.update(chunk);
        keep?.push(Buffer.from(chunk));
        await handle?.write(chunk);
      },
      async end() {
        await handle?.close();
        if (written !== size) throw new BackupError('damaged', DAMAGED);
        staged.push({ path: rel, size, sha256: hash.digest('hex') });
        if (keep) captured.set(rel, Buffer.concat(keep));
      },
    };
  };

  await readTar(
    unpacked(path),
    async (entry): Promise<Visit> => {
      if (!header) {
        if (entry.name !== HEADER || entry.size > MAX_HEADER)
          throw new BackupError('not-backup', 'That file isn’t a Conch backup.');
        return collector(MAX_HEADER, async (data) => {
          header = parseHeader(data);
          headerBytes = data;
          if (header.secrets?.mode === 'local' && !options.allowLocal)
            throw new BackupError(
              'local-only',
              'This is a copy Conch keeps on the computer that made it, so it can’t be restored from a file.',
            );
          // Ask for the passphrase before reading the rest, not after.
          if (header.secrets?.mode === 'passphrase' && !options.skipSecrets) {
            if (!options.passphrase)
              throw new BackupError(
                'needs-passphrase',
                'Enter the passphrase you chose to unlock the keys and sign-ins in this backup.',
              );
            key = await unlock(header.secrets.lock, options.passphrase);
          }
        });
      }
      if (entry.name.startsWith(FILES)) {
        if (sealBytes) throw new BackupError('damaged', DAMAGED);
        const rel = entry.name.slice(FILES.length);
        if (!validRelPath(rel)) throw unsafe();
        const rule = classify(rel);
        const allowed =
          rule?.group !== undefined &&
          header.groups.includes(rule.group) &&
          (rule.class === 'kept' || (rule.class === 'secret' && header.secrets?.mode === 'local'));
        if (!allowed) throw unsafe();
        const folded = rel.toLowerCase();
        if (seen.has(folded)) throw new BackupError('damaged', DAMAGED);
        seen.add(folded);
        return fileSink(rel, entry.size);
      }
      if (entry.name === SEAL) {
        if (sealBytes || entry.size > MAX_SEAL) throw new BackupError('damaged', DAMAGED);
        return collector(MAX_SEAL, (data) => {
          sealBytes = data;
        });
      }
      if (entry.name === SECRETS) {
        if (!sealBytes || secretsBytes || header.secrets?.mode !== 'passphrase')
          throw new BackupError('damaged', DAMAGED);
        if (entry.size > MAX_SECRETS) throw new BackupError('damaged', DAMAGED);
        if (options.skipSecrets) return 'skip';
        return collector(MAX_SECRETS, (data) => {
          secretsBytes = data;
        });
      }
      throw unsafe();
    },
    options.limits,
  );

  if (!header || !headerBytes || !sealBytes) throw new BackupError('damaged', DAMAGED);
  // Every file, in order, with the size and sum the seal says.
  let seal: SealEntry[];
  try {
    seal = Seal.parse(JSON.parse(sealBytes.toString('utf8'))).files;
  } catch {
    throw new BackupError('damaged', DAMAGED);
  }
  const same =
    seal.length === staged.length &&
    seal.every(
      (s, i) =>
        s.path === staged[i]?.path && s.size === staged[i].size && s.sha256 === staged[i].sha256,
    );
  if (!same) throw new BackupError('damaged', DAMAGED);

  const secrets: string[] = [];
  if (header.secrets?.mode === 'passphrase' && !options.skipSecrets) {
    if (!secretsBytes || !key) throw new BackupError('damaged', DAMAGED);
    const plain = decrypt(
      key,
      header.secrets.lock,
      secretsBytes,
      associatedData(headerBytes, sealBytes),
    );
    let payload: z.infer<typeof SecretFiles>;
    try {
      payload = SecretFiles.parse(JSON.parse(plain.toString('utf8')));
    } catch {
      throw new BackupError('damaged', DAMAGED);
    }
    if (!files) throw new BackupError('damaged', DAMAGED);
    for (const file of payload.files) {
      if (!validRelPath(file.path) || classify(file.path)?.class !== 'secret') throw unsafe();
      const target = safeJoinPath(files, file.path);
      // Secrets in a folder (`vault/`) need it made first.
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const handle = await open(target, 'wx', 0o600).catch(() => {
        throw new BackupError('damaged', DAMAGED);
      });
      await handle.writeFile(Buffer.from(file.data, 'base64'));
      await handle.close();
      secrets.push(file.path);
    }
  }
  return { header, files: staged.map((s) => s.path), secrets, captured };
}
