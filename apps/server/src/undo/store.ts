/**
 * Where Undo keeps what it needs (ADR 0030), under `~/.conch/undo`:
 *
 * - `blobs/<aa>/<sha256>`: file contents, each kept once however many
 *   changes share it;
 * - `sets/<id>.json`: one change set — the files one tool call (or one turn)
 *   created, changed or deleted, with what each was before and after;
 * - `index/<workspace>.json`: what the work folder looked like last time,
 *   so a command's changes can be found by comparing.
 *
 * Everything is the person's alone (0700/0600) and none of it is backed up:
 * it's about these files on this computer. It's bounded: change sets go
 * after 30 days, and the oldest go first when it grows past its share of
 * the disk; blobs nothing refers to are swept.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { readJson, writeFileAtomic, writeJson } from '../lib/fs';

/** How long a change can be undone. */
export const KEEP_MS = 30 * 24 * 60 * 60_000;
/** How much Undo may keep in all, copies of work folders included. */
export const MAX_BYTES = 1024 * 1024 * 1024;

const Version = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), mode: z.number().int() });

export const FileChange = z.object({
  /** Absolute, as it was when changed. */
  path: z.string(),
  /** As a person reads it. */
  shown: z.string(),
  /** Where its folder really was (realpath): a restore never follows a link somewhere else. */
  parent: z.string(),
  /** Absent: it didn't exist. */
  before: Version.optional(),
  after: Version.optional(),
});
export type FileChange = z.infer<typeof FileChange>;

export const ChangeSet = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  conversationId: z.string(),
  toolUseId: z.string().optional(),
  label: z.string(),
  at: z.number(),
  state: z.enum(['applied', 'undone', 'expired']),
  files: z.array(FileChange),
});
export type ChangeSet = z.infer<typeof ChangeSet>;

export const IndexEntry = z.object({
  size: z.number(),
  mtimeMs: z.number(),
  mode: z.number(),
  hash: z.string(),
});
export type IndexEntry = z.infer<typeof IndexEntry>;
const IndexFile = z.object({
  workspace: z.string(),
  at: z.number(),
  files: z.record(z.string(), IndexEntry),
});

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class UndoStore {
  readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, 'undo');
  }

  #blob(hash: string) {
    return join(this.dir, 'blobs', hash.slice(0, 2), hash);
  }

  /** Keep these bytes; returns their hash. Already kept: nothing written. */
  async put(bytes: Uint8Array): Promise<string> {
    const hash = sha256(bytes);
    const path = this.#blob(hash);
    if (!existsSync(path)) {
      await mkdir(join(this.dir, 'blobs', hash.slice(0, 2)), { recursive: true, mode: 0o700 });
      await writeFileAtomic(path, bytes, 0o600);
    }
    return hash;
  }

  async has(hash: string): Promise<boolean> {
    return existsSync(this.#blob(hash));
  }

  /** The bytes, checked against their hash: a damaged copy is never put back. */
  async get(hash: string): Promise<Buffer | undefined> {
    const bytes = await readFile(this.#blob(hash)).catch(() => undefined);
    return bytes && sha256(bytes) === hash ? bytes : undefined;
  }

  async saveSet(set: ChangeSet): Promise<void> {
    await mkdir(join(this.dir, 'sets'), { recursive: true, mode: 0o700 });
    await writeJson(join(this.dir, 'sets', `${set.id}.json`), set);
  }

  async set(id: string): Promise<ChangeSet | undefined> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return undefined;
    const raw = await readJson<unknown>(join(this.dir, 'sets', `${id}.json`)).catch(
      () => undefined,
    );
    const parsed = ChangeSet.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  async sets(): Promise<ChangeSet[]> {
    const names = await readdir(join(this.dir, 'sets')).catch(() => [] as string[]);
    const out: ChangeSet[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const set = await this.set(name.slice(0, -5));
      if (set) out.push(set);
    }
    return out.sort((a, b) => b.at - a.at);
  }

  #indexPath(workspace: string) {
    return join(this.dir, 'index', `${sha256(Buffer.from(workspace)).slice(0, 32)}.json`);
  }

  async index(workspace: string): Promise<Record<string, IndexEntry>> {
    const raw = await readJson<unknown>(this.#indexPath(workspace)).catch(() => undefined);
    const parsed = IndexFile.safeParse(raw);
    return parsed.success && parsed.data.workspace === workspace ? parsed.data.files : {};
  }

  async saveIndex(workspace: string, files: Record<string, IndexEntry>): Promise<void> {
    await mkdir(join(this.dir, 'index'), { recursive: true, mode: 0o700 });
    await writeJson(this.#indexPath(workspace), { workspace, at: Date.now(), files });
  }

  /** How much is kept, and how many changes can be undone. */
  async usage(): Promise<{ bytes: number; sets: number; undoable: number }> {
    let bytes = 0;
    const shards = await readdir(join(this.dir, 'blobs')).catch(() => [] as string[]);
    for (const shard of shards) {
      const names = await readdir(join(this.dir, 'blobs', shard)).catch(() => [] as string[]);
      for (const name of names)
        bytes +=
          (await stat(join(this.dir, 'blobs', shard, name)).catch(() => undefined))?.size ?? 0;
    }
    const sets = await this.sets();
    return { bytes, sets: sets.length, undoable: sets.filter((s) => s.state !== 'expired').length };
  }

  /**
   * Keep within bounds: changes older than `KEEP_MS` expire, the oldest
   * expire while it's over `MAX_BYTES`, and copies nothing needs are swept.
   * Returns how many changes expired.
   */
  async sweep(options: { now?: number; maxBytes?: number } = {}): Promise<number> {
    const now = options.now ?? Date.now();
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    const sets = await this.sets();
    let expired = 0;
    const expire = async (set: ChangeSet) => {
      if (set.state === 'expired') return;
      await this.saveSet({
        ...set,
        state: 'expired',
        files: set.files.map(({ before: _b, after: _a, ...f }) => f),
      });
      expired++;
    };
    for (const set of sets) if (now - set.at > KEEP_MS) await expire(set);
    // Tombstones go after another month: Activity no longer shows them.
    for (const set of await this.sets())
      if (set.state === 'expired' && now - set.at > 2 * KEEP_MS)
        await rm(join(this.dir, 'sets', `${set.id}.json`), { force: true });
    await this.#collect();
    let { bytes } = await this.usage();
    for (const set of [...(await this.sets())].reverse()) {
      if (bytes <= maxBytes) break;
      if (set.state === 'expired') continue;
      await expire(set);
      await this.#collect();
      bytes = (await this.usage()).bytes;
    }
    return expired;
  }

  /** Remove copies no change set and no work folder's index refers to. */
  async #collect() {
    const wanted = new Set<string>();
    for (const set of await this.sets())
      for (const f of set.files) {
        if (f.before) wanted.add(f.before.hash);
        if (f.after) wanted.add(f.after.hash);
      }
    const indexes = await readdir(join(this.dir, 'index')).catch(() => [] as string[]);
    for (const name of indexes) {
      const parsed = IndexFile.safeParse(
        await readJson<unknown>(join(this.dir, 'index', name)).catch(() => undefined),
      );
      if (parsed.success) for (const e of Object.values(parsed.data.files)) wanted.add(e.hash);
    }
    const shards = await readdir(join(this.dir, 'blobs')).catch(() => [] as string[]);
    for (const shard of shards)
      for (const name of await readdir(join(this.dir, 'blobs', shard)).catch(() => [] as string[]))
        if (!wanted.has(name)) await rm(join(this.dir, 'blobs', shard, name), { force: true });
  }

  /** For tests: write raw bytes where a blob would be (a damaged copy). */
  async corrupt(hash: string): Promise<void> {
    await writeFile(this.#blob(hash), 'damaged');
  }
}
