/**
 * Always on — Conch starting when you log in and running in the background
 * (ADR 0026), so routines run on time and your phone and chat apps can reach
 * it with no Terminal window open.
 *
 * The gateway registers itself with the computer's own way of starting things
 * at login (launchd on a Mac, systemd on Linux, the Run key on Windows), and a
 * Conch running in a Terminal window hands over to the background one without
 * the page losing its place.
 */
import { z } from 'zod';

/**
 * Conch in the menu bar, the tray or the panel (ADR 0029): a tiny helper
 * built on this computer, with no app store and no download.
 */
export const TrayStatus = z.object({
  /** This computer can show one; `unavailable` says why not. */
  available: z.boolean(),
  unavailable: z.string().optional(),
  /** What's missing for it, when Conch can get it (a need, ADR 0016). */
  need: z.string().optional(),
  /** The person wants it (it starts whenever Conch does). */
  on: z.boolean(),
  /** It's showing now. */
  running: z.boolean(),
  /** "menu bar", "tray", "panel". */
  where: z.string(),
});
export type TrayStatus = z.infer<typeof TrayStatus>;

/** What the menu bar helper shows (loopback only, with its own token). */
export const TrayInfo = z.object({
  /** "Pearl", the assistant's name. */
  name: z.string(),
  alwaysOn: z.boolean(),
  /** Questions waiting in chats, and devices waiting to be approved. */
  approvals: z.number().int().min(0),
  devices: z.number().int().min(0),
  /** Where the page is. */
  url: z.string(),
});
export type TrayInfo = z.infer<typeof TrayInfo>;

export const SetTrayBody = z.object({ on: z.boolean() });
export const SetAfterLogoutBody = z.object({ on: z.boolean() });
export const SetKeepAwakeBody = z.object({ on: z.boolean() });

/** How this computer starts Conch at login. `pretend` is the mock engine's, for tests. */
export const BackgroundKind = z.enum(['launchd', 'systemd', 'autostart', 'windows', 'pretend']);
export type BackgroundKind = z.infer<typeof BackgroundKind>;

/** How the Conch answering right now is running. */
export const BackgroundRunning = z.enum([
  /** Started by the computer, with no window. */
  'background',
  /** In a Terminal window (`pnpm start`): closing it stops Conch. */
  'window',
  /** A development server (`pnpm dev`): Always on is for the real thing. */
  'dev',
]);
export type BackgroundRunning = z.infer<typeof BackgroundRunning>;

export const BackgroundStatus = z.object({
  /** Always on can be turned on (or off) from here. */
  supported: z.boolean(),
  /** Why not, in a sentence, when it can't. */
  unsupported: z.string().optional(),
  kind: BackgroundKind.optional(),
  /** Conch starts by itself when you log in. */
  on: z.boolean(),
  running: BackgroundRunning,
  /** When this Conch started (epoch ms). */
  since: z.number(),
  /**
   * Where a person sees it on this computer: "System Settings → General →
   * Login Items" on a Mac, "Task Manager → Startup apps" on Windows.
   */
  place: z.string().optional(),
  /**
   * What only works while Conch runs, in a sentence, when there's something:
   * "Your 2 routines and Telegram only work while Conch is running."
   */
  needed: z.string().optional(),
  /**
   * Conch as an app, where people look for apps: "Applications" on a Mac,
   * "the Start menu" on Windows. Opening it starts Conch when it isn't running.
   */
  shortcut: z.object({ installed: z.boolean(), where: z.string() }).optional(),
  /** Something's wrong with it: one sentence, and what to run when only a person can fix it. */
  problem: z.object({ message: z.string(), command: z.string().optional() }).optional(),
  /**
   * Conch in the menu bar (macOS), the tray (Windows) or the panel (Linux),
   * ADR 0029. Unset: this computer can't show one.
   */
  tray: TrayStatus.optional(),
  /**
   * A little computer (ADR 0029): whether Conch keeps running once you log
   * out. Linux keeps a user's services going with `loginctl enable-linger`;
   * a Mac stops them at logout, so it says how to stay logged in instead.
   */
  afterLogout: z
    .object({
      state: z.enum(['on', 'off', 'unavailable']),
      /** What a person runs when Conch can't turn it on itself. */
      command: z.string().optional(),
      /** One sentence, when it isn't simply on or off. */
      note: z.string().optional(),
    })
    .optional(),
  /** A Mac on mains power doesn't sleep while Conch runs (opt-in). Unset: not a Mac. */
  keepAwake: z.object({ on: z.boolean(), active: z.boolean() }).optional(),
});
export type BackgroundStatus = z.infer<typeof BackgroundStatus>;

export const SetBackgroundBody = z.object({ on: z.boolean() });
export type SetBackgroundBody = z.infer<typeof SetBackgroundBody>;

/**
 * The answer to turning it on or off. `handover`: this Conch (in a Terminal
 * window) stops in a moment and the background one takes over — the page
 * waits on its calm restart screen and comes back by itself.
 */
export const SetBackgroundResult = z.object({
  status: BackgroundStatus,
  handover: z.boolean().default(false),
});
export type SetBackgroundResult = z.infer<typeof SetBackgroundResult>;
