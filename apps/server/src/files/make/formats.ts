/**
 * The kinds of file Conch makes itself (`file_make`, `file_convert`,
 * `file_combine`), whichever provider is answering: their extensions, types,
 * and the limits every maker holds to.
 */
import { ATTACHMENT_LIMITS } from '@conch/protocol';

import { cleanName, extension } from '../../attachments/sniff';

export const MAKE_FORMATS = [
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'pptx',
  'md',
  'txt',
  'html',
  'json',
  'svg',
  'png',
] as const;
export type MakeFormat = (typeof MAKE_FORMATS)[number];

export const MIME: Record<MakeFormat | 'zip', string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  zip: 'application/zip',
};

/** What one call may hand in and get out. */
export const LIMITS = {
  /** A made or converted file, the most the attachment store keeps. */
  outputBytes: ATTACHMENT_LIMITS.maxBytes,
  /** Markdown, HTML or text handed in. */
  textChars: 2_000_000,
  sheets: 20,
  /** Cells across every sheet. */
  cells: 500_000,
  columns: 200,
  cellChars: 32_000,
  slides: 100,
  bullets: 20,
  /** Files in one combined PDF or ZIP. */
  files: 20,
  /** Bytes read from every source together. */
  sourceBytes: 60 * 1024 * 1024,
  /** Entries taken out of one ZIP. */
  unzipEntries: 50,
  chartSeries: 12,
  chartPoints: 500,
  /** Pictures from the chat placed in one document. */
  images: 30,
} as const;

/**
 * A safe file name with the right extension: the person's words kept, any
 * folder or control character dropped, the extension replaced when it's
 * another format's ("report.docx" asked for as a PDF is "report.pdf").
 */
export function fileName(raw: string, format: MakeFormat | 'zip'): string {
  const clean = cleanName(raw.trim() || 'file', 200);
  const ext = extension(clean);
  const known = ext && (MAKE_FORMATS as readonly string[]).concat('zip', 'markdown', 'htm');
  const stem = known && known.includes(ext) ? clean.slice(0, -(ext.length + 1)) : clean;
  return cleanName(`${stem || 'file'}.${format}`);
}

export function formatOf(name: string, mimeType: string): string {
  const ext = extension(name);
  if (ext === 'markdown') return 'md';
  if (ext === 'htm') return 'html';
  if (ext === 'jpeg') return 'jpg';
  if (ext) return ext;
  if (mimeType === 'application/pdf') return 'pdf';
  return '';
}
