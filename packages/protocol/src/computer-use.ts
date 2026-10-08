import { z } from 'zod';

/**
 * Using your computer's apps (ADR 0110): the assistant looks at the screen and
 * clicks, types and scrolls in the apps you let it use, while a glowing edge
 * says so and one press stops it. Off until a person turns it on. These are
 * the shapes Settings → This computer and the chat's live card read.
 */

/** Where Conch can use the apps: macOS first. Elsewhere it says so plainly. */
export const ComputerUsePlatform = z.enum(['mac', 'unsupported']);
export type ComputerUsePlatform = z.infer<typeof ComputerUsePlatform>;

/**
 * A switch macOS keeps for itself (Privacy & Security). `granted`: on.
 * `missing`: off, or never asked (macOS doesn't tell the two apart).
 * `unknown`: Conch couldn't look just now.
 */
export const ComputerUseAccessState = z.enum(['granted', 'missing', 'unknown']);
export type ComputerUseAccessState = z.infer<typeof ComputerUseAccessState>;

/** The two switches: seeing the screen, and clicking and typing. */
export const ComputerUseAccessKind = z.enum(['screen', 'control']);
export type ComputerUseAccessKind = z.infer<typeof ComputerUseAccessKind>;

/** An app you said Conch may always use ("Always" on its question). */
export const ComputerUseApp = z.object({
  /** The app's bundle identifier (`com.apple.Notes`), or its name where it has none. */
  id: z.string().min(1).max(200),
  /** What people call it: `Notes`. */
  name: z.string().min(1).max(120),
});
export type ComputerUseApp = z.infer<typeof ComputerUseApp>;

/** What's happening right now: one chat at a time uses the computer. */
export const ComputerUseActive = z.object({
  conversationId: z.string().max(64),
  /** "Clicking in Notes", "Looking at the screen". */
  label: z.string().max(160),
  /** The app it's in, by name. */
  app: z.string().max(120).optional(),
  /** Steps taken this turn, and how many it may take. */
  steps: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  /**
   * The latest look at the screen, kept in memory for this turn only and
   * fetched from `/api/computer-use/shot`. Gone when the turn ends.
   */
  shot: z
    .string()
    .regex(/^[a-z0-9]{6,40}$/)
    .optional(),
  /** When it started, in ms since the epoch. */
  since: z.number(),
});
export type ComputerUseActive = z.infer<typeof ComputerUseActive>;

export const ComputerUseStatus = z.object({
  platform: ComputerUsePlatform,
  /** You turned it on (Settings → This computer). Off by default. */
  enabled: z.boolean(),
  access: z.object({ screen: ComputerUseAccessState, control: ComputerUseAccessState }),
  /**
   * The app macOS lists the two switches under: `Conch` for the desktop app,
   * else the app Conch was started from (`Terminal`, `iTerm`).
   */
  grantTo: z.string().max(80),
  /**
   * Who draws the glowing edge and the Stop key: the desktop app, or nobody
   * (Conch in a browser only: the chat's card and its Stop button).
   */
  overlay: z.enum(['app', 'none']),
  /** The keys that stop it, in the system's own symbols (`⌘⎋`), when the overlay is there. */
  stopKeys: z.string().max(20).optional(),
  /** Apps you said it may always use. */
  apps: z.array(ComputerUseApp).max(500),
  /** Kinds of apps it never touches, whatever anyone says, in a few words each. */
  keptAway: z.array(z.string().max(80)).max(20),
  active: ComputerUseActive.optional(),
  /** This browser is on the computer itself, so it can open System Settings there. */
  here: z.boolean(),
});
export type ComputerUseStatus = z.infer<typeof ComputerUseStatus>;

export const UpdateComputerUseBody = z.object({ enabled: z.boolean() }).strict();
export type UpdateComputerUseBody = z.infer<typeof UpdateComputerUseBody>;

/** Open the System Settings page with one switch on it, on this computer. */
export const OpenComputerUseAccessBody = z.object({ kind: ComputerUseAccessKind }).strict();
export type OpenComputerUseAccessBody = z.infer<typeof OpenComputerUseAccessBody>;

/**
 * What the chat's live card asks for while a turn runs (`/api/computer-use/live`):
 * cheap, nothing is looked at on the computer to answer it.
 */
export const ComputerUseNow = z.object({
  active: ComputerUseActive.optional(),
  stopKeys: z.string().max(20).optional(),
});
export type ComputerUseNow = z.infer<typeof ComputerUseNow>;
