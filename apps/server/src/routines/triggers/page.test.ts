import type { LiveDataResult } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { fetchLive } from '../../artifacts/live';
import {
  CONFIRM_MS,
  describePage,
  diffLines,
  hostsFor,
  lineKey,
  pageLines,
  pageProblem,
  pageSource,
  readableText,
  type PageFetch,
} from './page';
import type { SourceContext, TriggerOf } from './types';

const URL_ = 'https://shop.example.com/pricing';
const trigger: TriggerOf<'page'> = { kind: 'page', url: URL_, every: 60 };

const html = (main: string, extra = '') => `<!doctype html><html><head><title>Pricing</title>
<script>var t = ${Math.random()}</script><style>p{}</style></head>
<body><nav>Home · Pricing · Blog</nav><header>Sign in</header>
<main>${main}</main>
<aside>Ad: buy socks ${extra}</aside><footer>© 2026 · Updated 08:15</footer></body></html>`;

function fakeWeb(pages: string[]) {
  const asked: { url: string; hosts: string[] }[] = [];
  const fetchPage: PageFetch = async (url, hosts) => {
    asked.push({ url, hosts: [...hosts] });
    const body = pages.length > 1 ? (pages.shift() ?? '') : (pages[0] ?? '');
    return { ok: true, status: 200, type: 'text/html', body, at: Date.now() };
  };
  return { fetchPage, asked, set: (...next: string[]) => pages.splice(0, pages.length, ...next) };
}

const ctx = (state: Record<string, unknown>, now = 1_000_000) =>
  ({
    routineId: 'r1',
    title: 'Pricing',
    trigger,
    since: 0,
    state,
    now,
    signal: new AbortController().signal,
  }) as SourceContext<TriggerOf<'page'>>;

describe('when a page changes', () => {
  it('reads the words people read: the main part, without menus, scripts, ads or the footer', () => {
    const text = readableText(html('<h1>Plans</h1><p>Pro: $20 a month</p>', '42'), 'text/html');
    expect(text).toContain('Plans');
    expect(text).toContain('Pro: $20 a month');
    expect(text).not.toMatch(/socks|Sign in|Blog|var t|Updated/);
    expect(readableText('{"price": 20}', 'application/json')).toBe('{"price": 20}');
  });

  it('leaves times, dates and “5 minutes ago” out of the comparison', () => {
    expect(lineKey('Updated 5 minutes ago')).toBe('updated');
    expect(lineKey('Posted Oct 3, 2026 at 8:15 pm')).toBe('posted at');
    expect(lineKey('Price: $499')).toBe('price: $499');
    expect(pageLines('Last checked 2026-10-03T08:15:00Z\n12:30\n•\nPrice: $499')).toEqual([
      { line: 'Last checked 2026-10-03T08:15:00Z', key: 'last checked' },
      { line: 'Price: $499', key: 'price: $499' },
    ]);
  });

  it('says what was added and removed', () => {
    const before = pageLines('Pro: $20\nTeam: $50\nFree');
    const after = pageLines('Pro: $25\nTeam: $50\nFree\nEnterprise: call us');
    expect(diffLines(before, after)).toEqual({
      added: ['Pro: $25', 'Enterprise: call us'],
      removed: ['Pro: $20'],
    });
  });

  it('starts from the first read, waits for a change to hold, then reports it once', async () => {
    const web = fakeWeb([html('<p>Pro: $20 a month</p>')]);
    const source = pageSource(web.fetchPage);
    const first = await source.check?.(ctx({}));
    expect(first?.happenings).toEqual([]);
    // Only the clock in the footer and the script changed: nothing.
    const same = await source.check?.(ctx(first?.state ?? {}));
    expect(same?.happenings).toEqual([]);
    web.set(html('<p>Pro: $25 a month</p>'));
    const seen = await source.check?.(ctx(same?.state ?? {}));
    expect(seen?.happenings).toEqual([]);
    expect(seen?.again).toBe(CONFIRM_MS);
    const held = await source.check?.(ctx(seen?.state ?? {}));
    expect(held?.happenings).toHaveLength(1);
    expect(held?.happenings[0]).toMatchObject({
      label: 'the changes on shop.example.com/pricing',
      link: URL_,
    });
    expect(held?.happenings[0]?.detail).toContain('+ Pro: $25 a month');
    expect(held?.happenings[0]?.detail).toContain('- Pro: $20 a month');
    const after = await source.check?.(ctx(held?.state ?? {}));
    expect(after?.happenings).toEqual([]);
  });

  it('learns lines that come and go (a rotating banner), and stops noticing them', async () => {
    const web = fakeWeb([html('<p>Pro: $20</p><p>Deal of the day: socks</p>')]);
    const source = pageSource(web.fetchPage);
    let state = (await source.check?.(ctx({})))?.state ?? {};
    web.set(html('<p>Pro: $20</p><p>Deal of the day: hats</p>'));
    state = (await source.check?.(ctx(state)))?.state ?? {};
    // Back to what it was before it was confirmed: that line comes and goes.
    web.set(html('<p>Pro: $20</p><p>Deal of the day: socks</p>'));
    state = (await source.check?.(ctx(state)))?.state ?? {};
    expect(state.volatile).toEqual(
      expect.arrayContaining(['deal of the day: hats', 'deal of the day: socks']),
    );
    web.set(html('<p>Pro: $20</p><p>Deal of the day: hats</p>'));
    const flip = await source.check?.(ctx(state));
    expect(flip?.again).toBeUndefined();
    expect(flip?.happenings).toEqual([]);
  });

  it('only ever reads the page’s own host (and its www twin)', async () => {
    const web = fakeWeb([html('<p>x</p>')]);
    await pageSource(web.fetchPage).check?.(ctx({}));
    expect(web.asked[0]).toEqual({
      url: URL_,
      hosts: ['shop.example.com', 'www.shop.example.com'],
    });
    expect([...hostsFor('https://www.example.com/x')]).toEqual(['www.example.com', 'example.com']);
  });

  it('never watches this computer or your network, before or while reading', async () => {
    for (const bad of [
      'http://example.com/',
      'https://localhost/admin',
      'https://127.0.0.1/',
      'https://192.168.1.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data',
      'https://printer.local/',
      'https://intranet/',
      'https://me:pw@example.com/',
      'not a url',
    ])
      expect(pageProblem(bad), bad).toBeTruthy();
    expect(pageProblem('https://example.com/news')).toBeUndefined();
    await expect(
      pageSource(async () => ({
        ok: true,
        status: 200,
        type: 'text/html',
        body: '',
        at: 0,
      })).validate?.({ kind: 'page', url: 'https://10.0.0.1/', every: 60 }, {}),
    ).rejects.toThrow(/your own network/);

    // A public name that resolves inward is refused as it connects (DNS rebinding included).
    const inward: PageFetch = (url, hosts) =>
      fetchLive(
        url,
        { local: false, gatewayPort: 4317, hosts },
        { resolve: async () => [{ address: '10.1.2.3', family: 4 }] },
      );
    await expect(pageSource(inward).check?.(ctx({}))).rejects.toMatchObject({
      kind: 'needs-you',
      message: expect.stringMatching(/your own network/),
    });
    const metadata: PageFetch = (url, hosts) =>
      fetchLive(
        url,
        { local: false, gatewayPort: 4317, hosts },
        { resolve: async () => [{ address: '169.254.169.254', family: 4 }] },
      );
    await expect(pageSource(metadata).check?.(ctx({}))).rejects.toMatchObject({
      kind: 'needs-you',
    });
  });

  it('a page that’s down is tried again; one that’s gone says so', async () => {
    const down: PageFetch = async () =>
      ({
        ok: false,
        reason: 'timeout',
        message: 'shop.example.com took too long to answer.',
      }) as LiveDataResult;
    await expect(pageSource(down).check?.(ctx({}))).rejects.toMatchObject({ kind: 'retry' });
    const missing: PageFetch = async () => ({
      ok: true,
      status: 404,
      type: 'text/html',
      body: '',
      at: 0,
    });
    await expect(pageSource(missing).check?.(ctx({}))).rejects.toMatchObject({
      kind: 'retry',
      message: expect.stringMatching(/404/),
    });
    expect(pageSource(down).patience).toBe(24 * 60 * 60_000);
  });

  it('describes the page by its address', () => {
    expect(describePage(trigger)).toBe('When shop.example.com/pricing changes');
    expect(describePage({ ...trigger, url: 'https://www.example.com/' })).toBe(
      'When example.com changes',
    );
  });
});
