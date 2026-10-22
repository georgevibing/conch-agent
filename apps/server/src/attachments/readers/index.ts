import { documents } from './documents';
import type { Reader } from './types';

export type { AttachmentAbilities, Reader, ReaderDeps, ReaderInput, ReaderResult } from './types';

/**
 * Every reader, most specific first (ADR 0017). Each family has its own file
 * here; add a reader by adding it to this list, never by editing `prompt.ts`.
 */
export const READERS: readonly Reader[] = [documents];
