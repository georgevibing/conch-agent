/**
 * Updates — for Conch itself and the programs it uses (ADR 0019, ADR 0051).
 *
 * Conch checks quietly, once a day, and says what's waiting in a few plain
 * words. Updating is one press: a program goes through the package manager
 * it came from (ADR 0016). Conch itself follows signed releases in a
 * channel: the new version is made ready beside the one running, then
 * swapped in with a restart, and the one before is kept to go back to. A
 * developer's copy follows its branch instead, as before.
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
export const ConchUpdateStep = z.enum([
  'fetch',
  /** Checking the release's signature against the keys this copy trusts. */
  'verify',
  'install',
  'build',
  /** A backup of your things, made before the new version is swapped in. */
  'backup',
  'restart',
  'rollback',
]);
export type ConchUpdateStep = z.infer<typeof ConchUpdateStep>;

/**
 * Which releases Conch follows. Stable is the default; beta also takes
 * beta releases, alpha everything (ADR 0051).
 */
export const ReleaseChannel = z.enum(['stable', 'beta', 'alpha']);
export type ReleaseChannel = z.infer<typeof ReleaseChannel>;

/**
 * What one release brings, as its notes say it: a line per benefit, from
 * your side, in at most three groups, and a "Heads up" when you must do
 * something.
 */
export const ReleaseNotes = z.object({
  /** "0.3.0", "0.4.0-beta.2" */
  version: z.string(),
  channel: ReleaseChannel,
  /** When it was released (the tag's date). */
  date: z.number().optional(),
  headsUp: z.array(z.string()).default([]),
  new: z.array(z.string()).default([]),
  better: z.array(z.string()).default([]),
  fixed: z.array(z.string()).default([]),
});
export type ReleaseNotes = z.infer<typeof ReleaseNotes>;

/**
 * Where Conch's own updates come from: signed `releases` in a channel, or
 * every change on its `branch` (a developer's copy, a checkout from before
 * the first release, or "every change on main" turned on).
 */
export const UpdateSource = z.enum(['releases', 'branch']);
export type UpdateSource = z.infer<typeof UpdateSource>;

/** What is running, independently of the channel followed for future updates. */
export const ConchBuild = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dev'),
    commit: z
      .string()
      .regex(/^[a-f0-9]{7,40}$/)
      .optional(),
  }),
  z.object({
    kind: z.literal('release'),
    version: z.string(),
    channel: ReleaseChannel,
    commit: z
      .string()
      .regex(/^[a-f0-9]{7,40}$/)
      .optional(),
  }),
]);
export type ConchBuild = z.infer<typeof ConchBuild>;

/** A compact, honest identity; prerelease suffixes are never shortened away. */
export function conchBuildLabel(build?: ConchBuild): string {
  return build?.kind === 'release'
    ? `v${build.version}`
    : ['Dev', build?.commit?.slice(0, 7)].filter(Boolean).join(' · ');
}

export const ConchUpdate = z.object({
  /** Conch runs from a git checkout it can look after; `problem` says why not. */
  checkable: z.boolean(),
  /** Base semantic version for update comparisons, not a display label. */
  version: z.string(),
  /** Identity captured when this gateway started; absent on older gateways. */
  build: ConchBuild.optional(),
  /** The commit Conch's folder is on (short). */
  commit: z.string().optional(),
  /** The commit an update moves it to (short), for a copy following its branch. */
  target: z.string().optional(),
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
  blocked: z
    .object({
      reason: z.string(),
      command: z.string().optional(),
      /** Where to download it, when the app can't replace itself (ADR 0054). */
      download: z.string().url().optional(),
    })
    .optional(),
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
      /** The notes of what arrived, for a release. */
      releases: z.array(ReleaseNotes).default([]),
      /** When only a person can finish it: what to run in Conch's folder. */
      command: z.string().optional(),
    })
    .optional(),

  // ── Releases (ADR 0051) ───────────────────────────────────────────────
  source: UpdateSource.default('branch'),
  /** Why it follows its branch, in a sentence (a developer's copy, no releases yet). */
  sourceWhy: z.string().optional(),
  /** The channel followed: yours, else the installer's, else the steadiest with a release. */
  channel: ReleaseChannel.default('stable'),
  /** The channels with a release to follow, steadiest first: the others can't be chosen yet. */
  channels: z.array(ReleaseChannel).default([]),
  /** The channel was chosen (in Settings, or by the installer), not worked out. */
  channelChosen: z.boolean().default(false),
  /** A copy of main that would follow releases once you choose a channel with some. */
  canFollowReleases: z.boolean().default(false),
  /** "Every change on main" is on: a contributor's choice, hidden from everyone else. */
  everyChange: z.boolean().default(false),
  /** The release offered: the newest in the channel above this version. */
  latest: z.object({ version: z.string(), channel: ReleaseChannel }).optional(),
  /** What each waiting release brings, newest first. */
  releases: z.array(ReleaseNotes).default([]),
  /** A new release worth a quiet word at the top of the app (not dismissed yet). */
  announce: z.boolean().default(false),
  /**
   * Back to a steadier channel waits for a release newer than this one:
   * "Conch moves to stable with its next release after 0.4.0-beta.2."
   */
  waiting: z.string().optional(),
  /** A newer release that isn't signed by a key this copy trusts: it's refused, in a sentence. */
  refused: z.string().optional(),
  /** Releases that didn't start here: not offered again until a newer one. */
  failed: z.array(z.string()).default([]),
  /** The version kept to go back to at once. */
  previous: z.string().optional(),
  /** Said once, until it's put away: Conch now follows releases; or it went back by itself. */
  notice: z.object({ id: z.string(), message: z.string() }).optional(),
  /**
   * "Wait until it's done": Conch updates by itself as soon as nothing is
   * working any more (`POST /api/updates/conch` with `when: 'idle'`).
   */
  armed: z.object({ at: z.number() }).optional(),
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

/**
 * A newer version of an app you added from GitHub (ADR 0061). Nothing
 * updates by itself: the app's page shows what changed, and **Update** is
 * the person's press (`POST /api/conch-apps/:id/update`).
 */
export const AppUpdateNotice = z.object({
  /** The app's id in `GET /api/conch-apps`. */
  appId: z.string(),
  name: z.string(),
  installed: z.string(),
  latest: z.string(),
  /** Signed by the key it was added with. */
  sameSigner: z.boolean(),
  /** Websites the new version reaches that this one doesn't: shown first. */
  reachesAdded: z.array(z.string()).default([]),
});
export type AppUpdateNotice = z.infer<typeof AppUpdateNotice>;

export const UpdatesStatus = z.object({
  conch: ConchUpdate,
  programs: z.array(ProgramUpdate),
  /** Apps you added from GitHub with a newer version waiting (ADR 0061); absent: none. */
  apps: z.array(AppUpdateNotice).optional(),
  /** A check is running now. */
  checking: z.boolean(),
  /** When the last full check finished. */
  checkedAt: z.number().optional(),
  /** Program updates install by themselves overnight, when nothing is running. */
  auto: z.boolean(),
  /** This gateway's boot id, so the page knows when a restart has finished. */
  bootId: z.string().optional(),
  /** Conch can start itself again (it runs under `pnpm start`), so an update finishes by itself. */
  restartable: z.boolean().default(false),
  /**
   * When the web app being served was built (its `build.json`), for a copy
   * that keeps it built from its own folder's code. A page built at another
   * time offers to reload onto it.
   */
  webBuilt: z.string().max(64).optional(),
  /**
   * What is working right now (a chat, a task's chat, a routine's run): an
   * update would pause it and carry it on after the restart. Absent: nothing.
   */
  working: z
    .array(z.object({ id: z.string(), title: z.string().max(200) }))
    .max(20)
    .optional(),
});
export type UpdatesStatus = z.infer<typeof UpdatesStatus>;

/**
 * Updating Conch itself. `now` (the default) refuses with `busy` while
 * something is working, so the page can ask first; `anyway` pauses that work
 * at a safe point and carries it on after the restart; `idle` waits until
 * nothing is working, then updates by itself; `cancel` stops waiting.
 */
export const UpdateConchBody = z
  .object({ when: z.enum(['now', 'anyway', 'idle', 'cancel']).default('now') })
  .prefault({});
export type UpdateConchBody = z.infer<typeof UpdateConchBody>;

/** Starting Conch again (`POST /api/gateway/restart`): `anyway` pauses what's working and carries it on after. */
export const RestartBody = z
  .object({ when: z.enum(['now', 'anyway']).default('now') })
  .prefault({});
export type RestartBody = z.infer<typeof RestartBody>;

export const UpdatesSettingsBody = z
  .object({
    auto: z.boolean(),
    /** Which releases Conch follows: beta and alpha need a recent password or key. */
    channel: ReleaseChannel,
    /** Every change on main (developers): needs a recent password or key to turn on. */
    everyChange: z.boolean(),
    /** "Conch 0.3 is ready" was seen and put away: not shown again for that version. */
    dismiss: z.string().max(64),
    /** A notice that's been read. */
    dismissNotice: z.string().max(64),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdatesSettingsBody = z.infer<typeof UpdatesSettingsBody>;
