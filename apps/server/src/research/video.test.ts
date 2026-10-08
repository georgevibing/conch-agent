import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { HostTool } from '../engines/types';
import {
  agoWords,
  clockSeconds,
  jsonAt,
  oembedOf,
  videoTools,
  watchDetails,
  youtubeResults,
} from './video';

// The smallest real PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');

const renderer = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: 'Natasha’s Kitchen' }] },
    lengthText: { simpleText: '11:53' },
    viewCountText: { simpleText: '3,344,279 views' },
    publishedTimeText: { simpleText: '2y ago' },
    ...extra,
  },
});

const results = (items: unknown[]) =>
  `<html><script>var ytInitialData = ${JSON.stringify({
    contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } },
  })};</script></html>`;

const watch = `<html><head><title>Bake it - YouTube</title>
<meta itemprop="duration" content="PT11M53S">
<meta itemprop="interactionType" content="https://schema.org/WatchAction"><meta itemprop="userInteractionCount" content="3344279">
<meta itemprop="datePublished" content="2024-03-08T08:30:07-08:00">
</head><body><script>{"chapterRenderer":{"title":{"simpleText":"Intro \\u0026 starter"},"timeRangeStartMillis":0},"x":1,"chapterRenderer":{"title":{"simpleText":"Shaping"},"timeRangeStartMillis":206000}}</script></body></html>`;

const ok = (body: string, extra: Partial<AppFetchResponse> = {}): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: {},
  body,
  ...extra,
});
const missing: AppFetchResponse = { ok: false, status: 404, headers: {}, body: '' };

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function tools(fetcher: AppFetcher) {
  dir = await mkdtemp(join(tmpdir(), 'conch-video-'));
  const ctx = { conversationId: 'c1', signal: new AbortController().signal } as ToolContext;
  const store = new AttachmentStore(dir);
  const list = videoTools(ctx, { fetcher, store });
  const [search, details] = ['video_search', 'video_details'].map((name) => {
    const tool = list.find((t) => t.name === name);
    if (!tool) throw new Error(`No ${name}`);
    return tool;
  }) as [HostTool, HostTool];
  return {
    search,
    details,
    store,
  };
}

describe('reading what the sites say', () => {
  it('reads the videos on a YouTube results page, and only well-formed ones', () => {
    const found = youtubeResults(
      results([
        renderer('4gEoh3sk2AE', 'Bake the Perfect Sourdough'),
        renderer('bad"id', 'Not a video'),
        renderer('4gEoh3sk2AE', 'A duplicate'),
        { channelRenderer: { channelId: 'UC1' } },
        renderer('CTuGXdyrWUo', 'Premiere', { upcomingEventData: { startTime: '1' } }),
        renderer('rP3-auQLHcc', '<b>Live</b> bakery', {
          lengthText: undefined,
          badges: [
            { metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } },
          ],
        }),
      ]),
    );
    expect(found).toEqual([
      {
        provider: 'youtube',
        id: '4gEoh3sk2AE',
        title: 'Bake the Perfect Sourdough',
        channel: 'Natasha’s Kitchen',
        duration: 713,
        published: '2 years ago',
        views: 3344279,
      },
      expect.objectContaining({ id: 'rP3-auQLHcc', title: 'Live bakery', live: true }),
    ]);
    expect(youtubeResults('<html>consent</html>')).toEqual([]);
    expect(youtubeResults('var ytInitialData = {"broken": ;</script>')).toEqual([]);
  });

  it('matches braces inside strings when it reads embedded JSON', () => {
    expect(jsonAt('x = {"a":"}{\\"","b":{"c":1}};', 4)).toEqual({ a: '}{"', b: { c: 1 } });
    expect(jsonAt('x = nothing', 4)).toBeUndefined();
  });

  it('reads lengths and ages', () => {
    expect(clockSeconds('1:02:03')).toBe(3723);
    expect(clockSeconds('LIVE')).toBeUndefined();
    expect(agoWords('1y ago')).toBe('1 year ago');
    expect(agoWords('Streamed 3 weeks ago')).toBe('Streamed 3 weeks ago');
    expect(agoWords('5 mo ago')).toBe('5 months ago');
  });

  it('reads oEmbed, and nothing that isn’t oEmbed', () => {
    expect(
      oembedOf(
        JSON.stringify({
          title: 'The <i>Mountain</i>',
          author_name: 'TSO Photography',
          thumbnail_url: 'https://i.vimeocdn.com/video/1-d_1280',
          duration: 185,
          upload_date: '2011-04-15 08:35:35',
        }),
      ),
    ).toEqual({
      title: 'The Mountain',
      channel: 'TSO Photography',
      picture: 'https://i.vimeocdn.com/video/1-d_1280',
      duration: 185,
      published: '2011-04-15T08:35:35',
    });
    expect(oembedOf('<html>Not Found</html>')).toBeUndefined();
    expect(oembedOf(JSON.stringify({ title: 5 }))).toBeUndefined();
    expect(oembedOf(JSON.stringify({ thumbnail_url: 'http://plain/' }))).toEqual({});
  });

  it('reads a watch page: length, date, views and chapters', () => {
    expect(watchDetails(watch)).toEqual({
      duration: 713,
      published: '2024-03-08T08:30:07-08:00',
      views: 3344279,
      chapters: [
        { title: 'Intro & starter', start: 0 },
        { title: 'Shaping', start: 206 },
      ],
    });
    // A Vimeo page says it in JSON-LD.
    expect(
      watchDetails(
        `<script type="application/ld+json">${JSON.stringify([
          {
            '@type': 'VideoObject',
            duration: 'PT3M5S',
            uploadDate: '2011-04-15T08:35:35-04:00',
            interactionStatistic: [
              { interactionType: 'http://schema.org/WatchAction', userInteractionCount: 1200 },
            ],
          },
        ])}</script>`,
      ),
    ).toEqual({ duration: 185, published: '2011-04-15T08:35:35-04:00', views: 1200 });
    expect(watchDetails('<html></html>')).toEqual({});
  });
});

describe('video_search', () => {
  it('finds videos on YouTube, keeps their pictures as the chat’s own, and makes a card', async () => {
    const fetcher = vi.fn<AppFetcher>(async (_app, request) => {
      if (request.url.startsWith('https://www.youtube.com/results'))
        return ok(results([renderer('4gEoh3sk2AE', 'Bake'), renderer('CTuGXdyrWUo', 'Shape')]));
      if (request.url.includes('/4gEoh3sk2AE/maxresdefault.jpg'))
        return ok(PNG, { bodyBase64: true, headers: { 'content-type': 'image/png' } });
      if (request.url.includes('/CTuGXdyrWUo/hqdefault.jpg'))
        return ok(PNG, { bodyBase64: true, headers: { 'content-type': 'image/png' } });
      return missing;
    });
    const { search, store } = await tools(fetcher);
    const result = await search.run({ query: 'sourdough', count: 6 });
    if (typeof result === 'string') throw new Error('expected a view');
    const view = result.view;
    expect(view?.kind).toBe('videos');
    if (view?.kind !== 'videos') return;
    expect(view.items.map((v) => [v.id, v.url, Boolean(v.thumbnail)])).toEqual([
      ['4gEoh3sk2AE', 'https://www.youtube.com/watch?v=4gEoh3sk2AE', true],
      ['CTuGXdyrWUo', 'https://www.youtube.com/watch?v=CTuGXdyrWUo', true],
    ]);
    expect(await store.inConversation(view.items[0]?.thumbnail?.id ?? '', 'c1')).toBeDefined();
    // The query and the pictures went only to YouTube's own hosts.
    expect(new Set(fetcher.mock.calls.map((c) => c[0].reaches[0]))).toEqual(
      new Set(['www.youtube.com', 'i.ytimg.com']),
    );
    // What's logged is what was made.
    expect(cleanView(view)).toEqual(view);
    const text = JSON.parse(result.text) as { videos: { length: string }[]; shown: string };
    expect(text.videos[0]?.length).toBe('11:53');
    expect(text.shown).toMatch(/Don’t list them again/);
  });

  it('falls back to Bing when YouTube doesn’t answer, keeping only video links', async () => {
    const rss = `<rss><channel>
      <item><title>Shaping - YouTube</title><link>https://www.youtube.com/watch?v=CTuGXdyrWUo</link></item>
      <item><title>A blog</title><link>https://example.org/bread</link></item>
      <item><title>Loaf | Vimeo</title><link>https://vimeo.com/22439234</link></item>
    </channel></rss>`;
    const fetcher: AppFetcher = async (_app, request) => {
      if (request.url.startsWith('https://www.youtube.com/results'))
        return { ok: false, status: 0, headers: {}, body: '', refused: 'took too long' };
      if (request.url.startsWith('https://www.bing.com/')) return ok(rss);
      if (request.url.startsWith('https://vimeo.com/api/oembed.json'))
        return ok(JSON.stringify({ title: 'The Loaf', author_name: 'Baker', duration: 185 }));
      return missing;
    };
    const { search } = await tools(fetcher);
    const result = await search.run({ query: 'bread', count: 6 });
    if (typeof result === 'string' || result.view?.kind !== 'videos') throw new Error('no view');
    expect(result.view.items.map((v) => [v.provider, v.title, v.duration])).toEqual([
      ['youtube', 'Shaping', undefined],
      ['vimeo', 'The Loaf', 185],
    ]);
    expect(JSON.parse(result.text)).toMatchObject({ provider: 'Bing' });
  });

  it('says what to try when nothing comes back', async () => {
    const { search } = await tools(async () => missing);
    await expect(search.run({ query: 'zzzz', count: 6 })).rejects.toThrow(
      /Try fewer or other words/,
    );
  });
});

describe('video_details', () => {
  it('reads each video’s page and oEmbed, and keeps where it should start', async () => {
    const fetcher: AppFetcher = async (_app, request) => {
      if (request.url.startsWith('https://www.youtube.com/oembed'))
        return ok(JSON.stringify({ title: 'Bake it', author_name: 'Natasha’s Kitchen' }));
      if (request.url.startsWith('https://www.youtube.com/watch')) return ok(watch);
      return missing;
    };
    const { details } = await tools(fetcher);
    const result = await details.run({
      urls: ['https://youtu.be/4gEoh3sk2AE?t=206', 'https://example.org/not-a-video'],
    });
    if (typeof result === 'string' || result.view?.kind !== 'videos') throw new Error('no view');
    expect(result.view.items[0]).toMatchObject({
      id: '4gEoh3sk2AE',
      title: 'Bake it',
      channel: 'Natasha’s Kitchen',
      duration: 713,
      start: 206,
      chapters: [{ start: 0 }, { start: 206 }],
    });
    expect(JSON.parse(result.text)).toMatchObject({
      notVideoLinks: ['https://example.org/not-a-video'],
      videos: [{ startsAt: '3:26', url: 'https://www.youtube.com/watch?v=4gEoh3sk2AE&t=206s' }],
    });
  });

  it('takes one link as a list, and refuses what isn’t a video without fetching anything', async () => {
    const fetcher = vi.fn<AppFetcher>(async () => missing);
    const { details } = await tools(fetcher);
    expect(details.mend?.({ url: 'https://youtu.be/4gEoh3sk2AE' })).toMatchObject({
      urls: ['https://youtu.be/4gEoh3sk2AE'],
    });
    await expect(
      details.run({ urls: ['https://evil.example/watch?v=4gEoh3sk2AE', 'javascript:alert(1)'] }),
    ).rejects.toThrow(/None of these is a YouTube or Vimeo video link/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says so when a video can’t be read (private, removed)', async () => {
    const { details } = await tools(async () => missing);
    await expect(details.run({ urls: ['https://vimeo.com/22439234'] })).rejects.toThrow(
      /private, removed/,
    );
  });
});
