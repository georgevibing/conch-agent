/**
 * Choosing a file or folder with the system's own Open dialog, shown on the
 * computer Conch runs on (`POST /api/pick`). The gateway knows what each
 * purpose is for, so a page can't make it ask for anything else.
 */
import { z } from 'zod';

export const PickPurpose = z.enum([
  'keepassxc-database',
  'keepassxc-keyfile',
  'workspace',
  /** A folder a routine watches for changes (ADR 0056). */
  'watch-folder',
]);
export type PickPurpose = z.infer<typeof PickPurpose>;

export const PickBody = z.object({ purpose: PickPurpose });

/** No path: the person cancelled. */
export const PickResult = z.object({ path: z.string().optional() });
export type PickResult = z.infer<typeof PickResult>;
