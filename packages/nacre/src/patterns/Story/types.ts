/**
 * The words the chat uses to tell what the assistant is doing (ADR 0103),
 * shaped like `@conch/protocol`'s `activity.ts` so its values pass straight
 * in. Nacre doesn't depend on the protocol; these stay structurally the same.
 */

/** What kind of work a step is: chooses its glyph. Mirrors `ActivityFamily`. */
export type StoryFamily =
  | 'explore'
  | 'edit'
  | 'run'
  | 'verify'
  | 'ship'
  | 'research'
  | 'browse'
  | 'connect'
  | 'make'
  | 'plan'
  | 'delegate'
  | 'remember'
  | 'other';

export const STORY_FAMILIES: readonly StoryFamily[] = [
  'explore',
  'edit',
  'run',
  'verify',
  'ship',
  'research',
  'browse',
  'connect',
  'make',
  'plan',
  'delegate',
  'remember',
  'other',
];

/** A small thing to point at: a site, a file, a picture. Mirrors `ActivityChip`. */
export interface StoryChip {
  kind: 'site' | 'file' | 'image' | 'person' | 'app' | 'text';
  label: string;
  /** A link to open (sites), a path to show (files). */
  href?: string;
  /** A favicon, a product photo, an app logo (URL or data URL). */
  image?: string;
}

/** What kinds of change a turn can make outside the chat. Mirrors `ActivityEffect['kind']`. */
export type StoryEffectKind =
  | 'file'
  | 'commit'
  | 'push'
  | 'install'
  | 'send'
  | 'schedule'
  | 'purchase'
  | 'delete'
  | 'publish'
  | 'other';

/** Something a step changed in the world. Mirrors `ActivityEffect`. */
export interface StoryEffect {
  kind: StoryEffectKind;
  /** "Pushed 2 commits to main", "Sent an email to Ana". */
  text: string;
  /** The file, branch, person or place it's about. */
  target?: string;
  /** The change set that puts it back, when one does. */
  undo?: string;
}

/** Where a headline's words came from: rules, the provider, or a small model. */
export type StorySource = 'rule' | 'provider' | 'model';
