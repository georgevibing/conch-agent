/**
 * Videos found for the chat (ADR 0060 §7): a card that plays the video in
 * place. Only YouTube and Vimeo, and only by an id Conch checked, so the
 * player's address is always one Conch built from that id, never a link a
 * model or a page supplied (security.ts allows exactly these two players as
 * frames, and only after the person presses play).
 */
import { z } from 'zod';

import { Attachment } from '../attachments';

/** WHATWG URL exists in browsers and Node; the protocol has neither's typings. */
interface ParsedUrl {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  pathname: string;
  hash: string;
  searchParams: { get(name: string): string | null };
}
const URLParser = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

export const VideoProvider = z.enum(['youtube', 'vimeo']);
export type VideoProvider = z.infer<typeof VideoProvider>;

/** What an id looks like on each site: nothing else is ever put in a player's address. */
const IDS: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^[1-9]\d{0,11}$/,
};

/** The sites' own names, for "Open on YouTube". */
export const VIDEO_SITE: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo' };

/** The only origins a player frame may come from (security.ts `frame-src`). */
export const VIDEO_PLAYER_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
] as const;

/** Twelve hours: longer than any video a person asks to watch in a chat. */
const MOST_SECONDS = 12 * 3600;

export function isVideoId(provider: VideoProvider, id: string): boolean {
  return IDS[provider].test(id);
}

const seconds = (start: number | undefined) =>
  start !== undefined && Number.isInteger(start) && start > 0 && start <= MOST_SECONDS
    ? start
    : undefined;

/** The video's own page, built from its id. */
export function videoPage(provider: VideoProvider, id: string, start?: number): string {
  const at = seconds(start);
  return provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${id}${at ? `&t=${at}s` : ''}`
    : `https://vimeo.com/${id}${at ? `#t=${at}s` : ''}`;
}

/**
 * The player's address, built from a checked id, or nothing for anything
 * else. YouTube's no-cookie player; Vimeo's with Do Not Track. It starts
 * playing at once, since it's only made when the person pressed play.
 */
export function videoPlayer(
  provider: VideoProvider,
  id: string,
  start?: number,
): string | undefined {
  if (!VideoProvider.safeParse(provider).success || !isVideoId(provider, id)) return undefined;
  const at = seconds(start);
  if (provider === 'youtube')
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1${at ? `&start=${at}` : ''}`;
  return `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${at ? `#t=${at}s` : ''}`;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/** `t=90`, `t=1m30s`, `t=1h2m3s` or `#t=90s`, in seconds. */
function startOf(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = raw.trim().replace(/^t=/, '');
  if (/^\d+s?$/.test(value)) return seconds(parseInt(value, 10));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || !m.slice(1).some(Boolean)) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  return seconds(n(1) * 3600 + n(2) * 60 + n(3));
}

/**
 * Which video a link is, or nothing: YouTube's watch, short, live, embed and
 * youtu.be links, and Vimeo's pages and player. The id is checked, and a time
 * in the link (`t=`) is kept.
 */
export function videoFromUrl(
  raw: string,
): { provider: VideoProvider; id: string; start?: number } | undefined {
  let url: ParsedUrl;
  try {
    url = new URLParser(raw.trim());
  } catch {
    return undefined;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
    return undefined;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const start = startOf(
    url.searchParams.get('t') ?? url.searchParams.get('start') ?? url.hash.slice(1),
  );
  const found = (provider: VideoProvider, id: string | undefined) =>
    id && isVideoId(provider, id) ? { provider, id, ...(start && { start }) } : undefined;
  if (host === 'youtu.be') return found('youtube', parts[0]);
  if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === 'watch') return found('youtube', url.searchParams.get('v') ?? undefined);
    if (parts[0] && ['shorts', 'live', 'embed', 'v'].includes(parts[0]))
      return found('youtube', parts[1]);
    return undefined;
  }
  if (VIMEO_HOSTS.has(host)) {
    // vimeo.com/123, vimeo.com/channels/staffpicks/123, player.vimeo.com/video/123
    if (host === 'player.vimeo.com')
      return parts[0] === 'video' ? found('vimeo', parts[1]) : undefined;
    return found(
      'vimeo',
      [...parts].reverse().find((p) => /^\d+$/.test(p)),
    );
  }
  return undefined;
}

export const VideoChapter = z.object({
  title: z.string().min(1).max(200),
  /** Where it starts, in seconds. */
  start: z.number().int().min(0).max(MOST_SECONDS),
});
export type VideoChapter = z.infer<typeof VideoChapter>;

/** One video, as the card draws it. Everything but the id came from outside: plain text. */
export const VideoItem = z
  .object({
    provider: VideoProvider,
    /** Checked against the site's own shape (11 letters for YouTube, digits for Vimeo). */
    id: z.string().min(1).max(12),
    title: z.string().min(1).max(300),
    channel: z.string().max(200).optional(),
    /** Its length in seconds; absent for a live stream or when the site didn't say. */
    duration: z.number().int().positive().max(MOST_SECONDS).optional(),
    /** When it was published: an ISO date, or the site's own words ("2 years ago"). */
    published: z.string().min(1).max(40).optional(),
    views: z.number().int().nonnegative().optional(),
    live: z.boolean().optional(),
    /** Its picture, fetched by the gateway and kept as the chat's own (never a remote image). */
    thumbnail: Attachment.optional(),
    /** Its own page on the site, for "Open on YouTube". */
    url: z
      .string()
      .max(2000)
      .regex(/^https:\/\//, 'Only https links.'),
    /** Play from here, in seconds. */
    start: z.number().int().min(0).max(MOST_SECONDS).optional(),
    chapters: z.array(VideoChapter).max(40).optional(),
  })
  .superRefine((video, ctx) => {
    if (!isVideoId(video.provider, video.id))
      ctx.addIssue({ code: 'custom', path: ['id'], message: `Not a ${video.provider} video id.` });
    const page = videoFromUrl(video.url);
    if (page?.provider !== video.provider || page.id !== video.id)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Not this video’s own page.' });
  });
export type VideoItem = z.infer<typeof VideoItem>;

/** The most videos one card carries: a lead and a shelf. */
export const MAX_VIDEOS = 8;

export const VideosView = z.object({
  kind: z.literal('videos'),
  /** What was searched for, when it was a search. */
  query: z.string().max(300).optional(),
  items: z.array(VideoItem).max(MAX_VIDEOS),
});
export type VideosView = z.infer<typeof VideosView>;
