/**
 * Music and podcasts a tool found (`music_search`), drawn as a card that plays
 * them in the chat (ADR 0060 §7). Everything here came from outside (Apple's
 * catalogue, a podcast's own feed): plain text only, links only to the web.
 *
 * Nothing in it is ever loaded from another site by the page. The artwork is
 * the chat's own picture (an `Attachment` the gateway fetched once), and what
 * plays is streamed through the gateway (`GET /api/listen`), which plays only
 * a `preview` an `audio` card in that same chat carries.
 */
import { z } from 'zod';

import { Attachment } from '../attachments';
import { Id } from '../common';

/** Only web links; anything else is dropped before it's drawn. */
const WebUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//i, 'Only web links.');
/** Only secure links: what the gateway streams. */
const SecureUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Only secure web links.');

/** A song, an album, an artist, a podcast (a show), or one episode of one. */
export const AudioItemKind = z.enum(['song', 'album', 'artist', 'podcast', 'episode']);
export type AudioItemKind = z.infer<typeof AudioItemKind>;

/** Where else to listen: the item's own page, or a search for it. */
export const AudioLinks = z.object({
  apple: WebUrl.optional(),
  spotify: WebUrl.optional(),
  youtube: WebUrl.optional(),
});
export type AudioLinks = z.infer<typeof AudioLinks>;

export const AudioItem = z.object({
  kind: AudioItemKind,
  title: z.string().min(1).max(300),
  /** The artist, or the show an episode is from. */
  by: z.string().max(200).optional(),
  album: z.string().max(300).optional(),
  /** The cover, kept as the chat's own picture. */
  artwork: Attachment.optional(),
  /** Seconds: the whole song or episode, not the preview. */
  duration: z.number().nonnegative().max(172_800).optional(),
  /** When it came out (ISO 8601). */
  released: z.string().min(4).max(40).optional(),
  genre: z.string().max(80).optional(),
  explicit: z.boolean().optional(),
  /** An episode's few words about itself; a show's or an album's count of tracks. */
  description: z.string().max(400).optional(),
  tracks: z.number().int().positive().max(100_000).optional(),
  /**
   * What the card can play, streamed through Conch: a song's 30-second
   * preview, or a whole episode (`whole`).
   */
  preview: z.object({ url: SecureUrl, whole: z.boolean().default(false) }).optional(),
  links: AudioLinks.optional(),
});
export type AudioItem = z.infer<typeof AudioItem>;

/** The most items one card carries. */
export const AUDIO_MAX_ITEMS = 12;

export const AudioView = z.object({
  kind: z.literal('audio'),
  /** The chat the card is in: what it plays is checked against this chat's own cards. */
  chat: Id,
  /** What was looked for, as the person would say it. */
  query: z.string().max(200).optional(),
  items: z.array(AudioItem).max(AUDIO_MAX_ITEMS),
});
export type AudioView = z.infer<typeof AudioView>;

/** Where the page plays an item's preview from: always Conch itself. */
export function listenPath(chat: string, url: string): string {
  return `/api/listen?chat=${encodeURIComponent(chat)}&src=${encodeURIComponent(url)}`;
}
