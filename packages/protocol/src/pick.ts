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
  /** A `.conchapp` file, or a folder with a `conch-app.json`, to add (ADR 0061). */
  'conch-app',
  /** The folder a chat's trajectory or report is saved in (ADR 0113). */
  'export-folder',
]);
export type PickPurpose = z.infer<typeof PickPurpose>;

export const PickBody = z.object({ purpose: PickPurpose });

/** No path: the person cancelled. */
export const PickResult = z.object({ path: z.string().optional() });
export type PickResult = z.infer<typeof PickResult>;

// ── Looking for a folder from any device (`/api/pick/…`) ────────────────────
//
// A browser can't hand a page a real path, and a phone can't see a dialog on
// the computer across the room. So the gateway lists folders for the person
// to walk through: names only, never what's in a file; files only when the
// purpose is choosing one; only for a person (never an access key); and never
// Conch's own folder or the places sign-ins and keys are kept.

/** A path as a page sends one: absolute, `~`, or a name in the home folder. */
export const AskedPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.includes('\0'), 'Not a path.');

/** One folder in a listing. */
export const FolderEntry = z.object({
  name: z.string(),
  path: z.string(),
  /** A shortcut to a folder somewhere else (a symbolic link). */
  link: z.boolean().optional(),
  /** Its name starts with a dot: hidden unless asked for. */
  hidden: z.boolean().optional(),
});
export type FolderEntry = z.infer<typeof FolderEntry>;

/** One step of the way to a folder, from the home folder or the top of the disk. */
export const FolderCrumb = z.object({
  name: z.string(),
  path: z.string(),
  /** The first step: the home folder, or the top of a disk. */
  top: z.enum(['home', 'disk']).optional(),
});
export type FolderCrumb = z.infer<typeof FolderCrumb>;

/** What's in a folder: the folders in it, by name. */
export const FolderListing = z.object({
  path: z.string(),
  /** Its name ("Projects"; the disk's own name at the top). */
  name: z.string(),
  /** The way people read it: `~/Projects`. */
  shown: z.string(),
  parent: z.string().optional(),
  crumbs: z.array(FolderCrumb),
  folders: z.array(FolderEntry),
  /** Files that can be chosen here, when the purpose is a file (`.kdbx` for KeePassXC). */
  files: z.array(FolderEntry).optional(),
  /** Hidden folders left out of `folders` (shown with `hidden=1`). */
  hiddenCount: z.number().int().nonnegative(),
  /** More folders than a listing holds: these are the first, by name. */
  more: z.boolean(),
  /** A new folder can be made here. */
  writable: z.boolean(),
});
export type FolderListing = z.infer<typeof FolderListing>;

export const FolderPlaceKind = z.enum([
  'home',
  'desktop',
  'documents',
  'downloads',
  'projects',
  'cloud',
  'workspace',
  'drive',
]);
export type FolderPlaceKind = z.infer<typeof FolderPlaceKind>;

/** A place to start from: the home folder, Desktop, a projects folder, a disk. */
export const FolderPlace = z.object({
  kind: FolderPlaceKind,
  title: z.string(),
  path: z.string(),
  /** The way people read it: `~/Projects`. */
  shown: z.string().optional(),
});
export type FolderPlace = z.infer<typeof FolderPlace>;

export const FolderPlaces = z.object({
  home: z.string(),
  /** How this computer writes paths. */
  separator: z.enum(['/', '\\']),
  places: z.array(FolderPlace),
});
export type FolderPlaces = z.infer<typeof FolderPlaces>;

/** `POST /api/pick/folder`: a new folder, in the folder you're looking at. */
export const MakeFolderBody = z.object({
  parent: AskedPath,
  name: z.string().min(1).max(255),
});
export type MakeFolderBody = z.infer<typeof MakeFolderBody>;
export const MadeFolder = z.object({ path: z.string() });
export type MadeFolder = z.infer<typeof MadeFolder>;

/** `GET /api/pick/guess?path=`: a typed path, read — what's there, and how it might go on. */
export const FolderGuess = z.object({
  /** The typed path, as the gateway reads it (`~` expanded). */
  path: z.string(),
  state: z.enum(['folder', 'file', 'missing', 'denied']),
  /** Why it can't be used, in a sentence, when it can't. */
  message: z.string().optional(),
  /** Folders whose names go on from what was typed. */
  matches: z.array(FolderEntry),
});
export type FolderGuess = z.infer<typeof FolderGuess>;
