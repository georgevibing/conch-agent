/**
 * Repair everything — one look at every part of Conch, and one button that
 * fixes what can be fixed (AGENTS.md agreement 11).
 *
 * Every part of Conch that can break registers a check on the gateway
 * (`apps/server/src/doctor/`). A check looks without changing anything, or —
 * when asked to repair — tries every safe fix it knows, then says where things
 * stand in one plain sentence. What only a person can do comes back as one
 * action: open the right place, install something, or a command to copy.
 */
import { z } from 'zod';

export const DoctorState = z.enum([
  /** Being looked at right now. */
  'checking',
  /** Working, or only history now (it restarted by itself an hour ago, and all is well). */
  'ok',
  /** It was broken, and Conch just fixed it. */
  'fixed',
  /**
   * News, never a problem: a new release, something Conch is already seeing to
   * by itself. Never counted as worth a look; it may carry an action.
   */
  'info',
  /**
   * Works, but worth a look, and there's something to do about it: always with
   * an `action` (an old backup → Open backups), or `repairable` (Repair
   * everything fixes it). Nothing anyone can do is `info`, not a warning.
   */
  'warning',
  /** Only a person can fix it; `action` (always there) says how. */
  'needs-you',
  /** Turned off, or not set up: nothing wrong. */
  'off',
]);
export type DoctorState = z.infer<typeof DoctorState>;

/** Places in the app a fix can open: a fixed list, never an address. */
export const DoctorPlace = z.enum([
  'providers',
  'integrations',
  'security',
  /** Settings → Devices: what's signed in, approving new ones, adding your phone. */
  'devices',
  'browser',
  'terminal',
  'models',
  'usage',
  'health',
  'channels',
  'passwords',
  /** Settings → Memory (Come home lives there, ADR 0035). */
  'memory',
  'notifications',
  'tasks',
  'skills',
  /** Routines (and one routine, by `focus`): ADR 0056. */
  'routines',
  /** Settings → Other apps: apps paired with Conch (ADR 0073). */
  'other-apps',
  /** Settings → Agents: their names and pictures (ADR 0101). */
  'agents',
]);
export type DoctorPlace = z.infer<typeof DoctorPlace>;

/** The one thing to do about an item. */
export const DoctorAction = z.discriminatedUnion('kind', [
  /** Open a place (and something in it, e.g. one provider). */
  z.object({
    kind: z.literal('open'),
    label: z.string(),
    place: DoctorPlace,
    focus: z.string().optional(),
  }),
  /** Install, update or open something Conch knows how to get (`GET /api/needs/:id`). */
  z.object({
    kind: z.literal('need'),
    label: z.string(),
    need: z.string(),
    mode: z.enum(['install', 'update', 'open']),
  }),
  /**
   * Something only a person can run: typed into Conch's terminal for them (or
   * copied). `watch`: the need it brings, which Conch watches for.
   */
  z.object({
    kind: z.literal('command'),
    label: z.string(),
    command: z.string(),
    watch: z.string().optional(),
  }),
]);
export type DoctorAction = z.infer<typeof DoctorAction>;

export const DoctorItem = z.object({
  /** Stable across runs: `providers:claude-code`. */
  id: z.string(),
  /** "Providers", "Integrations", "This computer". */
  group: z.string(),
  /** What it is: "Claude Code", "Search". */
  title: z.string(),
  state: DoctorState,
  /** One plain sentence: where it stands, or what Conch did. */
  message: z.string(),
  action: DoctorAction.optional(),
  /**
   * Only on a look: Repair everything fixes this, so pressing it is the action.
   * After a repair the check says `fixed`, or what's left (and never this).
   */
  repairable: z.boolean().optional(),
});
export type DoctorItem = z.infer<typeof DoctorItem>;

export const DoctorReport = z.object({
  items: z.array(DoctorItem),
  /** When the last look finished (0: never). */
  checkedAt: z.number(),
  /** A look or a repair is running; items fill in as each part answers. */
  running: z.boolean().default(false),
  /** The last run was a repair, not just a look. */
  repaired: z.boolean().default(false),
});
export type DoctorReport = z.infer<typeof DoctorReport>;
