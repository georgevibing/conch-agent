/**
 * The shapes Conch apps' patterns draw (ADR 0061). Each mirrors its schema in
 * `@conch/protocol` (`conch-apps.ts`) structurally: Nacre stays free of the
 * protocol, and the web passes the protocol's values straight in, so its
 * typecheck says when the two drift apart.
 *
 * The words come from the protocol too (`appAbilities`, `describeChanges`,
 * `appSourceLine`), worked out by the web and handed in, so the card, the
 * app's page, the preview and the assistant's prompt all say the same thing.
 */
import type { SkillSignatureBadgeProps } from '../Skills/SkillSignatureBadge';
import type { AppColor, AppGlyph } from './glyphs';

/** One line of what an app can do (`AppAbilityLine`, from `appAbilities`). */
export interface AppAbilityLine {
  kind: 'data' | 'reach' | 'nothing-else' | 'needs' | 'looks' | 'changes';
  text: string;
}

/** What an app needs from the person (`AppSetting`). */
export interface AppSettingView {
  key: string;
  label: string;
  /** One sentence: where to find it. */
  help?: string;
  /** Where to get it: **Get it** opens it in a new tab. */
  link?: string;
  /** Masked, never shown again, never seen by the assistant. */
  secret?: boolean;
  optional?: boolean;
}

export interface AppPageView {
  id: string;
  title: string;
}

/** The parts of `ConchAppManifest` the patterns show. */
export interface AppManifestView {
  id: string;
  name: string;
  tagline: string;
  description?: string;
  version: string;
  icon: { glyph: AppGlyph; color: AppColor };
  pages?: readonly AppPageView[];
  settings?: readonly AppSettingView[];
  examples?: readonly string[];
}

/** One of its tools (`ConchAppTool`). */
export interface AppToolView {
  name: string;
  title: string;
  description?: string;
  /** It changes something (else it only looks). */
  changes: boolean;
}

/** Who signed it (`SkillSignature`). */
export type AppSignatureView = Pick<
  SkillSignatureBadgeProps,
  'state' | 'publisher' | 'fingerprint' | 'problem' | 'lookalike'
>;

/** How a new version differs (`ConchAppChanges`): the parts the card needs to mark. */
export interface AppChangesView {
  from: string;
  to: string;
  reachesAdded?: readonly string[];
  toolsNowChange?: readonly string[];
}

/** What a page or a card says about an app, worked out by the protocol's words. */
export interface AppWords {
  /** `appAbilities(manifest, tools)`. */
  abilities: readonly AppAbilityLine[];
  /** `appSourceLine(source, signature)`: “Made by you”, “From github.com/ada/plant-diary”. */
  from: string;
  /** For an update: `describeChanges(changes, …)`, new reach first. */
  changes?: readonly string[];
}

/** A version kept for **Go back** (`ConchAppVersion`). */
export interface AppVersionView {
  version: string;
  at: number;
  hash?: string;
}

/** Publishing on GitHub, one step at a time (`PublishState`). */
export type PublishStateView =
  | { state: 'idle' }
  | { state: 'needs-program'; need: string }
  | { state: 'needs-sign-in'; code: string; url: string }
  | { state: 'publishing'; step: string }
  | { state: 'published'; url: string; version: string }
  | { state: 'failed'; message: string };

/** A repository with the topic `conch-app` (`CommunityApp`). */
export interface CommunityAppView {
  owner: string;
  repo: string;
  description?: string;
  stars?: number;
  updatedAt?: number;
  url: string;
  /** You already have an app from it. */
  installed?: boolean;
}

/** Only an https address is ever opened from an app's words. */
export const isWebLink = (url: string | undefined): url is string =>
  typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url);
