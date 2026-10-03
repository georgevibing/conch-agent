/**
 * GitHub links and GitHub's API, for apps added from a link (ADR 0061 §6).
 *
 * Everything goes through the SSRF guard (`guardedFetch('public')`): the
 * address checked is the address dialled, and every redirect is checked
 * again. GitHub's own calls are also held to GitHub's hosts, so a redirect
 * can't carry a download anywhere else, and every download stops the moment
 * it passes `APP_LIMITS.download`.
 */
import { APP_LIMITS } from '@conch/protocol';

import { EndpointError, guardedFetch } from '../integrations/net';
import { SourceError } from './types';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
/** Where GitHub's API may send Conch: itself, and codeload for archives. */
const API_HOSTS = ['api.github.com'] as const;
const ARCHIVE_HOSTS = ['api.github.com', 'codeload.github.com'] as const;
/** What an API answer may weigh; a search page is well under it. */
const JSON_CAP = 2 * 1024 * 1024;

// ── Links ───────────────────────────────────────────────────────────────────

/** What a link someone gave points at, before asking GitHub anything. */
export type ParsedLink =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      /** A tag, branch or commit; unset: the newest release, or the default branch. */
      ref?: string;
      /** A folder in the repository. */
      path?: string;
      /**
       * A `/tree/…` link whose ref may itself contain `/` (`feature/x/apps/plant`):
       * the segments, split into a ref and a folder by asking GitHub (`resolve`).
       */
      tree?: string[];
    }
  | { kind: 'link'; url: string };

const NOT_A_LINK =
  'That isn’t a link Conch can add an app from. Use a GitHub repository’s address (like github.com/ada/plant-diary, or a folder, tag or release in one), or an https:// address of a .conchapp file.';

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
/** One part of a ref (`v1.2.0`, `feature`): what git allows, minus anything odd. */
const REF_PART = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]{0,99}$/;
/** One folder name in a path. */
const PATH_PART = /^[A-Za-z0-9_+-][A-Za-z0-9 ._+-]{0,99}$/;
/** A file someone can download and add as it is. */
const PLAIN = /\.(?:conchapp|tar\.gz)$/i;

const notALink = () => new SourceError('not-a-link', NOT_A_LINK);

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw notALink();
  }
}

const refOk = (part: string) =>
  REF_PART.test(part) && !part.includes('..') && !/\.lock$/.test(part);
const pathOk = (part: string) => PATH_PART.test(part) && !part.includes('..');

/** Whether this is a tag or branch name Conch will put in an API path. */
export const isRef = (ref: string) => ref.length <= 200 && ref.split('/').every(refOk);

/** Whether these are a GitHub owner's and repository's names, safe in an API path. */
export function isRepoName(owner: string, repo: string): boolean {
  return OWNER.test(owner) && REPO.test(repo) && !/^\.+$/.test(repo);
}

function repoOf(owner: string | undefined, name: string | undefined) {
  const repo = name?.replace(/\.git$/i, '');
  if (!owner || !repo || !isRepoName(owner, repo)) throw notALink();
  return { kind: 'github' as const, owner, repo };
}

/** A ref and a folder from segments, or segments to split by asking GitHub. */
function treeOf(base: ReturnType<typeof repoOf>, parts: string[]): ParsedLink {
  if (parts.length === 0 || !parts.every((p) => refOk(p) || pathOk(p))) throw notALink();
  const [first] = parts;
  if (parts.length === 1 && first && refOk(first)) return { ...base, ref: first };
  return { ...base, tree: parts };
}

function gitHubPath(base: ReturnType<typeof repoOf>, rest: string[]): ParsedLink {
  const [kind, ...more] = rest;
  if (kind === undefined) return base;
  switch (kind) {
    case 'tree':
      return treeOf(base, more);
    case 'blob':
      // A link to the manifest means the folder it's in.
      if (more.at(-1) !== 'conch-app.json' || more.length < 2) break;
      return treeOf(base, more.slice(0, -1));
    case 'releases': {
      if (more.length === 0 || (more.length === 1 && more[0] === 'latest')) return base;
      const [tag, ...name] = more;
      if (tag === 'tag' && name.length > 0 && name.every(refOk))
        return { ...base, ref: name.join('/') };
      break;
    }
    case 'commit': {
      const [sha] = more;
      if (more.length === 1 && sha && /^[0-9a-f]{7,40}$/i.test(sha)) return { ...base, ref: sha };
      break;
    }
  }
  throw notALink();
}

/**
 * Reads a link someone pasted. Accepts a GitHub repository (with or without
 * `https://`, `www.` or `.git`, or as `git@github.com:o/r.git`), a folder
 * (`/tree/<ref>/<path>`), a manifest (`/blob/<ref>/<path>/conch-app.json`),
 * a release (`/releases/tag/<tag>`), a commit, or any https address of a
 * `.conchapp` or `.tar.gz`. Anything else is `not-a-link`, in words that say
 * what is.
 */
export function parseLink(text: string): ParsedLink {
  const raw = text
    .trim()
    .replace(/^<(.*)>$/s, '$1')
    .trim();
  if (!raw || raw.length > 2000 || /\s/.test(raw)) throw notALink();
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(raw);
  if (ssh) return repoOf(ssh[1], ssh[2]);
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw notALink();
  }
  if (url.username || url.password) throw notALink();
  const host = url.hostname.toLowerCase();
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  if (web && (host === 'github.com' || host === 'www.github.com')) {
    // A file on a release (`/releases/download/v1/plant.conchapp`) is a file.
    if (PLAIN.test(url.pathname) && url.protocol === 'https:')
      return { kind: 'link', url: url.href };
    const [owner, repo, ...rest] = url.pathname.split('/').filter(Boolean).map(decode);
    return gitHubPath(repoOf(owner, repo), rest);
  }
  if (url.protocol === 'https:' && PLAIN.test(url.pathname)) return { kind: 'link', url: url.href };
  throw notALink();
}

/** GitHub's page for a repository, or a folder at a ref in it. */
export function treeUrl(owner: string, repo: string, ref?: string, path?: string): string {
  const base = `https://github.com/${owner}/${repo}`;
  if (!ref) return base;
  const parts = [...ref.split('/'), ...(path ? path.split('/') : [])];
  return `${base}/tree/${parts.map(encodeURIComponent).join('/')}`;
}

// ── Talking to GitHub ───────────────────────────────────────────────────────

/** GitHub asked Conch to wait; `resetAt` is when it may ask again (ms), when GitHub said. */
export class GitHubLimited extends SourceError {
  constructor(readonly resetAt?: number) {
    super('limited', 'GitHub is limiting how often Conch can ask it. Try again in a few minutes.');
  }
}

const offline = (why = 'Conch couldn’t reach GitHub.') =>
  new SourceError('offline', `${why} Check your internet connection and try again.`);

const tooBig = () =>
  new SourceError(
    'too-big',
    `That download is bigger than ${APP_LIMITS.download / (1024 * 1024)} MB, which is more than an app can be.`,
  );

export interface GitHubDeps {
  /** What the SSRF guard sends through; tests hand in a fake. */
  fetch?: typeof fetch;
  /** Conch's version, for GitHub's `user-agent`. */
  version: string;
  now?: () => number;
  /** How long one API call may take (15 s), or a download (60 s). */
  timeoutMs?: number;
  downloadMs?: number;
}

/** Only https to these hosts; anything else is refused before it's dialled. */
function onlyTo(hosts: readonly string[], base: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname))
      return Promise.reject(
        new SourceError(
          'refused',
          `GitHub sent Conch on to ${url.hostname}, which isn’t GitHub, so Conch stopped there.`,
        ),
      );
    return base(input, init);
  };
}

/** The body, stopping the moment it passes `cap`. */
export async function readCapped(
  response: Response,
  cap: number,
  big: () => SourceError = tooBig,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    throw big();
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw big();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A gzip stream starts with these two bytes. */
const isGzip = (bytes: Buffer) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

const ARCHIVE_TYPES = [
  'application/gzip',
  'application/octet-stream',
  'application/x-gzip',
  'application/x-tar',
];

/** A repository's release or default branch, resolved to a commit. */
export interface Resolved {
  /** What was asked for (unset: the newest release or the default branch). */
  ref?: string;
  /** The tag or branch it came to: `ref`, the newest release's tag, or the default branch. */
  at: string;
  commit: string;
  /** A folder in the repository. */
  path?: string;
}

export class GitHub {
  readonly #base: typeof fetch;
  readonly #api: typeof fetch;
  readonly #archive: typeof fetch;
  readonly #anywhere: typeof fetch;

  constructor(private readonly deps: GitHubDeps) {
    this.#base = deps.fetch ?? fetch;
    this.#api = guardedFetch('public', onlyTo(API_HOSTS, this.#base));
    this.#archive = guardedFetch('public', onlyTo(ARCHIVE_HOSTS, this.#base));
    this.#anywhere = guardedFetch('public', this.#base);
  }

  get #headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'user-agent': `Conch/${this.deps.version}`,
      'x-github-api-version': API_VERSION,
    };
  }

  /** One request, its failures turned into `SourceError`s (a caller's abort stays an abort). */
  async #send(
    via: typeof fetch,
    url: string,
    headers: Record<string, string>,
    ms: number,
    signal?: AbortSignal,
  ): Promise<{ response: Response; signal: AbortSignal }> {
    const timeout = AbortSignal.timeout(ms);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return { response: await via(url, { headers, signal: both }), signal: both };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof SourceError) throw error;
      if (error instanceof EndpointError)
        throw /Couldn’t find/.test(error.message)
          ? offline()
          : new SourceError('refused', error.message);
      throw timeout.aborted ? offline('GitHub took too long to answer.') : offline();
    }
  }

  /** What a refusal from GitHub means. */
  #failure(response: Response): SourceError {
    const status = response.status;
    if (status === 403 || status === 429) {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const after = Number(response.headers.get('retry-after'));
      const now = (this.deps.now ?? Date.now)();
      return new GitHubLimited(
        Number.isFinite(after) && after > 0
          ? now + after * 1000
          : Number.isFinite(reset) && reset > 0
            ? reset * 1000
            : undefined,
      );
    }
    if (status === 404 || status === 410 || status === 451)
      return new SourceError('not-found', 'GitHub has nothing at that address.');
    if (status >= 500) return offline('GitHub isn’t answering properly just now.');
    return new SourceError('refused', `GitHub refused that request (HTTP ${status}).`);
  }

  /** An API answer as JSON; `undefined` when GitHub has nothing there (404). */
  async api(path: string, signal?: AbortSignal): Promise<unknown> {
    const { response, signal: both } = await this.#send(
      this.#api,
      `${API}${path}`,
      this.#headers,
      this.deps.timeoutMs ?? 15_000,
      signal,
    );
    if (response.status === 404 || response.status === 422) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw this.#failure(response);
    }
    const bytes = await this.#read(response, JSON_CAP, both, signal);
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw offline('GitHub answered with something Conch couldn’t read.');
    }
  }

  async #read(
    response: Response,
    cap: number,
    both: AbortSignal,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    try {
      return await readCapped(response, cap);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof SourceError) throw error;
      throw both.aborted ? offline('The download took too long.') : offline();
    }
  }

  /** The commit a tag, branch or sha names, or `undefined` when there's no such thing. */
  async commit(owner: string, repo: string, ref: string, signal?: AbortSignal) {
    const path = ref.split('/').map(encodeURIComponent).join('/');
    const found = await this.api(`/repos/${owner}/${repo}/commits/${path}`, signal);
    const sha = (found as { sha?: unknown } | undefined)?.sha;
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  }

  /** The newest release's tag, or `undefined` when there's none. */
  async latestRelease(owner: string, repo: string, signal?: AbortSignal) {
    const found = await this.api(`/repos/${owner}/${repo}/releases/latest`, signal);
    const tag = (found as { tag_name?: unknown } | undefined)?.tag_name;
    return typeof tag === 'string' && tag.split('/').every(refOk) ? tag : undefined;
  }

  /** The repository's default branch; `not-found` when there's no such repository. */
  async defaultBranch(owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    const found = await this.api(`/repos/${owner}/${repo}`, signal);
    if (found === undefined) throw missingRepo(owner, repo);
    const branch = (found as { default_branch?: unknown }).default_branch;
    if (typeof branch !== 'string' || !branch.split('/').every(refOk))
      throw new SourceError('not-found', `github.com/${owner}/${repo} has nothing in it yet.`);
    return branch;
  }

  /**
   * The commit to download: the ref asked for, else the newest release, else
   * the default branch's head. A `/tree/` link's ref may contain `/`, so its
   * segments are tried as a ref from the shortest, and the rest is the folder.
   */
  async resolve(
    link: Extract<ParsedLink, { kind: 'github' }>,
    signal?: AbortSignal,
  ): Promise<Resolved> {
    const { owner, repo } = link;
    if (link.tree) {
      // At most four segments for a ref: `release/2026/10/1` is about as deep as they go.
      for (let take = 1; take <= Math.min(4, link.tree.length); take++) {
        const refParts = link.tree.slice(0, take);
        const pathParts = link.tree.slice(take);
        if (!refParts.every(refOk) || !pathParts.every(pathOk)) continue;
        const ref = refParts.join('/');
        const commit = await this.commit(owner, repo, ref, signal);
        if (commit)
          return {
            ref,
            at: ref,
            commit,
            ...(pathParts.length > 0 && { path: pathParts.join('/') }),
          };
      }
      await this.defaultBranch(owner, repo, signal);
      throw new SourceError(
        'not-found',
        `github.com/${owner}/${repo} has no branch or tag in that link. Check the address, or use the repository’s own address.`,
      );
    }
    const path = link.path ? { path: link.path } : {};
    if (link.ref) {
      const commit = await this.commit(owner, repo, link.ref, signal);
      if (commit) return { ref: link.ref, at: link.ref, commit, ...path };
      await this.defaultBranch(owner, repo, signal);
      throw new SourceError(
        'not-found',
        `github.com/${owner}/${repo} has no branch, tag or release called ${link.ref}. Check the address, or use the repository’s own address.`,
      );
    }
    const tag = await this.latestRelease(owner, repo, signal);
    const at = tag ?? (await this.defaultBranch(owner, repo, signal));
    const commit = await this.commit(owner, repo, at, signal);
    if (!commit)
      throw new SourceError('not-found', `github.com/${owner}/${repo} has nothing in it yet.`);
    return { at, commit, ...path };
  }

  /** A repository at one commit, as GitHub's tar.gz (via codeload, nowhere else). */
  async tarball(owner: string, repo: string, commit: string, signal?: AbortSignal) {
    const { response, signal: both } = await this.#send(
      this.#archive,
      `${API}/repos/${owner}/${repo}/tarball/${commit}`,
      this.#headers,
      this.deps.downloadMs ?? 60_000,
      signal,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw response.status === 404 ? missingRepo(owner, repo) : this.#failure(response);
    }
    const bytes = await this.#read(response, APP_LIMITS.download, both, signal);
    if (!isGzip(bytes))
      throw new SourceError('refused', 'GitHub sent something that isn’t an archive.');
    return bytes;
  }

  /** A `.conchapp` (or `.tar.gz`) from any public https address. */
  async download(url: string, signal?: AbortSignal): Promise<Buffer> {
    const { response, signal: both } = await this.#send(
      this.#anywhere,
      url,
      {
        accept: 'application/gzip, application/octet-stream;q=0.9, */*;q=0.1',
        'user-agent': `Conch/${this.deps.version}`,
      },
      this.deps.downloadMs ?? 60_000,
      signal,
    );
    const host = new URL(url).hostname;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 410)
        throw new SourceError(
          'not-found',
          `There’s no file at that address on ${host}. Check the link, or ask whoever shared it for a new one.`,
        );
      if (response.status >= 500 || response.status === 429)
        throw offline(`${host} isn’t answering properly just now.`);
      throw new SourceError(
        'refused',
        `${host} wouldn’t hand over that file (HTTP ${response.status}).`,
      );
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!type || !ARCHIVE_TYPES.includes(type)) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceError(
        'refused',
        `That address gives a ${type || 'file of no stated kind'}, not a Conch app. Use the address of the .conchapp file itself.`,
      );
    }
    const bytes = await this.#read(response, APP_LIMITS.download, both, signal);
    if (!isGzip(bytes))
      throw new SourceError(
        'refused',
        'That file isn’t a Conch app: a .conchapp is a tar.gz archive. Ask whoever shared it to save it again.',
      );
    return bytes;
  }
}

export function missingRepo(owner: string, repo: string): SourceError {
  return new SourceError(
    'not-found',
    `Conch couldn’t find github.com/${owner}/${repo}. Check the address; the repository may be private or gone.`,
  );
}
