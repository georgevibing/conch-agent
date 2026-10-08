import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AudioView, type TaintSource } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { AppFetcher, AppFetchResponse } from '../conchapps/types';
import { cleanView } from '../conversations/views';
import { hostToolText, type HostTool, type HostToolResult } from '../engines/types';
import { artworkUrl, countryFor, isPreviewHost, musicResults, musicTools } from './music';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/itunes-${name}.json`, import.meta.url), 'utf8');
// The smallest real PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function tool(answer: (url: URL) => AppFetchResponse) {
  dir = await mkdtemp(join(tmpdir(), 'conch-music-'));
  const fetcher = vi.fn<AppFetcher>(async (_app, request) => answer(new URL(request.url)));
  const taint = vi.fn<(source: TaintSource) => void>();
  const [music] = musicTools(
    { conversationId: 'c1', signal: new AbortController().signal, taint },
    { fetcher, store: new AttachmentStore(dir) },
  );
  return { music: music as HostTool, fetcher, taint };
}

const json = (body: string): AppFetchResponse => ({
  ok: true,
  status: 200,
  headers: { 'content-type': 'text/javascript; charset=utf-8' },
  body,
});
const png: AppFetchResponse = {
  ok: true,
  status: 200,
  headers: { 'content-type': 'image/png' },
  body: PNG.toString('base64'),
  bodyBase64: true,
};

describe('music_search', () => {
  it('asks Apple for songs, keeps the covers as the chat’s pictures, and draws a card', async () => {
    const { music, fetcher, taint } = await tool((url) =>
      url.hostname === 'itunes.apple.com' ? json(fixture('song')) : png,
    );
    const result = (await music.run({
      query: 'bohemian rhapsody',
      kind: 'song',
      limit: 6,
      country: 'gb',
    })) as HostToolResult;
    const asked = new URL(fetcher.mock.calls[0]?.[1].url ?? '');
    expect(asked.origin + asked.pathname).toBe('https://itunes.apple.com/search');
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      term: 'bohemian rhapsody',
      media: 'music',
      entity: 'song',
      country: 'GB',
    });
    // Covers at 600 × 600, from Apple's image servers only.
    const cover = new URL(fetcher.mock.calls[1]?.[1].url ?? '');
    expect(cover.hostname).toMatch(/mzstatic\.com$/);
    expect(cover.pathname).toMatch(/\/600x600bb\.jpg$/);

    const view = AudioView.parse(result.view);
    expect(view.chat).toBe('c1');
    const [first] = view.items;
    expect(first).toMatchObject({
      kind: 'song',
      title: 'Bohemian Rhapsody',
      by: 'Queen',
      duration: 355,
      preview: { whole: false },
      artwork: { kind: 'image', mimeType: 'image/png' },
    });
    expect(first?.preview?.url).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
    expect(first?.links).toMatchObject({
      apple: expect.stringMatching(/^https:\/\/music\.apple\.com\//),
      spotify: 'https://open.spotify.com/search/Bohemian%20Rhapsody%20Queen',
      youtube: 'https://music.youtube.com/search?q=Bohemian%20Rhapsody%20Queen',
    });
    // The view survives the gateway's own check before it's logged.
    expect(cleanView(result.view)).toEqual(view);
    // The model reads facts, and is told not to list them again.
    const text = JSON.parse(hostToolText(result)) as { results: unknown[]; note: string };
    expect(text.results[0]).toMatchObject({
      title: 'Bohemian Rhapsody',
      playable: '30-second preview',
    });
    expect(text.note).toMatch(/Don’t list them again/);
    // Other people's words came in: the chat has read the web.
    expect(taint).toHaveBeenCalledWith({ kind: 'web', label: 'Apple Music search results' });
  });

  it('plays whole podcast episodes, with the show, the date and a few words', async () => {
    const { music } = await tool((url) =>
      url.hostname === 'itunes.apple.com' ? json(fixture('podcastEpisode')) : png,
    );
    const result = (await music.run({
      query: 'hardcore history',
      kind: 'episode',
      limit: 3,
    })) as HostToolResult;
    const view = AudioView.parse(result.view);
    const [episode] = view.items;
    expect(episode).toMatchObject({ kind: 'episode', preview: { whole: true } });
    expect(episode?.by).toBeTruthy();
    expect(episode?.released).toMatch(/^\d{4}-/);
    expect(episode?.description?.length ?? 0).toBeLessThanOrEqual(400);
    expect(episode?.links?.youtube).toBeUndefined();
  });

  it('reads albums, artists and shows, which link out but don’t play', () => {
    const [album] = musicResults(fixture('album'), 'album');
    expect(album?.item).toMatchObject({
      kind: 'album',
      by: expect.any(String),
      tracks: expect.any(Number),
    });
    expect(album?.item.preview).toBeUndefined();
    const [artist] = musicResults(fixture('musicArtist'), 'artist');
    expect(artist?.item).toMatchObject({ kind: 'artist', title: expect.any(String) });
    expect(artist?.artwork).toBeUndefined();
    const [show] = musicResults(fixture('podcast'), 'podcast');
    expect(show?.item).toMatchObject({ kind: 'podcast' });
    expect(show?.artwork).toMatch(/600x600bb/);
  });

  it('leaves out a preview that isn’t on Apple’s servers, and words that are markup', () => {
    const body = JSON.stringify({
      results: [
        {
          wrapperType: 'track',
          kind: 'song',
          trackName: '<b>Loud</b> &amp; clear',
          artistName: 'Someone',
          previewUrl: 'https://evil.example/leak?data=secret',
          artworkUrl100: 'https://evil.example/100x100bb.jpg',
          trackViewUrl: 'javascript:alert(1)',
        },
      ],
    });
    const [song] = musicResults(body, 'song');
    expect(song?.item.title).toBe('Loud & clear');
    expect(song?.item.preview).toBeUndefined();
    expect(song?.artwork).toBeUndefined();
    expect(song?.item.links?.apple).toBeUndefined();
  });

  it('says what went wrong, in a sentence, when Apple can’t be asked', async () => {
    const refused = await tool(() => ({
      ok: false,
      status: 0,
      headers: {},
      body: '',
      refused: 'Couldn’t reach itunes.apple.com.',
    }));
    await expect(refused.music.run({ query: 'x', kind: 'song', limit: 6 })).rejects.toThrow(
      'Couldn’t reach itunes.apple.com.',
    );
    const down = await tool(() => ({ ok: false, status: 503, headers: {}, body: 'busy' }));
    await expect(down.music.run({ query: 'x', kind: 'song', limit: 6 })).rejects.toThrow(/503/);
    const garbled = await tool(() => json('<html>'));
    await expect(garbled.music.run({ query: 'x', kind: 'song', limit: 6 })).rejects.toThrow(
      /couldn’t read/,
    );
    expect(garbled.taint).not.toHaveBeenCalled();
  });

  it('draws nothing when nothing was found, and tells the model to try again', async () => {
    const { music } = await tool(() => json('{"resultCount":0,"results":[]}'));
    const result = (await music.run({ query: 'zzzz', kind: 'song', limit: 6 })) as HostToolResult;
    expect(result.view).toBeUndefined();
    expect(JSON.parse(result.text)).toMatchObject({
      results: [],
      note: expect.stringMatching(/Nothing found/),
    });
  });

  it('picks a store country from the locale, and the US when it can’t tell', () => {
    expect(countryFor('de')).toBe('DE');
    expect(countryFor(undefined, 'en-GB')).toBe('GB');
    expect(countryFor(undefined, 'fr')).toBe('FR');
    expect(countryFor(undefined, 'not a locale!')).toBe('US');
  });

  it('knows Apple’s servers and asks for big covers', () => {
    expect(isPreviewHost('audio-ssl.itunes.apple.com')).toBe(true);
    expect(isPreviewHost('is1-ssl.mzstatic.com')).toBe(true);
    expect(isPreviewHost('itunes.apple.com.evil.example')).toBe(false);
    expect(isPreviewHost('evilmzstatic.com')).toBe(false);
    expect(artworkUrl('https://is1-ssl.mzstatic.com/image/thumb/a.jpg/100x100bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/a.jpg/600x600bb.jpg',
    );
    expect(artworkUrl('http://is1-ssl.mzstatic.com/a/100x100bb.jpg')).toBeUndefined();
  });
});
