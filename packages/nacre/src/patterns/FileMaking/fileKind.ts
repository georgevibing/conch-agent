import { extensionOf, familyOf, formatBytes, specialFamilyOf } from '../Attachments/fileType';
import { META_SEP } from '../../components/MetaList';

/**
 * What a file is, as its card draws it: each type has its own silhouette
 * while it's made, its own glyph and tint once it's there.
 */
export type FileType =
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'archive'
  | 'code'
  | 'data'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'email'
  | 'ebook'
  | 'database'
  | 'font'
  | 'model'
  | 'binary'
  | 'notebook'
  | 'file';

/** The shape drawn while it's made (and at rest, when there's no picture of it). */
export type FileShape = 'page' | 'grid' | 'slides' | 'box' | 'window' | 'code' | 'wave' | 'film';

const BY_EXT: Record<string, FileType> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pages: 'doc',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  numbers: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  key: 'slides',
  csv: 'csv',
  tsv: 'csv',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  zip: 'archive',
  gz: 'archive',
  tgz: 'archive',
  tar: 'archive',
  rar: 'archive',
  '7z': 'archive',
  bz2: 'archive',
  xz: 'archive',
  json: 'data',
  jsonl: 'data',
  ndjson: 'data',
  yaml: 'data',
  yml: 'data',
  xml: 'data',
  txt: 'text',
  log: 'text',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',
  aac: 'audio',
  opus: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  m4v: 'video',
};

const CODE = new Set(
  'ts tsx js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql css scss vue svelte lua r dart scala toml ini dockerfile makefile tf graphql proto'.split(
    ' ',
  ),
);

const BY_MIME: [RegExp, FileType][] = [
  [/^application\/pdf$/, 'pdf'],
  [/wordprocessingml|msword|opendocument\.text/, 'doc'],
  [/spreadsheetml|ms-excel|opendocument\.spreadsheet/, 'sheet'],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, 'slides'],
  [/^text\/(csv|tab-separated-values)$/, 'csv'],
  [/^text\/markdown$/, 'markdown'],
  [/^text\/html$/, 'html'],
  [/zip|x-tar|gzip|x-7z|x-rar/, 'archive'],
  [/json|yaml|xml/, 'data'],
  [/^image\//, 'image'],
  [/^audio\//, 'audio'],
  [/^video\//, 'video'],
];

const FROM_FAMILY = new Set<string>(['doc', 'sheet', 'slides', 'archive', 'audio', 'video']);

/** A file's type from its name first (what people read), then its type, then its kind. */
export function fileTypeOf(info: {
  name: string;
  mimeType?: string;
  kind?: 'text' | 'image' | 'file';
}): FileType {
  if (info.kind === 'image') return 'image';
  const special = specialFamilyOf(info);
  if (special) return special;
  const ext = extensionOf(info.name);
  const named = BY_EXT[ext];
  if (named) return named;
  if (CODE.has(ext)) return 'code';
  const mime = info.mimeType ?? '';
  for (const [pattern, type] of BY_MIME) if (pattern.test(mime)) return type;
  // The families the attachment cards know by more names (ODF, legacy Office, more archives).
  const family = familyOf({ name: info.name, mimeType: mime, kind: info.kind ?? 'file' });
  if (FROM_FAMILY.has(family)) return family as FileType;
  return info.kind === 'text' || mime.startsWith('text/') ? 'text' : 'file';
}

/** The shape each type takes while it's made. */
export const SHAPE: Record<FileType, FileShape> = {
  pdf: 'page',
  doc: 'page',
  markdown: 'page',
  text: 'page',
  file: 'page',
  sheet: 'grid',
  csv: 'grid',
  slides: 'slides',
  archive: 'box',
  html: 'window',
  code: 'code',
  data: 'code',
  image: 'film',
  video: 'film',
  audio: 'wave',
  email: 'page',
  ebook: 'page',
  database: 'grid',
  font: 'page',
  model: 'box',
  binary: 'box',
  notebook: 'code',
};

/** What a type is called, for people: "PDF", "Word document", "Spreadsheet". */
export const TYPE_WORDS: Record<FileType, string> = {
  pdf: 'PDF',
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Presentation',
  csv: 'Table',
  markdown: 'Markdown',
  html: 'Web page',
  archive: 'Archive',
  code: 'Code',
  data: 'Data',
  text: 'Text',
  image: 'Picture',
  audio: 'Audio',
  video: 'Video',
  email: 'Email',
  ebook: 'E-book',
  database: 'Database',
  font: 'Font',
  model: '3D model',
  binary: 'Program',
  notebook: 'Notebook',
  file: 'File',
};

/** The short badge: the extension, or the type's own word when there isn't a good one. */
export function badgeFor(name: string, type: FileType): string {
  const ext = extensionOf(name);
  if (ext && ext.length <= 4) return ext.toUpperCase();
  if (type === 'markdown') return 'MD';
  if (type === 'html') return 'HTML';
  if (type === 'pdf') return 'PDF';
  return TYPE_WORDS[type];
}

/** A file's name with its extension, from what was asked for (`Q3 report` + `pdf`). */
export function withExtension(name: string, format: string | undefined): string {
  const clean = name.trim();
  if (!format) return clean;
  const ext = format.replace(/^\./, '').toLowerCase();
  return extensionOf(clean) === ext ? clean : `${clean}.${ext}`;
}

const count = new Intl.NumberFormat();
const plural = (n: number, one: string, many: string) =>
  `${count.format(n)} ${n === 1 ? one : many}`;

/** The quiet line under its name: "PDF · 3 pages · 240 KB". */
export function fileMeta(info: {
  badge: string;
  size?: number;
  pages?: number;
  sheets?: number;
  slides?: number;
  lines?: number;
  files?: number;
}): string {
  return [
    info.badge,
    info.pages !== undefined ? plural(info.pages, 'page', 'pages') : undefined,
    info.sheets !== undefined ? plural(info.sheets, 'sheet', 'sheets') : undefined,
    info.slides !== undefined ? plural(info.slides, 'slide', 'slides') : undefined,
    info.files !== undefined ? plural(info.files, 'file', 'files') : undefined,
    info.pages === undefined && info.lines !== undefined
      ? plural(info.lines, 'line', 'lines')
      : undefined,
    info.size !== undefined ? formatBytes(info.size) : undefined,
  ]
    .filter(Boolean)
    .join(META_SEP);
}

/**
 * The first few lines of a Markdown file, read for a small picture of the
 * page: headings, bullets and paragraphs, as plain words. Nothing in it is
 * ever drawn as HTML.
 */
export interface ExcerptLine {
  kind: 'h1' | 'h2' | 'li' | 'p' | 'quote';
  text: string;
}

export function markdownLines(text: string, max = 12): ExcerptLine[] {
  const out: ExcerptLine[] = [];
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
    if (out.length >= max) break;
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (
      !line.trim() ||
      /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line) ||
      /^\s*\|?[-:| ]+\|?$/.test(line)
    )
      continue;
    const plain = (s: string) => {
      let words = s
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]+/g, '');
      // Tags go until none is left: taking one out can join the halves of another (`<scr<b>ipt>`).
      let before: string;
      do {
        before = words;
        words = words.replace(/<[^<>]+>/g, '');
      } while (words !== before);
      return words.trim();
    };
    if (fenced) {
      out.push({ kind: 'p', text: line.trim() });
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({
        kind: (heading[1]?.length ?? 1) === 1 ? 'h1' : 'h2',
        text: plain(heading[2] ?? ''),
      });
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      out.push({ kind: 'li', text: plain(item[1] ?? '') });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      out.push({ kind: 'quote', text: plain(quote[1] ?? '') });
      continue;
    }
    out.push({ kind: 'p', text: plain(line.replace(/^\s*\|/, '').replace(/\|/g, ' · ')) });
  }
  return out.filter((l) => l.text);
}

/**
 * A web page's title and first words, read as text for a small picture of
 * it. The page itself never runs here: what the assistant writes runs only
 * in a sealed frame (ADR 0034), and this is a file, not a page of Conch's.
 */
export function htmlGist(html: string): { title?: string; lines: string[] } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<(script|style|head|title|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/h\d|\/li|\/div|\/tr|\/section|\/article)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so `&amp;lt;` reads as the words "&lt;", not as "<".
    .replace(/&amp;/g, '&');
  const lines = body
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8);
  const clean = title?.replace(/\s+/g, ' ').trim();
  return { ...(clean && { title: clean }), lines };
}
