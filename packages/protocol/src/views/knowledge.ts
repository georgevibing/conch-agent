/**
 * What the chat draws for knowledge and links (ADR 0060 §7): a card about a
 * person, place, thing or event (Wikipedia), previews of the pages being
 * shared, books (Open Library) and shows (TVmaze).
 *
 * Everything here came from outside. Words are plain text the chat draws as
 * text, never markup; links are `https:` only; pictures are the chat's own
 * attachments, fetched by the gateway, so the page never loads a remote image.
 */
import { z } from 'zod';

import { Attachment } from '../attachments';

/** Only secure web links leave the chat. */
const SecureUrl = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Only secure web links.');
/** An ISO 8601 date or date-time, as a service gave it. */
const When = z.string().min(4).max(40);
const Line = (max: number) => z.string().min(1).max(max);

// ── Knowledge ───────────────────────────────────────────────────────────────

/** One fact beside a knowledge card: "Born" · "15 April 1452, Anchiano". */
export const KnowledgeFact = z.object({
  label: Line(40),
  value: Line(200),
});
export type KnowledgeFact = z.infer<typeof KnowledgeFact>;

/** A page to read next, from the same encyclopedia. */
export const KnowledgeLink = z.object({ title: Line(200), url: SecureUrl });
export type KnowledgeLink = z.infer<typeof KnowledgeLink>;

/** The most of an article's opening a card carries. */
export const KNOWLEDGE_EXTRACT_MAX = 1200;

export const KnowledgeView = z.object({
  kind: z.literal('knowledge'),
  title: Line(200),
  /** A few words of what it is: "Italian polymath (1452–1519)". */
  description: z.string().max(200).optional(),
  /** The article's opening, as plain text. */
  extract: z.string().max(KNOWLEDGE_EXTRACT_MAX),
  picture: Attachment.optional(),
  facts: z.array(KnowledgeFact).max(8).optional(),
  /** The article itself. */
  url: SecureUrl,
  /** The encyclopedia's language: `en`, `de`, `pt-br`. */
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/)
    .max(12),
  /** Where it's from, as the card names it (Wikipedia when absent). */
  source: z.string().max(40).optional(),
  related: z.array(KnowledgeLink).max(6).optional(),
});
export type KnowledgeView = z.infer<typeof KnowledgeView>;

// ── Links ───────────────────────────────────────────────────────────────────

export const LinkPreviewKind = z.enum(['article', 'video', 'product', 'repo', 'other']);
export type LinkPreviewKind = z.infer<typeof LinkPreviewKind>;

/** A page as it describes itself (its card tags, its JSON-LD). */
export const LinkPreview = z.object({
  url: SecureUrl,
  title: Line(300),
  /** The site's name, or its host: "The Guardian", "github.com". */
  site: Line(120),
  description: z.string().max(600).optional(),
  picture: Attachment.optional(),
  published: When.optional(),
  author: z.string().max(160).optional(),
  kind: LinkPreviewKind.optional(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const LinksView = z.object({
  kind: z.literal('links'),
  items: z.array(LinkPreview).max(8),
});
export type LinksView = z.infer<typeof LinksView>;

// ── Books ───────────────────────────────────────────────────────────────────

export const BookItem = z.object({
  title: Line(300),
  authors: z.array(Line(160)).max(6),
  /** The year it first came out. */
  year: z.number().int().min(-3000).max(3000).optional(),
  cover: Attachment.optional(),
  pages: z.number().int().positive().max(100_000).optional(),
  subjects: z.array(Line(80)).max(6).optional(),
  url: SecureUrl,
  /** Readers' average, out of 5. */
  rating: z.number().min(0).max(5).optional(),
  ratings: z.number().int().nonnegative().optional(),
});
export type BookItem = z.infer<typeof BookItem>;

export const BooksView = z.object({
  kind: z.literal('books'),
  items: z.array(BookItem).max(12),
});
export type BooksView = z.infer<typeof BooksView>;

// ── Shows ───────────────────────────────────────────────────────────────────

export const ShowKind = z.enum(['tv', 'movie']);
export type ShowKind = z.infer<typeof ShowKind>;

/** The next episode to air. */
export const ShowEpisode = z.object({
  at: When,
  season: z.number().int().nonnegative().optional(),
  number: z.number().int().nonnegative().optional(),
  name: z.string().max(200).optional(),
});
export type ShowEpisode = z.infer<typeof ShowEpisode>;

export const ShowItem = z.object({
  title: Line(300),
  kind: ShowKind,
  /** The year it first aired or came out. */
  year: z.number().int().min(1800).max(3000).optional(),
  poster: Attachment.optional(),
  genres: z.array(Line(60)).max(6).optional(),
  /** Viewers' average, out of 10. */
  rating: z.number().min(0).max(10).optional(),
  /** Plain text, never the service's markup. */
  summary: z.string().max(600).optional(),
  /** Where it's on: "HBO", "Netflix". */
  network: z.string().max(120).optional(),
  /** "Running", "Ended", "To Be Determined". */
  status: z.string().max(40).optional(),
  next: ShowEpisode.optional(),
  url: SecureUrl,
});
export type ShowItem = z.infer<typeof ShowItem>;

export const ShowsView = z.object({
  kind: z.literal('shows'),
  items: z.array(ShowItem).max(10),
});
export type ShowsView = z.infer<typeof ShowsView>;
