/**
 * Is the web app built from the code that's here? (ADR 0019 § The web app's
 * stamp.)
 *
 * Every build of `apps/web` writes `dist/build.json`: the commit it was made
 * from and when (`apps/web/vite.config.ts`). Code pulled into Conch's folder
 * by hand (`git pull`) and a restart give the gateway new code, but the web
 * app stays what it was until something builds it again. Comparing the stamp
 * with the folder's commit tells.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WebStamp {
  /** The commit the build was made from; absent when there was no git. */
  commit?: string;
  /** When it was built (ISO time): what a page compares with its own. */
  builtAt?: string;
}

/** A `build.json`, or undefined when it isn't one. */
export function parseStamp(text: string): WebStamp | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { commit, builtAt } = raw as { commit?: unknown; builtAt?: unknown };
  return {
    ...(typeof commit === 'string' && /^[0-9a-f]{40,64}$/.test(commit) && { commit }),
    ...(typeof builtAt === 'string' && builtAt.length <= 64 && { builtAt }),
  };
}

/** The stamp of the build in `dist`, if it has a readable one. */
export function readStamp(dist: string): WebStamp | undefined {
  try {
    return parseStamp(readFileSync(join(dist, 'build.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** A built web app is there to serve. */
export const isBuilt = (dist: string) => existsSync(join(dist, 'index.html'));

export type WebFreshness =
  /** Built from the commit that's here. */
  | { state: 'fresh' }
  /** Can't tell (no git, nothing built, a build made without git): left as it is. */
  | { state: 'unknown' }
  /** Built from another commit, or before builds were stamped. */
  | { state: 'stale'; why: 'commit' | 'missing'; head: string; built?: string };

/**
 * Whether the web app needs building again. Only a build that's there and
 * says nothing, or names another commit, is stale: never one made without
 * git (it would be built again on every start).
 */
export function freshness({
  built,
  stamp,
  head,
}: {
  built: boolean;
  stamp: WebStamp | undefined;
  head: string | undefined;
}): WebFreshness {
  if (!head || !built) return { state: 'unknown' };
  if (!stamp) return { state: 'stale', why: 'missing', head };
  if (!stamp.commit) return { state: 'unknown' };
  if (stamp.commit !== head) return { state: 'stale', why: 'commit', head, built: stamp.commit };
  return { state: 'fresh' };
}
