/**
 * Setup — what a feature needs from this computer, and how Conch gets it.
 *
 * Some things Conch can't do alone: 1Password's MCP server comes with the
 * 1Password app, a provider's CLI has to be installed. Each is a "need" that
 * knows how to find itself and, where it can, how to install itself as you
 * (no administrator) through the computer's own package manager. The UI shows
 * them as a short checklist with one obvious button (AGENTS.md agreement 11).
 */
import { z } from 'zod';

export const NeedState = z.enum([
  /** It's here. */
  'ready',
  /** Not here yet. */
  'missing',
  /** Conch is installing it right now. */
  'installing',
  /** Installing didn't work; `message` says why. */
  'failed',
  /** It doesn't exist for this computer (e.g. no Windows version). */
  'unsupported',
]);
export type NeedState = z.infer<typeof NeedState>;

export const Need = z.object({
  id: z.string(),
  /** "The 1Password app" */
  name: z.string(),
  /** For buttons and progress: "1Password". */
  short: z.string(),
  state: NeedState,
  /** One plain sentence about where it stands. */
  message: z.string().optional(),
  /**
   * Conch can install it itself. `command` is exactly what will run, shown
   * before you agree; `label` is the button ("Install 1Password").
   */
  install: z.object({ label: z.string(), command: z.string() }).optional(),
  /** Where a person gets it when Conch can't install it here. */
  download: z.string().optional(),
  /** An app Conch can open, so you can flip a switch in it. */
  openable: z.boolean().default(false),
  /** While installing. `percent` is unset when the installer doesn't say. */
  progress: z
    .object({ percent: z.number().min(0).max(100).optional(), label: z.string() })
    .optional(),
});
export type Need = z.infer<typeof Need>;

export const Readiness = z.object({
  /** Every need is here. */
  ready: z.boolean(),
  needs: z.array(Need),
});
export type Readiness = z.infer<typeof Readiness>;
