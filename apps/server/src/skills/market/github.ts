/**
 * A skill's folder from GitHub at one commit (ADR 0077), file by file, each
 * checked against the hash git itself keeps for it.
 *
 * - **Which commit.** A branch or "the default" is turned into a commit
 *   first (`head`), and only the commit is used from then on: what's read is
 *   what's added, and the same pin downloads the same bytes for ever.
 * - **Which files.** The commit's tree (one API call, kept: a commit never
 *   changes) lists every file with its git blob hash, its size and its mode.
 *   Links and submodules are never fetched, nor are hidden files.
 * - **The bytes.** Each file comes from `raw.githubusercontent.com` at that
 *   commit and must hash (`sha1("blob <size>\0" + bytes)`) to what the tree
 *   says. Anything else — a cache serving something stale, a proxy changing
 *   it, a different file under the same name — stops the whole download.
 *
 * GitHub's API allows 60 calls an hour without signing in. An install costs
 * two (the commit, its tree); a commit lookup that hasn't changed costs
 * none, as GitHub doesn't count a 304. The raw files aren't counted.
 */
import { createHash } from 'node:crypto';

import { validRelPath } from '../../backup/paths';
import { isRef, isRepoName } from '../../conchapps/github';
import { type HttpDeps, MarketError, MarketHttp } from './http';
import { contentKey, inTurn } from './types';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const API_VERSION = '2022-11-28';

/** What one skill may be: more than any real one, far less than a repository. */
export const FOLDER_LIMITS = {
  files: 200,
  bytes: 16 * 1024 * 1024,
  file: 4 * 1024 * 1024,
} as const;

export interface TreeFile {
  path: string;
  /** The git blob hash: SHA-1 of `blob <size>\0` and the bytes. */
  sha: string;
  size: number;
  mode: string;
}

/** Git's own hash of a file's bytes. */
export function blobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const SHA = /^[0-9a-f]{40}$/;

export class GitHubSkills {
  readonly #api: MarketHttp;
  readonly #raw: MarketHttp;
  /** Trees by `owner/repo@commit`: a commit never changes, so these never go stale. */
  readonly #trees = new Map<string, TreeFile[]>();
  /** The last answer for a ref, with its ETag, so asking again is free when nothing moved. */
  readonly #heads = new Map<string, { etag?: string; commit: string }>();

  constructor(deps: HttpDeps) {
    this.#api = new MarketHttp('GitHub', ['api.github.com'], deps);
    this.#raw = new MarketHttp('GitHub', ['raw.githubusercontent.com'], deps);
  }

  #headers(accept = 'application/vnd.github+json') {
    return { accept, 'x-github-api-version': API_VERSION };
  }

  /** The commit a branch or tag names now (the default branch when there's none). */
  async head(owner: string, repo: string, ref?: string, signal?: AbortSignal): Promise<string> {
    if (!isRepoName(owner, repo) || (ref !== undefined && !isRef(ref)))
      throw new MarketError('not-found', 'That isn’t a GitHub repository Conch can read.');
    const key = `${owner}/${repo}@${ref ?? ''}`.toLowerCase();
    const last = this.#heads.get(key);
    const at = ref ? ref.split('/').map(encodeURIComponent).join('/') : 'HEAD';
    const { response } = await this.#api.send(`${API}/repos/${owner}/${repo}/commits/${at}`, {
      headers: {
        ...this.#headers('application/vnd.github.sha'),
        ...(last?.etag && { 'if-none-match': last.etag }),
      },
      ...(signal && { signal }),
    });
    if (response.status === 304 && last) {
      await response.body?.cancel().catch(() => undefined);
      return last.commit;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw this.#api.failure(response);
    }
    const sha = (await response.text()).trim();
    if (!SHA.test(sha))
      throw this.#api.offline('GitHub answered with something Conch couldn’t read.');
    const etag = response.headers.get('etag') ?? undefined;
    this.#heads.set(key, { commit: sha, ...(etag && { etag }) });
    return sha;
  }

  /** Every file in a commit, with its hash, size and mode. */
  async tree(
    owner: string,
    repo: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<TreeFile[]> {
    if (!isRepoName(owner, repo) || !SHA.test(commit))
      throw new MarketError('not-found', 'That isn’t a GitHub commit Conch can read.');
    const key = `${owner}/${repo}@${commit}`.toLowerCase();
    const kept = this.#trees.get(key);
    if (kept) return kept;
    const answer = await this.#api.json(
      `${API}/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`,
      { headers: this.#headers(), cap: 8 * 1024 * 1024, ...(signal && { signal }) },
    );
    if (answer.status !== 'fresh') throw this.#api.offline();
    const raw = answer.json as { tree?: unknown; truncated?: unknown };
    if (!Array.isArray(raw.tree))
      throw this.#api.offline('GitHub answered with something Conch couldn’t read.');
    const files: TreeFile[] = [];
    for (const entry of raw.tree as unknown[]) {
      const e = entry as {
        path?: unknown;
        sha?: unknown;
        size?: unknown;
        mode?: unknown;
        type?: unknown;
      };
      if (
        e.type === 'blob' &&
        typeof e.path === 'string' &&
        typeof e.sha === 'string' &&
        SHA.test(e.sha) &&
        typeof e.size === 'number' &&
        typeof e.mode === 'string'
      )
        files.push({ path: e.path, sha: e.sha, size: e.size, mode: e.mode });
    }
    this.#trees.set(key, files);
    while (this.#trees.size > 24) {
      const oldest = this.#trees.keys().next().value;
      if (oldest === undefined) break;
      this.#trees.delete(oldest);
    }
    return files;
  }

  /** One file at a commit, checked against git's hash for it. */
  async file(
    owner: string,
    repo: string,
    commit: string,
    entry: TreeFile,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const path = entry.path.split('/').map(encodeURIComponent).join('/');
    const changed = () =>
      new MarketError(
        'changed',
        `GitHub sent something different from what the skill holds at that version (${entry.path}), so Conch stopped. Nothing was added.`,
      );
    const bytes = await this.#raw
      .bytes(`${RAW}/${owner}/${repo}/${commit}/${path}`, {
        cap: Math.min(entry.size, FOLDER_LIMITS.file) + 1,
        what: entry.path,
        ...(signal && { signal }),
      })
      // More than git says the file holds is a different file, not a big one.
      .catch((error: unknown) => {
        throw error instanceof MarketError && error.code === 'too-big' ? changed() : error;
      });
    if (bytes.length !== entry.size || blobSha(bytes) !== entry.sha)
      throw new MarketError(
        'changed',
        `GitHub sent something different from what the skill holds at that version (${entry.path}), so Conch stopped. Nothing was added.`,
      );
    return bytes;
  }

  /**
   * The files of a skill's folder Conch would add, relative to it: regular
   * files only (never links, submodules or hidden files), within
   * `FOLDER_LIMITS`, no name twice in different cases.
   */
  async #select(owner: string, repo: string, commit: string, folder: string, signal?: AbortSignal) {
    const base = folder.replace(/^\/+|\/+$/g, '');
    if (base && !validRelPath(base))
      throw new MarketError('not-found', 'That isn’t a folder Conch can read.');
    const prefix = base ? `${base}/` : '';
    const tree = await this.tree(owner, repo, commit, signal);
    const mine = tree.filter((f) => f.path.startsWith(prefix));
    if (!mine.some((f) => f.path === `${prefix}SKILL.md`))
      throw new MarketError('not-found', 'There’s no skill in that folder any more.');
    const wanted: TreeFile[] = [];
    let bytes = 0;
    const folded = new Set<string>();
    for (const entry of mine) {
      const rel = entry.path.slice(prefix.length);
      // Links (120000) and anything git doesn't call a plain file are never fetched.
      if (!validRelPath(rel))
        throw new MarketError(
          'refused',
          `The skill has a file Conch won’t open: “${rel.slice(0, 120)}”.`,
        );
      if (entry.mode !== '100644' && entry.mode !== '100755') continue;
      if (rel.split('/').some((part) => part.startsWith('.'))) continue;
      if (entry.size > FOLDER_LIMITS.file)
        throw new MarketError('too-big', `“${rel}” is bigger than a skill’s file may be.`);
      if (folded.has(rel.toLowerCase()))
        throw new MarketError('refused', `The skill has “${rel}” twice, in different cases.`);
      folded.add(rel.toLowerCase());
      bytes += entry.size;
      wanted.push({ ...entry, path: rel });
    }
    if (wanted.length > FOLDER_LIMITS.files || bytes > FOLDER_LIMITS.bytes)
      throw new MarketError('too-big', 'This skill is bigger than Conch adds.');
    return { prefix, wanted };
  }

  /**
   * A fingerprint of what Conch would add from this folder at this commit
   * (every path and its git hash): the same when nothing in the skill
   * changed, whatever else moved in the repository.
   */
  async content(owner: string, repo: string, commit: string, folder: string, signal?: AbortSignal) {
    const { wanted } = await this.#select(owner, repo, commit, folder, signal);
    return contentKey(wanted.map((f) => ({ path: f.path, hash: f.sha })));
  }

  /**
   * The repository's own LICENSE at that commit (its first few kilobytes),
   * for a skill whose folder doesn't carry one. Only a hint: the skill's own
   * words win (`licenseOf`).
   */
  async rootLicense(owner: string, repo: string, commit: string, signal?: AbortSignal) {
    const tree = await this.tree(owner, repo, commit, signal);
    const entry = tree.find(
      (f) => /^(?:LICEN[CS]E|COPYING)(?:\.(?:md|txt))?$/i.test(f.path) && f.size <= 64 * 1024,
    );
    return entry ? (await this.text(owner, repo, commit, entry, signal)).slice(0, 4000) : undefined;
  }

  /** A skill's folder at a commit, each file checked against its hash. Paths are relative to the folder. */
  async folder(
    owner: string,
    repo: string,
    commit: string,
    folder: string,
    signal?: AbortSignal,
  ): Promise<{ files: Map<string, Buffer>; content: string }> {
    const { prefix, wanted } = await this.#select(owner, repo, commit, folder, signal);
    const out = new Map<string, Buffer>();
    // A few at a time: kind to GitHub, quick for a skill with fonts or schemas.
    await inTurn(wanted, 6, async (entry) => {
      out.set(
        entry.path,
        await this.file(owner, repo, commit, { ...entry, path: prefix + entry.path }, signal),
      );
    });
    return { files: out, content: contentKey(wanted.map((f) => ({ path: f.path, hash: f.sha }))) };
  }

  /** Text files' contents by path, for listing a repository's skills (each fetched by hash). */
  async text(owner: string, repo: string, commit: string, entry: TreeFile, signal?: AbortSignal) {
    return (await this.file(owner, repo, commit, entry, signal)).toString('utf8');
  }
}
