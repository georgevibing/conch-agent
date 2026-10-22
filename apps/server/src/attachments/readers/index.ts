import { archives } from './archives';
import { binary } from './binary';
import { documents } from './documents';
import { media } from './media';
import { pdf } from './pdf';
import { pictures } from './pictures';
import { sqlite } from './sqlite';
import type { Reader } from './types';

export type { AttachmentAbilities, Reader, ReaderDeps, ReaderInput, ReaderResult } from './types';

/**
 * Every reader, most specific first (ADR 0017). Each family has its own file
 * here; add a reader by adding it to this list, never by editing `prompt.ts`.
 */
export const READERS: readonly Reader[] = [
  pdf,
  documents,
  archives,
  media,
  pictures,
  sqlite,
  // Last: names any other file from its bytes, so none arrives as only a name.
  binary,
];
