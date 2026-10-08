/**
 * Conch's own PDF writer, for when there's no browser to print with: the same
 * blocks laid out in the standard PDF fonts (headings, paragraphs with bold
 * and italics, lists, tables, code, quotes, pictures, page numbers). Plainer
 * than a printed page, and Latin script only: characters the standard fonts
 * can't draw are replaced, and the caller is told.
 */
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import { firstHeading, type Block, type Run } from './blocks';
import { accentOf, type PageSize } from './html';
import type { Picture } from './ooxml';

const PAGE_PT: Record<PageSize, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A5: [419.53, 595.28],
};
const MARGIN = 60;
const INK = rgb(0.114, 0.137, 0.161);
const SOFT = rgb(0.35, 0.39, 0.43);
const LINE = rgb(0.85, 0.87, 0.89);
const WASH = rgb(0.957, 0.965, 0.973);

const SUBSTITUTE: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '✓': 'v',
  '✔': 'v',
  '☐': '[ ]',
  '☑': '[x]',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  ' ': ' ',
  '\t': '    ',
};

function hex(color: string) {
  const n = Number.parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

export interface LiteOptions {
  title?: string;
  subtitle?: string;
  size?: PageSize;
  landscape?: boolean;
  accent?: string;
  pictures?: ReadonlyMap<string, Picture>;
}

export async function makeLitePdf(
  doc: readonly Block[],
  options: LiteOptions = {},
): Promise<{ pdf: Buffer; pages: number; lossy: boolean }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title ?? 'Document');
  pdf.setCreator('Conch');
  pdf.setProducer('Conch');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const charset = new Set(fonts.regular.getCharacterSet());
  const monoSet = new Set(fonts.mono.getCharacterSet());
  let lossy = false;
  const clean = (text: string, mono = false) => {
    const set = mono ? monoSet : charset;
    let out = '';
    for (const ch of text) {
      const sub = SUBSTITUTE[ch];
      if (sub !== undefined) out += sub;
      else if (set.has(ch.codePointAt(0) ?? 0)) out += ch;
      else if (ch === '\n' || ch === '\r') out += ' ';
      else {
        lossy = true;
        out += '?';
      }
    }
    return out;
  };
  const accent = hex(accentOf(options.accent));
  const [pw, ph] = PAGE_PT[options.size ?? 'A4'];
  const [W, H] = options.landscape ? [ph, pw] : [pw, ph];
  const width = W - 2 * MARGIN;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - MARGIN;
  const images = new Map<string, PDFImage | undefined>();

  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - MARGIN;
  };
  const room = (h: number) => {
    if (y - h < MARGIN + 10) newPage();
  };
  const fontOf = (run: Run) =>
    run.code
      ? fonts.mono
      : run.bold && run.italic
        ? fonts.boldItalic
        : run.bold
          ? fonts.bold
          : run.italic
            ? fonts.italic
            : fonts.regular;

  /** Words of styled runs, wrapped into `w`, drawn from x; returns the height used. */
  const flow = (
    runs: readonly Run[],
    opts: {
      x: number;
      w: number;
      size: number;
      color?: ReturnType<typeof rgb>;
      bold?: boolean;
      draw?: boolean;
      lead?: number;
    },
  ) => {
    const lead = opts.lead ?? opts.size * 1.45;
    interface Piece {
      text: string;
      font: PDFFont;
      color: ReturnType<typeof rgb>;
      width: number;
      space: number;
      br?: boolean;
    }
    const pieces: Piece[] = [];
    for (const run of runs) {
      if (run.br) {
        pieces.push({ text: '', font: fonts.regular, color: INK, width: 0, space: 0, br: true });
        continue;
      }
      if (run.image) {
        if (run.image.alt) {
          const text = clean(`[${run.image.alt}]`);
          pieces.push({
            text,
            font: fonts.italic,
            color: SOFT,
            width: fonts.italic.widthOfTextAtSize(text, opts.size),
            space: 0,
          });
        }
        continue;
      }
      const font =
        opts.bold && !run.code ? (run.italic ? fonts.boldItalic : fonts.bold) : fontOf(run);
      const color = run.link ? accent : (opts.color ?? INK);
      const size = run.code ? opts.size * 0.92 : opts.size;
      const words = clean(run.text, run.code).split(/( +)/);
      for (const word of words) {
        if (!word) continue;
        if (/^ +$/.test(word)) {
          const last = pieces.at(-1);
          if (last) last.space += font.widthOfTextAtSize(' ', size) * word.length;
          continue;
        }
        pieces.push({
          text: word,
          font,
          color,
          width: font.widthOfTextAtSize(word, size),
          space: 0,
        });
      }
    }
    const lines: Piece[][] = [[]];
    let lineW = 0;
    for (const piece of pieces) {
      const current = lines.at(-1) ?? [];
      if (piece.br) {
        lines.push([]);
        lineW = 0;
        continue;
      }
      const prev = current.at(-1);
      const needed = (prev ? prev.space : 0) + piece.width;
      if (current.length && lineW + needed > opts.w) {
        lines.push([piece]);
        lineW = piece.width;
      } else {
        current.push(piece);
        lineW += needed;
      }
      // A word longer than the line is cut.
      while (piece.width > opts.w && piece.text.length > 1) {
        const keep = Math.max(1, Math.floor((piece.text.length * opts.w) / piece.width) - 1);
        const rest = piece.text.slice(keep);
        piece.text = piece.text.slice(0, keep);
        piece.width = piece.font.widthOfTextAtSize(piece.text, opts.size);
        const next = { ...piece, text: rest, width: piece.font.widthOfTextAtSize(rest, opts.size) };
        lines.push([next]);
        lineW = next.width;
        if (next.width <= opts.w) break;
      }
    }
    if (opts.draw !== false)
      for (const line of lines) {
        room(lead);
        let x = opts.x;
        for (const piece of line) {
          const size = piece.font === fonts.mono ? opts.size * 0.92 : opts.size;
          page.drawText(piece.text, {
            x,
            y: y - opts.size,
            size,
            font: piece.font,
            color: piece.color,
          });
          x += piece.width + piece.space;
        }
        y -= lead;
      }
    return lines.length * lead;
  };

  const picture = async (src: string) => {
    if (images.has(src)) return images.get(src);
    const found = options.pictures?.get(src);
    const embedded = !found
      ? undefined
      : found.mimeType === 'image/png'
        ? await pdf.embedPng(found.bytes).catch(() => undefined)
        : found.mimeType === 'image/jpeg'
          ? await pdf.embedJpg(found.bytes).catch(() => undefined)
          : undefined;
    images.set(src, embedded);
    return embedded;
  };

  if (options.title && !(doc[0]?.type === 'heading' && doc[0].level === 1)) {
    flow([{ text: options.title }], { x: MARGIN, w: width, size: 24, bold: true });
    if (options.subtitle)
      flow([{ text: options.subtitle }], { x: MARGIN, w: width, size: 13, color: SOFT });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: W - MARGIN, y },
      thickness: 0.8,
      color: LINE,
    });
    y -= 18;
  }

  const blocks = async (
    list: readonly Block[],
    x: number,
    w: number,
    quote = false,
  ): Promise<void> => {
    for (const block of list) {
      switch (block.type) {
        case 'heading': {
          const size = [20, 15, 12.5, 11, 10.5, 10.5][block.level - 1] ?? 11;
          room(size * 3);
          y -= block.level <= 2 ? 12 : 8;
          flow(block.runs, { x, w, size, bold: true, color: block.level === 3 ? accent : INK });
          if (block.level === 2) {
            page.drawLine({
              start: { x, y: y + 4 },
              end: { x: x + w, y: y + 4 },
              thickness: 1.2,
              color: accent,
            });
            y -= 4;
          }
          y -= 4;
          break;
        }
        case 'paragraph': {
          const only = block.runs.length === 1 ? block.runs[0]?.image : undefined;
          const image = only ? await picture(only.src) : undefined;
          if (image) {
            const scale = Math.min(1, w / image.width, (H - 2 * MARGIN) / 2 / image.height);
            const iw = image.width * scale;
            const ih = image.height * scale;
            room(ih + 10);
            page.drawImage(image, { x: x + (w - iw) / 2, y: y - ih, width: iw, height: ih });
            y -= ih + 12;
            break;
          }
          const top = y;
          flow(block.runs, {
            x: quote ? x + 12 : x,
            w: quote ? w - 12 : w,
            size: 10.5,
            color: quote ? SOFT : INK,
          });
          if (quote && top > y)
            page.drawRectangle({ x, y, width: 2.5, height: top - y, color: accent });
          y -= 7;
          break;
        }
        case 'list': {
          let n = block.start;
          for (const item of block.items) {
            const mark =
              item.checked !== undefined
                ? item.checked
                  ? '[x]'
                  : '[ ]'
                : block.ordered
                  ? `${n++}.`
                  : '•';
            room(16);
            page.drawText(mark, {
              x: x + 4,
              y: y - 10.5,
              size: 10.5,
              font: fonts.regular,
              color: block.ordered ? INK : accent,
            });
            flow(item.runs, { x: x + 20, w: w - 20, size: 10.5 });
            y -= 2;
            if (item.children.length) await blocks(item.children, x + 20, w - 20, quote);
          }
          y -= 6;
          break;
        }
        case 'code': {
          const size = 8.5;
          const perLine = Math.max(
            10,
            Math.floor((w - 16) / fonts.mono.widthOfTextAtSize('M', size)),
          );
          const rows = block.text.split('\n').flatMap((line) => {
            const text = clean(line, true);
            const out: string[] = [];
            for (let i = 0; i < Math.max(1, text.length); i += perLine)
              out.push(text.slice(i, i + perLine));
            return out;
          });
          const lead = size * 1.4;
          for (let i = 0; i < rows.length;) {
            room(lead * 2 + 12);
            const fit = Math.max(
              1,
              Math.min(rows.length - i, Math.floor((y - MARGIN - 22) / lead)),
            );
            const h = fit * lead + 12;
            page.drawRectangle({
              x,
              y: y - h,
              width: w,
              height: h,
              color: WASH,
              borderColor: LINE,
              borderWidth: 0.6,
            });
            let yy = y - 6;
            for (const row of rows.slice(i, i + fit)) {
              page.drawText(row, { x: x + 8, y: yy - size, size, font: fonts.mono, color: INK });
              yy -= lead;
            }
            y -= h + 8;
            i += fit;
          }
          break;
        }
        case 'quote':
          await blocks(block.blocks, x, w, true);
          break;
        case 'table': {
          const cols = Math.max(1, block.header.length);
          const cw = w / cols;
          const size = 9;
          const row = (cells: readonly Run[][], head: boolean) => {
            const heights = cells.map((cell) =>
              flow(cell, { x: 0, w: cw - 10, size, bold: head, draw: false, lead: size * 1.35 }),
            );
            const h = Math.max(size * 1.35, ...heights) + 8;
            room(h);
            if (head) page.drawRectangle({ x, y: y - h, width: w, height: h, color: accent });
            const top = y;
            cells.forEach((cell, i) => {
              y = top - 4;
              flow(cell, {
                x: x + i * cw + 5,
                w: cw - 10,
                size,
                bold: head,
                color: head ? rgb(1, 1, 1) : INK,
                lead: size * 1.35,
              });
            });
            y = top - h;
            if (!head)
              page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: LINE });
          };
          row(block.header, true);
          for (const cells of block.rows)
            row(
              block.header.map((_, i) => cells[i] ?? []),
              false,
            );
          y -= 12;
          break;
        }
        case 'rule':
          room(20);
          y -= 8;
          page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.8, color: LINE });
          y -= 12;
          break;
        case 'pagebreak':
          newPage();
          break;
      }
    }
  };
  await blocks(doc, MARGIN, width);

  const pages = pdf.getPages();
  const footer = clean((options.title ?? firstHeading(doc) ?? '').slice(0, 80));
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, {
      x: W - MARGIN - fonts.regular.widthOfTextAtSize(label, 8),
      y: 30,
      size: 8,
      font: fonts.regular,
      color: SOFT,
    });
    if (footer) p.drawText(footer, { x: MARGIN, y: 30, size: 8, font: fonts.regular, color: SOFT });
  });
  return { pdf: Buffer.from(await pdf.save()), pages: pages.length, lossy };
}

/** Pictures as a PDF, one to a page, each fitted with a margin. */
export async function picturesPdf(
  pictures: readonly Picture[],
  size: PageSize = 'A4',
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setCreator('Conch');
  for (const picture of pictures) {
    const image =
      picture.mimeType === 'image/png'
        ? await pdf.embedPng(picture.bytes)
        : await pdf.embedJpg(picture.bytes);
    const [pw, ph] = PAGE_PT[size];
    const [W, H] = image.width > image.height ? [ph, pw] : [pw, ph];
    const page = pdf.addPage([W, H]);
    const scale = Math.min((W - 72) / image.width, (H - 72) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  }
  return Buffer.from(await pdf.save());
}

/** Pages in a PDF Conch made itself (trusted bytes; others are counted in the worker). */
export async function pageCount(bytes: Buffer): Promise<number | undefined> {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    return undefined;
  }
}
