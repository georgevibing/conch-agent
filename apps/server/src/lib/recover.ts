import { readdir, readFile, rename, rm } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';

import type { HealArea } from '@conch/protocol';
import { z } from 'zod';

import { writeFileAtomic, writeJson } from './fs';

/**
 * Say what Conch fixed on its own, in one plain sentence (`Healed.note`).
 * Stores that repair themselves take one; it never throws.
 */
export type Heal = (area: HealArea, message: string) => void;

/** Damaged copies kept per file: enough to recover from, never a pile. */
export const KEEP_BROKEN = 2;

const stampOf = (at: Date) => at.toISOString().replace(/[:.]/g, '-');

/**
 * Where a damaged file is kept: `settings.json` → `settings.broken-<time>.json`,
 * `search.db` → `search.db.broken-<time>` (a file without a JSON extension
 * keeps its whole name). The time sorts, so the newest copy sorts last.
 */
export function brokenPath(path: string, at = new Date(), n = 1): string {
  const ext = extname(path) === '.json' ? '.json' : '';
  const again = n > 1 ? `-${n}` : '';
  return `${path.slice(0, path.length - ext.length)}.broken-${stampOf(at)}${again}${ext}`;
}

/** Whether a file name is a damaged copy kept by `setAside` (stores must skip these). */
export function isBrokenCopy(name: string): boolean {
  return /\.broken-\d{4}-\d\d-\d\dT[\d-]+Z(-\d+)?(\.json)?$/.test(name);
}

/** The damaged copies of `path`, oldest first. */
async function copiesOf(path: string): Promise<string[]> {
  const dir = dirname(path);
  const ext = extname(path) === '.json' ? '.json' : '';
  const stem = `${basename(path).slice(0, basename(path).length - ext.length)}.broken-`;
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => n.startsWith(stem) && n.endsWith(ext) && isBrokenCopy(n))
    .sort()
    .map((n) => join(dir, n));
}

/** Errors Windows gives for a moment while another handle — a reader, a virus scan — has the file open. */
const SHARING = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function moveFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (platform() !== 'win32' || !SHARING.has(code) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

export interface SetAside {
  /** Where the damaged file is kept now. */
  copy: string;
  /**
   * A new copy was made. `false` when the newest copy already held these
   * exact bytes: a file that stays damaged is kept, and reported, once.
   */
  fresh: boolean;
}

/**
 * Keep a damaged file for later, next to it as `<name>.broken-<time>`,
 * readable only by you (it may hold keys or chats). Only the newest
 * `keep` copies stay.
 *
 * With `bytes` (what was read), a copy is written and the original is left
 * for the caller to replace or remove. Without, the file itself is moved
 * aside (a database too big to hold in memory).
 */
export async function setAside(
  path: string,
  options: { bytes?: Buffer; keep?: number } = {},
): Promise<SetAside> {
  const keep = Math.max(1, options.keep ?? KEEP_BROKEN);
  const copies = await copiesOf(path);
  const newest = copies.at(-1);
  if (options.bytes && newest) {
    const kept = await readFile(newest).catch(() => undefined);
    if (kept?.equals(options.bytes)) return { copy: newest, fresh: false };
  }
  const now = new Date();
  let copy = brokenPath(path, now);
  // Two repairs in the same millisecond still get two names.
  for (let n = 2; copies.includes(copy); n++) copy = brokenPath(path, now, n);
  if (options.bytes) await writeFileAtomic(copy, options.bytes, 0o600);
  else await moveFile(path, copy);
  for (const old of [...copies, copy].slice(0, -keep)) await rm(old, { force: true });
  return { copy, fresh: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What's still good in `raw` for `schema`. Fields that parse are kept, fields
 * that don't are dropped so their defaults apply (recursively, so one bad
 * preference doesn't reset the others), and list items and record entries
 * that don't parse are dropped whole: half a key or half a routine is worse
 * than none. `undefined` when nothing is usable.
 */
export function salvage(schema: z.ZodType, raw: unknown): unknown {
  if (schema.safeParse(raw).success) return raw;
  if (
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable
  ) {
    return raw === undefined ? undefined : salvage(schema.unwrap() as z.ZodType, raw);
  }
  if (schema instanceof z.ZodObject) {
    if (!isRecord(raw)) return undefined;
    const kept: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      if (!(key in raw)) continue;
      const value = salvage(field, raw[key]);
      if (value !== undefined) kept[key] = value;
    }
    return kept;
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(raw)) return undefined;
    const element = schema.element as z.ZodType;
    return raw.filter((item) => element.safeParse(item).success);
  }
  if (schema instanceof z.ZodRecord) {
    if (!isRecord(raw)) return undefined;
    const keyType = schema.keyType as z.ZodType;
    const valueType = schema.valueType as z.ZodType;
    return Object.fromEntries(
      Object.entries(raw).filter(
        ([key, value]) => keyType.safeParse(key).success && valueType.safeParse(value).success,
      ),
    );
  }
  return undefined;
}

/**
 * - `read`: the file was fine.
 * - `missing`: there was no file (a new install): the defaults.
 * - `salvaged`: part of it was damaged; the rest was kept and saved back.
 * - `reset`: none of it could be used; back to the defaults.
 */
export type StoreState = 'read' | 'missing' | 'salvaged' | 'reset';

export interface StoreRead<T> {
  value: T;
  state: StoreState;
  /** Where the damaged file was kept, after `salvaged` or `reset`. */
  copy?: string;
}

export interface ReadStoreOptions<T> {
  /** What a missing or unusable file reads as. Default: the schema's defaults (`{}` parsed). */
  fallback?: () => T;
  /** Keep what's still valid (default), or treat any damage as `reset`. */
  salvage?: boolean;
  /**
   * Told once per damaged file, after it was set aside, with what happened.
   * Not told when the same damage was already set aside (another process, a
   * restart): the note was left then.
   */
  onRepair?: (state: 'salvaged' | 'reset', copy: string) => void;
}

/**
 * Read a JSON file Conch owns (settings, integrations, …), never letting a
 * damaged one stop Conch. A file that won't parse or doesn't match its
 * schema is kept as `<name>.broken-<time>.json`; what's still valid is kept
 * and written back, the rest goes back to its default, and `onRepair` is
 * told so the repair can be noted. A missing file is the defaults.
 *
 * Not for files where a default is *less* safe than the damaged value (who
 * may sign in): those fail closed instead (`auth/store.ts`).
 */
export async function readStore<S extends z.ZodType>(
  path: string,
  schema: S,
  options: ReadStoreOptions<z.output<S>> = {},
): Promise<StoreRead<z.output<S>>> {
  const fallback = options.fallback ?? (() => schema.parse({}));
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { value: fallback(), state: 'missing' };
    throw error;
  }
  let raw: unknown;
  let parsedJson = true;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    parsedJson = false;
  }
  if (parsedJson) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { value: parsed.data, state: 'read' };
  }

  let value: z.output<S> | undefined;
  if (parsedJson && options.salvage !== false) {
    const rescued = schema.safeParse(salvage(schema, raw));
    if (rescued.success) value = rescued.data;
  }
  const state = value === undefined ? 'reset' : 'salvaged';
  let aside: SetAside | undefined;
  try {
    aside = await setAside(path, { bytes });
  } catch {
    // Couldn't keep a copy (a full disk, a locked folder): carry on with the
    // defaults in memory and leave the file be, so nothing more is lost.
    return { value: value ?? fallback(), state };
  }
  // Already set aside by someone else (a restart, the CLI): leave the file to them.
  if (aside.fresh) {
    try {
      if (value === undefined) await rm(path, { force: true });
      else await writeJson(path, value);
    } catch {
      // The next save replaces it; the copy is already safe.
    }
    options.onRepair?.(state, aside.copy);
  }
  return { value: value ?? fallback(), state, copy: aside.copy };
}
