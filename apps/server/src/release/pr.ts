/**
 * The release pull request (ADR 0127). release-please keeps one open: it
 * bumps the version and writes its own changelog. Right after, CI runs
 * `pnpm release ci notes` on that branch, and this puts Conch's notes in
 * their place — New, Better, Fixed and Heads up, from the person's side —
 * in `CHANGELOG.md` and in the pull request's description, which is what
 * release-please makes the GitHub Release from. Merging it is the release.
 */
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Git } from '../updates/conch';
import { compareLink, notesFor, Stop, type ReleaseNotes } from './history';
import { addToChangelog, changelogSection } from './notes';
import type { PolishDeps } from './polish';
import { parseRelease } from './semver';

export const CONFIG_FILE = 'release-please-config.json';
export const MANIFEST_FILE = '.release-please-manifest.json';
/** Where release-please puts notes too long for a pull request's description. */
export const OVERFLOW_FILE = 'release-notes.md';

type Json = Record<string, unknown>;

function object(text: string, file: string): Json {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Stop(`${file} isn’t a JSON object.`);
  return value as Json;
}

/** The version release-please wrote in its manifest, if it's one Conch releases. */
export function manifestVersion(text: string): string | undefined {
  const version = object(text, MANIFEST_FILE)['.'];
  return typeof version === 'string' && parseRelease(version) ? version : undefined;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * The pull request's description, in the shape release-please reads back
 * when it's merged: its header, `---`, the version's section, `---`, its footer.
 */
export function prBody(config: Json, section: string): string {
  return `${text(config['pull-request-header'])}\n---\n\n\n${section.trim()}\n\n---\n${text(config['pull-request-footer'])}\n`;
}

/**
 * The configuration without a one-off `release-as` once that version is the
 * one being released (`pnpm release channel` and `pnpm release as` set it).
 * `undefined` when there's nothing to take out.
 */
export function withoutReleaseAs(configText: string, version: string): string | undefined {
  const config = object(configText, CONFIG_FILE);
  let changed = false;
  const places = [
    config,
    ...Object.values((config.packages as Record<string, Json> | undefined) ?? {}),
  ];
  for (const place of places)
    if (place['release-as'] === version) {
      delete place['release-as'];
      changed = true;
    }
  return changed ? `${JSON.stringify(config, null, 2)}\n` : undefined;
}

export interface PullRequestNotes extends ReleaseNotes {
  /** The pull request's new description. */
  body: string;
  /** The files changed on the branch. */
  files: string[];
}

/**
 * On the release branch at `root`: Conch's notes into `CHANGELOG.md` (on top
 * of `main`'s, in place of release-please's), the one-off `release-as` out,
 * and the pull request's description to match.
 */
export async function writePullRequestNotes({
  root,
  git,
  repository,
  base = 'origin/main',
  ai = true,
  polishDeps,
  today = () => new Date().toISOString().slice(0, 10),
}: {
  root: string;
  git: Git;
  /** `owner/name` on GitHub. */
  repository: string;
  /** Where the changelog the release builds on is. */
  base?: string;
  ai?: boolean;
  polishDeps?: PolishDeps;
  today?: () => string;
}): Promise<PullRequestNotes> {
  const manifest = await readFile(join(root, MANIFEST_FILE), 'utf8').catch(() => '{}');
  const version = manifestVersion(manifest);
  if (!version)
    throw new Stop(
      `${MANIFEST_FILE} doesn’t name a version Conch releases. Is this the release branch?`,
    );
  const notes = await notesFor(git, version, { ai, polishDeps });
  const section = changelogSection(
    version,
    today(),
    notes.notes,
    compareLink(repository, version, notes.since),
  );
  const before = await git(['show', `${base}:CHANGELOG.md`]);
  await writeFile(
    join(root, 'CHANGELOG.md'),
    addToChangelog(before.code === 0 ? before.stdout : undefined, section),
  );
  const files = ['CHANGELOG.md'];
  const configPath = join(root, CONFIG_FILE);
  const configText = await readFile(configPath, 'utf8');
  const config = withoutReleaseAs(configText, version);
  if (config) {
    await writeFile(configPath, config);
    files.push(CONFIG_FILE);
  }
  // release-please moves notes too long for a description into this file; Conch's fit.
  const overflow = join(root, OVERFLOW_FILE);
  if (existsSync(overflow) && (await git(['show', `${base}:${OVERFLOW_FILE}`])).code !== 0) {
    await rm(overflow);
    files.push(OVERFLOW_FILE);
  }
  return { ...notes, body: prBody(object(config ?? configText, CONFIG_FILE), section), files };
}
