/**
 * PDFs past their words (ADR 0017): whole to an engine that can send one,
 * pictures of the pages that have no text, the text for an engine that opens
 * files but reads PDFs poorly, and nothing added for one that reads them well.
 */
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { forTurn } from '../prompt';
import { AttachmentStore } from '../store';
import {
  LOOK_PAGES,
  pdf,
  THIN_PAGE_CHARS,
  WHOLE_MAX_PAGES,
  WHOLE_TEXT_ROOM,
  type Look,
  type LookOptions,
  type PdfDeps,
} from './pdf';
import type { AttachmentAbilities, ReaderInput } from './types';

const WORDS =
  'Quarterly revenue grew by twelve percent, led by the northern region and new subscriptions. ';

/** A PDF with a page of words and a page that is only a drawing (a scan, as far as text goes). */
async function makePdf(pages: ('text' | 'scan')[] = ['text', 'scan']): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const kind of pages) {
    const page = doc.addPage([400, 300]);
    if (kind === 'text')
      for (let line = 0; line < 4; line++)
        page.drawText(WORDS.slice(0, 60), { x: 10, y: 260 - line * 20, size: 10, font });
    else page.drawRectangle({ x: 40, y: 40, width: 200, height: 120, color: rgb(0.8, 0.1, 0.1) });
  }
  return Buffer.from(await doc.save());
}

async function saved(bytes: Buffer, name = 'report.pdf') {
  const store = new AttachmentStore(await mkdtemp(join(tmpdir(), 'conch-pdf-')));
  const attachment = await store.save({ name, bytes });
  const found = await store.get(attachment.id);
  if (!found) throw new Error('not saved');
  return { store, attachment, path: found.path };
}

/** A looker that says what it's told, and remembers what it was asked. */
function fakeLook(look: Look | { locked: true }, asked: LookOptions[] = []): PdfDeps {
  return {
    look: async (_bytes, options) => {
      asked.push(options);
      return look;
    },
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

async function read(bytes: Buffer, can: AttachmentAbilities, deps: PdfDeps = {}) {
  const file = await saved(bytes);
  const input: ReaderInput = {
    attachment: file.attachment,
    bytes,
    path: file.path,
    room: 60_000,
    can,
    deps: { pdf: deps },
    signal: new AbortController().signal,
  };
  return { result: await pdf.read(input), file };
}

const API: AttachmentAbilities = { images: true, files: false, tools: true, pdfs: true };

describe('a PDF for an engine that can send it whole', () => {
  it('goes whole, with its page count, beside the start of its text', async () => {
    const bytes = await makePdf(['text', 'text']);
    const { result } = await read(
      bytes,
      API,
      fakeLook({ pages: 2, chars: [240, 240], rendered: [] }),
    );
    expect(result?.documents).toEqual([
      expect.objectContaining({
        name: 'report.pdf',
        mimeType: 'application/pdf',
        pages: 2,
        bytes: bytes.length,
        data: bytes.toString('base64'),
      }),
    ]);
    expect(result?.documents?.[0]?.pictures).toBeUndefined();
    expect(result?.text).toContain('Quarterly revenue');
    expect(result?.text?.length).toBeLessThanOrEqual(WHOLE_TEXT_ROOM);
    expect(result?.note).toMatch(/A PDF of 2 pages\. Sent with the message whole/);
    expect(result?.images).toBeUndefined();
  });

  it('carries pictures of its scanned pages, for a model that turns out not to read it', async () => {
    const { result } = await read(
      await makePdf(['text', 'scan']),
      API,
      fakeLook({
        pages: 2,
        chars: [240, 0],
        rendered: [{ page: 2, width: 400, height: 300, data: JPEG }],
      }),
    );
    const pictures = result?.documents?.[0]?.pictures;
    expect(pictures).toHaveLength(1);
    expect(pictures?.[0]).toMatchObject({ name: 'report.pdf, page 2', mimeType: 'image/jpeg' });
    expect(pictures?.[0]?.path).toMatch(/\.for-models-pdf-page-2\.jpg$/);
    expect(result?.note).toContain('pictures of page 2 come instead');
  });

  it('stays home past the page cap: its text and pictures carry it', async () => {
    const asked: LookOptions[] = [];
    const { result } = await read(
      await makePdf(['scan']),
      API,
      fakeLook(
        {
          pages: WHOLE_MAX_PAGES + 1,
          chars: Array.from({ length: LOOK_PAGES }, () => 0),
          rendered: [{ page: 1, width: 400, height: 300, data: JPEG }],
        },
        asked,
      ),
    );
    expect(result?.documents).toBeUndefined();
    expect(result?.images).toHaveLength(1);
    expect(result?.note).toContain('too large to send whole');
    expect(result?.note).toContain('later pages are not');
    expect(asked[0]).toMatchObject({
      draw: true,
      threshold: THIN_PAGE_CHARS,
      lookPages: LOOK_PAGES,
    });
  });

  it('is said plainly when it’s locked with a password', async () => {
    const { result } = await read(await makePdf(), API, fakeLook({ locked: true }));
    expect(result?.note).toMatch(/locked with a password/);
    expect(result?.documents).toBeUndefined();
  });
});

describe('a PDF for the other engines', () => {
  it('Claude Code reads it itself: nothing added', async () => {
    const { result } = await read(
      await makePdf(),
      { images: true, files: true, opensPdfs: true },
      fakeLook({ pages: 2, chars: [240, 0], rendered: [] }),
    );
    expect(result).toBeUndefined();
  });

  it('Codex opens files but reads PDFs poorly: it gets the text and the scanned pages', async () => {
    const { result } = await read(
      await makePdf(),
      { images: true, files: true, tools: true },
      fakeLook({
        pages: 2,
        chars: [240, 0],
        rendered: [{ page: 2, width: 400, height: 300, data: JPEG }],
      }),
    );
    expect(result?.text).toContain('Quarterly revenue');
    expect(result?.images?.[0]?.path).toMatch(/page-2\.jpg$/);
    expect(result?.note).toContain('Page 2 has little or no text');
    expect(result?.documents).toBeUndefined();
  });

  it('a PDF with text everywhere is just its words, as the documents reader says them', async () => {
    const { result } = await read(
      await makePdf(['text']),
      { images: true, files: false, tools: true },
      fakeLook({ pages: 1, chars: [240], rendered: [] }),
    );
    expect(result?.text).toContain('Quarterly revenue');
    expect(result?.images).toBeUndefined();
    expect(result?.note).toMatch(/taken out by Conch/);
  });

  it('when looking fails, the words still stand', async () => {
    const { result } = await read(
      await makePdf(['text']),
      { images: true, files: false },
      { look: async () => undefined },
    );
    expect(result?.text).toContain('Quarterly revenue');
  });
});

describe('the turn', () => {
  it('collects the PDF whole for the engine, and the block says what it is', async () => {
    const bytes = await makePdf(['text']);
    const file = await saved(bytes);
    const turn = await forTurn(file.store, [file.attachment], API, {
      pdf: fakeLook({ pages: 1, chars: [240], rendered: [] }),
    });
    expect(turn.documents).toHaveLength(1);
    expect(turn.block).toContain('Sent with the message whole');
    // An engine that can't send PDFs whole gets none, whatever a reader made.
    const plain = await forTurn(
      file.store,
      [file.attachment],
      { images: true, files: false, tools: true },
      { pdf: fakeLook({ pages: 1, chars: [240], rendered: [] }) },
    );
    expect(plain.documents).toBeUndefined();
  });
});

const canDraw = (() => {
  try {
    createRequire(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')).resolve(
      '@napi-rs/canvas',
    );
    return true;
  } catch {
    return false;
  }
})();

describe('the sealed worker, for real', () => {
  it.skipIf(!canDraw)(
    'counts the pages, and draws only the one without text',
    async () => {
      const bytes = await makePdf(['text', 'scan']);
      const { result } = await read(bytes, { images: true, files: false, tools: true });
      expect(result?.images).toHaveLength(1);
      const picture = Buffer.from(result?.images?.[0]?.data ?? '', 'base64');
      expect(picture.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(result?.note).toMatch(/A PDF of 2 pages\./);
      expect(result?.note).toContain('Page 2 has little or no text');
    },
    30_000,
  );

  it('a file that only calls itself a PDF fails in the worker, and the plain note stands', async () => {
    const bytes = Buffer.from('%PDF-1.7\n' + 'garbage '.repeat(200), 'latin1');
    const { result } = await read(bytes, { images: true, files: false, pdfs: true });
    expect(result?.documents).toBeUndefined();
    expect(result?.images).toBeUndefined();
    expect(result?.note).toMatch(/no text Conch could take out/);
  }, 30_000);

  it.skipIf(!canDraw)(
    'kept beside the attachment, so the next turn doesn’t draw it again',
    async () => {
      const bytes = await makePdf(['scan']);
      const file = await saved(bytes);
      const input = (deps: PdfDeps): ReaderInput => ({
        attachment: file.attachment,
        bytes,
        path: file.path,
        room: 60_000,
        can: { images: true, files: false },
        deps: { pdf: deps },
        signal: new AbortController().signal,
      });
      const first = await pdf.read(input({}));
      expect(first?.images).toHaveLength(1);
      let looked = 0;
      const again = await pdf.read(
        input({
          look: async () => {
            looked++;
            return undefined;
          },
        }),
      );
      expect(looked).toBe(0);
      expect(again?.images?.[0]?.data).toBe(first?.images?.[0]?.data);
    },
    30_000,
  );
});
