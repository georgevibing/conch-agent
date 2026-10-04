/**
 * What Discover's patterns draw (ADR 0072). Each mirrors its schema in
 * `@conch/protocol` (`skill-market.ts`) structurally: Nacre stays free of the
 * protocol, and the web passes the protocol's values straight in, so its
 * typecheck says when the two drift apart.
 */
import type { SkillCapabilityName } from '../Skills/SkillPermissionList';
import type { SkillReviewFinding } from '../Skills/SkillReview';

/** How far to trust a skill before Conch has read it, from what its place says. */
export type MarketTrustLevel = 'official' | 'verified' | 'community' | 'flagged' | 'blocked';

/** A skill on a shelf (`MarketListing`). */
export interface MarketListingView {
  id: string;
  sourceLabel: string;
  name: string;
  title: string;
  description: string;
  publisher: { name: string; handle?: string; url?: string };
  trust: MarketTrustLevel;
  trustNote?: string;
  installs?: number;
  stars?: number;
  category?: string;
  url: string;
  installed?: { skillId: string; update?: boolean };
}

/** Exactly what's added (`MarketPin`). */
export type MarketPinView =
  | { kind: 'commit'; owner: string; repo: string; path: string; commit: string }
  | { kind: 'version'; version: string; sha256: string };

export interface MarketPermissionsView {
  declared: boolean;
  capabilities: SkillCapabilityName[];
  words: string[];
}

/** A file that's different in an update (`MarketFileChange`). */
export interface MarketFileChangeView {
  path: string;
  change: 'added' | 'removed' | 'changed';
  diff?: string;
}

/** A skill downloaded and read, waiting for a yes (`MarketPreview`). */
export interface MarketPreviewView {
  listing: MarketListingView;
  pin: MarketPinView;
  review: { verdict: 'clean' | 'caution' | 'danger'; findings: SkillReviewFinding[]; hash: string };
  permissions: MarketPermissionsView;
  instructions: string;
  files: string[];
  license: { name?: string; kind: 'open' | 'restricted' | 'unknown' };
  blocked?: string;
  changes?: {
    files: MarketFileChangeView[];
    permissions: { before: MarketPermissionsView; after: MarketPermissionsView };
    wider: boolean;
  };
}

/** A starting point for someone who doesn't know what to look for (`MarketIdea`). */
export interface MarketIdeaView {
  id: string;
  label: string;
  query: string;
  category: string;
}

/** 18400 → "18k", 1234 → "1.2k": a glance, not a count. */
export function roughly(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

/** "Version 1.2.0" or "Commit 8a1541c": what's pinned, in a few characters. */
export function pinWords(pin: MarketPinView): string {
  return pin.kind === 'commit' ? `commit ${pin.commit.slice(0, 7)}` : `version ${pin.version}`;
}

/** “ClawHub · Ada”, or just “Anthropic” when the place and the publisher are one. */
export function fromWords(sourceLabel: string, publisher: string): string {
  return sourceLabel.trim().toLowerCase() === publisher.trim().toLowerCase()
    ? sourceLabel
    : `${sourceLabel} · ${publisher}`;
}

/** Where a link goes, in a word: “GitHub”, “ClawHub”, “skills.sh”. */
export function hostWords(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'github.com' ? 'GitHub' : host === 'clawhub.ai' ? 'ClawHub' : host;
  } catch {
    return url;
  }
}
