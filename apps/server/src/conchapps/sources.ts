/**
 * Where apps come from (ADR 0061 §6): a GitHub repository, a folder, tag or
 * release in one, or any https address of a `.conchapp`; and **Find an
 * app**'s search of GitHub for the topic `conch-app`, calm when GitHub limits
 * it. Also the newest version where an app came from, for updates (§8).
 */
import { z } from 'zod';

import { GitHub, GitHubLimited, isRef, isRepoName, parseLink, treeUrl } from './github';
import { type AppSources, type CommunityRepo, type FetchedPackage, SourceError } from './types';

export interface SourcesDeps {
  /** What the SSRF guard sends through; tests hand in a fake. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Conch's version, for GitHub's `user-agent`. */
  version: string;
}

/** How long a search is kept: GitHub allows ten unsigned searches a minute. */
const SEARCH_TTL_MS = 10 * 60_000;
/** When GitHub limits us without saying until when. */
const DEFAULT_BACKOFF_MS = 60_000;
const MAX_CACHED = 100;
const QUERY_MAX = 100;
const QUERY_WORDS = 8;

/**
 * What a person typed, as words GitHub only reads as words: no qualifiers
 * (`user:`, `topic:`, `in:` — anything with a colon), no quotes, operators
 * or symbols, at most eight words and a hundred characters, lower case.
 * The empty string lists the most-starred.
 */
export function searchWords(query: string): string {
  const words = query
    .normalize('NFKC')
    .toLowerCase()
    .slice(0, QUERY_MAX * 2)
    .split(/\s+/)
    .filter((word) => word && !word.includes(':'))
    .map((word) => word.replace(/[^\p{L}\p{N}._-]+/gu, '').replace(/^[._-]+|[._-]+$/g, ''))
    .filter((word) => word && !['and', 'or', 'not'].includes(word))
    .slice(0, QUERY_WORDS);
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > QUERY_MAX) break;
    out = next;
  }
  return out;
}

const SearchItem = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
  description: z.string().nullable().optional(),
  stargazers_count: z.number().int().nonnegative().optional(),
  pushed_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  html_url: z.string(),
  archived: z.boolean().optional(),
});
const SearchPage = z.object({ items: z.array(z.unknown()) });

/** A description fit for a tile: one line, at most 280 characters. */
function tidy(description: string | null | undefined): string {
  const one = (description ?? '').replace(/\s+/g, ' ').trim();
  return one.length <= 280 ? one : `${one.slice(0, 279).trimEnd()}…`;
}

function toRepo(raw: unknown): CommunityRepo | undefined {
  const item = SearchItem.safeParse(raw);
  if (!item.success || item.data.archived) return undefined;
  const { name, owner, html_url } = item.data;
  const url = `https://github.com/${owner.login}/${name}`;
  // Only GitHub's own page for that very repository.
  if (html_url.toLowerCase() !== url.toLowerCase()) return undefined;
  const when = Date.parse(item.data.pushed_at ?? item.data.updated_at ?? '');
  return {
    owner: owner.login,
    repo: name,
    description: tidy(item.data.description),
    stars: item.data.stargazers_count ?? 0,
    ...(Number.isFinite(when) && { updatedAt: when }),
    url,
  };
}

export function createSources(deps: SourcesDeps): AppSources {
  const now = deps.now ?? Date.now;
  const github = new GitHub({ fetch: deps.fetch, version: deps.version, now });
  const cache = new Map<string, { repos: CommunityRepo[]; at: number }>();
  /** GitHub asked us to wait until then: until it passes, answer from the cache. */
  let quietUntil = 0;

  const remember = (key: string, repos: CommunityRepo[]) => {
    cache.delete(key);
    cache.set(key, { repos, at: now() });
    while (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return {
    async fetch(link, signal): Promise<FetchedPackage> {
      const parsed = parseLink(link);
      if (parsed.kind === 'link')
        return {
          archive: await github.download(parsed.url, signal),
          source: { kind: 'link', url: parsed.url },
        };
      const { owner, repo } = parsed;
      const found = await github.resolve(parsed, signal);
      const archive = await github.tarball(owner, repo, found.commit, signal);
      return {
        archive,
        ...(found.path && { path: found.path }),
        source: {
          kind: 'github',
          owner,
          repo,
          ...(found.path && { path: found.path }),
          ...(found.ref && { ref: found.ref }),
          commit: found.commit,
          url:
            found.path || found.ref
              ? treeUrl(owner, repo, found.at, found.path)
              : treeUrl(owner, repo),
        },
      };
    },

    async search(query) {
      const words = searchWords(query);
      const cached = cache.get(words);
      if (cached && now() - cached.at < SEARCH_TTL_MS)
        return { repos: cached.repos, limited: false, offline: false };
      if (now() < quietUntil) return { repos: cached?.repos ?? [], limited: true, offline: false };
      const params = new URLSearchParams({
        q: words ? `topic:conch-app ${words}` : 'topic:conch-app',
        sort: 'stars',
        order: 'desc',
        per_page: '24',
      });
      try {
        const page = SearchPage.safeParse(await github.api(`/search/repositories?${params}`));
        const repos = page.success ? page.data.items.flatMap((item) => toRepo(item) ?? []) : [];
        remember(words, repos);
        return { repos, limited: false, offline: false };
      } catch (error) {
        if (error instanceof GitHubLimited) {
          quietUntil = Math.max(error.resetAt ?? 0, now() + DEFAULT_BACKOFF_MS);
          return { repos: cached?.repos ?? [], limited: true, offline: false };
        }
        if (error instanceof SourceError)
          return { repos: cached?.repos ?? [], limited: false, offline: true };
        throw error;
      }
    },

    async latest(source) {
      const { owner, repo, ref } = source;
      if (!isRepoName(owner, repo) || (ref !== undefined && !isRef(ref))) return undefined;
      if (ref) {
        const commit = await github.commit(owner, repo, ref);
        return commit ? { ref, commit } : undefined;
      }
      try {
        const tag = await github.latestRelease(owner, repo);
        const at = tag ?? (await github.defaultBranch(owner, repo));
        const commit = await github.commit(owner, repo, at);
        return { ref: at, ...(commit && { commit }) };
      } catch (error) {
        // Gone or emptied: there's nothing newer to offer.
        if (error instanceof SourceError && error.code === 'not-found') return undefined;
        throw error;
      }
    },
  };
}
