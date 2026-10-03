import { gzipSync } from 'node:zlib';

import { APP_LIMITS } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { GitHub, parseLink, treeUrl } from './github';
import { SourceError } from './types';

// The guard resolves every host before it's dialled: GitHub's are public,
// `*.internal` is on the local network, `nowhere.example` doesn't exist.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'nowhere.example') throw new Error('ENOTFOUND');
    if (host.endsWith('.internal')) return [{ address: '10.0.0.5', family: 4 }];
    if (host === 'metadata.example') return [{ address: '169.254.169.254', family: 4 }];
    return [{ address: '140.82.112.6', family: 4 }];
  }),
}));

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A pretend internet: one handler, every call recorded. */
function internet(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url: url.href, headers: { ...(init?.headers as Record<string, string>) } });
    return handler(url, init ?? {});
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const archive = gzipSync(Buffer.from('a tar would be here'));
const gz = (bytes: Buffer = archive, type = 'application/gzip') =>
  new Response(new Uint8Array(bytes), { headers: { 'content-type': type } });

async function failure(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SourceError) return error;
    throw error;
  }
  throw new Error('it worked');
}

describe('reading a link', () => {
  it.each([
    ['https://github.com/ada/plant-diary', { owner: 'ada', repo: 'plant-diary' }],
    ['github.com/ada/plant-diary', { owner: 'ada', repo: 'plant-diary' }],
    ['  <https://www.github.com/ada/plant-diary/>  ', { owner: 'ada', repo: 'plant-diary' }],
    ['http://github.com/Ada-L/plant.diary.git', { owner: 'Ada-L', repo: 'plant.diary' }],
    ['git@github.com:ada/plant-diary.git', { owner: 'ada', repo: 'plant-diary' }],
    ['https://github.com/ada/plant-diary?tab=readme#top', { owner: 'ada', repo: 'plant-diary' }],
    ['https://github.com/ada/plant-diary/tree/main', { ref: 'main' }],
    [
      'https://github.com/ada/apps/tree/main/apps/plant-diary',
      { tree: ['main', 'apps', 'plant-diary'] },
    ],
    [
      'https://github.com/ada/apps/blob/v2/apps/plant-diary/conch-app.json',
      { tree: ['v2', 'apps', 'plant-diary'] },
    ],
    ['https://github.com/ada/plant-diary/blob/main/conch-app.json', { ref: 'main' }],
    ['https://github.com/ada/plant-diary/releases/tag/v1.2.0', { ref: 'v1.2.0' }],
    ['https://github.com/ada/plant-diary/releases/tag/release/2026', { ref: 'release/2026' }],
    ['https://github.com/ada/plant-diary/releases/latest', { owner: 'ada', repo: 'plant-diary' }],
    ['https://github.com/ada/plant-diary/releases', { owner: 'ada', repo: 'plant-diary' }],
    ['https://github.com/ada/plant-diary/commit/0123abc', { ref: '0123abc' }],
    ['https://github.com/ada/plant-diary/tree/my%20branch', { tree: ['my branch'] }],
  ])('reads %s', (text, expected) => {
    const link = parseLink(text);
    expect(link).toMatchObject({ kind: 'github', ...expected });
    if (!('ref' in expected)) expect(link).not.toHaveProperty('ref');
  });

  it('takes any https address of a .conchapp or .tar.gz as a file', () => {
    expect(parseLink('https://example.com/apps/plant-diary.conchapp')).toEqual({
      kind: 'link',
      url: 'https://example.com/apps/plant-diary.conchapp',
    });
    expect(parseLink('https://files.example.org/x/plant.tar.gz?dl=1')).toMatchObject({
      kind: 'link',
    });
    // A file on a GitHub release is a file, not the repository.
    expect(
      parseLink('https://github.com/ada/plant-diary/releases/download/v1/plant-diary.conchapp'),
    ).toEqual({
      kind: 'link',
      url: 'https://github.com/ada/plant-diary/releases/download/v1/plant-diary.conchapp',
    });
  });

  it.each([
    '',
    'plant diary',
    'https://example.com/plant-diary',
    'http://example.com/plant-diary.conchapp',
    'ftp://example.com/plant-diary.conchapp',
    'file:///C:/apps/plant.conchapp',
    'javascript:alert(1)',
    'https://user:secret@example.com/plant.conchapp',
    'https://ada:token@github.com/ada/plant-diary',
    'https://github.com/ada',
    'https://github.com/-ada/plant',
    'https://github.com/ada/..',
    'https://github.com/ada/plant-diary/issues/4',
    'https://github.com/ada/plant-diary/blob/main/README.md',
    'https://github.com/ada/plant-diary/tree/main/../../etc',
    'https://github.com/ada/plant-diary/tree/main/.git',
    'https://github.com/ada/plant-diary/tree/%E0%A4%A',
    'https://gitlab.com/ada/plant-diary',
    'https://github.com.evil.example/ada/plant-diary',
    `https://github.com/ada/${'a'.repeat(2000)}`,
  ])('refuses %s, saying what it takes', (text) => {
    let thrown: unknown;
    try {
      parseLink(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SourceError);
    expect((thrown as SourceError).code).toBe('not-a-link');
    expect((thrown as SourceError).message).toMatch(/github\.com\/ada\/plant-diary.*\.conchapp/);
  });

  it('writes GitHub’s page for a folder at a ref', () => {
    expect(treeUrl('ada', 'apps')).toBe('https://github.com/ada/apps');
    expect(treeUrl('ada', 'apps', 'feature/x', 'apps/my plant')).toBe(
      'https://github.com/ada/apps/tree/feature/x/apps/my%20plant',
    );
  });
});

describe('downloading', () => {
  it('follows GitHub’s archive only to codeload, asking as Conch', async () => {
    const net = internet((url) =>
      url.hostname === 'api.github.com'
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://codeload.github.com/ada/plant/legacy.tar.gz/abc' },
          })
        : gz(archive, 'application/x-gzip'),
    );
    const github = new GitHub({ fetch: net.fetch, version: '1.4.0' });
    expect(await github.tarball('ada', 'plant', 'a'.repeat(40))).toEqual(archive);
    expect(net.calls.map((c) => new URL(c.url).hostname)).toEqual([
      'api.github.com',
      'codeload.github.com',
    ]);
    expect(net.calls[0]?.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      'user-agent': 'Conch/1.4.0',
      'x-github-api-version': '2022-11-28',
    });
  });

  it('refuses a redirect anywhere but GitHub, before dialling it', async () => {
    for (const location of [
      'https://evil.example/plant.tar.gz',
      'http://codeload.github.com/ada/plant/legacy.tar.gz/abc',
      'https://github.com.evil.example/x',
    ]) {
      const net = internet((url) =>
        url.hostname === 'api.github.com'
          ? new Response(null, { status: 302, headers: { location } })
          : gz(),
      );
      const github = new GitHub({ fetch: net.fetch, version: '1' });
      const error = await failure(github.tarball('ada', 'plant', 'a'.repeat(40)));
      expect(error.code).toBe('refused');
      expect(net.calls).toHaveLength(1);
    }
  });

  it('refuses a file link that leads into the local network or to cloud metadata', async () => {
    for (const location of [
      'https://nas.internal/plant.conchapp',
      'https://metadata.example/latest',
      'http://example.com/plant.conchapp',
    ]) {
      const net = internet((url) =>
        url.hostname === 'files.example.com'
          ? new Response(null, { status: 301, headers: { location } })
          : gz(),
      );
      const github = new GitHub({ fetch: net.fetch, version: '1' });
      const error = await failure(github.download('https://files.example.com/plant.conchapp'));
      expect(error.code).toBe('refused');
      expect(net.calls).toHaveLength(1);
    }
  });

  it('stops a download the moment it passes the limit', async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    chunk[0] = 0x1f;
    chunk[1] = 0x8b;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        controller.enqueue(chunk);
      },
    });
    const net = internet(
      () => new Response(endless, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    const github = new GitHub({ fetch: net.fetch, version: '1' });
    const error = await failure(github.download('https://files.example.com/plant.conchapp'));
    expect(error.code).toBe('too-big');
    expect(error.message).toMatch(/10 MB/);
    // Read up to the limit, and not much past it.
    expect(sent).toBeLessThan(APP_LIMITS.download / chunk.length + 3);
  });

  it('refuses a download that says up front it’s too big, without reading it', async () => {
    const net = internet(
      () =>
        new Response(new Uint8Array(archive), {
          headers: {
            'content-type': 'application/gzip',
            'content-length': String(APP_LIMITS.download + 1),
          },
        }),
    );
    const github = new GitHub({ fetch: net.fetch, version: '1' });
    expect((await failure(github.download('https://f.example.com/a.conchapp'))).code).toBe(
      'too-big',
    );
  });

  it('takes only an archive: by its type and by its first bytes', async () => {
    const github = (response: () => Response) =>
      new GitHub({ fetch: internet(response).fetch, version: '1' });
    const url = 'https://files.example.com/plant.conchapp';
    expect(
      await github(() => gz(archive, 'application/gzip; charset=binary')).download(url),
    ).toEqual(archive);
    expect(await github(() => gz(archive, 'application/x-tar')).download(url)).toEqual(archive);
    const page = await failure(github(() => gz(archive, 'text/html')).download(url));
    expect(page.code).toBe('refused');
    expect(page.message).toMatch(/text\/html/);
    const notGzip = await failure(
      github(() => gz(Buffer.from('<html>'), 'application/octet-stream')).download(url),
    );
    expect(notGzip.message).toMatch(/tar\.gz/);
    const missing = await failure(github(() => new Response('', { status: 404 })).download(url));
    expect(missing.code).toBe('not-found');
  });

  it('says offline when the network fails, and when the address doesn’t resolve', async () => {
    const down = new GitHub({
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
      version: '1',
    });
    expect((await failure(down.api('/repos/ada/plant'))).code).toBe('offline');
    const nowhere = new GitHub({ fetch: internet(() => gz()).fetch, version: '1' });
    expect((await failure(nowhere.download('https://nowhere.example/a.conchapp'))).code).toBe(
      'offline',
    );
  });

  it('gives up on a slow answer as offline, but keeps a caller’s own abort', async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const slow = new GitHub({ fetch: hang, version: '1', timeoutMs: 20 });
    const error = await failure(slow.api('/repos/ada/plant'));
    expect(error.code).toBe('offline');
    expect(error.message).toMatch(/too long/);
    const stop = new AbortController();
    const asked = new GitHub({ fetch: hang, version: '1' }).api('/repos/ada/plant', stop.signal);
    stop.abort();
    await expect(asked).rejects.not.toBeInstanceOf(SourceError);
  });
});
