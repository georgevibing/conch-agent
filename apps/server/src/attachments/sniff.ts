import type { AttachmentKind } from '@conch/protocol';

/** Image types every provider that can see accepts, and that browsers show without help. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface Sniffed {
  kind: AttachmentKind;
  mimeType: string;
  width?: number;
  height?: number;
  /** For text: how it decoded. */
  text?: string;
}

/**
 * What a file really is, from its bytes. The name and the type the browser
 * claimed only break ties for things the bytes can't tell apart (CSV from
 * plain text). An image is an image only when its header says so, so a
 * renamed HTML file is never served as one.
 */
export function sniff(bytes: Buffer, name: string, claimed: string | undefined): Sniffed {
  const image = sniffImage(bytes);
  if (image) return { kind: 'image', ...image };
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-')
    return { kind: 'file', mimeType: 'application/pdf' };
  const text = decodeText(bytes);
  if (text !== undefined) return { kind: 'text', mimeType: textType(name, claimed), text };
  return { kind: 'file', mimeType: fileType(name, claimed) };
}

/** UTF-8 (a BOM is fine) without NUL bytes, or undefined for binary data. */
export function decodeText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

const TEXT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

const FILE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  heic: 'image/heic',
  heif: 'image/heif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** A MIME type shaped like one; anything else is dropped rather than echoed back. */
const MIME = /^[a-z]+\/[a-z0-9][a-z0-9.+-]{0,100}$/;

export function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function textType(name: string, claimed: string | undefined): string {
  const known = TEXT_TYPES[extension(name)];
  if (known) return known;
  const base = claimed?.split(';')[0]?.trim().toLowerCase();
  // Code files arrive as all sorts of made-up types; they're text either way.
  return base && MIME.test(base) && base.startsWith('text/') ? base : 'text/plain';
}

function fileType(name: string, claimed: string | undefined): string {
  const known = FILE_TYPES[extension(name)];
  if (known) return known;
  const base = claimed?.split(';')[0]?.trim().toLowerCase();
  return base && MIME.test(base) ? base : 'application/octet-stream';
}

// ── Images ──────────────────────────────────────────────────────────────────

interface ImageInfo {
  mimeType: ImageType;
  width?: number;
  height?: number;
}

function sniffImage(b: Buffer): ImageInfo | undefined {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    return { mimeType: 'image/png', ...size(b.readUInt32BE(16), b.readUInt32BE(20)) };
  }
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) {
    return { mimeType: 'image/gif', ...size(b.readUInt16LE(6), b.readUInt16LE(8)) };
  }
  if (
    b.length >= 16 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ...webpSize(b) };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mimeType: 'image/jpeg', ...jpegSize(b) };
  }
  return undefined;
}

function size(width: number, height: number) {
  return width > 0 && height > 0 && width < 1e6 && height < 1e6 ? { width, height } : {};
}

function webpSize(b: Buffer) {
  const chunk = b.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X' && b.length >= 30)
    return size(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  if (chunk === 'VP8 ' && b.length >= 30)
    return size(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return {};
}

/** Walks the JPEG markers to the first frame header, which holds the size. */
function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return {};
    const marker = b[i + 1] ?? 0;
    // Start-of-frame markers, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return size(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return {};
}

// ── Names ───────────────────────────────────────────────────────────────────

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * A file name that's safe to show and to write: no folders, no control
 * characters, nothing Windows refuses, at most `max` bytes with the extension
 * kept. Never empty.
 */
export function cleanName(raw: string, max = 255): string {
  let name = raw.normalize('NFC').split(/[\\/]/).at(-1) ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what's removed
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, '').trim();
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) name = 'file';
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (Buffer.byteLength(name) <= max) return name;
  const ext = extension(name);
  const tail = ext && ext.length <= 16 ? `.${ext}` : '';
  let stem = name.slice(0, name.length - tail.length);
  while (Buffer.byteLength(stem + tail) > max) stem = stem.slice(0, -1);
  return stem + tail;
}
