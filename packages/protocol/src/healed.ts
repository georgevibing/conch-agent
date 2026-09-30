/**
 * Fixed on its own — what Conch repaired without asking (AGENTS.md agreement 11).
 *
 * Every self-repair leaves one plain note: a settings file it set aside, a
 * search index it rebuilt, an integration that came back. They're shown as
 * reassurance in a quiet list, never as an error or a toast that asks for
 * attention.
 */
import { z } from 'zod';

export const HealArea = z.enum([
  'settings',
  'search',
  'integrations',
  'providers',
  'routines',
  'secrets',
  'browser',
  'gateway',
  'access',
  'conversations',
  'terminal',
  'skills',
  'usage',
]);
export type HealArea = z.infer<typeof HealArea>;

export const HealNote = z.object({
  id: z.string(),
  at: z.number(),
  area: HealArea,
  /** One plain sentence: what was wrong and what Conch did. */
  message: z.string(),
});
export type HealNote = z.infer<typeof HealNote>;

export const HealLog = z.object({ notes: z.array(HealNote) });
export type HealLog = z.infer<typeof HealLog>;
