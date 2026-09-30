/**
 * Updates — for Conch itself and the programs it uses (ADR 0019).
 *
 * Conch checks quietly, once a day, and says what's waiting in a few plain
 * words. Updating is one press: a program goes through the package manager
 * it came from (ADR 0016); Conch pulls its own checkout forward, installs,
 * rebuilds, and starts itself again, or goes back to what you had.
 */
import { z } from 'zod';

/** How far along something is: a sentence, and a percentage when it's known. */
export const UpdateProgress = z.object({
  label: z.string(),
  percent: z.number().min(0).max(100).optional(),
  /** Which step of how many ("2 of 3"), for Conch's own update. */
  step: z.number().int().min(1).optional(),
  steps: z.number().int().min(1).optional(),
});
export type UpdateProgress = z.infer<typeof UpdateProgress>;

/** A step of Conch's own update. */
export const ConchUpdateStep = z.enum(['fetch', 'install', 'build', 'restart', 'rollback']);
export type ConchUpdateStep = z.infer<typeof ConchUpdateStep>;

export const ConchUpdate = z.object({
  /** Conch runs from a git checkout it can look after; `problem` says why not. */
  checkable: z.boolean(),
  /** `SERVER_VERSION`, for the quiet line under the title. */
  version: z.string(),
  /** The commit Conch's folder is on (short). */
  commit: z.string().optional(),
  branch: z.string().optional(),
  /** Changes waiting upstream; 0 is up to date. */
  behind: z.number().int().min(0).default(0),
  /** Of those, the ones a person would call an improvement (no chores, tests or docs). */
  improvements: z.number().int().min(0).default(0),
  /** "What's new": the newest few, in plain words. */
  whatsNew: z.array(z.string()).default([]),
  /** When a check last got an answer. */
  checkedAt: z.number().optional(),
  /** The last check didn't get an answer (offline, a sign-in): one quiet sentence. */
  problem: z.string().optional(),
  /**
   * Why one press can't update it (local changes, no upstream, a merge
   * needed), and the exact command to run by hand.
   */
  blocked: z.object({ reason: z.string(), command: z.string().optional() }).optional(),
  /** An update running now. */
  running: UpdateProgress.extend({ phase: ConchUpdateStep }).optional(),
  /** The folder moved on since Conch started: it's ready once Conch starts again. */
  restartNeeded: z.boolean().default(false),
  /** How the last update ended: one sentence, and what it brought. */
  outcome: z
    .object({
      kind: z.enum(['updated', 'rolled-back', 'failed']),
      message: z.string(),
      at: z.number(),
      whatsNew: z.array(z.string()).default([]),
      /** When only a person can finish it: what to run in Conch's folder. */
      command: z.string().optional(),
    })
    .optional(),
});
export type ConchUpdate = z.infer<typeof ConchUpdate>;

export const ProgramUpdateState = z.enum(['idle', 'queued', 'updating']);
export type ProgramUpdateState = z.infer<typeof ProgramUpdateState>;

/** A program Conch uses (a need that can say its version) and whether a newer one is out. */
export const ProgramUpdate = z.object({
  /** The need's id: `codex`. */
  id: z.string(),
  /** "Codex" */
  name: z.string(),
  installed: z.string(),
  /** The newest version, when Conch could find out. */
  latest: z.string().optional(),
  /** `latest` is newer than `installed`. */
  available: z.boolean(),
  /** Conch can update it here (a package manager it knows is on this computer). */
  canUpdate: z.boolean(),
  /** Where to get it by hand when Conch can't. */
  download: z.string().optional(),
  state: ProgramUpdateState.default('idle'),
  progress: UpdateProgress.optional(),
  /** The last update didn't work: why, in plain words. */
  problem: z.string().optional(),
  /** When Conch last updated it, and from which version. */
  updated: z.object({ at: z.number(), from: z.string() }).optional(),
});
export type ProgramUpdate = z.infer<typeof ProgramUpdate>;

export const UpdatesStatus = z.object({
  conch: ConchUpdate,
  programs: z.array(ProgramUpdate),
  /** A check is running now. */
  checking: z.boolean(),
  /** When the last full check finished. */
  checkedAt: z.number().optional(),
  /** Program updates install by themselves overnight, when nothing is running. */
  auto: z.boolean(),
  /** This gateway's boot id, so the page knows when a restart has finished. */
  bootId: z.string().optional(),
});
export type UpdatesStatus = z.infer<typeof UpdatesStatus>;

export const UpdatesSettingsBody = z.object({ auto: z.boolean() });
export type UpdatesSettingsBody = z.infer<typeof UpdatesSettingsBody>;
