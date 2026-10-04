/**
 * ClawHub (clawhub.ai), OpenClaw's registry, through its documented public
 * read API (ADR 0072), and the skills.sh skills it indexes.
 *
 * - **Searching.** `GET /api/v1/search` (ClawHub's own skills and skills.sh's,
 *   with the scanners' verdicts) and `GET /api/v1/skills?sort=downloads` for
 *   the shelf, always with `nonSuspiciousOnly=true`. ClawHub allows reuse of
 *   these reads when results are cached, 429s are honoured and each skill
 *   links back to its page there.
 * - **ClawHub's own skills** are pinned to a version, and every file is
 *   checked against the SHA-256 ClawHub lists for that version. What ClawHub
 *   adds to every package (`skill-card.md`, `_meta.json`) isn't the author's,
 *   so it's left out. A version its scanners call malicious, or that its
 *   moderators blocked, is never added.
 * - **skills.sh's skills** live in GitHub repositories. Conch finds the
 *   folder in the repository at its newest commit and downloads that commit,
 *   file by file against git's hashes (`github.ts`), rather than skills.sh's
 *   own download, which isn't tied to a version.
 */
import { createHash } from 'node:crypto';

import type { MarketTrust } from '@conch/protocol';

import { validRelPath } from '../../backup/paths';
import { isRepoName } from '../../conchapps/github';
import { readKey, splitSkill } from '../frontmatter';
import { FOLDER_LIMITS, type GitHubSkills } from './github';
import { type HttpDeps, MarketError, MarketHttp } from './http';
import {
  contentKey,
  type Fetched,
  inTurn,
  type MarketSource,
  plainLine,
  type SourceListing,
  titleOf,
} from './types';

const BASE = 'https://clawhub.ai';
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Files ClawHub writes into every package; not the author's. */
const GENERATED = new Set(['skill-card.md', '_meta.json']);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

/** One fingerprint for a version's files as ClawHub lists them (`contentKey`). */
export const bundleHash = (files: { path: string; sha256: string }[]) =>
  contentKey(files.map((f) => ({ path: f.path, hash: f.sha256 })));

/** Scanner verdicts from skills.sh (via ClawHub), as one trust level. */
function upstreamTrust(scanners: Json): { trust: MarketTrust; note?: string } {
  const statuses = Object.values(scanners).map((s) => str(obj(s).status)?.toLowerCase());
  if (!statuses.length) return { trust: 'community' };
  if (statuses.some((s) => s && !['pass', 'safe', 'clean', 'low'].includes(s)))
    return { trust: 'flagged', note: 'skills.sh’s safety checks raised something about it.' };
  return { trust: 'community', note: 'skills.sh’s safety checks found nothing.' };
}

/** ClawHub's verdict on one version: blocked, flagged, or fine. */
export function versionVerdict(
  security: Json,
  moderation: Json,
): {
  trust?: MarketTrust;
  blocked?: string;
  warning?: string;
} {
  const status = str(security.status)?.toLowerCase();
  const scanners = Object.values(obj(security.scanners)).map(obj);
  const scannerSays = (word: string) =>
    scanners.some(
      (s) =>
        str(s.status)?.toLowerCase() === word ||
        str(s.normalizedStatus)?.toLowerCase() === word ||
        str(s.verdict)?.toLowerCase() === word,
    );
  if (moderation.isMalwareBlocked === true || status === 'malicious' || scannerSays('malicious'))
    return {
      trust: 'blocked',
      blocked: 'ClawHub’s checks found harmful code in it, so Conch won’t add it.',
    };
  const dontInstall = scanners.some(
    (s) => str(s.recommendation)?.toUpperCase() === 'DO_NOT_INSTALL',
  );
  if (
    moderation.isSuspicious === true ||
    status === 'suspicious' ||
    scannerSays('suspicious') ||
    dontInstall
  )
    return {
      trust: 'flagged',
      warning: dontInstall
        ? 'One of ClawHub’s safety checks says not to install it.'
        : 'ClawHub’s safety checks marked it as suspicious.',
    };
  return {};
}

export class ClawHubSource implements MarketSource {
  readonly id = 'clawhub' as const;
  readonly label = 'ClawHub';
  readonly http: MarketHttp;

  constructor(deps: HttpDeps) {
    this.http = new MarketHttp('ClawHub', ['clawhub.ai'], deps);
  }

  #split(key: string) {
    const [owner, slug, ...rest] = key.split('/');
    if (!owner || !slug || rest.length || !HANDLE.test(owner) || !HANDLE.test(slug))
      throw new MarketError('not-found', 'That isn’t a ClawHub skill Conch can read.');
    return { owner, slug };
  }

  async #get(path: string, signal?: AbortSignal): Promise<Json> {
    const answer = await this.http.json(`${BASE}${path}`, { ...(signal && { signal }) });
    if (answer.status !== 'fresh') throw this.http.offline();
    return obj(answer.json);
  }

  /** A result from search or the list, as a listing (skills.sh's go to that source's id). */
  #fromIndex(raw: unknown): SourceListing | undefined {
    const item = obj(raw);
    const source = str(item.source) ?? 'clawhub';
    if (source === 'skills-sh') {
      const identity = obj(item.sourceIdentity);
      const key = str(identity.id);
      const [owner, repo, skill] = key?.split('/') ?? [];
      if (!key || !owner || !repo || !skill || !isRepoName(owner, repo) || !HANDLE.test(skill))
        return undefined;
      const scanners = upstreamTrust(obj(obj(item.trust).upstreamScanners));
      const official = item.official === true;
      return {
        id: `skills-sh:${owner}/${repo}/${skill}`,
        source: 'skills-sh',
        sourceLabel: 'skills.sh',
        name: skill,
        title: titleOf(str(item.displayName) ?? skill).slice(0, 80),
        description: plainLine(str(item.summary)),
        publisher: { name: owner, handle: owner, url: `https://github.com/${owner}` },
        trust: scanners.trust === 'flagged' ? 'flagged' : official ? 'verified' : 'community',
        ...(scanners.note && { trustNote: scanners.note }),
        ...(num(identity.lifetimeInstalls) !== undefined && {
          installs: num(identity.lifetimeInstalls),
        }),
        url: `https://skills.sh/${owner}/${repo}/${skill}`,
      };
    }
    if (source !== 'clawhub') return undefined;
    const native = obj(item.native);
    const skill = obj(native.skill);
    const owner = str(item.ownerHandle) ?? str(native.ownerHandle);
    const slug = str(item.slug) ?? str(skill.slug);
    if (!owner || !slug || !HANDLE.test(owner) || !HANDLE.test(slug)) return undefined;
    const stats = obj(item.stats ?? skill.stats);
    const publisher = obj(item.publisher);
    const official = item.official === true || publisher.official === true;
    const suspicious = skill.isSuspicious === true;
    const name = str(publisher.displayName) ?? owner;
    return {
      id: `clawhub:${owner}/${slug}`,
      source: 'clawhub',
      sourceLabel: this.label,
      name: slug,
      title: titleOf(str(item.displayName) ?? slug).slice(0, 80),
      description: plainLine(str(item.summary) ?? str(skill.summary)),
      publisher: { name: name.slice(0, 80), handle: owner, url: `${BASE}/u/${owner}` },
      trust: suspicious ? 'flagged' : official ? 'verified' : 'community',
      ...(suspicious
        ? { trustNote: 'ClawHub’s safety checks marked it as suspicious.' }
        : official && { trustNote: 'ClawHub marks this publisher as official.' }),
      ...(num(stats.installs) !== undefined && { installs: num(stats.installs) }),
      ...(num(stats.stars) !== undefined && { stars: num(stats.stars) }),
      url: `${BASE}/${owner}/skills/${slug}`,
    };
  }

  async search(query: string, signal?: AbortSignal): Promise<SourceListing[]> {
    const q = query.trim();
    if (!q) {
      const list = await this.#get(
        '/api/v1/skills?sort=downloads&limit=48&nonSuspiciousOnly=true',
        signal,
      );
      return (Array.isArray(list.items) ? list.items : []).flatMap((i) => this.#fromIndex(i) ?? []);
    }
    const params = new URLSearchParams({
      q: q.slice(0, 120),
      limit: '30',
      nonSuspiciousOnly: 'true',
    });
    const found = await this.#get(`/api/v1/search?${params}`, signal);
    return (Array.isArray(found.results) ? found.results : []).flatMap(
      (i) => this.#fromIndex(i) ?? [],
    );
  }

  async #skill(key: string, signal?: AbortSignal) {
    const { owner, slug } = this.#split(key);
    const params = new URLSearchParams({ ownerHandle: owner });
    const detail = await this.#get(`/api/v1/skills/${encodeURIComponent(slug)}?${params}`, signal);
    const skill = obj(detail.skill);
    const version = str(obj(detail.latestVersion).version) ?? str(obj(skill.tags).latest);
    if (!version || version.length > 64)
      throw new MarketError('not-found', 'ClawHub has no version of that skill to add.');
    const moderation = obj(detail.moderation);
    const stats = obj(skill.stats);
    const ownerInfo = obj(detail.owner);
    const listing: SourceListing = {
      id: `clawhub:${owner}/${slug}`,
      source: 'clawhub',
      sourceLabel: this.label,
      name: slug,
      title: titleOf(str(skill.displayName) ?? slug).slice(0, 80),
      description: plainLine(str(skill.summary)),
      publisher: {
        name: (str(ownerInfo.displayName) ?? owner).slice(0, 80),
        handle: owner,
        url: `${BASE}/u/${owner}`,
      },
      trust: moderation.isSuspicious === true ? 'flagged' : 'community',
      ...(num(stats.installs) !== undefined && { installs: num(stats.installs) }),
      ...(num(stats.stars) !== undefined && { stars: num(stats.stars) }),
      url: `${BASE}/${owner}/skills/${slug}`,
    };
    return { owner, slug, version, moderation, listing };
  }

  async listing(key: string, signal?: AbortSignal): Promise<SourceListing> {
    return (await this.#skill(key, signal)).listing;
  }

  async #version(owner: string, slug: string, version: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ ownerHandle: owner });
    const answer = await this.#get(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}?${params}`,
      signal,
    );
    const v = obj(answer.version);
    const files: { path: string; sha256: string; size: number }[] = [];
    for (const raw of Array.isArray(v.files) ? v.files : []) {
      const f = obj(raw);
      const path = str(f.path);
      const sha256 = str(f.sha256)?.toLowerCase();
      const size = num(f.size);
      if (!path || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) || size === undefined)
        throw new MarketError(
          'refused',
          'ClawHub listed a file Conch can’t check, so nothing was added.',
        );
      if (!validRelPath(path))
        throw new MarketError(
          'refused',
          `The skill has a file Conch won’t open: “${path.slice(0, 120)}”.`,
        );
      if (GENERATED.has(path)) continue;
      // Hidden files are never added, as from GitHub.
      if (path.split('/').some((part) => part.startsWith('.'))) continue;
      if (size > FOLDER_LIMITS.file)
        throw new MarketError('too-big', `“${path}” is bigger than a skill’s file may be.`);
      files.push({ path, sha256, size });
    }
    return { files, security: obj(v.security), license: str(v.license) };
  }

  async latest(key: string, signal?: AbortSignal) {
    const { owner, slug, version } = await this.#skill(key, signal);
    const { files } = await this.#version(owner, slug, version, signal);
    const sha256 = bundleHash(files);
    return { pin: { kind: 'version' as const, version, sha256 }, content: sha256 };
  }

  async fetch(key: string, signal?: AbortSignal): Promise<Fetched> {
    const { owner, slug, version, moderation, listing } = await this.#skill(key, signal);
    const { files, security, license } = await this.#version(owner, slug, version, signal);
    if (!files.some((f) => f.path === 'SKILL.md'))
      throw new MarketError(
        'not-found',
        'That version on ClawHub has no SKILL.md, so it isn’t a skill.',
      );
    const total = files.reduce((n, f) => n + f.size, 0);
    if (files.length > FOLDER_LIMITS.files || total > FOLDER_LIMITS.bytes)
      throw new MarketError('too-big', 'This skill is bigger than Conch adds.');
    const folded = new Set<string>();
    for (const f of files) {
      if (folded.has(f.path.toLowerCase()))
        throw new MarketError('refused', `The skill has “${f.path}” twice, in different cases.`);
      folded.add(f.path.toLowerCase());
    }
    const verdict = versionVerdict(security, moderation);
    const read = new Map<string, Buffer>();
    await inTurn(files, 4, async (f) => {
      const params = new URLSearchParams({ path: f.path, version, ownerHandle: owner });
      const changed = () =>
        new MarketError(
          'changed',
          `ClawHub sent something different from what it lists for that version (${f.path}), so Conch stopped. Nothing was added.`,
        );
      const bytes = await this.http
        .bytes(`${BASE}/api/v1/skills/${encodeURIComponent(slug)}/file?${params}`, {
          cap: f.size + 1,
          what: f.path,
          ...(signal && { signal }),
        })
        .catch((error: unknown) => {
          throw error instanceof MarketError && error.code === 'too-big' ? changed() : error;
        });
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== f.size || sha !== f.sha256) throw changed();
      read.set(f.path, bytes);
    });
    return {
      listing: {
        ...listing,
        ...(verdict.trust && { trust: verdict.trust }),
        ...((verdict.warning ?? verdict.blocked) && {
          trustNote: verdict.warning ?? verdict.blocked,
        }),
      },
      pin: { kind: 'version', version, sha256: bundleHash(files) },
      files: read,
      content: bundleHash(files),
      ...(verdict.blocked && { blocked: verdict.blocked }),
      ...(license && { licenseHint: license }),
    };
  }
}

/**
 * skills.sh's skills, as ClawHub indexes them, downloaded from GitHub at a
 * commit. The folder is the one named after the skill (or whose SKILL.md
 * gives that name); a repository with one skill at its top is that skill.
 */
export class SkillsShSource implements MarketSource {
  readonly id = 'skills-sh' as const;
  readonly label = 'skills.sh';

  constructor(
    private readonly github: GitHubSkills,
    private readonly hub: ClawHubSource,
  ) {}

  #split(key: string) {
    const [owner, repo, skill, ...rest] = key.split('/');
    if (!owner || !repo || !skill || rest.length || !isRepoName(owner, repo) || !HANDLE.test(skill))
      throw new MarketError('not-found', 'That isn’t a skills.sh skill Conch can read.');
    return { owner, repo, skill };
  }

  async listing(key: string, signal?: AbortSignal): Promise<SourceListing> {
    const { skill } = this.#split(key);
    const found = (await this.hub.search(skill, signal)).find((l) => l.id === `skills-sh:${key}`);
    if (found) return found;
    const { owner, repo } = this.#split(key);
    return {
      id: `skills-sh:${key}`,
      source: 'skills-sh',
      sourceLabel: this.label,
      name: skill,
      title: titleOf(skill),
      description: '',
      publisher: { name: owner, handle: owner, url: `https://github.com/${owner}` },
      trust: 'community',
      url: `https://skills.sh/${owner}/${repo}/${skill}`,
    };
  }

  /** The skill's folder in the repository at `commit`. */
  async #folder(owner: string, repo: string, skill: string, commit: string, signal?: AbortSignal) {
    const tree = await this.github.tree(owner, repo, commit, signal);
    const skills = tree.filter(
      (f) =>
        (f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md')) &&
        !f.path.split('/').some((p) => p.startsWith('.')),
    );
    const folderOf = (path: string) => path.slice(0, -'SKILL.md'.length).replace(/\/$/, '');
    const named = skills.filter((f) => folderOf(f.path).split('/').pop() === skill);
    if (named.length === 1 && named[0]) return folderOf(named[0].path);
    if (skills.length === 1 && skills[0]) return folderOf(skills[0].path);
    // Several, none by that name: the one whose own words give it.
    for (const entry of skills.slice(0, 30)) {
      const text = await this.github.text(owner, repo, commit, entry, signal);
      if (readKey(splitSkill(text).front, 'name')?.trim() === skill) return folderOf(entry.path);
    }
    throw new MarketError(
      'not-found',
      `github.com/${owner}/${repo} has no skill called ${skill} any more.`,
    );
  }

  async latest(key: string, signal?: AbortSignal) {
    const { owner, repo, skill } = this.#split(key);
    const commit = await this.github.head(owner, repo, undefined, signal);
    const path = await this.#folder(owner, repo, skill, commit, signal);
    return {
      pin: { kind: 'commit' as const, owner, repo, path, commit },
      content: await this.github.content(owner, repo, commit, path, signal),
    };
  }

  async fetch(key: string, signal?: AbortSignal): Promise<Fetched> {
    const { owner, repo, skill } = this.#split(key);
    const [listing, commit] = await Promise.all([
      this.listing(key, signal).catch(() => undefined),
      this.github.head(owner, repo, undefined, signal),
    ]);
    const path = await this.#folder(owner, repo, skill, commit, signal);
    const { files, content } = await this.github.folder(owner, repo, commit, path, signal);
    const text = files.get('SKILL.md')?.toString('utf8') ?? '';
    const description = plainLine(readKey(splitSkill(text).front, 'description'));
    const base = listing ?? (await this.listing(key, signal));
    const repoLicense = await this.github
      .rootLicense(owner, repo, commit, signal)
      .catch(() => undefined);
    return {
      listing: { ...base, description: base.description || description, url: base.url },
      pin: { kind: 'commit', owner, repo, path, commit },
      files,
      content,
      ...(repoLicense && { licenseHint: repoLicense }),
    };
  }
}
