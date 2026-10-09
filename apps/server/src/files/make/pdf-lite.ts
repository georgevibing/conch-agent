/**
 * Conch's own PDF writer, for when there's no browser to print with: the same
 * blocks laid out in this computer's own fonts (`fonts.ts`: Arial, Liberation,
 * Noto, DejaVu…), each embedded as a subset of what the document uses, with
 * wide-coverage fonts for the scripts the main one lacks (Greek, Cyrillic,
 * Hebrew, Chinese…). Headings, paragraphs with bold and italics, lists,
 * tables, code, quotes, pictures, page numbers: plainer than a printed page.
 *
 * On a computer with no usable fonts it falls back to the standard PDF fonts
 * (Western European only); a character no font has is replaced, and the
 * caller is told which (`missing`). Right-to-left text is drawn left to right,
 * so the caller is told that too (`rtl`).
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
import { loadFont, safeFontkit, systemFonts, type FontFiles, type FontRole } from './fonts';
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

/** For a character no font has: something close the standard fonts can draw. */
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
};

function hex(color: string) {
  const n = Number.parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** A font of the document and the characters it can draw. */
interface Face {
  font: PDFFont;
  has: (codePoint: number) => boolean;
}

/** One role's fonts, in the order they're asked for a character. */
interface Chain {
  faces: Face[];
  /** Which face draws a character, once worked out. */
  picked: Map<number, PDFFont | null>;
}

type Fonts = Record<FontRole, Chain>;

/** A stretch of text drawn in one font. */
interface Seg {
  text: string;
  font: PDFFont;
}

type Color = ReturnType<typeof rgb>;

const STANDARD: Record<FontRole, StandardFonts> = {
  regular: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
  italic: StandardFonts.HelveticaOblique,
  boldItalic: StandardFonts.HelveticaBoldOblique,
  mono: StandardFonts.Courier,
};
const ROLES = Object.keys(STANDARD) as FontRole[];

/** Characters that take no room and need no glyph: joiners, variation selectors, marks of direction. */
const INVISIBLE = /^[\p{Cf}\uFE00-\uFE0F]$/u;
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

export interface LiteOptions {
  title?: string;
  subtitle?: string;
  size?: PageSize;
  landscape?: boolean;
  accent?: string;
  pictures?: ReadonlyMap<string, Picture>;
  /** The fonts to draw with (tests hand in their own); `false`: only the standard PDF fonts. */
  fonts?: FontFiles | false;
}

export interface LitePdf {
  pdf: Buffer;
  pages: number;
  /** Some characters were replaced: no font here has them. */
  lossy: boolean;
  /** Which (a few, once each). */
  missing: string[];
  /** It has right-to-left text, drawn left to right. */
  rtl: boolean;
  /** Fonts from this computer are in it (not only the standard PDF fonts). */
  embedded: boolean;
}

/** Every string in the document, for working out which fonts it needs. */
function textOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) textOf(v, out);
  else if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value))
      if (key !== 'src' && key !== 'link') textOf(v, out);
  return out;
}

/**
 * Each role's fonts for this document: its own font, then the wide ones for
 * the characters it lacks; only the fonts some character needs are embedded,
 * and each only as the glyphs used. The standard font always comes last.
 */
async function documentFonts(pdf: PDFDocument, files: FontFiles | false, text: string) {
  const codePoints = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 32 && !INVISIBLE.test(ch)) codePoints.add(cp);
  }
  const loaded = new Map<string, ReturnType<typeof loadFont>>();
  const load = (path: string) => {
    if (!loaded.has(path)) loaded.set(path, loadFont(path));
    return loaded.get(path);
  };
  const embedded = new Map<string, Face | undefined>();
  const fonts = {} as Fonts;
  let any = false;
  if (files) pdf.registerFontkit(safeFontkit);
  for (const role of ROLES) {
    const own = files ? files.roles[role] : undefined;
    const paths = files
      ? [
          ...new Set(
            [own, role === 'mono' ? files.roles.regular : undefined, ...files.fallbacks].filter(
              (p): p is string => Boolean(p),
            ),
          ),
        ]
      : [];
    // Which of them this document needs: the first that has each character.
    const needed = new Set<string>();
    let left = [...codePoints];
    for (const path of paths) {
      const face = load(path)?.face;
      if (!face) continue;
      const has = new Set(left.filter((cp) => face.hasGlyphForCodePoint(cp)));
      // Its own font always, so the document keeps one look; others only when they add something.
      if (has.size || path === own) needed.add(path);
      left = left.filter((cp) => !has.has(cp));
      if (!left.length) break;
    }
    const faces: Face[] = [];
    for (const path of paths.filter((p) => needed.has(p))) {
      if (!embedded.has(path)) {
        const font = load(path);
        const made = font
          ? await pdf
              .embedFont(font.bytes, { subset: true })
              .then((pdfFont) => ({
                font: pdfFont,
                has: (cp: number) => font.face.hasGlyphForCodePoint(cp),
              }))
              .catch(() => undefined)
          : undefined;
        embedded.set(path, made);
      }
      const face = embedded.get(path);
      if (face) faces.push(face);
    }
    if (faces.length) any = true;
    const standard = await pdf.embedFont(STANDARD[role]);
    const set = new Set(standard.getCharacterSet());
    faces.push({ font: standard, has: (cp) => set.has(cp) });
    fonts[role] = { faces, picked: new Map() };
  }
  return { fonts, embedded: any };
}

export async function makeLitePdf(
  doc: readonly Block[],
  options: LiteOptions = {},
): Promise<LitePdf> {
  const files = options.fonts ?? systemFonts();
  try {
    return await layOut(doc, options, files);
  } catch (error) {
    // A font that couldn't be written: the standard fonts still make the PDF.
    if (!files) throw error;
    return layOut(doc, options, false);
  }
}

async function layOut(
  doc: readonly Block[],
  options: LiteOptions,
  files: FontFiles | false,
): Promise<LitePdf> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title ?? 'Document');
  pdf.setCreator('Conch');
  pdf.setProducer('Conch');
  const allText = [
    options.title ?? '',
    options.subtitle ?? '',
    ...textOf(doc),
    // What the writer draws itself: bullets, boxes, page numbers.
    '•[]x/?-<>=!0123456789',
  ].join(' ');
  const { fonts, embedded } = await documentFonts(pdf, files, allText);
  const missing = new Set<string>();
  let lossy = false;

  /** The first of a role's fonts that has the character (or none does). */
  const pick = (chain: Chain, cp: number) => {
    let font = chain.picked.get(cp);
    if (font === undefined) {
      font = chain.faces.find((f) => f.has(cp))?.font ?? null;
      chain.picked.set(cp, font);
    }
    return font;
  };
  /** Text as stretches in the fonts that can draw it; what none can is replaced. */
  const segs = (text: string, role: FontRole = 'regular'): Seg[] => {
    const chain = fonts[role];
    const base = chain.faces[0]?.font;
    const out: Seg[] = [];
    const push = (t: string, font: PDFFont | null | undefined) => {
      const use = font ?? base;
      if (!use || !t) return;
      const last = out.at(-1);
      if (last && last.font === use) last.text += t;
      else out.push({ text: t, font: use });
    };
    for (const ch of text) {
      if (ch === '\n' || ch === '\r' || ch === '\u00a0') {
        push(' ', base);
        continue;
      }
      if (ch === '\t') {
        push('    ', base);
        continue;
      }
      if (INVISIBLE.test(ch)) continue;
      const font = pick(chain, ch.codePointAt(0) ?? 0);
      if (font) {
        push(ch, font);
        continue;
      }
      const sub = SUBSTITUTE[ch];
      if (sub !== undefined) {
        push(sub, chain.faces.at(-1)?.font);
        continue;
      }
      lossy = true;
      if (missing.size < 12) missing.add(ch);
      push('?', base);
    }
    return out;
  };
  const widthOf = (parts: readonly Seg[], size: number) =>
    parts.reduce((w, part) => w + part.font.widthOfTextAtSize(part.text, size), 0);
  const draw = (
    on: PDFPage,
    parts: readonly Seg[],
    at: { x: number; y: number; size: number; color: Color },
  ) => {
    let x = at.x;
    for (const part of parts) {
      on.drawText(part.text, { x, y: at.y, size: at.size, font: part.font, color: at.color });
      x += part.font.widthOfTextAtSize(part.text, at.size);
    }
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
  const roleOf = (run: Run, bold = false): FontRole =>
    run.code
      ? 'mono'
      : (bold || run.bold) && run.italic
        ? 'boldItalic'
        : bold || run.bold
          ? 'bold'
          : run.italic
            ? 'italic'
            : 'regular';

  interface Piece {
    parts: Seg[];
    size: number;
    color: Color;
    width: number;
    space: number;
    br?: boolean;
  }
  const length = (parts: readonly Seg[]) => parts.reduce((n, p) => n + [...p.text].length, 0);
  /** The first `count` characters of a word, and the rest. */
  const cut = (parts: readonly Seg[], count: number): [Seg[], Seg[]] => {
    const head: Seg[] = [];
    const tail: Seg[] = [];
    let left = count;
    for (const part of parts) {
      const chars = [...part.text];
      if (left >= chars.length) head.push(part);
      else if (left <= 0) tail.push(part);
      else {
        head.push({ text: chars.slice(0, left).join(''), font: part.font });
        tail.push({ text: chars.slice(left).join(''), font: part.font });
      }
      left -= chars.length;
    }
    return [head, tail];
  };

  /** Words of styled runs, wrapped into `w`, drawn from x; returns the height used. */
  const flow = (
    runs: readonly Run[],
    opts: {
      x: number;
      w: number;
      size: number;
      color?: Color;
      bold?: boolean;
      draw?: boolean;
      lead?: number;
    },
  ) => {
    const lead = opts.lead ?? opts.size * 1.45;
    const pieces: Piece[] = [];
    for (const run of runs) {
      if (run.br) {
        pieces.push({ parts: [], size: opts.size, color: INK, width: 0, space: 0, br: true });
        continue;
      }
      if (run.image) {
        if (run.image.alt) {
          const parts = segs(`[${run.image.alt}]`, 'italic');
          pieces.push({
            parts,
            size: opts.size,
            color: SOFT,
            width: widthOf(parts, opts.size),
            space: 0,
          });
        }
        continue;
      }
      const role = roleOf(run, opts.bold);
      const color = run.link ? accent : (opts.color ?? INK);
      const size = run.code ? opts.size * 0.92 : opts.size;
      const space = widthOf(segs(' ', role), size);
      for (const word of run.text.replace(/[\n\r\t\u00a0]/g, ' ').split(/( +)/)) {
        if (!word) continue;
        if (/^ +$/.test(word)) {
          const last = pieces.at(-1);
          if (last) last.space += space * word.length;
          continue;
        }
        const parts = segs(word, role);
        pieces.push({ parts, size, color, width: widthOf(parts, size), space: 0 });
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
      let long = piece;
      while (long.width > opts.w && length(long.parts) > 1) {
        const keep = Math.max(1, Math.floor((length(long.parts) * opts.w) / long.width) - 1);
        const [head, rest] = cut(long.parts, keep);
        long.parts = head;
        long.width = widthOf(head, long.size);
        const next: Piece = { ...long, parts: rest, width: widthOf(rest, long.size) };
        lines.push([next]);
        lineW = next.width;
        long = next;
      }
    }
    if (opts.draw !== false)
      for (const line of lines) {
        room(lead);
        let x = opts.x;
        for (const piece of line) {
          draw(page, piece.parts, {
            x,
            y: y - opts.size,
            size: piece.size,
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
    const embeddedImage = !found
      ? undefined
      : found.mimeType === 'image/png'
        ? await pdf.embedPng(found.bytes).catch(() => undefined)
        : found.mimeType === 'image/jpeg'
          ? await pdf.embedJpg(found.bytes).catch(() => undefined)
          : undefined;
    images.set(src, embeddedImage);
    return embeddedImage;
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
            draw(page, segs(mark), {
              x: x + 4,
              y: y - 10.5,
              size: 10.5,
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
          const em = widthOf(segs('M', 'mono'), size) || size * 0.6;
          const perLine = Math.max(10, Math.floor((w - 16) / em));
          const rows = block.text.split('\n').flatMap((line) => {
            const chars = [...line.replaceAll('\t', '    ')];
            const out: string[] = [];
            for (let i = 0; i < Math.max(1, chars.length); i += perLine)
              out.push(chars.slice(i, i + perLine).join(''));
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
              draw(page, segs(row, 'mono'), { x: x + 8, y: yy - size, size, color: INK });
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
  const footer = segs([...(options.title ?? firstHeading(doc) ?? '')].slice(0, 80).join(''));
  pages.forEach((p, i) => {
    const label = segs(`${i + 1} / ${pages.length}`);
    draw(p, label, { x: W - MARGIN - widthOf(label, 8), y: 30, size: 8, color: SOFT });
    if (footer.length) draw(p, footer, { x: MARGIN, y: 30, size: 8, color: SOFT });
  });
  return {
    pdf: Buffer.from(await pdf.save()),
    pages: pages.length,
    lossy,
    missing: [...missing],
    rtl: RTL.test(allText),
    embedded,
  };
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
