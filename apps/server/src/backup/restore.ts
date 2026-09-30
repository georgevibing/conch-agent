/**
 * Finishing a restore, as Conch starts (ADR 0020).
 *
 * A restore is checked and written to a staging folder while Conch runs, with
 * `plan.json` written last. The files themselves go into place here, before
 * any store has read anything — so nothing running can write over them — and
 * then the staging folder goes. A restore cut short (a crash, a power cut) is
 * finished on the next start: clearing and copying again gives the same result.
 */
import { chmod, copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Id, RestoredFrom } from '@conch/protocol';
import { z } from 'zod';

import { BACKUP_EXTENSION } from '@conch/protocol';

import { safeJoin, writeFileAtomic, writeJson } from '../lib/fs';
import { writeBackup } from './format';
import { classify, GROUP_DIRS, walk, type BackupGroup } from './manifest';
import { safeJoinPath, validRelPath } from './paths';

export const backupsDir = (home: string) => join(home, 'backups');
export const stagingDir = (home: string) => join(backupsDir(home), 'restoring');
export const journalPath = (home: string) => join(backupsDir(home), 'restore.json');

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

export const Plan = z.object({
  version: z.literal(1),
  at: z.number(),
  from: RestoredFrom,
  /** Replaced as a whole. */
  groups: z.array(Group),
  /** Folders made even when empty. */
  dirs: z.array(z.string()),
  /** Files under `restoring/files/`, by their path under `CONCH_HOME`. */
  files: z.array(z.string()),
  /** The copy made just before, which undoes this. */
  undoId: Id.optional(),
  /**
   * Keys and sign-in the backup doesn't have go too. Only for an Undo copy,
   * which is exactly how things were; any other backup leaves them be.
   */
  exact: z.boolean().default(false),
});
export type Plan = z.infer<typeof Plan>;

export const Journal = z.object({
  last: z.object({ at: z.number(), from: RestoredFrom, undoId: Id.optional() }).optional(),
});
export type Journal = z.infer<typeof Journal>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The spending record after a restore: the backup's budget, and for every
 * day the larger amount. Money already spent stays counted, so a restore
 * never makes a budget look further off than it is.
 */
export function mergeUsage(current: Buffer | undefined, restored: Buffer): Buffer {
  const read = (bytes: Buffer | undefined) => {
    try {
      const raw: unknown = bytes && JSON.parse(bytes.toString('utf8'));
      return isRecord(raw) ? raw : {};
    } catch {
      return {};
    }
  };
  const now = read(current);
  const back = read(restored);
  const days: Record<string, number> = {};
  for (const source of [now.days, back.days]) {
    if (!isRecord(source)) continue;
    for (const [day, value] of Object.entries(source))
      if (/^\d{4}-\d\d-\d\d$/.test(day) && typeof value === 'number' && value >= 0)
        days[day] = Math.max(days[day] ?? 0, value);
  }
  const budget =
    typeof back.budget === 'number' && back.budget > 0
      ? back.budget
      : typeof now.budget === 'number' && now.budget > 0
        ? now.budget
        : undefined;
  return Buffer.from(
    `${JSON.stringify({ version: 1, ...(budget && { budget }), days }, null, 2)}\n`,
  );
}

/** Put a staged restore in place. Safe to run again after being cut short. */
export async function applyPlan(home: string, plan: Plan): Promise<void> {
  const groups = new Set<BackupGroup>(plan.groups);
  const staged = join(stagingDir(home), 'files');
  const incoming = new Set(plan.files);

  // What's here now in those groups goes: what was added since the backup too.
  for (const group of groups)
    for (const dir of GROUP_DIRS[group] ?? [])
      await rm(safeJoinPath(home, dir), { recursive: true, force: true });
  for (const file of await walk(home)) {
    const rule = file.rule;
    if (!rule?.group || !groups.has(rule.group) || rule.merge) continue;
    if (rule.class !== 'kept' && rule.class !== 'secret') continue;
    // Keys and sign-in the backup doesn't have stay as they are (except on Undo).
    if (rule.class === 'secret' && !incoming.has(file.path) && !plan.exact) continue;
    await rm(safeJoinPath(home, file.path), { force: true });
  }

  for (const dir of plan.dirs) {
    const owned = plan.groups.some((g) => GROUP_DIRS[g]?.includes(dir));
    if (owned) await mkdir(safeJoinPath(home, dir), { recursive: true, mode: 0o700 });
  }

  for (const path of plan.files) {
    const rule = classify(path);
    // Checked when staged; checked again here, in case the staging folder was touched.
    if (!validRelPath(path) || !rule?.group || !groups.has(rule.group)) continue;
    if (rule.class !== 'kept' && rule.class !== 'secret') continue;
    const from = safeJoinPath(staged, path);
    const to = safeJoinPath(home, path);
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    if (rule.merge === 'usage') {
      const current = await readFile(to).catch(() => undefined);
      await writeJson(to, JSON.parse(mergeUsage(current, await readFile(from)).toString('utf8')));
      continue;
    }
    await rm(to, { force: true });
    await copyFile(from, to);
    await chmod(to, 0o600).catch(() => undefined);
  }

  // The search index is rebuilt from the chats now here. Only ever a nicety:
  // an index that can't go now is set aside by search itself when it misreads.
  if (groups.has('chats'))
    for (const name of ['search.db', 'search.db-wal', 'search.db-shm', 'search.db-journal'])
      await rm(join(home, name), { force: true }).catch(() => undefined);
}

export type ApplyResult =
  { kind: 'none' } | { kind: 'applied'; plan: Plan } | { kind: 'failed'; error: string };

/**
 * The Undo copy, made again from what's here right now: things may have
 * changed since the restore was asked for (when Conch was restarted by hand
 * later). Only on the first go; a restore cut short keeps the copy it made.
 */
async function refreshUndo(home: string, plan: Plan, conchVersion: string): Promise<void> {
  if (!plan.undoId) return;
  const marker = join(stagingDir(home), 'undo-refreshed');
  if (
    await stat(marker).then(
      () => true,
      () => false,
    )
  )
    return;
  try {
    await writeBackup(home, safeJoin(backupsDir(home), `${plan.undoId}${BACKUP_EXTENSION}`), {
      kind: 'before-restore',
      groups: plan.groups.filter((g) => g !== 'secrets'),
      ...(plan.groups.includes('secrets') && { secrets: { mode: 'local' as const } }),
      conchVersion,
    });
  } catch {
    // The copy made when the restore was asked for is still there.
  }
  await writeFileAtomic(marker, '');
}

/**
 * Finish a restore that's waiting, before anything else reads `home`. A
 * staging folder without a plan was never finished, so it's cleared away.
 */
export async function applyPendingRestore(
  home: string,
  options: { conchVersion?: string } = {},
): Promise<ApplyResult> {
  const dir = stagingDir(home);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8'));
  } catch (error) {
    const exists = await stat(dir).then(
      () => true,
      () => false,
    );
    if (exists) await rm(dir, { recursive: true, force: true });
    return (error as NodeJS.ErrnoException).code === 'ENOENT' || !exists
      ? { kind: 'none' }
      : { kind: 'failed', error: 'The restore that was waiting couldn’t be read.' };
  }
  const plan = Plan.safeParse(raw);
  if (!plan.success) {
    await rm(dir, { recursive: true, force: true });
    return { kind: 'failed', error: 'The restore that was waiting couldn’t be read.' };
  }
  try {
    await refreshUndo(home, plan.data, options.conchVersion ?? 'unknown');
    await applyPlan(home, plan.data);
  } catch (error) {
    // Left staged: the next start tries again, and gets the same result.
    return { kind: 'failed', error: (error as Error).message };
  }
  await writeJson(journalPath(home), {
    last: {
      at: Date.now(),
      from: plan.data.from,
      ...(plan.data.undoId && { undoId: plan.data.undoId }),
    },
  } satisfies Journal);
  await rm(dir, { recursive: true, force: true });
  return { kind: 'applied', plan: plan.data };
}
