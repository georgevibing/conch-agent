import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { createSources, searchWords } from './sources';
import { SourceError } from './types';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '140.82.112.6', family: 4 }]),
}));

const SHA = 'c0ffee'.padEnd(40, '0');
const OTHER = 'beef'.padEnd(40, '1');
const archive = gzipSync(Buffer.from('a tar would be here'));

/**
 * A pretend GitHub: `routes` maps an API path (and query) to a JSON answer, a
 * status, or a Response. The tarball redirects to codeload, which sends `archive`.
 */
function gitHub(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = `${url.pathname}${url.search}`;
    asked.push(path);
    if (url.hostname === 'codeload.github.com')
      return new Response(new Uint8Array(archive), {
        headers: { 'content-type': 'application/x-gzip' },
      });
    if (/\/tarball\//.test(path))
      return new Response(null, {
        status: 302,
        headers: { location: `https://codeload.github.com${url.pathname}` },
      });
    const route = routes[path];
    if (route === undefined) return Response.json({ message: 'Not Found' }, { status: 404 });
    if (route instanceof Response) return route;
    if (typeof route === 'number') return Response.json({ message: 'No' }, { status: route });
    if (route instanceof Error) throw route;
    return Response.json(route);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, asked };
}

async function failure(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SourceError) return error;
    throw error;
  }
  throw new Error('it worked');
}

describe('adding from a link', () => {
  it('takes the newest release when the link names no version', async () => {
    const gh = gitHub({
      '/repos/ada/plant-diary/releases/latest': { tag_name: 'v1.2.0' },
      '/repos/ada/plant-diary/commits/v1.2.0': { sha: SHA },
    });
    const sources = createSources({ fetch: gh.fetch, version: '1' });
    const got = await sources.fetch('github.com/ada/plant-diary');
    expect(got.archive).toEqual(archive);
    expect(got.path).toBeUndefined();
    // No ref: updates follow the newest release, wherever it goes.
    expect(got.source).toEqual({
      kind: 'github',
      owner: 'ada',
      repo: 'plant-diary',
      commit: SHA,
      url: 'https://github.com/ada/plant-diary',
    });
    expect(gh.asked).toContain(`/repos/ada/plant-diary/tarball/${SHA}`);
  });

  it('takes the default branch’s head when there’s no release', async () => {
    const gh = gitHub({
      '/repos/ada/plant-diary': { default_branch: 'trunk' },
      '/repos/ada/plant-diary/commits/trunk': { sha: SHA },
    });
    const got = await createSources({ fetch: gh.fetch, version: '1' }).fetch(
      'https://github.com/ada/plant-diary',
    );
    expect(got.source).toMatchObject({ commit: SHA });
    expect(got.source).not.toHaveProperty('ref');
    expect(gh.asked).toContain(`/repos/ada/plant-diary/tarball/${SHA}`);
  });

  it('downloads exactly the ref a link names', async () => {
    const gh = gitHub({ '/repos/ada/plant-diary/commits/v1.0.0': { sha: OTHER } });
    const got = await createSources({ fetch: gh.fetch, version: '1' }).fetch(
      'https://github.com/ada/plant-diary/releases/tag/v1.0.0',
    );
    expect(got.source).toEqual({
      kind: 'github',
      owner: 'ada',
      repo: 'plant-diary',
      ref: 'v1.0.0',
      commit: OTHER,
      url: 'https://github.com/ada/plant-diary/tree/v1.0.0',
    });
    expect(gh.asked).not.toContain('/repos/ada/plant-diary/releases/latest');
  });

  it('splits a folder link whose branch has a slash in it by asking GitHub', async () => {
    const gh = gitHub({
      // `feature` alone isn't a ref (GitHub says 422); `feature/x` is.
      '/repos/ada/apps/commits/feature': 422,
      '/repos/ada/apps/commits/feature/x': { sha: SHA },
    });
    const got = await createSources({ fetch: gh.fetch, version: '1' }).fetch(
      'https://github.com/ada/apps/tree/feature/x/apps/plant-diary',
    );
    expect(got.path).toBe('apps/plant-diary');
    expect(got.source).toEqual({
      kind: 'github',
      owner: 'ada',
      repo: 'apps',
      path: 'apps/plant-diary',
      ref: 'feature/x',
      commit: SHA,
      url: 'https://github.com/ada/apps/tree/feature/x/apps/plant-diary',
    });
  });

  it('says plainly when the repository or the ref isn’t there', async () => {
    const sources = createSources({ fetch: gitHub({}).fetch, version: '1' });
    const repo = await failure(sources.fetch('github.com/ada/nothing'));
    expect(repo.code).toBe('not-found');
    expect(repo.message).toMatch(/couldn’t find github\.com\/ada\/nothing.*private/);
    const ref = await failure(
      createSources({
        fetch: gitHub({ '/repos/ada/plant': { default_branch: 'main' } }).fetch,
        version: '1',
      }).fetch('github.com/ada/plant/tree/v9'),
    );
    expect(ref.code).toBe('not-found');
    expect(ref.message).toMatch(/no branch, tag or release called v9/);
  });

  it('downloads a .conchapp from anywhere public', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(archive), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    const got = await createSources({
      fetch: fetch as unknown as typeof globalThis.fetch,
      version: '1',
    }).fetch('https://example.com/plant-diary.conchapp');
    expect(got).toEqual({
      archive,
      source: { kind: 'link', url: 'https://example.com/plant-diary.conchapp' },
    });
  });

  it('refuses what isn’t a link before asking anyone', async () => {
    const gh = gitHub({});
    const error = await failure(
      createSources({ fetch: gh.fetch, version: '1' }).fetch('my plant app'),
    );
    expect(error.code).toBe('not-a-link');
    expect(gh.asked).toEqual([]);
  });

  it('says when GitHub is limiting Conch, and when it can’t be reached', async () => {
    const limited = createSources({
      fetch: gitHub({ '/repos/ada/plant/releases/latest': 403 }).fetch,
      version: '1',
    });
    expect((await failure(limited.fetch('github.com/ada/plant'))).code).toBe('limited');
    const offline = createSources({
      fetch: gitHub({ '/repos/ada/plant/releases/latest': new TypeError('fetch failed') }).fetch,
      version: '1',
    });
    const error = await failure(offline.fetch('github.com/ada/plant'));
    expect(error.code).toBe('offline');
    expect(error.message).toMatch(/internet connection/);
  });
});

describe('finding apps on GitHub', () => {
  const item = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    owner: { login: 'ada' },
    description: `  ${name}\n  keeps   track  `,
    stargazers_count: 12,
    pushed_at: '2026-09-01T10:00:00Z',
    html_url: `https://github.com/ada/${name}`,
    ...extra,
  });
  const search = (q: string) =>
    `/search/repositories?${new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: '24' })}`;

  it('lists the most-starred with the topic when nothing is typed', async () => {
    const gh = gitHub({
      [search('topic:conch-app')]: {
        items: [
          item('plant-diary'),
          item('old-thing', { archived: true }),
          // A page that isn't GitHub's own for that repository is left out.
          item('elsewhere', { html_url: 'https://evil.example/ada/elsewhere' }),
          { name: 'broken' },
        ],
      },
    });
    const found = await createSources({ fetch: gh.fetch, version: '1' }).search('   ');
    expect(found).toEqual({
      repos: [
        {
          owner: 'ada',
          repo: 'plant-diary',
          description: 'plant-diary keeps track',
          stars: 12,
          updatedAt: Date.parse('2026-09-01T10:00:00Z'),
          url: 'https://github.com/ada/plant-diary',
        },
      ],
      limited: false,
      offline: false,
    });
  });

  it('keeps what a person typed to words, so nothing can widen the search', () => {
    expect(searchWords('Weather  user:evil in:readme "forecast" OR rain -is:archived')).toBe(
      'weather forecast rain',
    );
    expect(searchWords('topic:other repo:ada/x')).toBe('');
    expect(searchWords('plants; DROP')).toBe('plants drop');
    expect(searchWords('a b c d e f g h i j')).toBe('a b c d e f g h');
    expect(searchWords('x'.repeat(500)).length).toBeLessThanOrEqual(100);
    expect(searchWords(`${'word '.repeat(30)}`).length).toBeLessThanOrEqual(100);
  });

  it('asks GitHub once in ten minutes for the same words', async () => {
    let now = 1_000_000;
    const gh = gitHub({ [search('topic:conch-app plants')]: { items: [item('plant-diary')] } });
    const sources = createSources({ fetch: gh.fetch, version: '1', now: () => now });
    await sources.search('Plants');
    await sources.search('plants ');
    expect(gh.asked).toHaveLength(1);
    now += 10 * 60_000 + 1;
    await sources.search('plants');
    expect(gh.asked).toHaveLength(2);
  });

  it('answers from what it had while GitHub limits it, and waits until GitHub says', async () => {
    let now = 1_000_000;
    let limit = false;
    // GitHub says wait five minutes from when it limits us.
    const reset = Math.floor((now + 16 * 60_000) / 1000);
    const fetch = vi.fn(async () =>
      limit
        ? Response.json(
            { message: 'API rate limit exceeded' },
            {
              status: 403,
              headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
            },
          )
        : Response.json({ items: [item('plant-diary')] }),
    );
    const sources = createSources({
      fetch: fetch as unknown as typeof globalThis.fetch,
      version: '1',
      now: () => now,
    });
    const first = await sources.search('plants');
    expect(first.repos).toHaveLength(1);
    // Stale, and GitHub now says wait.
    now += 11 * 60_000;
    limit = true;
    const calm = await sources.search('plants');
    expect(calm).toEqual({ repos: first.repos, limited: true, offline: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Words it never had: none, and no request while it waits.
    now += 60_000;
    expect(await sources.search('weather')).toEqual({ repos: [], limited: true, offline: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Past GitHub's reset, it asks again.
    now = reset * 1000 + 1;
    limit = false;
    expect((await sources.search('weather')).limited).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('backs off a minute when GitHub limits without saying until when', async () => {
    let now = 5_000_000;
    const fetch = vi.fn(async () => Response.json({ message: 'slow down' }, { status: 429 }));
    const sources = createSources({
      fetch: fetch as unknown as typeof globalThis.fetch,
      version: '1',
      now: () => now,
    });
    expect((await sources.search('x')).limited).toBe(true);
    now += 30_000;
    expect((await sources.search('y')).limited).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 31_000;
    await sources.search('y');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says offline, with what it had, when GitHub can’t be reached', async () => {
    let now = 0;
    let down = false;
    const fetch = vi.fn(async () => {
      if (down) throw new TypeError('fetch failed');
      return Response.json({ items: [item('plant-diary')] });
    });
    const sources = createSources({
      fetch: fetch as unknown as typeof globalThis.fetch,
      version: '1',
      now: () => now,
    });
    await sources.search('');
    now += 20 * 60_000;
    down = true;
    const got = await sources.search('');
    expect(got.offline).toBe(true);
    expect(got.repos).toHaveLength(1);
    expect(await sources.search('other')).toEqual({ repos: [], limited: false, offline: true });
  });
});

describe('the newest version where an app came from', () => {
  it('is the newest release, else the default branch’s head', async () => {
    const released = createSources({
      fetch: gitHub({
        '/repos/ada/plant/releases/latest': { tag_name: 'v2.0.0' },
        '/repos/ada/plant/commits/v2.0.0': { sha: SHA },
      }).fetch,
      version: '1',
    });
    expect(await released.latest({ owner: 'ada', repo: 'plant' })).toEqual({
      ref: 'v2.0.0',
      commit: SHA,
    });
    const gh = gitHub({
      '/repos/ada/plant': { default_branch: 'main' },
      '/repos/ada/plant/commits/main': { sha: OTHER },
    });
    const branch = createSources({ fetch: gh.fetch, version: '1' });
    expect(await branch.latest({ owner: 'ada', repo: 'plant' })).toEqual({
      ref: 'main',
      commit: OTHER,
    });
    // Without downloading anything.
    expect(gh.asked.some((path) => path.includes('tarball'))).toBe(false);
  });

  it('follows the ref it was added at', async () => {
    const sources = createSources({
      fetch: gitHub({ '/repos/ada/plant/commits/stable': { sha: SHA } }).fetch,
      version: '1',
    });
    expect(await sources.latest({ owner: 'ada', repo: 'plant', ref: 'stable' })).toEqual({
      ref: 'stable',
      commit: SHA,
    });
    expect(await sources.latest({ owner: 'ada', repo: 'plant', ref: 'gone' })).toBeUndefined();
  });

  it('is nothing for a repository that’s gone, or a name that isn’t one', async () => {
    const gh = gitHub({});
    const sources = createSources({ fetch: gh.fetch, version: '1' });
    expect(await sources.latest({ owner: 'ada', repo: 'gone' })).toBeUndefined();
    const asked = gh.asked.length;
    expect(await sources.latest({ owner: '../..', repo: 'x' })).toBeUndefined();
    expect(await sources.latest({ owner: 'ada', repo: 'x', ref: '../../user' })).toBeUndefined();
    expect(gh.asked).toHaveLength(asked);
  });

  it('lets a caller tell a limit from nothing new', async () => {
    const sources = createSources({
      fetch: gitHub({ '/repos/ada/plant/releases/latest': 429 }).fetch,
      version: '1',
    });
    expect((await failure(sources.latest({ owner: 'ada', repo: 'plant' }))).code).toBe('limited');
  });
});
