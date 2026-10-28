import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import type { AppFetcher } from '../conchapps/types';
import { keenableResults, researchTools, searchResults, publicWebFetcher } from './tools';

const ctx = { conversationId: 'one', signal: new AbortController().signal } as ToolContext;
describe('public research', () => {
  it('extracts structured search results and drops malformed or unsafe links', () => {
    const rss =
      '<rss><channel><item><title>A &amp; B</title><link>https://example.org/a</link><description>Text</description></item><item><title>bad</title><link>javascript:alert(1)</link></item><item><title>duplicate</title><link>https://example.org/a</link></item></channel></rss>';
    expect(searchResults(rss)).toEqual([
      { title: 'A & B', url: 'https://example.org/a', snippet: 'Text' },
    ]);
    expect(() => searchResults('<!DOCTYPE rss><rss/>')).toThrow();
    expect(() => searchResults('<html>captcha</html>')).toThrow('browser');
  });
  it('returns readable text, sources, final URLs and continuation', async () => {
    const fetcher: AppFetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.org/final',
      headers: { 'content-type': 'text/html' },
      body:
        '<title>Report</title><nav>Ignore navigation</nav><script>bad()</script><main>' +
        'Useful text. '.repeat(100) +
        '</main>',
    }));
    const tool = researchTools(ctx, fetcher).find((t) => t.name === 'web_fetch');
    const result = await tool?.run({ url: 'https://example.org', offset: 0, limit: 100 });
    expect(result).toMatchObject({
      view: { kind: 'sources', items: [{ url: 'https://example.org/final' }] },
    });
    expect(typeof result === 'object' && result.text).toContain('nextOffset');
    expect(typeof result === 'object' && result.text).not.toContain('Ignore navigation');
  });
  it('does not hide failed HTTP responses or binary downloads', async () => {
    for (const response of [
      { ok: false, status: 403, headers: {}, body: 'no' },
      { ok: true, status: 200, headers: {}, body: 'AA==', bodyBase64: true },
    ]) {
      const tool = researchTools(ctx, async () => response).find((t) => t.name === 'web_fetch');
      await expect(
        tool?.run({ url: 'https://example.org', offset: 0, limit: 100 }),
      ).rejects.toThrow();
    }
  });
  describe('web_search through Keenable', () => {
    const rss =
      '<rss><channel><item><title>From Bing</title><link>https://example.org/bing</link></item></channel></rss>';
    const keenable = JSON.stringify({
      results: [
        {
          title: 'Page',
          url: 'https://example.org/a',
          description: '',
          snippet: 'Line one\n\n  two',
        },
        { title: '', url: 'https://example.org/b', snippet: 'x'.repeat(700) },
        { title: 'plain', url: 'http://example.org/c', snippet: 'not https' },
        { title: 'again', url: 'https://example.org/a', snippet: 'duplicate' },
        { title: 'no address' },
      ],
    });
    const answering = (keenableAnswer: { ok: boolean; status: number; body: string }) =>
      vi.fn<AppFetcher>(async (_app, request) =>
        request.url.startsWith('https://api.keenable.ai/')
          ? { ...keenableAnswer, headers: { 'content-type': 'application/json' } }
          : {
              ok: true,
              status: 200,
              headers: { 'content-type': 'application/rss+xml' },
              body: rss,
            },
      );
    const search = (fetcher: AppFetcher, options?: Parameters<typeof researchTools>[2]) =>
      researchTools(ctx, fetcher, options).find((t) => t.name === 'web_search');

    it('reads https sources once each, with its page text as the snippet', () => {
      expect(keenableResults(keenable)).toEqual([
        { title: 'Page', url: 'https://example.org/a', snippet: 'Line one two' },
        { title: 'example.org', url: 'https://example.org/b', snippet: 'x'.repeat(600) },
      ]);
      expect(keenableResults('not json')).toEqual([]);
      expect(keenableResults('{"error":"limit"}')).toEqual([]);
    });

    it('asks Keenable without a key when chosen, naming Conch', async () => {
      const fetcher = answering({ ok: true, status: 200, body: keenable });
      const tool = search(fetcher, { engine: 'keenable' });
      expect(tool?.description).toContain('Queries are sent to Keenable (or to Bing');
      const result = await tool?.run({ query: 'tides today' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [app, request] = fetcher.mock.calls[0] ?? [];
      expect(app?.reaches).toEqual(['api.keenable.ai']);
      expect(request).toMatchObject({
        url: 'https://api.keenable.ai/v1/search/public',
        method: 'POST',
        headers: { 'x-keenable-title': 'Conch', 'content-type': 'application/json' },
      });
      expect(request?.headers).not.toHaveProperty('authorization');
      expect(JSON.parse(request?.body ?? '')).toEqual({ query: 'tides today', max_results: 10 });
      const text = typeof result === 'object' ? JSON.parse(result.text) : {};
      expect(text).toMatchObject({
        provider: 'Keenable',
        sources: [{ url: 'https://example.org/a' }, { url: 'https://example.org/b' }],
      });
    });

    it('sends a key only to the keyed endpoint, as authorization', async () => {
      const fetcher = answering({ ok: true, status: 200, body: keenable });
      await search(fetcher, { engine: 'keenable', keenableKey: 'kn-' + 'test' })?.run({
        query: 'q',
      });
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
        url: 'https://api.keenable.ai/v1/search',
        headers: { authorization: 'Bearer kn-test', 'x-keenable-title': 'Conch' },
      });
    });

    it('lets Bing answer when Keenable is limited, down or finds nothing', async () => {
      for (const answer of [
        { ok: false, status: 429, body: '{"error":"rate limited"}' },
        { ok: false, status: 0, body: '' },
        { ok: true, status: 200, body: '{"results":[]}' },
      ]) {
        const fetcher = answering(answer);
        const result = await search(fetcher, { engine: 'keenable' })?.run({ query: 'q' });
        expect(fetcher).toHaveBeenCalledTimes(2);
        const text = typeof result === 'object' ? JSON.parse(result.text) : {};
        expect(text).toMatchObject({ provider: 'Bing', sources: [{ title: 'From Bing' }] });
      }
    });

    it('never asks Keenable unless it was chosen', async () => {
      for (const options of [undefined, { engine: 'bing' as const, keenableKey: 'kn-' + 'test' }]) {
        const fetcher = answering({ ok: true, status: 200, body: keenable });
        const tool = search(fetcher, options);
        expect(tool?.description).toContain('Queries are sent to Bing;');
        const result = await tool?.run({ query: 'q' });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0]?.[1].url).toMatch(/^https:\/\/www\.bing\.com\/search\?/);
        expect(typeof result === 'object' && JSON.parse(result.text).provider).toBe('Bing');
      }
    });
  });
  it('rejects local addresses without making a public request', async () => {
    const fetcher = publicWebFetcher(4317);
    for (const host of ['127.0.0.1', '169.254.169.254', '[::1]']) {
      const response = await fetcher(
        { id: 'test', reaches: [host] },
        { url: `https://${host}/`, method: 'GET', headers: {} },
        ctx.signal,
      );
      expect(response.ok).toBe(false);
      expect(response.refused).toBeTruthy();
    }
  });
});
