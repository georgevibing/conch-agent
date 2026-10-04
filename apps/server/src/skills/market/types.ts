import { createHash } from 'node:crypto';

import type {
  MarketListing,
  MarketPin,
  MarketPublisher,
  MarketSourceId,
  MarketTrust,
} from '@conch/protocol';

/**
 * A listing as a source knows it, before Conch has sorted it onto a shelf or
 * marked it as one you have.
 */
export type SourceListing = Omit<MarketListing, 'category' | 'installed'>;

/** One version of a skill, downloaded and checked against what the source says it is. */
export interface Fetched {
  listing: SourceListing;
  pin: MarketPin;
  /** Every file, by path relative to the skill's folder. */
  files: Map<string, Buffer>;
  /** `contentKey` of what was downloaded, as the source hashes it. */
  content: string;
  /** What the source itself says that should stop it being added, in a sentence. */
  blocked?: string;
  /** The licence the source puts on it; the skill's own words win when stricter. */
  licenseHint?: string;
}

/**
 * A place skills come from (ADR 0072). Each one: talks only to its own
 * hosts, pins every download to a commit or a content hash, and checks
 * what it downloaded against that pin before handing it over.
 */
export interface MarketSource {
  readonly id: MarketSourceId;
  readonly label: string;
  /**
   * Listings for a query (`''`: its shelf). An index may return listings of
   * other sources it knows about (ClawHub lists skills.sh's).
   */
  search?(query: string, signal?: AbortSignal): Promise<SourceListing[]>;
  /** One listing by its key, from the source itself. */
  listing(key: string, signal?: AbortSignal): Promise<SourceListing>;
  /** The newest version, downloaded and checked. */
  fetch(key: string, signal?: AbortSignal): Promise<Fetched>;
  /** The newest pin and its `contentKey`, without downloading (for "an update is there"). */
  latest(
    key: string,
    signal?: AbortSignal,
  ): Promise<{ pin: MarketPin; content: string } | undefined>;
}

/** `<source>:<key>` back into its parts. */
export function splitId(id: string): { source: MarketSourceId; key: string } {
  const at = id.indexOf(':');
  return { source: id.slice(0, at) as MarketSourceId, key: id.slice(at + 1) };
}

export interface ListingParts {
  key: string;
  name: string;
  title?: string;
  description: string;
  publisher: MarketPublisher;
  trust: MarketTrust;
  trustNote?: string;
  installs?: number;
  stars?: number;
  url: string;
}

/** `run` over `items`, at most `width` at once, results in order. */
export async function inTurn<T, R>(
  items: readonly T[],
  width: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await run(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

/** "pdf-tools" → "PDF tools"-ish: words, first letter up. */
export function titleOf(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * A description fit for a card: no Markdown headings or emphasis, one line,
 * cut at a sentence near `max`.
 */
export function plainLine(text: string | null | undefined, max = 240): string {
  const tidy = (s: string) =>
    s
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/#{1,6}\s+/g, ' ')
      .replace(/[*`]+/g, '')
      .replace(/[>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const raw = (text ?? '').replace(/```[\s\S]*?```/g, ' ');
  // A summary that starts with the skill's own title ("# Meeting Notes ## Overview This skill…").
  const body = raw
    .replace(/^\s*#{1,6}\s+[^#\n]*?(?=\s+#{1,6}\s|\n|$)/, '')
    .replace(/#{1,6}\s+(?:Overview|About|Description|Summary|What it does)\b:?/gi, ' ');
  let clean = tidy(body) || tidy(raw);
  if (clean.length <= max) return clean;
  clean = clean.slice(0, max);
  const end = Math.max(clean.lastIndexOf('. '), clean.lastIndexOf('。'));
  return end > max / 2 ? clean.slice(0, end + 1) : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * One fingerprint for a version as its source serves it: SHA-256 over every
 * path and the hash the source gives for it, sorted. Two downloads of "the
 * same version" that differ get different keys.
 */
export function contentKey(files: { path: string; hash: string }[]): string {
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    hash.update(`${f.path}\0${f.hash}\n`);
  return hash.digest('hex');
}
