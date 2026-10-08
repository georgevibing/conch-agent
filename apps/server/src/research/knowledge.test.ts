import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ToolView } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import type { ToolContext } from '../conversations/manager';
import { cleanView } from '../conversations/views';
import { knowledgeTools } from './knowledge';
import { linkKind, previewOf } from './links';
import { pageData } from './pageData';
import { cutExtract, pictureAddress, wikidataDate } from './wikipedia';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const json = (value: unknown): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
});
const html = (body: string, url?: string): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
  ...(url && { url }),
});
const png: AppFetchResponse = {
  ok: true,
  status: 200,
  headers: { 'content-type': 'image/png' },
  body: PNG.toString('base64'),
  bodyBase64: true,
};
const missing: AppFetchResponse = { ok: false, status: 404, headers: {}, body: '{}' };

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Tools over a canned web: each address answers as given, anything else is a 404. */
async function tools(web: Record<string, AppFetchResponse>) {
  dir = await mkdtemp(join(tmpdir(), 'conch-knowledge-'));
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: AppFetcher = async (_app, request) => {
    asked.push({ url: request.url, headers: request.headers });
    return web[request.url] ?? missing;
  };
  const ctx = { conversationId: 'c1', signal: new AbortController().signal } as ToolContext;
  const store = new AttachmentStore(dir);
  const list = knowledgeTools(ctx, { fetcher, store });
  const run = async (name: string, args: Record<string, unknown>) => {
    const tool = list.find((t) => t.name === name);
    if (!tool) throw new Error(`no ${name}`);
    const result = await tool.run(args as never);
    if (typeof result === 'string') throw new Error('expected a view');
    return result;
  };
  return { run, asked };
}

/** A view logs exactly as the tool made it. */
function logsAsIs(view: unknown) {
  expect(ToolView.safeParse(view).success).toBe(true);
  expect(cleanView(view)).toEqual(view);
}

const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const ada = {
  type: 'standard',
  title: 'Ada Lovelace',
  description: 'English mathematician (1815–1852)',
  extract:
    'Augusta Ada King, Countess of Lovelace, was an English mathematician. She wrote <b>notes</b>.',
  extract_html: '<p><script>bad()</script>Augusta Ada King</p>',
  wikibase_item: 'Q7259',
  thumbnail: {
    source:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Ada_Lovelace.jpg/320px-Ada_Lovelace.jpg',
    width: 320,
    height: 400,
  },
  originalimage: {
    source: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Ada_Lovelace.jpg',
    width: 2000,
    height: 2500,
  },
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } },
};
const time = (t: string, precision = 11) => ({
  rank: 'normal',
  mainsnak: { datavalue: { value: { time: t, precision } } },
});
const entity = (id: string, rank = 'normal') => ({
  rank,
  mainsnak: { datavalue: { value: { id } } },
});
const WIKIDATA = 'https://www.wikidata.org/w/api.php?action=wbgetentities';

describe('knowledge_card', () => {
  it('draws Wikipedia’s plain summary, a sharp picture and Wikidata’s facts', async () => {
    const { run, asked } = await tools({
      [`${SUMMARY}Ada_Lovelace?redirect=true`]: json(ada),
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Ada_Lovelace.jpg/960px-Ada_Lovelace.jpg':
        png,
      [`${WIKIDATA}&ids=Q7259&props=claims&format=json`]: json({
        entities: {
          Q7259: {
            claims: {
              P569: [time('+1815-12-10T00:00:00Z')],
              P570: [time('+1852-11-27T00:00:00Z')],
              P19: [entity('Q84')],
              P106: [entity('Q170790'), entity('Q1', 'deprecated'), entity('Q36180')],
            },
          },
        },
      }),
      [`${WIKIDATA}&ids=Q84|Q170790|Q36180&props=labels&languages=en&languagefallback=1&format=json`]:
        json({
          entities: {
            Q84: { labels: { en: { value: 'London' } } },
            Q170790: { labels: { en: { value: 'mathematician' } } },
            Q36180: { labels: { en: { value: 'writer' } } },
          },
        }),
    });
    const result = await run('knowledge_card', { query: 'Ada Lovelace', lang: 'en' });
    expect(result.view).toMatchObject({
      kind: 'knowledge',
      title: 'Ada Lovelace',
      description: 'English mathematician (1815–1852)',
      url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
      lang: 'en',
      picture: { kind: 'image', mimeType: 'image/png' },
      facts: [
        { label: 'Born', value: '10 December 1815, London' },
        { label: 'Died', value: '27 November 1852' },
        { label: 'Occupation', value: 'Mathematician, writer' },
      ],
    });
    const view = result.view as Extract<ToolView, { kind: 'knowledge' }>;
    expect(view.extract).toBe(
      'Augusta Ada King, Countess of Lovelace, was an English mathematician. She wrote notes .',
    );
    expect(JSON.stringify(view)).not.toContain('bad()');
    expect(result.text).toContain('don’t repeat');
    expect(asked[0]?.headers['user-agent']).toMatch(/^Conch/);
    logsAsIs(view);
  });

  it('searches when there’s no page by that name, skipping disambiguation pages', async () => {
    const { run } = await tools({
      [`${SUMMARY}Mercury?redirect=true`]: json({
        type: 'disambiguation',
        title: 'Mercury',
        extract: 'May refer to',
      }),
      'https://en.wikipedia.org/w/rest.php/v1/search/page?q=Mercury&limit=3': json({
        pages: [
          { key: 'Mercury', title: 'Mercury', description: 'Topics referred to by the same term' },
          { key: 'Mercury_(planet)', title: 'Mercury (planet)', description: 'Planet' },
        ],
      }),
      [`${SUMMARY}Mercury_(planet)?redirect=true`]: json({
        type: 'standard',
        title: 'Mercury (planet)',
        extract: 'Mercury is the first planet from the Sun.',
      }),
    });
    const result = await run('knowledge_card', { query: 'Mercury', lang: 'en' });
    expect(result.view).toMatchObject({
      kind: 'knowledge',
      title: 'Mercury (planet)',
      url: 'https://en.wikipedia.org/wiki/Mercury_(planet)',
    });
    expect(result.view).not.toHaveProperty('picture');
    expect(result.view).not.toHaveProperty('facts');
    logsAsIs(result.view);
  });

  it('says plainly when Wikipedia has nothing, or can’t be reached', async () => {
    const empty = await tools({});
    await expect(empty.run('knowledge_card', { query: 'Qwxz', lang: 'en' })).rejects.toThrow(
      /no article for “Qwxz”.*web_search/,
    );
    const refused = await tools({
      [`${SUMMARY}Lisbon?redirect=true`]: {
        ok: false,
        status: 0,
        headers: {},
        body: '',
        refused: 'no connection',
      },
    });
    await expect(refused.run('knowledge_card', { query: 'Lisbon', lang: 'en' })).rejects.toThrow(
      /Wikipedia couldn’t be reached/,
    );
  });

  it('keeps the language to a real Wikipedia code', async () => {
    const { run, asked } = await tools({});
    await expect(run('knowledge_card', { query: 'x', lang: 'evil.example/' })).rejects.toThrow();
    expect(asked.every((a) => a.url.startsWith('https://en.wikipedia.org/'))).toBe(true);
  });
});

describe('knowledge helpers', () => {
  it('writes Wikidata dates in words, at their precision, BC too', () => {
    expect(wikidataDate('+1452-04-15T00:00:00Z')).toBe('15 April 1452');
    expect(wikidataDate('+1452-00-00T00:00:00Z', 9)).toBe('1452');
    expect(wikidataDate('+1452-04-00T00:00:00Z', 10)).toBe('April 1452');
    expect(wikidataDate('-0044-03-15T00:00:00Z')).toBe('15 March 44 BC');
    expect(wikidataDate('+1950-00-00T00:00:00Z', 8)).toBe('1950s');
    expect(wikidataDate('+1201-00-00T00:00:00Z', 7)).toBe('13th century');
    expect(wikidataDate('+1101-00-00T00:00:00Z', 7)).toBe('12th century');
    expect(wikidataDate('soon')).toBeUndefined();
  });
  it('cuts a long opening at a sentence’s end', () => {
    const long = `${'A sentence here. '.repeat(100)}`;
    const cut = cutExtract(long, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith('.')).toBe(true);
    expect(cutExtract('word '.repeat(50), 40)).toMatch(/word…$/);
  });
  it('asks for a picture no wider than it needs', () => {
    expect(
      pictureAddress({ originalimage: { source: 'https://u.example/a.jpg', width: 800 } }),
    ).toBe('https://u.example/a.jpg');
    expect(
      pictureAddress({
        originalimage: { source: 'https://u.example/a.svg', width: 300 },
        thumbnail: { source: 'https://u.example/thumb/a.svg/320px-a.svg.png' },
      }),
    ).toBe('https://u.example/thumb/a.svg/960px-a.svg.png');
  });
});

describe('link_preview', () => {
  it('previews pages from their card tags and JSON-LD, with pictures', async () => {
    const { run } = await tools({
      'https://news.example/story': html(
        `<title>Fallback</title>
         <meta property="og:title" content="Whales sing &amp; dance">
         <meta property="og:description" content="&lt;b&gt;New&lt;/b&gt; research">
         <meta property="og:site_name" content="News Example">
         <meta property="og:image" content="/img/whale.png">
         <meta property="og:type" content="article">
         <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-01T08:00:00Z","author":[{"@type":"Person","name":"Mira Vale"}]}</script>`,
        'https://news.example/story#top',
      ),
      'https://news.example/img/whale.png': png,
      'https://github.com/conch/conch': html('<title>conch/conch: a shell</title>'),
      'https://down.example/': { ok: false, status: 503, headers: {}, body: '' },
    });
    const result = await run('link_preview', {
      urls: [
        'https://news.example/story',
        'https://github.com/conch/conch',
        'https://down.example/',
        'http://plain.example/',
      ],
    });
    expect(result.view).toMatchObject({
      kind: 'links',
      items: [
        {
          url: 'https://news.example/story',
          title: 'Whales sing & dance',
          site: 'News Example',
          description: 'New research',
          published: '2026-10-01T08:00:00Z',
          author: 'Mira Vale',
          kind: 'article',
          picture: { kind: 'image' },
        },
        {
          url: 'https://github.com/conch/conch',
          title: 'conch/conch: a shell',
          site: 'github.com',
          kind: 'repo',
        },
      ],
    });
    const text = JSON.parse(result.text) as { failed: { url: string }[] };
    expect(text.failed.map((f) => f.url)).toEqual([
      'https://down.example/',
      'http://plain.example/',
    ]);
    logsAsIs(result.view);
  });
  it('fails plainly when no page could be read', async () => {
    const { run } = await tools({});
    await expect(run('link_preview', { urls: ['https://gone.example/'] })).rejects.toThrow(
      /None of those pages could be previewed/,
    );
  });
  it('tells videos, products and other pages apart', () => {
    const kind = (url: string, body: string) => linkKind(url, pageData(body));
    expect(kind('https://v.example/1', '<meta property="og:type" content="video.other">')).toBe(
      'video',
    );
    expect(
      kind(
        'https://s.example/p',
        '<script type="application/ld+json">{"@type":"Product"}</script>',
      ),
    ).toBe('product');
    expect(kind('https://gitlab.com/a/b/', '')).toBe('repo');
    expect(kind('https://github.com/a/b/issues', '')).toBe('other');
    expect(previewOf('https://x.example/', '').preview).toMatchObject({
      title: 'x.example',
      kind: 'other',
    });
  });
});

describe('book_search', () => {
  it('shelves Open Library’s books with covers and short subjects', async () => {
    const { run } = await tools({
      'https://openlibrary.org/search.json?q=le+guin&limit=6&fields=key%2Ctitle%2Cauthor_name%2Cfirst_publish_year%2Ccover_i%2Cnumber_of_pages_median%2Csubject%2Cratings_average%2Cratings_count':
        json({
          docs: [
            {
              key: '/works/OL59863W',
              title: 'A Wizard of Earthsea',
              author_name: ['Ursula K. Le Guin'],
              first_publish_year: 1968,
              cover_i: 12345,
              number_of_pages_median: 183,
              subject: ['Fantasy', 'nyt:paperback=2012', 'Wizards', 'Fiction, general'],
              ratings_average: 4.1234,
              ratings_count: 300,
            },
            { key: '/authors/OL1A', title: 'Not a work' },
          ],
        }),
      'https://covers.openlibrary.org/b/id/12345-L.jpg': png,
    });
    const result = await run('book_search', { query: 'le guin', limit: 6 });
    expect(result.view).toEqual({
      kind: 'books',
      items: [
        expect.objectContaining({
          title: 'A Wizard of Earthsea',
          authors: ['Ursula K. Le Guin'],
          year: 1968,
          pages: 183,
          subjects: ['Fantasy', 'Wizards'],
          url: 'https://openlibrary.org/works/OL59863W',
          rating: 4.12,
          ratings: 300,
          cover: expect.objectContaining({ kind: 'image' }),
        }),
      ],
    });
    logsAsIs(result.view);
  });
  it('says so when nothing is found', async () => {
    const { run } = await tools({});
    await expect(run('book_search', { query: 'zzzz', limit: 6 })).rejects.toThrow(
      /no books for “zzzz”/,
    );
  });
});

describe('show_search', () => {
  it('draws TVmaze’s shows as plain text, with the next episode', async () => {
    const { run, asked } = await tools({
      'https://api.tvmaze.com/search/shows?q=severance': json([
        {
          show: {
            name: 'Severance',
            url: 'https://www.tvmaze.com/shows/44933/severance',
            genres: ['Drama', 'Mystery'],
            status: 'Running',
            premiered: '2022-02-18',
            rating: { average: 8.4 },
            webChannel: { name: 'Apple TV+' },
            image: { original: 'https://static.tvmaze.com/p/1.jpg' },
            summary:
              '<p><b>Severance</b> is a workplace thriller &amp; more.</p><script>x()</script>',
            _links: { nextepisode: { href: 'https://api.tvmaze.com/episodes/9' } },
          },
        },
        {
          show: {
            name: 'Elsewhere',
            url: 'https://www.tvmaze.com/shows/2',
            status: 'Running',
            _links: { nextepisode: { href: 'https://evil.example/episodes/1' } },
          },
        },
      ]),
      'https://static.tvmaze.com/p/1.jpg': png,
      'https://api.tvmaze.com/episodes/9': json({
        name: 'Hello, Ms. Cobel',
        season: 3,
        number: 1,
        airstamp: '2026-10-11T01:00:00+00:00',
      }),
    });
    const result = await run('show_search', { query: 'severance', kind: 'tv' });
    expect(result.view).toMatchObject({
      kind: 'shows',
      items: [
        {
          title: 'Severance',
          kind: 'tv',
          year: 2022,
          genres: ['Drama', 'Mystery'],
          rating: 8.4,
          network: 'Apple TV+',
          status: 'Running',
          summary: 'Severance is a workplace thriller & more. x()',
          next: { at: '2026-10-11T01:00:00+00:00', season: 3, number: 1, name: 'Hello, Ms. Cobel' },
          poster: { kind: 'image' },
        },
        { title: 'Elsewhere' },
      ],
    });
    expect(JSON.stringify(result.view)).not.toMatch(/<p>|<b>|<script/);
    expect(asked.some((a) => a.url.includes('evil.example'))).toBe(false);
    logsAsIs(result.view);
  });
  it('is honest that TVmaze has no films, and shows Wikipedia’s instead', async () => {
    const { run } = await tools({
      [`${SUMMARY}Dune_Part_Two_(film)?redirect=true`]: missing,
      [`${SUMMARY}Dune_Part_Two?redirect=true`]: json({
        type: 'standard',
        title: 'Dune: Part Two',
        description: '2024 film by Denis Villeneuve',
        extract: 'Dune: Part Two is a 2024 American epic science fiction film.',
      }),
    });
    const result = await run('show_search', { query: 'Dune Part Two', kind: 'movie' });
    expect(result.view).toMatchObject({ kind: 'knowledge', title: 'Dune: Part Two' });
    expect(result.text).toContain('TVmaze lists TV shows only');
    logsAsIs(result.view);
  });
  it('says so when nothing is found', async () => {
    const { run } = await tools({ 'https://api.tvmaze.com/search/shows?q=zz': json([]) });
    await expect(run('show_search', { query: 'zz', kind: 'tv' })).rejects.toThrow(
      /TVmaze has no show called “zz”/,
    );
  });
});
