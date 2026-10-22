import { readFile } from 'node:fs/promises';

import {
  AttachmentView,
  type Attachment,
  type AttachmentViewBlock,
  type AttachmentViewPart,
} from '@conch/protocol';

import { READERS, type Reader, type ReaderDeps, type ReaderResult } from './readers';
import type { AttachmentStore } from './store';

/**
 * What a person sees when they open an attachment the browser can't show by
 * itself (ADR 0017 § "Previews for every kind"). The same readers that give
 * models the file give the preview its words, so every kind a model can read,
 * a person can look at too. A reader may say how to draw it (`ReaderResult.view`:
 * sheets, an archive's tree, an email's headers); otherwise the preview is made
 * from its text, by the shapes the readers write (`[Sheet: Q3]`, `[0:05] …`,
 * `Title: …`). It is plain data, never HTML: the browser draws every part.
 */

/** Most characters a reader may give a preview: generous, since nothing goes to a model. */
export const VIEW_ROOM = 400_000;
/** Longest a preview waits for a reader. A recording still being heard comes back with what's done. */
const VIEW_TIMEOUT_MS = 20_000;
/** Previews kept in memory, most recent last. Attachments never change, so a view stays true. */
const KEPT = 64;
/** A view that isn't whole yet (a recording still being heard) is made again after this. */
const UNFINISHED_MS = 30_000;
/** Readers run for previews at once; the rest wait their turn. */
const AT_ONCE = 2;

const TABLE_ROWS = 1000;
const TABLE_COLUMNS = 200;

interface Found {
  attachment: Attachment;
  path: string;
}

/** The first sentence of a reader's note, when it's about the file and not words for a model. */
export function summaryOf(note: string): string | undefined {
  const plain = note
    .trim()
    .replace(/^\((.*)\)$/s, '$1')
    .trim();
  const first = /^(.+?[.!?])(?=\s|$)/s.exec(plain)?.[1] ?? plain;
  if (!first || /read_document|read_file|\bsay so\b|\byou\b|\bthe message\b/i.test(first))
    return undefined;
  return first.slice(0, 600);
}

const STAMP = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s+(.+)$/;
const FACT = /^([A-Z][\w ’'/()-]{0,40}):\s+(.+)$/;
const CELL = /^([A-Z]{1,3})(\d{1,7}): ?(.*)$/;
const SIZE = /\s+[([]?\s*([\d.,]+\s?(?:B|KB|MB|GB|bytes))\s*[)\]]?$/i;
const EMAIL_HEADERS = /^(From|To|Cc|Bcc|Date|Subject|Reply-To|Sent):\s*(.*)$/i;

function seconds(stamp: string): number {
  return stamp.split(':').reduce((total, n) => total * 60 + Number(n), 0);
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A sheet as Conch's document reader writes it: `A1: Name | B1: Team`, a line per row. */
function cellTable(lines: string[], title: string | undefined): AttachmentViewPart | undefined {
  const grid = new Map<number, Map<number, string>>();
  let width = 0;
  for (const line of lines) {
    for (const cell of line.split(' | ')) {
      const m = CELL.exec(cell);
      if (!m) return undefined;
      const col = columnIndex(m[1] ?? 'A');
      const row = Number(m[2]);
      if (col >= TABLE_COLUMNS) continue;
      const value = (m[3] ?? '').replace(/ \[formula: [^\]]*; cached value\]$/, '');
      const cells = grid.get(row) ?? new Map<number, string>();
      cells.set(col, value);
      grid.set(row, cells);
      width = Math.max(width, col + 1);
    }
  }
  if (!grid.size) return undefined;
  const numbers = [...grid.keys()].sort((a, b) => a - b);
  const last = numbers.at(-1) ?? 0;
  const rows: string[][] = [];
  for (let r = 1; r <= last && rows.length < TABLE_ROWS; r++) {
    const cells = grid.get(r);
    rows.push(Array.from({ length: width }, (_, c) => cells?.get(c) ?? ''));
  }
  return {
    kind: 'table',
    ...(title && { title }),
    columns: Array.from({ length: width }, (_, c) => columnName(c)),
    rows,
    total: last,
  };
}

/** Lines split the same way (tabs, or `a | b | c`), with a header first. */
function delimitedTable(
  lines: string[],
  title: string | undefined,
): AttachmentViewPart | undefined {
  if (lines.length < 2) return undefined;
  const split = (line: string) =>
    line.includes('\t')
      ? line.split('\t')
      : line
          .replace(/^\|\s*/, '')
          .replace(/\s*\|$/, '')
          .split(/\s+\|\s+/);
  const rows = lines.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l)).map(split);
  const width = rows[0]?.length ?? 0;
  if (width < 2 || rows.filter((r) => r.length === width).length < rows.length * 0.8)
    return undefined;
  const [head = [], ...body] = rows;
  return {
    kind: 'table',
    ...(title && { title }),
    columns: head.slice(0, TABLE_COLUMNS).map((c) => c.trim()),
    rows: body.slice(0, TABLE_ROWS).map((r) => r.slice(0, TABLE_COLUMNS).map((c) => c.trim())),
    total: body.length,
  };
}

/** A list of paths, as an archive's contents: `docs/a.txt (12 KB)`, `photos/`. */
function treeOf(lines: string[], title: string | undefined): AttachmentViewPart | undefined {
  if (lines.length < 2) return undefined;
  const entries: { path: string; size?: number; folder?: boolean }[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    const sized = SIZE.exec(line);
    const path = (sized ? line.slice(0, sized.index) : line).trim();
    if (!path || path.length > 2048 || /\s{2,}|[.:;,]$/.test(path)) return undefined;
    const looksLikePath = path.endsWith('/') || path.includes('/') || /\.\w{1,8}$/.test(path);
    if (!looksLikePath || (path.split(' ').length > 6 && !path.includes('/'))) return undefined;
    entries.push({
      path,
      ...(path.endsWith('/') && { folder: true }),
      ...(sized?.[1] && { size: bytesOf(sized[1]) }),
    });
  }
  return { kind: 'tree', ...(title && { title }), entries, total: entries.length };
}

function bytesOf(text: string): number {
  const m = /^([\d.,]+)\s?(B|KB|MB|GB|bytes)$/i.exec(text.trim());
  if (!m) return 0;
  const n = Number((m[1] ?? '0').replace(/,/g, ''));
  const unit = (m[2] ?? 'B').toUpperCase();
  const scale = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : unit === 'GB' ? 1024 ** 3 : 1;
  return Math.round(n * scale);
}

/** An email as text: its headers, a blank line, its words. */
function emailOf(lines: string[], title: string | undefined): AttachmentViewPart | undefined {
  const headers: { name: string; value: string }[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) break;
    const m = EMAIL_HEADERS.exec(line) ?? /^(Attachments?|Attached):\s*(.*)$/i.exec(line);
    if (!m) break;
    headers.push({ name: m[1] ?? '', value: (m[2] ?? '').trim() });
  }
  const known = headers.filter((h) => EMAIL_HEADERS.test(`${h.name}: x`));
  if (known.length < 2 || !headers.some((h) => /^(from|subject)$/i.test(h.name))) return undefined;
  const listed = headers.find((h) => /^attach/i.test(h.name));
  const attachments = listed
    ? listed.value
        .split(/,\s*/)
        .filter(Boolean)
        .map((name) => {
          const sized = SIZE.exec(name);
          return {
            name: (sized ? name.slice(0, sized.index) : name).trim(),
            ...(sized?.[1] && { size: bytesOf(sized[1]) }),
          };
        })
    : [];
  return {
    kind: 'email',
    ...(title && { title }),
    headers: headers.filter((h) => h !== listed),
    body: lines
      .slice(i)
      .join('\n')
      .replace(/^\s*\n/, '')
      .trimEnd(),
    attachments,
  };
}

/** A document's lines: headings, items, quotes and set text, never markup. */
function blocksOf(lines: string[]): AttachmentViewBlock[] {
  const blocks: AttachmentViewBlock[] = [];
  let fence: string[] | undefined;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      if (fence) {
        blocks.push({ kind: 'pre', text: fence.join('\n') });
        fence = undefined;
      } else fence = [];
      continue;
    }
    if (fence) {
      fence.push(raw);
      continue;
    }
    if (!line.trim()) continue;
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(line);
    const item = /^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (heading) blocks.push({ kind: 'heading', text: heading[1] ?? '' });
    else if (item) blocks.push({ kind: 'item', text: item[1] ?? '' });
    else if (quote) blocks.push({ kind: 'quote', text: quote[1] ?? '' });
    else blocks.push({ kind: 'paragraph', text: line.trim() });
  }
  if (fence?.length) blocks.push({ kind: 'pre', text: fence.join('\n') });
  return blocks;
}

/** One section of a reader's text, as the parts that show it best. */
function sectionParts(title: string | undefined, text: string): AttachmentViewPart[] {
  const lines = text.split(/\r?\n/);
  const filled = lines.filter((l) => l.trim());
  if (!filled.length) return [];

  const email = emailOf(lines, title);
  if (email) return [email];
  const sheet = cellTable(filled, title);
  if (sheet) return [sheet];

  // A recording: a few facts about it, then what's said, line by line with its time.
  const stamped = filled.filter((l) => STAMP.test(l));
  if (stamped.length) {
    const parts: AttachmentViewPart[] = [];
    const facts = filled
      .filter((l) => !STAMP.test(l))
      .map((l) => FACT.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ label: m[1] ?? '', value: m[2] ?? '' }));
    if (facts.length) parts.push({ kind: 'facts', facts });
    parts.push({
      kind: 'transcript',
      ...(title && { title }),
      segments: stamped.map((l) => {
        const m = STAMP.exec(l);
        return { start: seconds(m?.[1] ?? '0'), text: m?.[2] ?? '' };
      }),
    });
    return parts;
  }

  if (filled.length <= 40 && filled.every((l) => FACT.test(l)))
    return [
      {
        kind: 'facts',
        ...(title && { title }),
        facts: filled.map((l) => {
          const m = FACT.exec(l);
          return { label: m?.[1] ?? '', value: m?.[2] ?? '' };
        }),
      },
    ];

  const table = delimitedTable(filled, title);
  if (table) return [table];
  const tree = treeOf(filled, title);
  if (tree) return [tree];
  return [{ kind: 'text', ...(title && { title }), blocks: blocksOf(lines) }];
}

/** A reader's text, cut at its `[Section]` lines (`[Page 2]`, `[Sheet: Q3]`, `[Slide 4]`). */
export function partsOf(text: string): AttachmentViewPart[] {
  const sections: { title?: string; lines: string[] }[] = [{ lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    const label = /^\[([^\]\n]{1,200})\]$/.exec(line.trim());
    if (label && !STAMP.test(line.trim())) sections.push({ title: label[1], lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections.flatMap((s) =>
    sectionParts(s.title?.replace(/^Sheet:\s*/, ''), s.lines.join('\n')),
  );
}

/** What one reader's result shows a person. */
export function viewFrom(result: ReaderResult): AttachmentView {
  if (result.view) {
    const given = AttachmentView.safeParse(result.view);
    if (given.success)
      return { ...given.data, summary: given.data.summary ?? summaryOf(result.note) };
  }
  const summary = summaryOf(result.note);
  const parts = result.text ? partsOf(result.text) : [];
  const view = { ...(summary && { summary }), parts, ...(result.more && { more: true }) };
  // Whatever a reader wrote, what leaves is only what the schema allows.
  const checked = AttachmentView.safeParse(view);
  return checked.success
    ? checked.data
    : {
        ...(summary && { summary }),
        parts: [
          { kind: 'text', blocks: [{ kind: 'pre', text: (result.text ?? '').slice(0, 40_000) }] },
        ],
        more: true,
      };
}

/**
 * The first reader that takes this attachment, read for a person: nothing
 * it makes goes to a model, so it gets more room and no pictures or tools.
 */
export async function buildView(
  found: Found,
  deps: ReaderDeps,
  readers: readonly Reader[] = READERS,
): Promise<AttachmentView | null> {
  const { attachment, path } = found;
  if (attachment.kind === 'image' || attachment.pasted) return null;
  const bytes = await readFile(path).catch(() => undefined);
  if (!bytes) return null;
  const head = bytes.subarray(0, 4096);
  const signal = AbortSignal.timeout(VIEW_TIMEOUT_MS);
  for (const reader of readers) {
    if (!reader.matches(attachment, head)) continue;
    const result = await reader
      .read({
        attachment,
        bytes,
        path,
        room: VIEW_ROOM,
        can: { images: false, files: false, tools: false },
        deps,
        signal,
      })
      .catch(() => undefined);
    if (result) return viewFrom(result);
  }
  return null;
}

/** Previews, made once per attachment and kept, a few at a time. */
export class AttachmentViews {
  readonly #kept = new Map<string, { view: Promise<AttachmentView | null>; until: number }>();
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(
    private readonly store: AttachmentStore,
    private readonly deps: () => ReaderDeps,
    private readonly readers: readonly Reader[] = READERS,
  ) {}

  /** Undefined for an attachment that isn't here; null when nothing can show it. */
  async get(id: string): Promise<AttachmentView | null | undefined> {
    const found = await this.store.get(id);
    if (!found) return undefined;
    const kept = this.#kept.get(id);
    if (kept && kept.until > Date.now()) {
      this.#kept.delete(id);
      this.#kept.set(id, kept);
      return kept.view;
    }
    const view = this.#turn(() => buildView(found, this.deps(), this.readers));
    const entry = { view, until: Infinity };
    this.#kept.set(id, entry);
    while (this.#kept.size > KEPT) {
      const oldest = this.#kept.keys().next().value;
      if (oldest === undefined) break;
      this.#kept.delete(oldest);
    }
    view.then(
      (v) => {
        if (v?.more) entry.until = Date.now() + UNFINISHED_MS;
      },
      () => this.#kept.delete(id),
    );
    return view;
  }

  async #turn<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= AT_ONCE) await new Promise<void>((go) => this.#waiting.push(go));
    this.#running++;
    try {
      return await work();
    } finally {
      this.#running--;
      this.#waiting.shift()?.();
    }
  }
}
