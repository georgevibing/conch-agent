/**
 * Making, converting, combining and unpacking files, as host tools: every
 * provider gets them, whatever it can do itself. What they make goes into
 * the chat's own attachment store (never a path the model names), with a
 * card to preview and download, and goes out to chat apps by id
 * (`message_user`, or with the reply in a chat that came from one).
 *
 * Untrusted files (an attached PDF, a zip, a workbook) are only ever parsed
 * in the sealed worker (`../worker.ts`); what the model wrote is printed in
 * a browser with JavaScript off and the network cut (`printer.ts`).
 */
import { convert as htmlToText } from 'html-to-text';
import { z } from 'zod';

import type { Attachment, ToolProgress } from '@conch/protocol';

import { decodeText, extension } from '../../attachments/sniff';
import type { AttachmentStore } from '../../attachments/store';
import type { ToolContext } from '../../conversations/manager';
import type { FileAccess } from '../../engines/host';
import type { HostTool, HostToolResult } from '../../engines/types';
import { extractDocument } from '../documents';
import { fileBytes } from '../read';
import { runWorker, WorkerFailed } from '../worker';
import {
  firstHeading,
  fromMarkdown,
  fromText,
  imagesIn,
  toMarkdown,
  toText,
  type Block,
  type Run,
} from './blocks';
import { chartPage, chartSvg, chartTable, CHART_SIZE, SERIES, type Chart } from './chart';
import { makeDocx } from './docx';
import { fileName, formatOf, LIMITS, MAKE_FORMATS, MIME, type MakeFormat } from './formats';
import { documentHtml, sealHtml, type PageOptions, type PageSize, type Theme } from './html';
import type { Picture } from './ooxml';
import { pack } from './ooxml';
import { makeLitePdf, pageCount } from './pdf-lite';
import { makePptx, slideHtml, type Slide } from './pptx';
import type { Printer } from './printer';
import { FileProgress } from './progress';
import { makeCsv, makeXlsx, parseCsv, typed, type CellValue, type Sheet } from './sheets';

export const FILE_TOOLS = /^(?:mcp__conch__)?file_(?:make|convert|combine|unzip)$/;

/** Words in the result every file tool gives, so the model sends files the one right way. */
const SEND_WORDS =
  'A card with a preview and Download is shown in the chat. In a chat that came from a chat app (Telegram, WhatsApp, Slack…) it is sent there with your reply; to send it to one of their chat apps, use message_user with attachments: [id]. Never paste a path or a link to it into a message, and never say it was downloaded: the person presses Download.';

// ── Inputs ──────────────────────────────────────────────────────────────────

const Cell = z.union([
  z.string().max(LIMITS.cellChars),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ formula: z.string().min(1).max(8000) }).strict(),
]);
const SheetInput = z
  .object({
    name: z.string().max(100).default('Sheet 1'),
    rows: z.array(z.array(Cell).max(LIMITS.columns)).max(100_000),
    header: z.boolean().optional(),
    formats: z
      .array(z.enum(['text', 'integer', 'decimal', 'percent', 'date', 'datetime']).nullable())
      .max(LIMITS.columns)
      .optional(),
  })
  .strict();
const SlideInput = z
  .object({
    layout: z.enum(['title', 'section', 'content']).optional(),
    title: z.string().min(1).max(300),
    subtitle: z.string().max(500).optional(),
    bullets: z.array(z.string().max(2000)).max(LIMITS.bullets).optional(),
    body: z.string().max(20_000).optional(),
    image: z.string().max(200).optional(),
  })
  .strict();
const ChartInput = z
  .object({
    type: z.enum(['bar', 'line', 'area', 'pie']),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(300).optional(),
    labels: z.array(z.string().max(200)).min(1).max(LIMITS.chartPoints),
    series: z
      .array(
        z
          .object({
            name: z.string().max(100),
            values: z.array(z.number().finite().nullable()).max(LIMITS.chartPoints),
          })
          .strict(),
      )
      .min(1)
      .max(SERIES.length),
    stacked: z.boolean().optional(),
    unit: z.string().max(12).optional(),
  })
  .strict();
const PageSizeInput = z.enum(['A4', 'Letter', 'Legal', 'A5']);
const Accent = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();

const MAKE_INPUT = {
  format: z.enum(MAKE_FORMATS),
  name: z.string().min(1).max(200),
  title: z.string().max(300).optional(),
  subtitle: z.string().max(500).optional(),
  markdown: z.string().max(LIMITS.textChars).optional(),
  html: z.string().max(LIMITS.textChars).optional(),
  content: z.string().max(LIMITS.textChars).optional(),
  data: z.unknown().optional(),
  sheets: z.array(SheetInput).min(1).max(LIMITS.sheets).optional(),
  slides: z.array(SlideInput).min(1).max(LIMITS.slides).optional(),
  chart: ChartInput.optional(),
  page_size: PageSizeInput.optional(),
  landscape: z.boolean().optional(),
  theme: z.enum(['modern', 'classic']).optional(),
  accent: Accent,
};
type MakeArgs = z.infer<z.ZodObject<typeof MAKE_INPUT>>;

const CONVERT_TO = [...MAKE_FORMATS.filter((f) => f !== 'svg')] as const;

// ── What a maker hands back ─────────────────────────────────────────────────

interface Made {
  bytes: Buffer;
  name: string;
  facts?: { pages?: number; sheets?: number; slides?: number };
  preview?: Buffer;
  /** The picture itself, for models that can see (a chart). */
  show?: boolean;
  warnings: string[];
}

interface Source {
  bytes: Buffer;
  name: string;
  mimeType: string;
  format: string;
}

export class FileError extends Error {}

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function stem(name: string): string {
  const ext = extension(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}

function sheetBlocks(sheets: readonly Sheet[]): Block[] {
  const cellRuns = (value: CellValue): Run[] => [
    {
      text:
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? `=${value.formula}`
            : String(value),
    },
  ];
  return sheets.flatMap((sheet): Block[] => {
    const [head = [], ...rest] = sheet.rows;
    const width = Math.max(1, ...sheet.rows.map((r) => r.length));
    const pad = (row: readonly CellValue[]) =>
      Array.from({ length: width }, (_, i) => cellRuns(row[i] ?? null));
    const table: Block =
      sheet.header === false
        ? {
            type: 'table',
            header: Array.from({ length: width }, () => []),
            rows: sheet.rows.map(pad),
            align: Array.from({ length: width }, () => null),
          }
        : {
            type: 'table',
            header: pad(head),
            rows: rest.map(pad),
            align: Array.from({ length: width }, (_, i) =>
              rest.length && rest.every((r) => typeof r[i] === 'number' || r[i] === null)
                ? 'right'
                : null,
            ),
          };
    return sheets.length > 1
      ? [{ type: 'heading', level: 2, runs: [{ text: sheet.name }] }, table]
      : [table];
  });
}

function slideBlocks(slides: readonly Slide[]): Block[] {
  return slides.flatMap((slide, i): Block[] => [
    ...(i ? [{ type: 'pagebreak' } as const] : []),
    {
      type: 'heading',
      level: slide.layout === 'content' || !slide.layout ? 2 : 1,
      runs: [{ text: slide.title }],
    },
    ...(slide.subtitle
      ? [{ type: 'paragraph' as const, runs: [{ text: slide.subtitle, italic: true }] }]
      : []),
    ...(slide.bullets?.length
      ? [
          {
            type: 'list' as const,
            ordered: false,
            start: 1,
            items: slide.bullets.map((b) => ({ runs: [{ text: b }], children: [] })),
          },
        ]
      : []),
    ...(slide.body ? fromMarkdown(slide.body) : []),
  ]);
}

/** Markdown split into slides: the first `#` is the title slide, each `##` (or `#`) a slide. */
export function markdownSlides(markdown: string, title?: string): Slide[] {
  const slides: Slide[] = [];
  let current: Slide | undefined;
  let body: string[] = [];
  const flush = () => {
    if (current) {
      const text = body.join('\n').trim();
      if (text) current.body = text;
      slides.push(current);
    }
    body = [];
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 2;
      current = {
        title: (heading[2] ?? '').slice(0, 300),
        layout: level === 1 ? (slides.length ? 'section' : 'title') : 'content',
      };
      continue;
    }
    if (!current) current = { title: title ?? 'Slides', layout: 'title' };
    body.push(line);
  }
  flush();
  // A title slide's text becomes its subtitle when it's short.
  for (const slide of slides)
    if (
      slide.layout !== 'content' &&
      slide.body &&
      slide.body.length <= 300 &&
      !slide.body.includes('\n')
    ) {
      slide.subtitle = slide.body;
      delete slide.body;
    }
  return slides.slice(0, LIMITS.slides);
}

function jsonRows(value: unknown): CellValue[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cell = (v: unknown): CellValue =>
    v === null || v === undefined
      ? null
      : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? v
        : JSON.stringify(v);
  if (value.every((row) => Array.isArray(row))) return value.map((row: unknown[]) => row.map(cell));
  if (value.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    const keys = [...new Set(value.flatMap((row) => Object.keys(row as object)))].slice(
      0,
      LIMITS.columns,
    );
    return [
      keys,
      ...value.map((row) => keys.map((k) => cell((row as Record<string, unknown>)[k]))),
    ];
  }
  return undefined;
}

function countCells(sheets: readonly Sheet[]): number {
  return sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.length, 0), 0);
}

// ── The service ─────────────────────────────────────────────────────────────

export class FileMaker {
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: {
      store: AttachmentStore;
      printer: Printer;
    },
  ) {}

  /** One file at a time per chat: later ones wait, saying so (`queued`). */
  async #serial<T>(ctx: ToolContext, progress: FileProgress, work: () => Promise<T>): Promise<T> {
    const before = this.#queues.get(ctx.conversationId);
    progress.queued(before ? 'Waiting for the file before it' : undefined);
    const run = (before ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        ctx.signal.throwIfAborted();
        return work();
      });
    const settled = run.catch(() => undefined);
    this.#queues.set(ctx.conversationId, settled);
    try {
      return await run;
    } finally {
      progress.stopEstimate();
      if (this.#queues.get(ctx.conversationId) === settled) this.#queues.delete(ctx.conversationId);
    }
  }

  #progress(ctx: ToolContext, toolName: string) {
    return new FileProgress({
      emit: (p: ToolProgress) => ctx.append({ type: 'tool.progress', ...p }),
      toolName,
    });
  }

  /** A file the model named: one of this chat's (`att_…`) or one in the work folder. */
  async #source(ctx: ToolContext, access: () => Promise<FileAccess>, ref: string): Promise<Source> {
    const trimmed = ref.trim();
    if (/^att_[A-Za-z0-9_-]+$/.test(trimmed)) {
      const found = await this.deps.store.inConversation(trimmed, ctx.conversationId);
      const bytes = found && (await this.deps.store.bytes(trimmed));
      if (!found || !bytes)
        throw new FileError(
          `There’s no file “${trimmed.slice(0, 60)}” in this chat. Use an id from list_attachments, or a path in the work folder.`,
        );
      return {
        bytes,
        name: found.attachment.name,
        mimeType: found.attachment.mimeType,
        format: formatOf(found.attachment.name, found.attachment.mimeType),
      };
    }
    const bytes = await fileBytes(await access(), trimmed, ctx.signal);
    const name = trimmed.split(/[\\/]/).at(-1) || 'file';
    const pdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    return { bytes, name, mimeType: pdf ? MIME.pdf : '', format: pdf ? 'pdf' : formatOf(name, '') };
  }

  /** The chat's pictures a document asks for, ready for each kind of file. */
  async #pictures(ctx: ToolContext, srcs: readonly string[]) {
    const html = new Map<string, string>();
    const office = new Map<string, Picture>();
    const warnings: string[] = [];
    for (const src of [...new Set(srcs)].slice(0, LIMITS.images)) {
      if (src.startsWith('data:')) continue;
      if (!/^att_[A-Za-z0-9_-]+$/.test(src)) {
        warnings.push(
          `The picture “${src.slice(0, 80)}” was left out: documents use only this chat’s pictures, by id (![alt](att_…)), never a web address.`,
        );
        continue;
      }
      const found = await this.deps.store.inConversation(src, ctx.conversationId);
      const bytes =
        found && found.attachment.kind === 'image' && (await this.deps.store.bytes(src));
      if (!found || !bytes || !IMAGE_MIME.has(found.attachment.mimeType)) {
        warnings.push(`The picture ${src} isn’t one of this chat’s pictures, so it was left out.`);
        continue;
      }
      html.set(src, `data:${found.attachment.mimeType};base64,${bytes.toString('base64')}`);
      if (
        found.attachment.mimeType !== 'image/webp' &&
        found.attachment.width &&
        found.attachment.height
      )
        office.set(src, {
          bytes,
          mimeType: found.attachment.mimeType as Picture['mimeType'],
          width: found.attachment.width,
          height: found.attachment.height,
        });
    }
    if (srcs.length > LIMITS.images)
      warnings.push(`Only the first ${LIMITS.images} pictures were placed.`);
    return { html, office, warnings };
  }

  /** A document as a PDF: printed by a browser, or by Conch's own writer without one. */
  async #pdf(
    progress: FileProgress,
    doc: readonly Block[] | undefined,
    html: string,
    options: PageOptions & { pictures: ReadonlyMap<string, Picture> },
    signal: AbortSignal,
  ): Promise<{ bytes: Buffer; pages?: number; preview?: Buffer; warnings: string[] }> {
    const by = this.deps.printer.by();
    if (by) {
      progress.by = by;
      progress.working('Laying out pages', 2500);
      const printed = await this.deps.printer
        .pdf(html, {
          size: options.size ?? 'A4',
          landscape: options.landscape ?? false,
          footer: options.title ?? (doc && firstHeading(doc)) ?? '',
          preview: 480,
          signal,
        })
        .catch((error: unknown) => {
          signal.throwIfAborted();
          if (error instanceof Error && /Timeout/i.test(error.message)) return undefined;
          return undefined;
        });
      if (printed) {
        progress.finishing('Counting pages');
        return {
          bytes: printed.pdf,
          pages: await pageCount(printed.pdf),
          ...(printed.preview && { preview: printed.preview }),
          warnings: [],
        };
      }
    }
    if (!doc)
      throw new FileError(
        'Printing HTML needs a browser, and none could start on this computer. Send the content as Markdown instead and Conch will lay it out itself, or open Settings → Browser to set one up.',
      );
    progress.by = 'Conch';
    progress.step(1, 3, 'Laying out pages');
    const lite = await makeLitePdf(doc, { ...options, pictures: options.pictures });
    return {
      bytes: lite.pdf,
      pages: lite.pages,
      warnings: [
        'Made with Conch’s built-in PDF writer (no browser was available), so the typography is plainer.',
        ...(lite.lossy
          ? [
              'Some characters outside Western European scripts were replaced: a browser is needed to draw them.',
            ]
          : []),
      ],
    };
  }

  /** A document from blocks, as `format`. */
  async #document(
    ctx: ToolContext,
    progress: FileProgress,
    format: MakeFormat,
    doc: Block[],
    options: PageOptions,
    name: string,
  ): Promise<Made> {
    const pictures = await this.#pictures(ctx, imagesIn(doc));
    const warnings = [...pictures.warnings];
    if (format === 'md') return { bytes: Buffer.from(toMarkdown(doc)), name, warnings };
    if (format === 'txt') return { bytes: Buffer.from(toText(doc)), name, warnings };
    const html = documentHtml(doc, { ...options, images: pictures.html });
    if (format === 'html') return { bytes: Buffer.from(html), name, warnings };
    if (format === 'docx') {
      progress.step(1, 2, 'Writing the document');
      if ([...pictures.html.keys()].some((src) => !pictures.office.has(src)))
        warnings.push('WebP pictures can’t go in a Word document; convert them to PNG first.');
      const bytes = makeDocx(doc, { ...options, pictures: pictures.office });
      const preview = await this.#previewOf(html, options, ctx.signal);
      return { bytes, name, warnings, ...(preview && { preview }) };
    }
    if (format === 'pdf') {
      const pdf = await this.#pdf(
        progress,
        doc,
        html,
        { ...options, pictures: pictures.office },
        ctx.signal,
      );
      return {
        bytes: pdf.bytes,
        name,
        ...(pdf.pages && { facts: { pages: pdf.pages } }),
        ...(pdf.preview && { preview: pdf.preview }),
        warnings: [...warnings, ...pdf.warnings],
      };
    }
    if (format === 'pptx') {
      const md = toMarkdown(doc);
      return this.#slides(ctx, progress, markdownSlides(md, options.title), options, name);
    }
    if (format === 'xlsx' || format === 'csv') {
      const tables = doc.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
      if (!tables.length)
        throw new FileError(
          'There’s no table in that to make a spreadsheet from. Send sheets (rows of cells) instead.',
        );
      const text = (runs: Run[]) => runs.map((r) => r.text).join('');
      const sheets = tables.map((t, i) => ({
        name: `Table ${i + 1}`,
        rows: [
          t.header.map(text),
          ...t.rows.map((r) => r.map((c) => typed(text(c)))),
        ] as CellValue[][],
      }));
      return this.#sheets(progress, format, sheets, options, name);
    }
    throw new FileError(`A document can’t be made as ${format.toUpperCase()}.`);
  }

  async #previewOf(html: string, options: PageOptions, signal: AbortSignal) {
    if (!this.deps.printer.by()) return undefined;
    const printed = await this.deps.printer
      .pdf(html, {
        size: options.size ?? 'A4',
        landscape: options.landscape ?? false,
        preview: 480,
        signal,
      })
      .catch(() => undefined);
    return printed?.preview;
  }

  async #sheets(
    progress: FileProgress,
    format: 'xlsx' | 'csv',
    sheets: Sheet[],
    options: { title?: string; accent?: string },
    name: string,
  ): Promise<Made> {
    if (countCells(sheets) > LIMITS.cells)
      throw new FileError(
        `That’s more than ${LIMITS.cells.toLocaleString('en-US')} cells. Split it into several files.`,
      );
    if (format === 'csv') {
      const [first] = sheets;
      return {
        bytes: makeCsv(first?.rows ?? []),
        name,
        warnings:
          sheets.length > 1
            ? [
                `CSV holds one table, so only “${first?.name}” is in it. Make an XLSX for every sheet.`,
              ]
            : [],
      };
    }
    progress.step(
      1,
      2,
      sheets.length > 1 ? `Writing ${sheets.length} sheets` : 'Writing the sheet',
    );
    return {
      bytes: makeXlsx(sheets, options),
      name,
      facts: { sheets: sheets.length },
      warnings: [],
    };
  }

  async #slides(
    ctx: ToolContext,
    progress: FileProgress,
    slides: Slide[],
    options: PageOptions,
    name: string,
  ): Promise<Made> {
    if (!slides.length) throw new FileError('There are no slides in that.');
    const pictures = await this.#pictures(
      ctx,
      slides.flatMap((s) => (s.image ? [s.image] : [])),
    );
    progress.step(1, 2, `Writing ${slides.length} slide${slides.length === 1 ? '' : 's'}`);
    const bytes = makePptx(slides, { ...options, pictures: pictures.office });
    let preview: Buffer | undefined;
    if (this.deps.printer.by() && slides[0]) {
      progress.working('Drawing a preview', 1200);
      preview = await this.deps.printer
        .picture(
          slideHtml(slides[0], 0, options.accent),
          { width: 1280, height: 720, scale: 0.375 },
          ctx.signal,
        )
        .catch(() => undefined);
    }
    return {
      bytes,
      name,
      facts: { slides: slides.length },
      ...(preview && { preview }),
      warnings: pictures.warnings,
    };
  }

  async #chart(
    ctx: ToolContext,
    progress: FileProgress,
    format: 'svg' | 'png',
    chart: Chart,
    name: string,
  ): Promise<Made> {
    const svg = chartSvg(chart);
    const warnings = chart.series.some((s) => s.values.length !== chart.labels.length)
      ? [
          'Some series have a different number of values than there are labels; the missing ones are left blank.',
        ]
      : [];
    if (format === 'svg') return { bytes: Buffer.from(svg), name, warnings };
    if (!this.deps.printer.by())
      throw new FileError(
        'A PNG chart needs a browser to draw it, and none is set up. Make it as SVG (format: "svg"), which every browser and most apps open, or open Settings → Browser to set one up. If this was so you could send a picture of a chart to one of their chat apps: a chart card in the chat has its own Send button, which makes the picture in their browser and needs no browser here — tell them to use it.',
      );
    progress.by = this.deps.printer.by() ?? 'Conch';
    progress.working('Drawing the chart', 1500);
    const png = await this.deps.printer.picture(
      chartPage(svg),
      { ...CHART_SIZE, scale: 2 },
      ctx.signal,
    );
    if (!png) throw new FileError('The chart couldn’t be drawn. Try format "svg" instead.');
    return { bytes: png, name, show: true, warnings };
  }

  /** Kept with the chat (its preview too), with the card and the words for the model. */
  async #keep(
    ctx: ToolContext,
    made: Made,
    extra: Record<string, unknown> = {},
  ): Promise<HostToolResult> {
    if (made.bytes.length > LIMITS.outputBytes)
      throw new FileError(
        `The file came to ${Math.round(made.bytes.length / 1024 / 1024)} MB, over the ${LIMITS.outputBytes / 1024 / 1024} MB Conch keeps. Split it into smaller files.`,
      );
    ctx.signal.throwIfAborted();
    const store = this.deps.store;
    let preview: Attachment | undefined;
    if (made.preview)
      preview = await store
        .save({ name: `${stem(made.name)} preview.png`, bytes: made.preview })
        .catch(() => undefined);
    const attachment = await store.save({
      name: made.name,
      bytes: made.bytes,
      facts: { ...made.facts, ...(preview && { preview: preview.id }) },
    });
    try {
      await store.claim([attachment.id, ...(preview ? [preview.id] : [])], ctx.conversationId);
    } catch (error) {
      await store.discard(attachment.id);
      if (preview) await store.discard(preview.id);
      throw error;
    }
    return {
      text: JSON.stringify({
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mimeType,
        size: attachment.size,
        ...made.facts,
        ...(preview && { preview: preview.id }),
        ...extra,
        ...(made.warnings.length && { warnings: made.warnings }),
        message: SEND_WORDS,
      }),
      view: { kind: 'downloads', items: [attachment] },
      ...(made.show &&
        IMAGE_MIME.has(attachment.mimeType) && {
          images: [
            { mimeType: attachment.mimeType as 'image/png', data: made.bytes.toString('base64') },
          ],
        }),
    };
  }

  #fail(error: unknown): never {
    if (error instanceof WorkerFailed)
      throw new FileError(
        error.reason === 'timeout'
          ? 'That took too long. Try fewer or smaller files.'
          : 'That file is too large or too complex to handle here. Try a smaller one.',
      );
    throw error;
  }

  async #worker<T>(
    op: Record<string, unknown>,
    signal: AbortSignal,
    shape: z.ZodType<T>,
    timeoutMs = 60_000,
  ): Promise<T> {
    const output = await runWorker({
      worker: './convert-worker.mjs',
      modules: ['fflate', 'fast-xml-parser', 'pdf-lib'],
      input: JSON.stringify(op),
      signal,
      timeoutMs,
      maxOutput: 90 * 1024 * 1024,
      heapMb: 512,
    }).catch((error: unknown) => this.#fail(error));
    const value = z
      .object({ result: shape.optional(), error: z.string().optional() })
      .parse(JSON.parse(output));
    if (value.result === undefined)
      throw new FileError(value.error ?? 'That file could not be read.');
    return value.result;
  }

  // ── The tools ─────────────────────────────────────────────────────────────

  tools(ctx: ToolContext, access: () => Promise<FileAccess>): HostTool[] {
    return [
      {
        name: 'file_make',
        row: true,
        searchHint:
          'make create generate pdf word docx excel xlsx spreadsheet csv powerpoint pptx slides deck chart graph svg png html markdown json report document',
        description:
          'Make a finished file for the person, in this chat: PDF, Word (docx), Excel (xlsx), CSV, PowerPoint (pptx), Markdown, plain text, HTML, JSON, or a chart (svg or png). Works with any model; nothing to install. ' +
          'Documents (pdf, docx, html, md, txt): send `markdown` (GitHub style: headings, lists, tables, code, quotes, links, `<!-- pagebreak -->`) plus an optional `title`/`subtitle`; pictures from this chat go in as ![alt](att_…). PDF is laid out with print typography and page numbers; for full control of a PDF or HTML page send `html` instead (it is printed sealed: no scripts, nothing loaded from the web). ' +
          'Spreadsheets (xlsx, csv): send `sheets`: [{name, rows: [[cells…]…], formats?}] with numbers as numbers, dates as "YYYY-MM-DD", formulas as {"formula": "SUM(B2:B9)"}; the first row is a frozen, filterable header. ' +
          'Slides (pptx): send `slides`: [{title, bullets?, body? (Markdown), image? (att_…), layout?: title|section|content}], or `markdown` where each ## starts a slide. ' +
          'Charts (svg, png): send `chart`: {type: bar|line|area|pie, labels, series: [{name, values}], title?, unit?}. JSON: `data` (any value) or `content`. Raw text for txt/md/html/csv/svg: `content`. ' +
          'Returns {id, name, mime, size, pages?, sheets?, slides?, preview?} and shows a preview and Download card. To send it to a chat app, use message_user with attachments: [id]. Max 30 MB.',
        input: MAKE_INPUT,
        run: async (raw) => {
          const args = raw as MakeArgs;
          const progress = this.#progress(ctx, 'file_make');
          const name = fileName(args.name, args.format);
          return this.#serial(ctx, progress, async () => {
            progress.step(0, 3, `Making ${name}`.slice(0, 80));
            const made = await this.#make(ctx, progress, args, name);
            progress.finishing();
            return this.#keep(ctx, made);
          }).catch((error: unknown) => this.#fail(error));
        },
      },
      {
        name: 'file_convert',
        row: true,
        searchHint: 'convert export save as pdf docx word excel xlsx csv markdown text json html',
        description:
          'Convert a file from this chat (its id, att_…) or the work folder (a path) into another format, as a new file in this chat. ' +
          'Handles: Markdown, text or HTML → pdf, docx, html, md, txt (and Markdown → pptx: each ## a slide); Word (docx) → pdf, html, md, txt; PDF → txt, md, docx (text only; layout and pictures are not kept); ' +
          'Excel (xlsx) → csv (one sheet: `sheet`), json, md, pdf, html, xlsx; CSV or JSON rows → xlsx, csv, json, md, pdf, html; PowerPoint → txt, md; PNG or JPEG pictures → pdf; SVG → png. ' +
          'Returns the new file’s id and a preview and Download card. To read a file’s text yourself, use read_document instead.',
        input: {
          source: z.string().min(1).max(4096),
          to: z.enum(CONVERT_TO),
          name: z.string().min(1).max(200).optional(),
          sheet: z.string().max(100).optional(),
          title: z.string().max(300).optional(),
          page_size: PageSizeInput.optional(),
          landscape: z.boolean().optional(),
          theme: z.enum(['modern', 'classic']).optional(),
        },
        aliases: { source: ['file_path', 'id', 'file', 'path'] },
        run: async (args) => {
          const progress = this.#progress(ctx, 'file_convert');
          return this.#serial(ctx, progress, async () => {
            progress.step(0, 3, 'Reading the file');
            const source = await this.#source(ctx, access, String(args.source));
            const to = args.to as MakeFormat;
            const name = fileName(args.name ? String(args.name) : stem(source.name), to);
            const made = await this.#convert(ctx, progress, source, to, name, {
              ...(typeof args.sheet === 'string' && { sheet: args.sheet }),
              ...(typeof args.title === 'string' && { title: args.title }),
              size: (args.page_size as PageSize | undefined) ?? 'A4',
              landscape: args.landscape === true,
              ...(typeof args.theme === 'string' && { theme: args.theme as Theme }),
            });
            progress.finishing();
            return this.#keep(ctx, made, { from: source.name });
          }).catch((error: unknown) => this.#fail(error));
        },
      },
      {
        name: 'file_combine',
        row: true,
        searchHint: 'merge combine join pdfs zip archive bundle compress',
        description:
          'Combine several files from this chat (ids, att_…) or the work folder (paths) into one new file: `to: "pdf"` merges PDFs (and PNG or JPEG pictures, one to a page) in the order given; `to: "zip"` packs any files into a ZIP. Up to 20 files. Returns the new file’s id with a preview and Download card.',
        input: {
          sources: z.array(z.string().min(1).max(4096)).min(1).max(LIMITS.files),
          to: z.enum(['pdf', 'zip']),
          name: z.string().min(1).max(200),
          page_size: z.enum(['A4', 'Letter']).optional(),
        },
        aliases: { sources: ['files', 'ids', 'file_paths'] },
        run: async (args) => {
          const progress = this.#progress(ctx, 'file_combine');
          const refs = (args.sources as string[]).map(String);
          return this.#serial(ctx, progress, async () => {
            const sources: Source[] = [];
            let total = 0;
            for (const [i, ref] of refs.entries()) {
              progress.step(i, refs.length * 2, `Reading ${i + 1} of ${refs.length}`);
              const source = await this.#source(ctx, access, ref);
              total += source.bytes.length;
              if (total > LIMITS.sourceBytes)
                throw new FileError(
                  `Those files come to more than ${LIMITS.sourceBytes / 1024 / 1024} MB together. Combine fewer at a time.`,
                );
              sources.push(source);
            }
            const to = args.to === 'pdf' ? 'pdf' : 'zip';
            const name = fileName(String(args.name), to);
            let made: Made;
            if (to === 'zip') {
              progress.step(refs.length, refs.length * 2, 'Packing');
              const used = new Set<string>();
              const parts = sources.map((s) => {
                let entry = s.name;
                for (let n = 2; used.has(entry.toLowerCase()); n++)
                  entry = `${stem(s.name)} (${n})${extension(s.name) ? `.${extension(s.name)}` : ''}`;
                used.add(entry.toLowerCase());
                return { path: entry, data: new Uint8Array(s.bytes) };
              });
              made = { bytes: pack(parts), name, warnings: [] };
            } else {
              const wrong = sources.filter((s) => !['pdf', 'png', 'jpg'].includes(kindOf(s)));
              if (wrong.length)
                throw new FileError(
                  `Only PDFs and PNG or JPEG pictures merge into a PDF; ${wrong.map((s) => s.name).join(', ')} ${wrong.length === 1 ? 'isn’t' : 'aren’t'}. Convert ${wrong.length === 1 ? 'it' : 'them'} to PDF first with file_convert.`,
                );
              progress.working(`Merging ${sources.length} files`, 1500 + total / 20_000);
              const merged = await this.#worker(
                {
                  op: 'merge',
                  size: args.page_size ?? 'A4',
                  sources: sources.map((s) => ({
                    type: kindOf(s) === 'jpg' ? 'jpeg' : kindOf(s),
                    data: s.bytes.toString('base64'),
                  })),
                },
                ctx.signal,
                z.object({ data: z.string(), pages: z.number().int().positive() }),
              );
              made = {
                bytes: Buffer.from(merged.data, 'base64'),
                name,
                facts: { pages: merged.pages },
                warnings: [],
              };
            }
            progress.finishing();
            return this.#keep(ctx, made, { files: sources.length });
          }).catch((error: unknown) => this.#fail(error));
        },
      },
      {
        name: 'file_unzip',
        row: true,
        searchHint: 'unzip extract unpack open zip archive',
        description:
          'Unpack a ZIP from this chat (its id, att_…) or the work folder into separate files of this chat (at most 50, 30 MB each), so they can be read (read_document, read_file), converted or sent. Returns each file’s id, name and path inside the archive. Nothing is run.',
        input: { source: z.string().min(1).max(4096) },
        aliases: { source: ['file_path', 'id', 'file', 'path'] },
        run: async (args) => {
          const progress = this.#progress(ctx, 'file_unzip');
          return this.#serial(ctx, progress, async () => {
            progress.step(0, 3, 'Reading the archive');
            const source = await this.#source(ctx, access, String(args.source));
            if (source.bytes.readUInt32LE(0) !== 0x04034b50)
              throw new FileError(`${source.name} isn’t a ZIP archive.`);
            progress.working('Unpacking', 1500);
            const out = await this.#worker(
              {
                op: 'unzip',
                data: source.bytes.toString('base64'),
                limit: LIMITS.unzipEntries,
                maxEach: LIMITS.outputBytes,
              },
              ctx.signal,
              z.object({
                files: z.array(z.object({ path: z.string(), data: z.string() })),
                more: z.number().int(),
                skipped: z.array(z.string()),
              }),
            );
            const saved: Attachment[] = [];
            const listing: {
              id: string;
              name: string;
              path: string;
              mime: string;
              size: number;
            }[] = [];
            const used = new Set<string>();
            for (const [i, file] of out.files.entries()) {
              progress.step(i, out.files.length, `Keeping ${i + 1} of ${out.files.length}`);
              let entry = file.path.split('/').at(-1) || 'file';
              for (let n = 2; used.has(entry.toLowerCase()); n++)
                entry = `${stem(file.path.split('/').at(-1) || 'file')} (${n})${extension(entry) ? `.${extension(entry)}` : ''}`;
              used.add(entry.toLowerCase());
              const attachment = await this.deps.store.save({
                name: entry,
                bytes: Buffer.from(file.data, 'base64'),
              });
              saved.push(attachment);
              listing.push({
                id: attachment.id,
                name: attachment.name,
                path: file.path.slice(0, 300),
                mime: attachment.mimeType,
                size: attachment.size,
              });
            }
            if (saved.length)
              await this.deps.store.claim(
                saved.map((a) => a.id),
                ctx.conversationId,
              );
            progress.finishing();
            return {
              text: JSON.stringify({
                files: listing,
                more: out.more,
                ...(out.skipped.length && { skipped: out.skipped.slice(0, 20) }),
                message: saved.length
                  ? `Unpacked ${saved.length} file${saved.length === 1 ? '' : 's'}${out.more ? `; ${out.more} more were left in the archive` : ''}. Read them with read_document or read_file (by id), convert them with file_convert, or send them with message_user by id.`
                  : 'There were no files to unpack in that archive.',
              }),
              ...(saved.length && {
                view: { kind: 'downloads' as const, items: saved.slice(0, 10) },
              }),
            };
          }).catch((error: unknown) => this.#fail(error));
        },
      },
    ];
  }

  async #make(
    ctx: ToolContext,
    progress: FileProgress,
    args: MakeArgs,
    name: string,
  ): Promise<Made> {
    const options: PageOptions = {
      ...(args.title && { title: args.title }),
      ...(args.subtitle && { subtitle: args.subtitle }),
      size: args.page_size ?? 'A4',
      landscape: args.landscape ?? false,
      ...(args.theme && { theme: args.theme }),
      ...(args.accent && { accent: args.accent }),
    };
    const format = args.format;
    switch (format) {
      case 'xlsx':
      case 'csv': {
        const sheets: Sheet[] | undefined =
          (args.sheets as Sheet[] | undefined) ??
          (args.data !== undefined && jsonRows(args.data)
            ? [{ name: 'Sheet 1', rows: jsonRows(args.data) ?? [] }]
            : undefined) ??
          (args.content !== undefined && format === 'csv'
            ? [
                {
                  name: 'Sheet 1',
                  rows: parseCsv(args.content, LIMITS.cells).map((r) => r.map(typed)),
                },
              ]
            : undefined);
        if (sheets) return this.#sheets(progress, format, sheets, options, name);
        if (args.markdown)
          return this.#document(ctx, progress, format, fromMarkdown(args.markdown), options, name);
        throw new FileError(
          'A spreadsheet needs `sheets`: [{name, rows: [[…], …]}] (or `data`: an array of rows or objects).',
        );
      }
      case 'pptx': {
        if (args.slides) return this.#slides(ctx, progress, args.slides as Slide[], options, name);
        if (args.markdown)
          return this.#slides(
            ctx,
            progress,
            markdownSlides(args.markdown, args.title),
            options,
            name,
          );
        throw new FileError(
          'A presentation needs `slides`: [{title, bullets}] (or `markdown` where each ## is a slide).',
        );
      }
      case 'svg':
      case 'png': {
        if (args.chart) return this.#chart(ctx, progress, format, args.chart as Chart, name);
        if (format === 'svg' && args.content) {
          if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(args.content))
            throw new FileError('That isn’t an SVG: it should start with <svg.');
          return { bytes: Buffer.from(sealSvg(args.content)), name, warnings: [] };
        }
        throw new FileError(
          format === 'png'
            ? 'A PNG here is a chart: send `chart`. For a picture or an illustration, use image_generate.'
            : 'An SVG needs `chart` (a chart Conch draws) or `content` (SVG markup).',
        );
      }
      case 'json': {
        let value: unknown = args.data;
        if (value === undefined && args.content !== undefined) {
          try {
            value = JSON.parse(args.content);
          } catch (error) {
            throw new FileError(`That isn’t valid JSON: ${(error as Error).message.slice(0, 200)}`);
          }
        }
        if (value === undefined)
          throw new FileError('JSON needs `data` (any value) or `content` (JSON text).');
        return { bytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`), name, warnings: [] };
      }
      case 'html':
        if (args.html) return { bytes: Buffer.from(sealHtml(args.html)), name, warnings: [] };
        if (args.content && !args.markdown)
          return { bytes: Buffer.from(sealHtml(args.content)), name, warnings: [] };
        break;
      case 'pdf':
        if (args.html) {
          const pdf = await this.#pdf(
            progress,
            undefined,
            sealHtml(args.html),
            { ...options, pictures: new Map() },
            ctx.signal,
          );
          return {
            bytes: pdf.bytes,
            name,
            ...(pdf.pages && { facts: { pages: pdf.pages } }),
            ...(pdf.preview && { preview: pdf.preview }),
            warnings: pdf.warnings,
          };
        }
        break;
      case 'md':
      case 'txt':
        if (args.content !== undefined && args.markdown === undefined)
          return {
            bytes: Buffer.from(args.content.endsWith('\n') ? args.content : `${args.content}\n`),
            name,
            warnings: [],
          };
        break;
    }
    // Documents: from Markdown, or from whatever structured content came.
    const doc =
      args.markdown !== undefined
        ? fromMarkdown(args.markdown)
        : args.content !== undefined
          ? fromText(args.content)
          : args.sheets
            ? sheetBlocks(args.sheets as Sheet[])
            : args.slides
              ? slideBlocks(args.slides as Slide[])
              : args.chart
                ? fromMarkdown(chartTable(args.chart as Chart))
                : undefined;
    if (!doc?.length && !args.title)
      throw new FileError(
        'There’s nothing to put in it: send `markdown` (or `html` for a PDF or web page).',
      );
    return this.#document(ctx, progress, format, doc ?? [], options, name);
  }

  async #convert(
    ctx: ToolContext,
    progress: FileProgress,
    source: Source,
    to: MakeFormat,
    name: string,
    options: PageOptions & { sheet?: string },
  ): Promise<Made> {
    const from = kindOf(source);
    const text = () => {
      const decoded = decodeText(source.bytes);
      if (decoded === undefined) throw new FileError(`${source.name} isn’t text.`);
      return decoded;
    };
    const docOpts = { ...options, title: options.title };
    switch (from) {
      case 'md':
        return this.#document(ctx, progress, to, fromMarkdown(text()), docOpts, name);
      case 'txt':
        return this.#document(ctx, progress, to, fromText(text()), docOpts, name);
      case 'html': {
        if (to === 'pdf') {
          const pdf = await this.#pdf(
            progress,
            undefined,
            sealHtml(text()),
            { ...options, pictures: new Map() },
            ctx.signal,
          ).catch(async (error: unknown) => {
            // Without a browser, the page's words still make a PDF.
            if (!(error instanceof FileError)) throw error;
            return this.#pdf(
              progress,
              fromText(htmlText(text())),
              '',
              { ...options, pictures: new Map() },
              ctx.signal,
            );
          });
          return {
            bytes: pdf.bytes,
            name,
            ...(pdf.pages && { facts: { pages: pdf.pages } }),
            ...(pdf.preview && { preview: pdf.preview }),
            warnings: pdf.warnings,
          };
        }
        if (to === 'html') return { bytes: Buffer.from(sealHtml(text())), name, warnings: [] };
        return this.#document(ctx, progress, to, fromText(htmlText(text())), docOpts, name);
      }
      case 'docx': {
        progress.working('Reading the document', 1500);
        const out = await this.#worker(
          { op: 'docx', data: source.bytes.toString('base64') },
          ctx.signal,
          z.object({ blocks: z.array(z.unknown()) }),
        );
        const made = await this.#document(ctx, progress, to, out.blocks as Block[], docOpts, name);
        made.warnings.push(
          'Pictures, headers, footers and exact layout from the Word file are not carried over.',
        );
        return made;
      }
      case 'pdf': {
        if (!['txt', 'md', 'docx', 'html'].includes(to))
          throw new FileError(
            `A PDF converts to txt, md, docx or html (its text). For a PDF of other files, use file_combine.`,
          );
        const blocks: Block[] = [];
        const warnings: string[] = [];
        let offset = 0;
        let chars = 0;
        for (;;) {
          const part = await extractDocument(source.bytes, source.name, offset, 20, ctx.signal);
          for (const section of part.sections) {
            if (blocks.length) blocks.push({ type: 'pagebreak' });
            blocks.push(...fromText(section.text));
            chars += section.text.length;
          }
          warnings.push(...part.warnings.slice(0, 5));
          progress.step(
            Math.min(part.totalSections, offset + part.sections.length),
            part.totalSections || 1,
            `Page ${Math.min(part.totalSections, offset + part.sections.length)} of ${part.totalSections}`,
          );
          if (part.nextOffset === null || chars > LIMITS.textChars) break;
          offset = part.nextOffset;
        }
        if (!chars)
          throw new FileError(
            'That PDF has no text to take out: it may be scanned pictures. Look at it with an image-capable model instead.',
          );
        const made = await this.#document(ctx, progress, to, blocks, docOpts, name);
        made.warnings.push(
          'Only the text was taken from the PDF: its layout, tables and pictures are not kept.',
          ...warnings.slice(0, 3),
        );
        return made;
      }
      case 'pptx': {
        if (!['txt', 'md'].includes(to))
          throw new FileError('A presentation converts to txt or md (its text).');
        const part = await extractDocument(source.bytes, source.name, 0, 20, ctx.signal);
        const blocks = part.sections.flatMap((s): Block[] => [
          { type: 'heading', level: 2, runs: [{ text: s.label }] },
          ...fromText(s.text),
        ]);
        return this.#document(ctx, progress, to, blocks, docOpts, name);
      }
      case 'xlsx':
      case 'csv':
      case 'json': {
        let sheets: Sheet[];
        if (from === 'xlsx') {
          progress.working('Reading the workbook', 1500);
          const book = await this.#worker(
            { op: 'xlsx', data: source.bytes.toString('base64') },
            ctx.signal,
            z.object({
              sheets: z.array(
                z.object({
                  name: z.string(),
                  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
                }),
              ),
            }),
          );
          sheets = book.sheets;
          if (options.sheet) {
            const wanted = sheets.filter(
              (s) => s.name.toLowerCase() === options.sheet?.toLowerCase(),
            );
            if (!wanted.length)
              throw new FileError(
                `There’s no sheet “${options.sheet}”. Its sheets are: ${sheets.map((s) => s.name).join(', ')}.`,
              );
            sheets = wanted;
          }
        } else if (from === 'csv') {
          sheets = [
            {
              name: stem(source.name).slice(0, 31) || 'Sheet 1',
              rows: parseCsv(text(), LIMITS.cells).map((r) => r.map(typed)),
            },
          ];
        } else {
          let value: unknown;
          try {
            value = JSON.parse(text());
          } catch {
            throw new FileError(`${source.name} isn’t valid JSON.`);
          }
          const rows = jsonRows(value);
          if (!rows)
            throw new FileError(
              'Only JSON that is a list (of rows, or of objects) converts to a table.',
            );
          sheets = [{ name: 'Sheet 1', rows }];
        }
        if (to === 'xlsx' || to === 'csv') {
          const made = await this.#sheets(progress, to, sheets, options, name);
          if (from === 'xlsx')
            made.warnings.push(
              'Values are the ones last saved in the workbook; formulas, formatting and charts are not carried over.',
            );
          return made;
        }
        if (to === 'json') {
          const [first] = sheets;
          const [head = [], ...rest] = first?.rows ?? [];
          const keys = head.map((h, i) => (h === null || h === '' ? `column ${i + 1}` : String(h)));
          const objects = rest.map((row) =>
            Object.fromEntries(keys.map((k, i) => [k, row[i] ?? null])),
          );
          return {
            bytes: Buffer.from(`${JSON.stringify(objects, null, 2)}\n`),
            name,
            warnings:
              sheets.length > 1
                ? [`Only the first sheet, “${first?.name}”, is in it. Pick another with \`sheet\`.`]
                : [],
          };
        }
        if (countCells(sheets) > 50_000)
          throw new FileError(
            'That table is too big for a document. Convert it to xlsx or csv, or pick one sheet with `sheet`.',
          );
        return this.#document(
          ctx,
          progress,
          to,
          sheetBlocks(sheets),
          {
            ...docOpts,
            landscape:
              options.landscape || Math.max(...sheets.map((s) => s.rows[0]?.length ?? 0)) > 6,
          },
          name,
        );
      }
      case 'png':
      case 'jpg': {
        if (to !== 'pdf')
          throw new FileError(
            'A picture converts to pdf here. To change a picture, use image_generate with it as the source.',
          );
        progress.working('Placing the picture', 800);
        const merged = await this.#worker(
          {
            op: 'merge',
            size: options.size === 'Letter' ? 'Letter' : 'A4',
            sources: [
              { type: from === 'jpg' ? 'jpeg' : 'png', data: source.bytes.toString('base64') },
            ],
          },
          ctx.signal,
          z.object({ data: z.string(), pages: z.number().int().positive() }),
        );
        return {
          bytes: Buffer.from(merged.data, 'base64'),
          name,
          facts: { pages: merged.pages },
          warnings: [],
        };
      }
      case 'svg': {
        if (to !== 'png') throw new FileError('An SVG converts to png here.');
        const svg = sealSvg(text());
        const size = svgSize(svg);
        const png = this.deps.printer.by()
          ? await this.deps.printer.picture(chartPage(svg), { ...size, scale: 2 }, ctx.signal)
          : undefined;
        if (!png)
          throw new FileError(
            'Drawing an SVG as PNG needs a browser, and none is set up. Open Settings → Browser.',
          );
        return { bytes: png, name, show: true, warnings: [] };
      }
    }
    throw new FileError(
      `Conch can’t convert ${source.name} (${from || 'unknown type'}) to ${to.toUpperCase()}. It converts Markdown, text, HTML, Word, PDF (text), Excel, CSV, JSON, PowerPoint (text), PNG/JPEG pictures and SVG.`,
    );
  }
}

/** What a file really is, for converting: the bytes first, then the name. */
function kindOf(source: Source): string {
  const b = source.bytes;
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const ext = source.format || formatOf(source.name, source.mimeType);
  if (b.length > 4 && b.readUInt32LE(0) === 0x04034b50)
    return ['docx', 'xlsx', 'pptx'].includes(ext) ? ext : 'zip';
  if (ext === 'markdown') return 'md';
  if (['md', 'txt', 'html', 'csv', 'json', 'svg'].includes(ext)) return ext;
  if (ext === 'tsv') return 'csv';
  if (decodeText(b) !== undefined)
    return /^\s*<svg\b/i.test(b.subarray(0, 200).toString('utf8')) ? 'svg' : 'txt';
  return ext;
}

function htmlText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
}

/** An SVG without anything that could run or reach out when it's opened. */
export function sealSvg(svg: string): string {
  return svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/((?:xlink:)?href)\s*=\s*(["'])(?!#|data:image\/)[^"']*\2/gi, '$1="#"');
}

function svgSize(svg: string): { width: number; height: number } {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const num = (name: string) =>
    Number(new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(open)?.[1]);
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(open);
  const width = num('width') || Number(box?.[1]) || 800;
  const height = num('height') || Number(box?.[2]) || 600;
  const scale = Math.min(1, 2000 / width, 2000 / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
