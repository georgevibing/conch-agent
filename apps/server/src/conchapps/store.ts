/**
 * What's added (ADR 0061): `conch-apps.json` holds one record per app, the
 * app's files live in `conch-apps/<id>/current/` with a pristine copy of
 * each kept version beside it (`conch-apps/<id>/<hash12>/`), its data in
 * `conch-app-data/<id>/`, and the settings it keeps secret in the sealed
 * `conch-apps.secrets.json`.
 *
 * Files arrive in a folder of their own first (`conch-apps/.incoming/`) and
 * are renamed into place, so a crash never leaves half an app: at worst
 * `current/` is missing, and it comes back from the pristine copy.
 */
import { cp, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AppFilePath,
  ConchAppManifest,
  ConchAppSource,
  ConchAppTool,
  ConchAppUpdate,
  ConchAppVersion,
  IntegrationPolicy,
  SkillSignature,
  ToolPolicy,
  AppId,
} from '@conch/protocol';
import { z } from 'zod';

import { newId } from '../lib/ids';
import { Mutex, removeTree, safeJoin, writeJson } from '../lib/fs';
import { type Heal, readStore } from '../lib/recover';
import type { AppFiles } from './types';

/** A version kept for Go back, with whose it was: only the same hands' versions are kept. */
export const KeptVersion = ConchAppVersion.extend({
  source: ConchAppSource.optional(),
  signature: SkillSignature.optional(),
});
export type KeptVersion = z.infer<typeof KeptVersion>;

export const AppRecord = z.object({
  id: AppId,
  /** The manifest as added, so listing apps never reads their folders. */
  manifest: ConchAppManifest,
  /** The tools as its runtime listed them when it was added. */
  tools: z.array(ConchAppTool).default([]),
  source: ConchAppSource,
  /** Who signed it when it was added: a later version from the same key is one press. */
  signature: SkillSignature,
  hash: z.string(),
  /** Earlier versions kept for Go back, newest first (at most `APP_LIMITS.keep`). */
  versions: z.array(KeptVersion).default([]),
  addedAt: z.number(),
  updatedAt: z.number(),
  conversationId: z.string().optional(),
  draftId: z.string().optional(),
  pinned: z.boolean().default(false),
  published: z.string().optional(),
  enabled: z.boolean().default(true),
  policy: IntegrationPolicy.default('ask'),
  /** The person's choice per tool (the tool's own name), when they made one. */
  toolPolicies: z.record(z.string(), ToolPolicy).default({}),
  lastUsedAt: z.number().optional(),
  /** A newer version found where it came from, waiting for a press. */
  update: ConchAppUpdate.optional(),
  /** The exact files of that update, so the press installs what was shown. */
  updateHash: z.string().optional(),
  /** The settings that aren't secret. Secret ones are in the sealed file. */
  values: z.record(z.string(), z.string()).default({}),
});
export type AppRecord = z.infer<typeof AppRecord>;

/**
 * Whose data was kept when an app was removed with its data. Kept here, not in
 * the data folder, which the app itself can write.
 */
export const KeptData = z.object({
  source: ConchAppSource,
  fingerprint: z.string().optional(),
});
export type KeptData = z.infer<typeof KeptData>;

const AppsFile = z.object({
  apps: z.array(AppRecord).default([]),
  keptData: z.record(z.string(), KeptData).default({}),
});

const SecretsFile = z.object({
  apps: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

/** A kept version's folder name: the first twelve of its hash. */
export const short = (hash: string) => hash.replace(/[^a-f0-9]/gi, '').slice(0, 12) || 'version';

/**
 * A path inside a folder, from an app's own `/`-separated path. Checked as
 * `AppFilePath`, then joined one plain name at a time (`safeJoin`), so
 * nothing can lead out. Names Windows can't keep are refused too.
 */
export function pathIn(dir: string, rel: string): string {
  const path = AppFilePath.parse(rel);
  let out = dir;
  for (const part of path.split('/')) {
    if (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part))
      throw new Error(`Unsafe file name: ${JSON.stringify(part)}`);
    out = safeJoin(out, part);
  }
  return out;
}

/** Write an app's files into a folder that doesn't exist yet. */
export async function writeFiles(dir: string, files: AppFiles): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [rel, bytes] of files) {
    const target = pathIn(dir, rel);
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Every byte under a folder (no links followed). */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  const visit = async (at: string) => {
    const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) total += (await stat(path).catch(() => undefined))?.size ?? 0;
    }
  };
  await visit(dir);
  return total;
}

export class ConchAppStore {
  readonly root: string;
  readonly dataRoot: string;
  #mutex = new Mutex();
  #files = new Mutex();
  #cache?: Promise<AppRecord[]>;
  #last: AppRecord[] = [];
  #kept: Record<string, KeptData> = {};
  #secrets?: Promise<z.infer<typeof SecretsFile>>;

  constructor(
    private readonly home: string,
    private readonly heal?: Heal,
  ) {
    this.root = join(home, 'conch-apps');
    this.dataRoot = join(home, 'conch-app-data');
  }

  get #path() {
    return join(this.home, 'conch-apps.json');
  }

  get #secretsPath() {
    return join(this.home, 'conch-apps.secrets.json');
  }

  // ── Records ─────────────────────────────────────────────────────────────

  read(): Promise<AppRecord[]> {
    this.#cache ??= readStore(this.#path, AppsFile, {
      onRepair: (state) =>
        this.heal?.(
          'integrations',
          state === 'salvaged'
            ? 'The list of apps you made or added was damaged; Conch kept what it could read.'
            : 'The list of apps you made or added couldn’t be read, so Conch kept a copy and started it again.',
        ),
    }).then(
      (read) => {
        this.#kept = read.value.keptData;
        return (this.#last = read.value.apps);
      },
      (error: unknown) => {
        this.#cache = undefined;
        throw error;
      },
    );
    return this.#cache;
  }

  /** What was last read or written, without waiting (a turn's tools are made at once). */
  peek(): readonly AppRecord[] {
    return this.#last;
  }

  async get(id: string): Promise<AppRecord | undefined> {
    return (await this.read()).find((a) => a.id === id);
  }

  /** Change the records, one change at a time. */
  update(fn: (apps: AppRecord[]) => AppRecord[] | undefined): Promise<AppRecord[]> {
    return this.#mutex.run(async () => {
      const draft = structuredClone(await this.read());
      const next = AppsFile.parse({ apps: fn(draft) ?? draft }).apps;
      await writeJson(this.#path, { apps: next, keptData: this.#kept });
      this.#cache = Promise.resolve(next);
      this.#last = next;
      return next;
    });
  }

  /** Whose data was kept for an app that was removed, if any. */
  async keptData(id: string): Promise<KeptData | undefined> {
    await this.read();
    return this.#kept[id];
  }

  /** Remember (or forget) whose data is kept for an app that's gone. */
  setKeptData(id: string, owner: KeptData | undefined): Promise<void> {
    return this.#mutex.run(async () => {
      const apps = await this.read();
      const next = Object.fromEntries(Object.entries(this.#kept).filter(([key]) => key !== id));
      this.#kept = owner ? { ...next, [id]: owner } : next;
      await writeJson(this.#path, { apps, keptData: this.#kept });
    });
  }

  /** Change one app's record; nothing when it's gone. */
  async patch(id: string, fn: (app: AppRecord) => void): Promise<AppRecord | undefined> {
    const apps = await this.update((all) => {
      const app = all.find((a) => a.id === id);
      if (app) fn(app);
      return all;
    });
    return apps.find((a) => a.id === id);
  }

  // ── Folders ─────────────────────────────────────────────────────────────

  current(id: string): string {
    return join(safeJoin(this.root, AppId.parse(id)), 'current');
  }

  kept(id: string, hash: string): string {
    return safeJoin(safeJoin(this.root, AppId.parse(id)), short(hash));
  }

  dataDir(id: string): string {
    return safeJoin(this.dataRoot, AppId.parse(id));
  }

  get #incoming() {
    return join(this.root, '.incoming');
  }

  /** A fresh folder for files on their way in. */
  async scratch(): Promise<string> {
    const dir = join(this.#incoming, newId('in'));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  /**
   * Put these files in place as the app's current files: a pristine copy
   * first (kept for Repair and Go back), then `current/` swapped by renames.
   */
  place(id: string, files: AppFiles, hash: string): Promise<void> {
    return this.#files.run(async () => {
      const kept = this.kept(id, hash);
      if (!(await exists(kept))) {
        const fresh = await this.scratch();
        await writeFiles(fresh, files);
        await mkdir(join(kept, '..'), { recursive: true, mode: 0o700 });
        await rename(fresh, kept);
      }
      await this.#swapIn(id, kept);
    });
  }

  /** `current/` again from a kept version (Repair, Go back). False when there's no copy. */
  restore(id: string, hash: string): Promise<boolean> {
    return this.#files.run(async () => {
      const kept = this.kept(id, hash);
      if (!(await exists(kept))) return false;
      await this.#swapIn(id, kept);
      return true;
    });
  }

  async #swapIn(id: string, kept: string) {
    const fresh = join(this.#incoming, newId('in'));
    await mkdir(this.#incoming, { recursive: true, mode: 0o700 });
    await cp(kept, fresh, { recursive: true, verbatimSymlinks: true });
    const current = this.current(id);
    const old = join(this.#incoming, newId('old'));
    if (await exists(current)) await rename(current, old);
    await rename(fresh, current);
    await removeTree(old);
  }

  async hasCurrent(id: string): Promise<boolean> {
    return exists(this.current(id));
  }

  async hasKept(id: string, hash: string): Promise<boolean> {
    return exists(this.kept(id, hash));
  }

  /** Keep only these versions' copies (and `current/`). */
  async prune(id: string, keep: readonly string[]): Promise<void> {
    const dir = safeJoin(this.root, AppId.parse(id));
    const wanted = new Set(keep.map(short));
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name === 'current' || wanted.has(entry.name)) continue;
      await removeTree(join(dir, entry.name));
    }
  }

  /** The app's files and records go; its data too unless kept. */
  async removeFiles(id: string, keepData: boolean): Promise<void> {
    await this.#files.run(async () => {
      await removeTree(safeJoin(this.root, AppId.parse(id)));
      if (!keepData) await removeTree(this.dataDir(id));
    });
  }

  /** Leftovers of an install a crash cut short. True when there were some. */
  async sweep(): Promise<boolean> {
    const entries = await readdir(this.#incoming).catch(() => []);
    if (!entries.length) return false;
    await removeTree(this.#incoming);
    return true;
  }

  /** An app's data gone: moved aside first, so a crash never leaves half of it for the next app. */
  async wipeData(id: string): Promise<boolean> {
    const dir = this.dataDir(id);
    if (!(await exists(dir))) return false;
    await mkdir(this.#incoming, { recursive: true, mode: 0o700 });
    const aside = join(this.#incoming, newId('data'));
    await rename(dir, aside);
    await removeTree(aside);
    return true;
  }

  async hasData(id: string): Promise<boolean> {
    return exists(this.dataDir(id));
  }

  async dataBytes(id: string): Promise<number> {
    return folderBytes(this.dataDir(id));
  }

  // ── Secrets ─────────────────────────────────────────────────────────────

  #readSecrets() {
    this.#secrets ??= readStore(this.#secretsPath, SecretsFile, {
      onRepair: () =>
        this.heal?.(
          'secrets',
          'The keys your apps use couldn’t be read, so Conch kept a copy. Type them again in each app’s settings.',
        ),
    }).then(
      (read) => read.value,
      (error: unknown) => {
        this.#secrets = undefined;
        throw error;
      },
    );
    return this.#secrets;
  }

  async secrets(id: string): Promise<Record<string, string>> {
    return { ...(await this.#readSecrets()).apps[id] };
  }

  async allSecrets(): Promise<Record<string, Record<string, string>>> {
    return structuredClone((await this.#readSecrets()).apps);
  }

  /** Set (or with `''`, clear) some of an app's secret settings; `undefined` forgets them all. */
  setSecrets(id: string, values: Record<string, string> | undefined): Promise<void> {
    return this.#mutex.run(async () => {
      const data = structuredClone(await this.#readSecrets());
      const next =
        values === undefined
          ? {}
          : Object.fromEntries(
              Object.entries({ ...data.apps[id], ...values }).filter(([, value]) => value !== ''),
            );
      data.apps = Object.fromEntries(
        Object.entries({ ...data.apps, [id]: next }).filter(
          ([, keys]) => Object.keys(keys).length > 0,
        ),
      );
      await writeJson(this.#secretsPath, data);
      this.#secrets = Promise.resolve(data);
    });
  }
}
