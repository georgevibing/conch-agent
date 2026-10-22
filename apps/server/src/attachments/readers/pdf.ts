/**
 * PDFs, past their words (ADR 0017). The `documents` reader takes a PDF's
 * text out; this one, before it, adds what text leaves behind:
 *
 * - **Whole**, to an engine that can send a PDF as it is (`can.pdfs`: the
 *   model APIs). The engine sends it to the models that read PDFs themselves
 *   (pages, charts, scans and layout) and keeps it from the rest. Its text
 *   comes too, shorter, so a model that can't read it whole, and the summary
 *   of a long chat, still have its words.
 * - **Pictures of its pages with little or no text** (a scan, a chart, a
 *   photo), drawn on this computer: shown to a model that sees, put into
 *   words for one that doesn't (ADR 0070), and ridden along with a PDF sent
 *   whole, for a model that turns out not to read it.
 *
 * Drawing happens in a disposable worker (`files/pdf-worker.mjs`), the pictures are
 * kept beside the attachment, and nothing goes anywhere but the provider the
 * chat is with. An engine whose own tools read PDFs well (`can.opensPdfs`:
 * Claude Code) gets the path and nothing more.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { Attachment } from '@conch/protocol';

import type { TurnDocument, TurnImage } from '../../engines/types';
import { runWorker } from '../../files/worker';
import { documents } from './documents';
import type { Reader, ReaderInput, ReaderResult } from './types';

/** Fewer letters than this on a page, and it's drawn as a picture (OpenClaw's rule too). */
export const THIN_PAGE_CHARS = 200;
/** Pages looked at for text, from the start. */
export const LOOK_PAGES = 20;
/** At most this many pages drawn. */
export const DRAW_PAGES = 8;
/** Pixels every drawn page shares: about four megapixels, as many as a few photos. */
export const PIXEL_BUDGET = 4_000_000;
/** A drawn page's long edge at most: what Claude reads without scaling down. */
export const MAX_EDGE = 1568;
/** Largest PDF sent whole: the chat's saved transcript stays well under its 8 MB (`context.ts`). */
export const WHOLE_MAX_BYTES = 4 * 1024 * 1024;
/** Most pages sent whole: every provider's floor (Anthropic's under a 1M window, OpenAI's). */
export const WHOLE_MAX_PAGES = 100;
/** Its text, beside a PDF sent whole: the start, for searching, quoting and summaries. */
export const WHOLE_TEXT_ROOM = 20_000;
/** Larger than this, pages aren't looked at (the worker's heap). */
const LOOK_MAX_BYTES = 40 * 1024 * 1024;
const CACHE = '.for-models-pdf.json';
const pageFile = (page: number) => `.for-models-pdf-page-${page}.jpg`;

const Drawn = z.object({
  page: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** What looking at a PDF found. */
export const Look = z.object({
  pages: z.number().int().nonnegative(),
  /** Letters on each page looked at, from the first. */
  chars: z.array(z.number().int().nonnegative()),
  /** Its thin pages, drawn as JPEGs (base64). */
  rendered: z.array(Drawn.extend({ data: z.string() })),
  /** Thin pages were found but this computer couldn't draw them. */
  undrawn: z.boolean().optional(),
});
export type Look = z.infer<typeof Look>;

const WorkerOutput = z.union([
  Look,
  z.object({ locked: z.literal(true) }),
  z.object({ error: z.string() }),
]);
type Looked = Look | { locked: true } | undefined;

export interface LookOptions {
  lookPages: number;
  draw: boolean;
  drawPages: number;
  pixelBudget: number;
  maxEdge: number;
  threshold: number;
}

/** What the reader leans on; tests give their own. */
export interface PdfDeps {
  look?(bytes: Buffer, options: LookOptions, signal: AbortSignal): Promise<Looked>;
}

/** pdf.js in a sealed worker that may draw (`worker.ts`, `addons`). */
async function lookInWorker(
  bytes: Buffer,
  options: LookOptions,
  signal: AbortSignal,
): Promise<Looked> {
  const raw = await runWorker({
    worker: './pdf-worker.mjs',
    modules: ['pdfjs-dist/legacy/build/pdf.mjs'],
    input: JSON.stringify({ data: bytes.toString('base64'), ...options }),
    signal,
    timeoutMs: 60_000,
    heapMb: 512,
    maxOutput: 16_000_000,
    addons: options.draw,
  });
  // Diagnostics may come first; the answer is the last line.
  const line = raw.trim().split('\n').at(-1) ?? '';
  const parsed = WorkerOutput.safeParse(JSON.parse(line));
  if (!parsed.success || 'error' in parsed.data) return undefined;
  return parsed.data;
}

interface Kept {
  v: 1;
  size: number;
  locked?: boolean;
  pages?: number;
  chars?: number[];
  drawn?: z.infer<typeof Drawn>[];
  undrawn?: boolean;
}

const KeptSchema = z.object({
  v: z.literal(1),
  size: z.number(),
  locked: z.boolean().optional(),
  pages: z.number().optional(),
  chars: z.array(z.number()).optional(),
  drawn: z.array(Drawn).optional(),
  undrawn: z.boolean().optional(),
});

/** What looking found, from beside the attachment when it was looked at before. */
async function looked(input: ReaderInput, draw: boolean): Promise<Kept | undefined> {
  const folder = dirname(input.path);
  const cache = join(folder, CACHE);
  const before = await readFile(cache, 'utf8')
    .then((raw) => KeptSchema.parse(JSON.parse(raw)))
    .catch(() => undefined);
  if (
    before &&
    before.size === input.bytes.length &&
    (before.drawn ?? []).every((d) => existsSync(join(folder, pageFile(d.page)))) &&
    // Looked at without drawing before, and pictures are wanted now: look again.
    !(draw && before.drawn === undefined && (before.chars ?? []).some((c) => c < THIN_PAGE_CHARS))
  )
    return before;
  if (input.bytes.length > LOOK_MAX_BYTES) return undefined;
  const look = input.deps.pdf?.look ?? lookInWorker;
  const found = await look(
    input.bytes,
    {
      lookPages: LOOK_PAGES,
      draw,
      drawPages: DRAW_PAGES,
      pixelBudget: PIXEL_BUDGET,
      maxEdge: MAX_EDGE,
      threshold: THIN_PAGE_CHARS,
    },
    input.signal,
  ).catch(() => undefined);
  if (!found) return undefined;
  const kept: Kept =
    'locked' in found
      ? { v: 1, size: input.bytes.length, locked: true }
      : {
          v: 1,
          size: input.bytes.length,
          pages: found.pages,
          chars: found.chars,
          ...(draw && {
            drawn: found.rendered.map(({ page, width, height }) => ({ page, width, height })),
          }),
          ...(found.undrawn && { undrawn: true }),
        };
  if (!('locked' in found))
    for (const page of found.rendered)
      await writeFile(join(folder, pageFile(page.page)), Buffer.from(page.data, 'base64')).catch(
        () => undefined,
      );
  await writeFile(cache, JSON.stringify(kept)).catch(() => undefined);
  return kept;
}

/** The drawn pages, as pictures for models, read back from beside the attachment. */
async function pictures(
  input: ReaderInput,
  kept: Kept,
): Promise<{ page: number; image: TurnImage }[]> {
  const folder = dirname(input.path);
  const out: { page: number; image: TurnImage }[] = [];
  for (const drawn of kept.drawn ?? []) {
    const path = join(folder, pageFile(drawn.page));
    const bytes = await readFile(path).catch(() => undefined);
    if (!bytes) continue;
    out.push({
      page: drawn.page,
      image: {
        name: `${input.attachment.name}, page ${drawn.page}`,
        mimeType: 'image/jpeg',
        data: bytes.toString('base64'),
        path,
      },
    });
  }
  return out;
}

/** "pages 2, 5 and 7". */
function pageList(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  return `pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`;
}

const upper = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function isPdf(attachment: Attachment, head: Buffer): boolean {
  return (
    attachment.kind === 'file' &&
    (attachment.mimeType === 'application/pdf' ||
      head.subarray(0, 5).toString('latin1') === '%PDF-')
  );
}

export const pdf: Reader = {
  id: 'pdf',
  matches: isPdf,
  // Codex and ACP agents open files but read a PDF poorly by themselves: they get this too.
  everywhere: true,
  async read(input): Promise<ReaderResult | undefined> {
    const { attachment, bytes, can } = input;
    // Claude Code reads a PDF, pictures and all, with its own Read tool.
    if (can.files && can.opensPdfs) return undefined;
    const draw = can.images === true;
    const kept = await looked(input, draw);
    if (kept?.locked)
      return {
        note: '(A PDF locked with a password: neither Conch nor a model can open it. If the message depends on it, ask for a copy without the password.)',
      };
    const pages = kept?.pages;
    const whole =
      can.pdfs === true &&
      pages !== undefined &&
      pages > 0 &&
      pages <= WHOLE_MAX_PAGES &&
      bytes.length <= WHOLE_MAX_BYTES;
    const room = whole ? Math.min(input.room, WHOLE_TEXT_ROOM) : input.room;
    const words = await documents.read({ ...input, room }).catch(() => undefined);
    const text = words?.text;
    const drawn = kept ? await pictures(input, kept) : [];
    const shown = drawn.map((d) => d.page);
    const images = drawn.map((d) => d.image);
    const thin = (kept?.chars ?? [])
      .map((count, i) => ({ count, page: i + 1 }))
      .filter((p) => p.count < THIN_PAGE_CHARS)
      .map((p) => p.page);
    const size = pages ? ` of ${plural(pages, 'page')}` : '';
    const id = attachment.id;
    const rest =
      words?.more && text
        ? can.tools
          ? ` Only the start of its text is here; for the rest, use read_document with file_path "${id}" and the next offset.`
          : ' Only the start of its text is here.'
        : '';
    const textSaid = text
      ? ` Its text, taken out by Conch, is below.${rest}`
      : ' Conch found no text in it to take out: it may be scanned.';
    const later = thin.length > shown.length || (pages ?? 0) > LOOK_PAGES;
    const one = shown.length === 1;
    const picturesSaid = shown.length
      ? ` ${upper(pageList(shown))} ${one ? 'has' : 'have'} little or no text (a scan, a chart or a picture), so ${one ? "it's" : "they're"} shown as ${one ? 'a picture' : 'pictures'}${later ? '; later pages are not' : ''}.`
      : thin.length && kept?.undrawn
        ? ` ${upper(pageList(thin.slice(0, 5)))} ${thin.length === 1 ? 'has' : 'have'} little or no text, and this computer couldn't draw ${thin.length === 1 ? 'it' : 'them'} as pictures.`
        : '';

    if (whole) {
      const document: TurnDocument = {
        name: attachment.name,
        mimeType: 'application/pdf',
        data: bytes.toString('base64'),
        pages: pages ?? 0,
        bytes: bytes.length,
        ...(images.length && { pictures: images }),
      };
      return {
        note: `(A PDF${size}. Sent with the message whole, for a model that reads PDFs: its pages, pictures and layout; a line after the message says whether this model got it.${textSaid}${shown.length ? ` For a model that can't read it whole, pictures of ${pageList(shown)} come instead.` : ''})`,
        ...(text && { text }),
        ...(words?.more && { more: true }),
        documents: [document],
      };
    }
    // Nothing to add to its words: they're what the `documents` reader says. An engine
    // that opens files gets them too (Codex reads a PDF poorly by itself).
    if (!images.length) return words;
    const tooBig = can.pdfs && pages !== undefined ? ' It is too large to send whole.' : '';
    return {
      note: `(A PDF${size}.${tooBig}${textSaid}${picturesSaid})`,
      ...(text && { text }),
      ...(words?.more && { more: true }),
      images,
    };
  },
};
