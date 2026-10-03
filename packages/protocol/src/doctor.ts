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
  /** Working. */
  'ok',
  /** It was broken, and Conch just fixed it. */
  'fixed',
  /** Nothing wrong, just news (a new release of Conch). */
  'info',
  /** Works, but worth knowing (an update, an old backup). */
  'warning',
  /** Only a person can fix it; `action` says how. */
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
  'memory',
  'tasks',
  'skills',
  /** Routines (and one routine, by `focus`): ADR 0056. */
  'routines',
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
  /** Something only a person can run, to copy. */
  z.object({ kind: z.literal('command'), label: z.string(), command: z.string() }),
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
