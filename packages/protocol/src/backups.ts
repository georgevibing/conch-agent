/**
 * Backups — your whole Conch in one file, and going back to one (ADR 0020).
 *
 * The gateway keeps a daily backup on this computer by itself, makes one to
 * download whenever you ask, and restores either. What goes in a backup is
 * decided in one place on the gateway (`backup/manifest.ts`).
 */
import { z } from 'zod';

import { PASSWORD_MAX } from './access';
import { Id } from './common';

/** The file name every backup ends with. */
export const BACKUP_EXTENSION = '.conchbackup';

/**
 * How big a backup may be. A file past these is refused before anything is
 * written: they bound what a hostile archive (a "zip bomb") can cost.
 */
export const BACKUP_LIMITS = {
  /** The file itself, as uploaded. */
  maxArchiveBytes: 2 * 1024 ** 3,
  /** Everything in it, unpacked. */
  maxUnpackedBytes: 8 * 1024 ** 3,
  /** One file inside it. */
  maxFileBytes: 1024 ** 3,
  /** How many files it may hold. */
  maxFiles: 250_000,
  /** The longest path inside it, in characters. */
  maxPath: 512,
} as const;

/**
 * - `automatic`: the daily backup Conch keeps on this computer.
 * - `before-restore`: what your Conch was just before a restore, for Undo.
 * - `manual`: one you made to download (Back up now).
 * - `uploaded`: a file you chose to restore from.
 */
export const BackupKind = z.enum(['automatic', 'before-restore', 'manual', 'uploaded']);
export type BackupKind = z.infer<typeof BackupKind>;

/** What a backup holds, counted, for the words in its preview. */
export const BackupContents = z.object({
  /** Personality, preferences, the browser's and terminal's settings. */
  settings: z.boolean(),
  memories: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  routines: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  integrations: z.number().int().nonnegative(),
  /**
   * Integrations that sign in (with a token or on the service's page). Without
   * the backup's keys and sign-ins, these ask you to sign in again.
   */
  integrationsSigningIn: z.number().int().nonnegative(),
  /** Chats, when they're in it (“Include chats”). */
  chats: z.number().int().nonnegative().optional(),
  /** Files and pictures sent in those chats. */
  attachments: z.number().int().nonnegative().optional(),
  /**
   * Keys and sign-ins, when they're in it: `passphrase` — locked with the
   * passphrase you chose; `local` — a copy Conch keeps on this computer for
   * Undo, which never leaves it.
   */
  secrets: z.enum(['passphrase', 'local']).optional(),
});
export type BackupContents = z.infer<typeof BackupContents>;

export const BackupSummary = z.object({
  id: Id,
  kind: BackupKind,
  /** When it was made (epoch ms). */
  createdAt: z.number(),
  /** The Conch that made it. */
  conchVersion: z.string(),
  /** The file's size in bytes. */
  size: z.number().nonnegative(),
  /**
   * What it holds. For a file you uploaded, counted from the files in it;
   * for one this computer made, as it said when it made it. A restore is
   * always previewed from the files themselves (`BackupPreview`).
   */
  contents: BackupContents,
  /** It can be downloaded (not an Undo copy, which may hold keys unlocked). */
  downloadable: z.boolean(),
});
export type BackupSummary = z.infer<typeof BackupSummary>;

/** Longest name or command a preview carries (they come from the file, so they're cut). */
export const POWER_TEXT_MAX = 300;
const PowerText = z.string().max(POWER_TEXT_MAX);

/**
 * Something in a backup that lets Conch act for you, shown before you
 * restore it — read from the files in it, never from what it says it holds.
 */
export const BackupPower = z.discriminatedUnion('kind', [
  /** An integration that runs a program on this computer (a local MCP server), with its command. */
  z.object({ kind: z.literal('runs-program'), name: PowerText, command: PowerText }),
  /** An integration set to “Don't ask”. */
  z.object({ kind: z.literal('integration-never-asks'), name: PowerText }),
  /** Some of an integration's tools set to always allow. */
  z.object({
    kind: z.literal('tools-never-ask'),
    name: PowerText,
    tools: z.array(PowerText).max(20),
    /** More tools than listed. */
    more: z.number().int().nonnegative().default(0),
  }),
  /** New chats start in a mode that never asks (“Full trust”). */
  z.object({ kind: z.literal('chats-never-ask') }),
  /** A routine that runs by itself, and never asks. */
  z.object({ kind: z.literal('routine-never-asks'), name: PowerText }),
  /** Routines may spend more each month than Conch's default, or without a limit (ADR 0057). */
  z.object({
    kind: z.literal('routines-spend'),
    /** USD a month; `null`: no limit. */
    limitUsd: z.number().positive().nullable(),
  }),
  /** A routine that starts when something happens, and may act on it without asking (ADR 0056). */
  z.object({ kind: z.literal('routine-acts-on-events'), name: PowerText }),
  /** Another app can start a routine through the public address (ADR 0056). */
  z.object({ kind: z.literal('routine-address'), name: PowerText }),
  /** Sites the browser acts on without asking. */
  z.object({
    kind: z.literal('browser-sites'),
    sites: z.array(PowerText).max(20),
    more: z.number().int().nonnegative().default(0),
  }),
  /** The browser can open apps on this computer and the network. */
  z.object({ kind: z.literal('browser-local') }),
  /** Other devices can open a terminal on this computer. */
  z.object({ kind: z.literal('terminal-remote') }),
  /** Publishers whose signed skills carry on updating without being turned off (ADR 0031). */
  z.object({
    kind: z.literal('trusted-publishers'),
    names: z.array(PowerText).max(20),
    more: z.number().int().nonnegative().default(0),
  }),
  /** Pages that read live data from these sites without asking again (ADR 0046). */
  z.object({
    kind: z.literal('page-data-sites'),
    sites: z.array(PowerText).max(20),
    more: z.number().int().nonnegative().default(0),
  }),
  /**
   * Model servers you added (ADR 0053): your chats go to these addresses when
   * one answers, so a backup from somewhere else names each before it's restored.
   */
  z.object({
    kind: z.literal('provider-servers'),
    servers: z.array(PowerText).max(20),
    more: z.number().int().nonnegative().default(0),
  }),
  /** A bot (Telegram, Discord, Slack) that these people can talk to your assistant through. */
  z.object({
    kind: z.literal('channel-people'),
    name: PowerText,
    people: z.array(PowerText).max(20),
    more: z.number().int().nonnegative().default(0),
  }),
]);
export type BackupPower = z.infer<typeof BackupPower>;

/**
 * `GET /api/backups/:id/preview`: what restoring it brings, in plain words,
 * from the files in it — checked through first, with no passphrase needed.
 */
export const BackupPreview = z.object({
  id: Id,
  contents: BackupContents,
  /** What in it can act for you, one line each (at most 40; `morePowers` counts the rest). */
  powers: z.array(BackupPower).max(40),
  morePowers: z.number().int().nonnegative().default(0),
  /**
   * This Conch has sign-in set up, so its password and keys stay as they
   * are: the backup's aren't restored (ADR 0020).
   */
  signInStays: z.boolean(),
});
export type BackupPreview = z.infer<typeof BackupPreview>;

/** Which backup a restore came from, in words the page can format. */
export const RestoredFrom = z.object({ kind: BackupKind, createdAt: z.number() });
export type RestoredFrom = z.infer<typeof RestoredFrom>;

/** `GET /api/backups`: everything Settings → Health → Backups shows. */
export const BackupStatus = z.object({
  /** Conch backs itself up every day. */
  automatic: z.boolean(),
  /** The newest backup Conch made by itself. */
  lastAutomaticAt: z.number().optional(),
  /** Why the last automatic backup didn't happen, in one sentence (low disk space). */
  problem: z.string().optional(),
  /** A backup or a restore is under way. */
  running: z.enum(['backing-up', 'restoring']).optional(),
  /** Backups kept on this computer (automatic, and Undo copies), newest first. */
  backups: z.array(BackupSummary),
  /** What your chats and their files take now, for “Include chats”. */
  chats: z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() }),
  /** A restore is ready and waits for Conch to start again. */
  pending: RestoredFrom.optional(),
  /** The last restore, for a while after it: it can be undone. */
  restored: z
    .object({
      at: z.number(),
      from: RestoredFrom,
      /** The copy made just before it; restoring that undoes it. */
      undoId: Id.optional(),
    })
    .optional(),
});
export type BackupStatus = z.infer<typeof BackupStatus>;

export const BackupSettingsBody = z.object({ automatic: z.boolean() });
export type BackupSettingsBody = z.infer<typeof BackupSettingsBody>;

/** `POST /api/backups`: make a backup to download. */
export const CreateBackupBody = z.object({
  /** Put chats (and the files sent in them) in it. */
  chats: z.boolean().default(true),
  /** Put keys and sign-ins in it, locked with this passphrase. Needs a recent sign-in. */
  passphrase: z.string().min(1).max(PASSWORD_MAX).optional(),
});
export type CreateBackupBody = z.infer<typeof CreateBackupBody>;

export const CreatedBackup = z.object({
  id: Id,
  /** What to call the file: `Conch backup 2026-09-30.conchbackup`. */
  name: z.string(),
  size: z.number().nonnegative(),
});
export type CreatedBackup = z.infer<typeof CreatedBackup>;

/** `POST /api/backups/:id/restore`. Needs a recent sign-in. */
export const RestoreBackupBody = z.object({
  /** Unlocks the keys and sign-ins in it. */
  passphrase: z.string().min(1).max(PASSWORD_MAX).optional(),
  /** Restore everything but the keys and sign-ins (a forgotten passphrase). */
  skipSecrets: z.boolean().default(false),
});
export type RestoreBackupBody = z.infer<typeof RestoreBackupBody>;

export const RestoreResult = z.object({
  /** Conch is starting again to finish; the page waits for it. */
  restarting: z.boolean(),
  /** When it can't start itself again: what to do, in one sentence. */
  message: z.string().optional(),
});
export type RestoreResult = z.infer<typeof RestoreResult>;
