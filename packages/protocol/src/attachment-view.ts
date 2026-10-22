/**
 * What a person sees when they look closer at an attachment the browser can't
 * show by itself (ADR 0017 § "Previews for every kind"): a document's words, a
 * workbook's sheets, an archive's folders, an email's headers, a recording's
 * words, a database's tables, or what an unknown file is.
 *
 * The gateway builds it from the same readers that give models the file
 * (`GET /api/attachments/:id/view`). It is plain data, never HTML: the
 * browser draws every part itself, so nothing in a file can run as Conch.
 */
import { z } from 'zod';

const Words = (max: number) => z.string().max(max);

/** A line of a document: a heading, a paragraph, a list item, a quote, or set text. */
export const AttachmentViewBlock = z.object({
  kind: z.enum(['heading', 'paragraph', 'item', 'quote', 'pre']),
  text: Words(40_000),
});
export type AttachmentViewBlock = z.infer<typeof AttachmentViewBlock>;

const Title = Words(300).optional();

export const AttachmentViewPart = z.discriminatedUnion('kind', [
  /** A document's words (a page, a chapter, a slide), as plain lines. */
  z.object({
    kind: z.literal('text'),
    title: Title,
    blocks: z.array(AttachmentViewBlock).max(20_000),
  }),
  /** A sheet or a database table: its first rows, and how many there are in all. */
  z.object({
    kind: z.literal('table'),
    title: Title,
    columns: z.array(Words(1000)).max(500),
    rows: z.array(z.array(Words(4000)).max(500)).max(2000),
    total: z.number().int().nonnegative().optional(),
  }),
  /** An archive's files and folders, by path (`docs/a.txt`). */
  z.object({
    kind: z.literal('tree'),
    title: Title,
    entries: z
      .array(
        z.object({
          path: Words(2048),
          size: z.number().int().nonnegative().optional(),
          folder: z.boolean().optional(),
        }),
      )
      .max(10_000),
    total: z.number().int().nonnegative().optional(),
  }),
  /** An email: who, when and what about, its words, and the names of what it carried. */
  z.object({
    kind: z.literal('email'),
    title: Title,
    headers: z.array(z.object({ name: Words(100), value: Words(4000) })).max(40),
    body: Words(400_000),
    attachments: z
      .array(
        z.object({
          name: Words(500),
          size: z.number().int().nonnegative().optional(),
          type: Words(255).optional(),
        }),
      )
      .max(500),
  }),
  /** A recording's words, with when each was said (seconds from the start) when known. */
  z.object({
    kind: z.literal('transcript'),
    title: Title,
    segments: z
      .array(z.object({ start: z.number().nonnegative().optional(), text: Words(20_000) }))
      .max(20_000),
  }),
  /** What a file is: a few facts ("Kind": "Windows program", "Built for": "64-bit Intel"). */
  z.object({
    kind: z.literal('facts'),
    title: Title,
    facts: z.array(z.object({ label: Words(100), value: Words(2000) })).max(60),
  }),
]);
export type AttachmentViewPart = z.infer<typeof AttachmentViewPart>;

export const AttachmentView = z.object({
  /** What it is, in a sentence for people: "A ZIP archive of 14 files." */
  summary: Words(600).optional(),
  parts: z.array(AttachmentViewPart).max(200),
  /** There's more than the preview shows (download it for the rest). */
  more: z.boolean().optional(),
});
export type AttachmentView = z.infer<typeof AttachmentView>;

/** `GET /api/attachments/:id/view`: null when no reader knows this kind of file. */
export const AttachmentViewResponse = z.object({ view: AttachmentView.nullable() });
export type AttachmentViewResponse = z.infer<typeof AttachmentViewResponse>;
