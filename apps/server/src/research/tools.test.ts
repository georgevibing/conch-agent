import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import type { AppFetcher } from '../conchapps/types';
import { researchTools, searchResults, publicWebFetcher } from './tools';

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
