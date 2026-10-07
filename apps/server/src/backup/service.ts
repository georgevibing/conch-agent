/**
 * Back up and restore your Conch (ADR 0020).
 *
 * - **Automatically**, once a day, when nothing is busy: into
 *   `CONCH_HOME/backups/`, chats included, keys and sign-ins not (they're
 *   already on this disk). Seven dailies and four weeklies are kept.
 * - **Back up now** makes a file to download, with chats if you like and your
 *   keys and sign-ins locked with a passphrase if you ask.
 * - **Restore** checks a backup through, keeps what's here now as an Undo
 *   copy, stages the files, and finishes when Conch starts again
 *   (`restore.ts`), before anything reads them.
 */
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

import {
  BACKUP_EXTENSION,
  BACKUP_LIMITS,
  type BackupContents,
  type BackupKind,
  type BackupPreview,
  type BackupStatus,
  type BackupSummary,
  Id,
  type RestoredFrom,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, safeJoin, writeJson } from '../lib/fs';
import { readStore, type Heal } from '../lib/recover';
import { BackupError, NO_ROOM } from './archive';
import { extractBackup, readHeader, writeBackup, type Header } from './format';
import { countContents, groupsFor, walk, type BackupGroup } from './manifest';
import { powersOf, previewReads } from './powers';
import { backupsDir, Journal, journalPath, Plan, stagingDir } from './restore';
import { currentAccess, hasSignIn, signInAfterRestore, stagedAccess } from './signin';
import { dayOf, retain, retainUndo } from './retention';

/** How long nothing must have happened in a chat before a backup starts. */
export const IDLE_MS = 5 * 60_000;
/** How often Conch looks whether a backup is due. */
const TICK_MS = 10 * 60_000;
/** The first look, a little after starting (so starting stays quick). */
const FIRST_TICK_MS = 2 * 60_000;
/** Files to download and files uploaded to restore are cleared after this. */
const TRANSIENT_MS = 60 * 60_000;
/**
 * A restore is mentioned, with Undo, for a day. Its Undo copy stays in the
 * list longer (see `retainUndo`).
 */
const UNDO_OFFER_MS = 24 * 60 * 60_000;
/** Room left free on the disk besides the backup itself. */
const SPARE_BYTES = 64 * 1024 * 1024;
/** Room left free besides a file uploaded to restore from: restoring it needs space too. */
const UPLOAD_SPARE_BYTES = 1024 ** 3;

const PREFIX: Record<BackupKind, string> = {
  automatic: 'auto',
  'before-restore': 'undo',
  manual: 'export',
  uploaded: 'upload',
};
const kindOf = (id: string): BackupKind | undefined =>
  (Object.entries(PREFIX) as [BackupKind, string][]).find(([, p]) => id.startsWith(`${p}-`))?.[0];

/** What a backup's files hold, read for the preview. */
interface Inspection {
  header: Header;
  contents: BackupContents;
  powers: BackupPreview['powers'];
}
/** The most things-that-act-for-you a preview lists; the rest are counted. */
const MAX_POWERS = 40;

const SettingsFile = z.object({
  version: z.literal(1).default(1),
  automatic: z.boolean().default(true),
  /** When Conch first looked after backups here (a new install isn't “overdue”). */
  since: z.number().optional(),
});
type Settings = z.infer<typeof SettingsFile>;

export interface BackupDeps {
  home: string;
  conchVersion: string;
  /** Something is running or waiting on someone (a turn, a routine). */
  busy: () => boolean;
  /** When a chat last did anything. */
  lastActivity: () => number;
  /** Tell the page to look again (`backups.changed`). */
  emit: () => void;
  heal?: Heal;
  now?: () => number;
  /** Free bytes on the disk holding `dir`, or undefined when that can't be told. */
  freeBytes?: (dir: string) => Promise<number | undefined>;
  /** Secret files made only for a passphrase-locked backup (the key to your passwords). */
  extraSecrets?: () => Promise<{ path: string; data: Buffer }[]>;
}

async function diskFree(dir: string): Promise<number | undefined> {
  try {
    const info = await statfs(dir);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return undefined;
  }
}

const stamp = (at: number) =>
  new Date(at)
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');

/** `Conch backup 2026-09-30.conchbackup`, in the local date. */
export function fileName(at: number): string {
  return `Conch backup ${dayOf(at)}${BACKUP_EXTENSION}`;
}

export class BackupService {
  readonly dir: string;
  #mutex = new Mutex();
  #running?: 'backing-up' | 'restoring';
  #problem?: string;
  #settings?: Promise<Settings>;
  #summaries = new Map<string, { mtimeMs: number; summary: BackupSummary }>();
  #inspected = new Map<string, { mtimeMs: number; size: number; inspection: Inspection }>();
  #timer?: NodeJS.Timeout;
  #first?: NodeJS.Timeout;

  constructor(private readonly deps: BackupDeps) {
    this.dir = backupsDir(deps.home);
  }

  get #now() {
    return this.deps.now?.() ?? Date.now();
  }

  // ── Settings ─────────────────────────────────────────────────────────

  get #settingsPath() {
    return join(this.deps.home, 'backups.json');
  }

  settings(): Promise<Settings> {
    this.#settings ??= readStore(this.#settingsPath, SettingsFile, {
      onRepair: () =>
        this.deps.heal?.(
          'backups',
          'Turned daily backups back on. The settings were damaged; a copy is kept.',
        ),
    }).then(
      async ({ value }) => {
        if (value.since) return value;
        const next = { ...value, since: this.#now };
        await writeJson(this.#settingsPath, next).catch(() => undefined);
        return next;
      },
      (error: unknown) => {
        this.#settings = undefined;
        throw error;
      },
    );
    return this.#settings;
  }

  async setAutomatic(automatic: boolean): Promise<BackupStatus> {
    const next = { ...(await this.settings()), automatic };
    await writeJson(this.#settingsPath, next);
    this.#settings = Promise.resolve(next);
    if (!automatic) this.#problem = undefined;
    this.deps.emit();
    return this.status();
  }

  // ── Files ────────────────────────────────────────────────────────────

  pathOf(id: string): string {
    return safeJoin(this.dir, `${Id.parse(id)}${BACKUP_EXTENSION}`);
  }

  #newId(kind: BackupKind, at: number, existing: Set<string>): string {
    const base =
      kind === 'automatic' || kind === 'before-restore'
        ? `${PREFIX[kind]}-${stamp(at)}`
        : `${PREFIX[kind]}-${randomBytes(6).toString('hex')}`;
    let id = base;
    for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async #ids(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(BACKUP_EXTENSION))
      .map((n) => n.slice(0, -BACKUP_EXTENSION.length))
      .filter((id) => Id.safeParse(id).success && kindOf(id) !== undefined);
  }

  /**
   * What a backup really holds, from its files (cached until the file
   * changes): checked through like a restore — paths, kinds, sizes, sums —
   * but nothing written and no passphrase needed. Never what its header
   * says: anyone can write a header.
   */
  async #inspect(id: string): Promise<Inspection> {
    const kind = kindOf(id);
    if (!kind || !Id.safeParse(id).success)
      throw new BackupError('not-found', 'That backup is gone.');
    const path = this.pathOf(id);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) throw new BackupError('not-found', 'That backup is gone.');
    const cached = this.#inspected.get(id);
    if (cached?.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.inspection;
    const { header, files, captured } = await extractBackup(path, {
      allowLocal: kind === 'before-restore',
      capture: previewReads,
    });
    const read = (p: string) => captured.get(p);
    const contents: BackupContents = {
      ...(await countContents(
        files.map((p) => ({ path: p })),
        async (p) => read(p),
        { chats: header.groups.includes('chats') },
      )),
      ...(header.secrets && { secrets: header.secrets.mode }),
    };
    const inspection: Inspection = { header, contents, powers: powersOf(files, read) };
    this.#inspected.set(id, { mtimeMs: info.mtimeMs, size: info.size, inspection });
    return inspection;
  }

  /**
   * What restoring a backup brings, for the preview a person sees before
   * they confirm: counted from its files, what in it can act for them, and
   * whether sign-in here stays as it is.
   */
  async preview(id: string): Promise<BackupPreview> {
    const { header, contents, powers } = await this.#inspect(id);
    const listed = powers.slice(0, MAX_POWERS);
    return {
      id,
      contents,
      powers: listed,
      morePowers: powers.length - listed.length,
      signInStays:
        header.secrets !== undefined &&
        kindOf(id) !== 'before-restore' &&
        (await this.signInStays()),
    };
  }

  /**
   * One backup (cached until the file changes). A file uploaded to restore
   * from is checked through, and what it holds is counted from its files;
   * one this computer made says what it holds in its header.
   */
  async summary(id: string): Promise<BackupSummary> {
    const kind = kindOf(id);
    if (!kind || !Id.safeParse(id).success)
      throw new BackupError('not-found', 'That backup is gone.');
    const path = this.pathOf(id);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) throw new BackupError('not-found', 'That backup is gone.');
    const cached = this.#summaries.get(id);
    if (cached?.mtimeMs === info.mtimeMs) return cached.summary;
    const header = kind === 'uploaded' ? (await this.#inspect(id)).header : await readHeader(path);
    const summary: BackupSummary = {
      id,
      kind,
      createdAt: header.createdAt,
      conchVersion: header.conchVersion,
      size: info.size,
      contents: kind === 'uploaded' ? (await this.#inspect(id)).contents : header.contents,
      // An Undo copy may hold keys unlocked: it never leaves this computer.
      downloadable: kind === 'automatic' || kind === 'manual',
    };
    this.#summaries.set(id, { mtimeMs: info.mtimeMs, summary });
    return summary;
  }

  /** The backups kept here (automatic, and Undo copies), newest first. Damaged ones are left out. */
  async list(): Promise<BackupSummary[]> {
    const out: BackupSummary[] = [];
    for (const id of await this.#ids()) {
      const kind = kindOf(id);
      if (kind !== 'automatic' && kind !== 'before-restore') continue;
      const summary = await this.summary(id).catch(() => undefined);
      if (summary) out.push(summary);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  async #journal(): Promise<Journal> {
    const parsed = Journal.safeParse(
      await readJson(journalPath(this.deps.home)).catch(() => undefined),
    );
    return parsed.success ? parsed.data : {};
  }

  async #pending(): Promise<Plan | undefined> {
    const raw = await readJson(join(stagingDir(this.deps.home), 'plan.json')).catch(
      () => undefined,
    );
    const parsed = Plan.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  async #chats(): Promise<BackupStatus['chats']> {
    const files = await walk(this.deps.home);
    let bytes = 0;
    let count = 0;
    for (const file of files) {
      if (file.rule?.group !== 'chats') continue;
      bytes += file.size;
      if (/^conversations\/[^/]+\.jsonl$/.test(file.path)) count++;
    }
    return { count, bytes };
  }

  async status(): Promise<BackupStatus> {
    const [settings, backups, journal, pending, chats] = await Promise.all([
      this.settings(),
      this.list(),
      this.#journal(),
      this.#pending(),
      this.#chats(),
    ]);
    const lastAutomatic = backups.find((b) => b.kind === 'automatic');
    const last = journal.last;
    const undo = last?.undoId && backups.find((b) => b.id === last.undoId);
    return {
      automatic: settings.automatic,
      ...(lastAutomatic && { lastAutomaticAt: lastAutomatic.createdAt }),
      ...(this.#problem && settings.automatic && { problem: this.#problem }),
      ...(this.#running && { running: this.#running }),
      backups,
      chats,
      ...(pending && { pending: pending.from }),
      ...(last &&
        this.#now - last.at < UNDO_OFFER_MS && {
          restored: { at: last.at, from: last.from, ...(undo && { undoId: undo.id }) },
        }),
    };
  }

  // ── Backing up ───────────────────────────────────────────────────────

  /** One thing at a time: a backup or a restore. */
  async #exclusive<T>(what: 'backing-up' | 'restoring', task: () => Promise<T>): Promise<T> {
    if (this.#running)
      throw new BackupError(
        'busy',
        this.#running === 'restoring'
          ? 'Conch is restoring a backup. Try again in a moment.'
          : 'Conch is making a backup. Try again in a moment.',
      );
    return this.#mutex.run(async () => {
      this.#running = what;
      this.deps.emit();
      try {
        return await task();
      } finally {
        this.#running = undefined;
        this.deps.emit();
      }
    });
  }

  async #write(
    kind: BackupKind,
    options: {
      groups: BackupGroup[];
      secrets?: { mode: 'passphrase'; passphrase: string } | { mode: 'local' };
    },
  ): Promise<{ id: string; header: Header; size: number }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const now = this.#now;
    const id = this.#newId(kind, now, new Set(await this.#ids()));
    const { header, size } = await writeBackup(this.deps.home, this.pathOf(id), {
      kind,
      groups: options.groups,
      secrets: options.secrets,
      ...(options.secrets?.mode === 'passphrase' &&
        this.deps.extraSecrets && { extraSecrets: this.deps.extraSecrets }),
      conchVersion: this.deps.conchVersion,
      now,
    });
    return { id, header, size };
  }

  /** Enough room for a backup of these groups? Throws `no-space` when not. */
  async #roomFor(groups: BackupGroup[]): Promise<void> {
    const files = await walk(this.deps.home);
    const need =
      files
        .filter((f) => f.rule?.group !== undefined && groups.includes(f.rule.group))
        .reduce((sum, f) => sum + f.size, 0) + SPARE_BYTES;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const free = await (this.deps.freeBytes ?? diskFree)(this.dir);
    if (free !== undefined && free < need)
      throw new BackupError(
        'no-space',
        'There isn’t enough free space on this computer for a backup. Free up some space and Conch will try again.',
      );
  }

  /**
   * Room to restore `path`, looked at before a byte is staged: the backup
   * unpacked (at least as big as the file), then an Undo copy of what it
   * replaces here. Throws `no-space` when there isn't; otherwise the room
   * left for what's unpacked, so extracting stops at the disk too.
   */
  async #roomToRestore(path: string, size: number): Promise<number | undefined> {
    const header = await readHeader(path);
    const here = (await walk(this.deps.home))
      .filter((f) => f.rule?.group !== undefined && header.groups.includes(f.rule.group))
      .reduce((sum, f) => sum + f.size, 0);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const free = await (this.deps.freeBytes ?? diskFree)(this.dir);
    if (free === undefined) return undefined;
    const room = free - here - SPARE_BYTES;
    if (room < size) throw new BackupError('no-space', NO_ROOM);
    return room;
  }

  /** Back up now into the backups folder (automatic), chats included. */
  backupNow(): Promise<BackupSummary> {
    return this.#exclusive('backing-up', async () => {
      const groups = groupsFor({ chats: true, secrets: false });
      try {
        await this.#roomFor(groups);
        const { id } = await this.#write('automatic', { groups });
        this.#problem = undefined;
        await this.#prune();
        return await this.summary(id);
      } catch (error) {
        this.#problem =
          error instanceof BackupError
            ? error.message
            : 'The last backup didn’t finish. Conch will try again.';
        throw error;
      }
    });
  }

  /** A backup to download: chats if asked, keys and sign-ins locked with a passphrase if given. */
  createExport(options: { chats: boolean; passphrase?: string }): Promise<BackupSummary> {
    return this.#exclusive('backing-up', async () => {
      await this.#sweep();
      const groups = groupsFor({ chats: options.chats, secrets: false });
      await this.#roomFor(groups);
      const { id } = await this.#write('manual', {
        groups,
        ...(options.passphrase && {
          secrets: { mode: 'passphrase' as const, passphrase: options.passphrase },
        }),
      });
      return this.summary(id);
    });
  }

  /**
   * A file you chose to restore from, streamed to disk as it arrives and
   * refused past the size limit. It's checked (the header) before it's kept.
   * Refused before a byte lands when the disk can't hold it and a gigabyte
   * more (`size`: what the upload says it is), and cut off if it grows past
   * that while it arrives.
   */
  async receive(
    body: Readable | AsyncIterable<Buffer>,
    options: { maxBytes?: number; size?: number } = {},
  ): Promise<BackupSummary> {
    const maxBytes = options.maxBytes ?? BACKUP_LIMITS.maxArchiveBytes;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.#sweep();
    const free = await (this.deps.freeBytes ?? diskFree)(this.dir);
    const noSpace = () =>
      new BackupError(
        'no-space',
        'There isn’t enough free space on this computer to restore that backup. Free up some space, then try again.',
      );
    if (free !== undefined && free < (options.size ?? 0) + UPLOAD_SPARE_BYTES) throw noSpace();
    const id = this.#newId('uploaded', this.#now, new Set());
    const path = this.pathOf(id);
    const tmp = `${path}.tmp`;
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        if (received > maxBytes)
          done(new BackupError('too-big', 'That file is over 2 GB, too big to be a Conch backup.'));
        else if (free !== undefined && received + UPLOAD_SPARE_BYTES > free) done(noSpace());
        else done(null, chunk);
      },
    });
    try {
      await pipeline(
        body instanceof Readable ? body : Readable.from(body),
        counter,
        createWriteStream(tmp, { mode: 0o600 }),
      );
      await rename(tmp, path);
      return await this.summary(id);
    } catch (error) {
      await rm(tmp, { force: true });
      await rm(path, { force: true });
      throw error;
    }
  }

  /** Throw away a file that was uploaded to restore from and then not used. */
  async discard(id: string): Promise<boolean> {
    if (kindOf(id) !== 'uploaded' && kindOf(id) !== 'manual') return false;
    await rm(this.pathOf(id), { force: true });
    this.#summaries.delete(id);
    this.#inspected.delete(id);
    return true;
  }

  /** Let go of what isn't kept: old automatic backups, old Undo copies, leftovers. */
  async #prune(): Promise<void> {
    const backups = await this.list();
    const keep = retain(backups.filter((b) => b.kind === 'automatic'));
    const journal = await this.#journal();
    const undoKeep = retainUndo(
      backups.filter((b) => b.kind === 'before-restore'),
      this.#now,
    );
    // The copy that undoes the last restore stays while it's offered.
    if (journal.last?.undoId && this.#now - journal.last.at < UNDO_OFFER_MS)
      undoKeep.add(journal.last.undoId);
    for (const backup of backups) {
      const kept = backup.kind === 'automatic' ? keep.has(backup.id) : undoKeep.has(backup.id);
      if (!kept) {
        await rm(this.pathOf(backup.id), { force: true });
        this.#summaries.delete(backup.id);
        this.#inspected.delete(backup.id);
      }
    }
    await this.#sweep();
  }

  /** Downloads and uploads from over an hour ago, and half-written files from a crash. */
  async #sweep(): Promise<void> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(this.dir, name);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) continue;
      const old = this.#now - info.mtimeMs > TRANSIENT_MS;
      const id = name.endsWith(BACKUP_EXTENSION) ? name.slice(0, -BACKUP_EXTENSION.length) : '';
      const transient = kindOf(id) === 'manual' || kindOf(id) === 'uploaded';
      if ((name.endsWith('.tmp') || transient) && old) await rm(path, { force: true });
    }
  }

  // ── Automatic ────────────────────────────────────────────────────────

  /** Look now and then whether today's backup is due, and make it when nothing is busy. */
  start(): void {
    if (this.#timer) return;
    this.#first = setTimeout(() => void this.tick(), FIRST_TICK_MS);
    this.#first.unref();
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    this.#timer.unref();
    // Remembers since when Conch has looked after backups here (a new install isn't overdue).
    void this.settings().catch(() => undefined);
    void this.#sweep().catch(() => undefined);
  }

  stop(): void {
    clearTimeout(this.#first);
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Today's backup, if it's due and nothing is busy. Never throws. */
  async tick(): Promise<'made' | 'not-due' | 'busy' | 'off' | 'failed'> {
    try {
      if (!(await this.settings()).automatic) return 'off';
      if (this.#running || (await this.#pending())) return 'busy';
      const last = (await this.list()).find((b) => b.kind === 'automatic');
      if (last && dayOf(last.createdAt) === dayOf(this.#now)) return 'not-due';
      if (this.deps.busy() || this.#now - this.deps.lastActivity() < IDLE_MS) return 'busy';
      await this.backupNow();
      return 'made';
    } catch {
      return 'failed';
    }
  }

  // ── Restoring ────────────────────────────────────────────────────────

  /**
   * Check a backup through and stage it; it goes into place when Conch starts
   * again. What's here now is kept first as an Undo copy. `keepSessionId`: the
   * device asking stays signed in when sign-in comes back from the backup.
   */
  restore(
    id: string,
    options: { passphrase?: string; skipSecrets?: boolean; keepSessionId?: string } = {},
  ): Promise<RestoredFrom> {
    return this.#exclusive('restoring', async () => {
      if (this.deps.busy())
        throw new BackupError(
          'busy',
          'A chat is still working. Wait for it to finish, then restore.',
        );
      const kind = kindOf(id);
      const source = await this.summary(id);
      const path = this.pathOf(id);
      const staging = stagingDir(this.deps.home);
      // Before anything is staged: a full disk says so, rather than fill up.
      const room = await this.#roomToRestore(path, source.size);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true, mode: 0o700 });
      try {
        const extracted = await extractBackup(path, {
          staging,
          passphrase: options.passphrase,
          skipSecrets: options.skipSecrets,
          allowLocal: kind === 'before-restore',
          ...(room !== undefined && { limits: { roomBytes: room } }),
        });
        const { header } = extracted;
        const withSecrets =
          header.secrets !== undefined &&
          !(header.secrets.mode === 'passphrase' && options.skipSecrets);
        const groups = header.groups.filter((g) => g !== 'secrets' || withSecrets);
        let files = [...extracted.files, ...extracted.secrets];
        const keep: string[] = [];
        if (files.includes('access.json') && (await this.#signIn(staging, options, kind))) {
          files = files.filter((f) => f !== 'access.json');
          keep.push('access.json');
        }

        // What's here now, exactly what the restore replaces: Undo puts it back.
        await this.#roomFor(groups);
        const undo = await this.#write('before-restore', {
          groups: groups.filter((g) => g !== 'secrets'),
          ...(groups.includes('secrets') && { secrets: { mode: 'local' as const } }),
        });
        const from: RestoredFrom = { kind: source.kind, createdAt: header.createdAt };
        const plan: Plan = {
          version: 1,
          at: this.#now,
          from,
          groups,
          dirs: header.dirs,
          files,
          undoId: undo.id,
          exact: kind === 'before-restore',
          keep,
        };
        // Written last: its presence is what makes the restore pending.
        await writeJson(join(staging, 'plan.json'), plan);
        if (kind === 'uploaded') {
          await rm(path, { force: true });
          this.#summaries.delete(id);
          this.#inspected.delete(id);
        }
        await this.#prune();
        return from;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    });
  }

  /**
   * Who may sign in after this restore (`signin.ts`): a Conch with sign-in
   * set up keeps its own password, keys and signed-in devices; one without
   * (a new computer) takes the backup's, minus any key it doesn't have, with
   * only the device restoring signed in. Says whether sign-in stays exactly
   * as it is here (then the staged copy goes).
   */
  async #signIn(
    staging: string,
    options: { keepSessionId?: string },
    kind: BackupKind | undefined,
  ): Promise<boolean> {
    const target = join(staging, 'files', 'access.json');
    const incoming = await stagedAccess(target);
    const outcome = incoming
      ? signInAfterRestore(await currentAccess(this.deps.home), incoming, {
          exact: kind === 'before-restore',
          keepSessionId: options.keepSessionId,
        })
      : ({ kind: 'kept' } as const);
    if (outcome.kind === 'kept') {
      await rm(target, { force: true });
      return true;
    }
    await writeJson(target, outcome.file);
    return false;
  }

  /** Sign-in stays as it is here when a backup is restored: it's set up already. */
  async signInStays(): Promise<boolean> {
    return hasSignIn(await currentAccess(this.deps.home));
  }

  /** Forget a restore that's waiting for Conch to start again. */
  async cancelPending(): Promise<boolean> {
    if (this.#running === 'restoring')
      throw new BackupError('busy', 'Conch is restoring right now.');
    const pending = await this.#pending();
    await rm(stagingDir(this.deps.home), { recursive: true, force: true });
    this.deps.emit();
    return Boolean(pending);
  }
}
