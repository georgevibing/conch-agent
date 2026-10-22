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
  /** The text wasn't UTF-8 (Excel's CSV, Notepad's UTF-16): keep it as `text`, in UTF-8. */
  transcoded?: boolean;
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
  const picture = sniffOtherPicture(bytes);
  // A camera's RAW file is a TIFF inside: kept as it is, never swapped for a JPEG.
  if (picture === 'image/tiff' && RAW_EXTENSIONS.has(extension(name)))
    return { kind: 'file', mimeType: 'image/x-dcraw' };
  if (picture) return { kind: 'file', mimeType: picture };
  if (bytes.subarray(0, 16).toString('latin1') === 'SQLite format 3\0')
    return { kind: 'file', mimeType: 'application/vnd.sqlite3' };
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-')
    return { kind: 'file', mimeType: 'application/pdf' };
  const text = decodeText(bytes);
  if (text !== undefined) return { kind: 'text', mimeType: textType(name, claimed), text };
  const legacy = decodeLegacyText(bytes, name);
  if (legacy !== undefined)
    return { kind: 'text', mimeType: textType(name, claimed), text: legacy, transcoded: true };
  const typed = fileType(name, claimed);
  // An archive with a name that says nothing (`download`, `backup.bin`): its signature does.
  return {
    kind: 'file',
    mimeType:
      typed === 'application/octet-stream'
        ? (zippedDocumentType(bytes) ?? archiveType(bytes) ?? typed)
        : typed,
  };
}

/** An archive's type from its signature (`readers/archives.ts` reads them). */
/**
 * An EPUB or OpenDocument file, from the `mimetype` entry both keep first
 * and unpacked in their zip (`readers/documents.ts` reads them).
 */
const ZIPPED_DOCUMENTS = new Set([
  'application/epub+zip',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
]);
function zippedDocumentType(b: Buffer): string | undefined {
  if (b.length < 38 || b.readUInt32LE(0) !== 0x04034b50) return undefined;
  if (b.subarray(30, 38).toString('latin1') !== 'mimetype') return undefined;
  const start = 38 + b.readUInt16LE(28);
  const type = b.subarray(start, start + Math.min(100, b.readUInt32LE(18))).toString('latin1');
  return ZIPPED_DOCUMENTS.has(type) ? type : undefined;
}

function archiveType(b: Buffer): string | undefined {
  const head = b.subarray(0, 8).toString('latin1');
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) return 'application/zip';
  if (head.startsWith('\x1f\x8b')) return 'application/gzip';
  if (head.startsWith('\x28\xb5\x2f\xfd')) return 'application/zstd';
  if (head.startsWith('\xfd7zXZ\0')) return 'application/x-xz';
  if (/^BZh[1-9]/.test(head)) return 'application/x-bzip2';
  if (head.startsWith('7z\xbc\xaf\x27\x1c')) return 'application/x-7z-compressed';
  if (head.startsWith('Rar!\x1a\x07')) return 'application/vnd.rar';
  if (head.startsWith('MSCF')) return 'application/vnd.ms-cab-compressed';
  if (head.startsWith('xar!')) return 'application/x-xar';
  if (b.subarray(257, 262).toString('latin1') === 'ustar') return 'application/x-tar';
  return undefined;
}

/** Camera RAW files, by extension: most are TIFF inside, so their bytes don't tell them apart. */
export const RAW_EXTENSIONS = new Set(
  'cr2 cr3 crw nef nrw arw srf sr2 dng raf orf rw2 pef srw x3f 3fr erf kdc mrw iiq'.split(' '),
);

/** Text files whose name says so, which Windows programs still save in other encodings. */
const LEGACY_TEXT = new Set(['csv', 'tsv', 'txt', 'text', 'log', 'md', 'markdown', 'ini']);

/**
 * Text that isn't UTF-8: UTF-16 with its byte-order mark (Notepad's "Unicode"),
 * or a CSV or a text file in Windows-1252 (Excel's "CSV (Comma delimited)").
 * Only for names that say it's text, so a binary file is never read as words.
 */
export function decodeLegacyText(bytes: Buffer, name: string): string | undefined {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : undefined;
  try {
    if (utf16) {
      const text = new TextDecoder(utf16, { fatal: true }).decode(bytes);
      return text.includes('\0') ? undefined : text;
    }
    if (!LEGACY_TEXT.has(extension(name)) || bytes.includes(0)) return undefined;
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return undefined;
  }
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
  // Documents that are text inside, read for their words (`readers/documents.ts`).
  rtf: 'application/rtf',
  eml: 'message/rfc822',
  mbox: 'application/mbox',
  ipynb: 'application/x-ipynb+json',
};

const FILE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odg: 'application/vnd.oasis.opendocument.graphics',
  epub: 'application/epub+zip',
  rtf: 'application/rtf',
  eml: 'message/rfc822',
  mbox: 'application/mbox',
  msg: 'application/vnd.ms-outlook',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  zst: 'application/zstd',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  jar: 'application/java-archive',
  apk: 'application/vnd.android.package-archive',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
  psd: 'image/vnd.adobe.photoshop',
  ico: 'image/vnd.microsoft.icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
  oga: 'audio/ogg',
  amr: 'audio/amr',
  caf: 'audio/x-caf',
  weba: 'audio/webm',
  mka: 'audio/x-matroska',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
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

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * A picture no provider reads (an iPhone's HEIC, AVIF, TIFF, BMP), from its
 * header, whatever it's called: Conch turns these into a JPEG (`fit.ts`).
 */
export function sniffOtherPicture(b: Buffer): string | undefined {
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (AVIF_BRANDS.has(brand)) return 'image/avif';
    if (HEIF_BRANDS.has(brand)) return 'image/heif';
    return undefined;
  }
  const head = b.subarray(0, 4).toString('latin1');
  if (head === 'II*\0' || head === 'MM\0*') return 'image/tiff';
  // "BM", the file's size, then a reserved zero: not text that happens to start "BM".
  if (
    b.length >= 26 &&
    head.startsWith('BM') &&
    b.readUInt32LE(2) === b.length &&
    b.readUInt32LE(6) === 0
  )
    return 'image/bmp';
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
