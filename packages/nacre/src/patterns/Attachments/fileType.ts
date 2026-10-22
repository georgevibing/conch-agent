/** What an attachment is, as far as its card and preview care. */
export type AttachmentKind = 'text' | 'image' | 'file';

/** A card's look: each family has its own glyph and tint. */
export type FileFamily =
  | 'pasted'
  | 'text'
  | 'code'
  | 'data'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'archive'
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

/** The facts every attachment surface uses. */
export interface AttachmentInfo {
  name: string;
  kind: AttachmentKind;
  mimeType?: string;
  /** Bytes. */
  size?: number;
  lines?: number;
  pasted?: boolean;
  width?: number;
  height?: number;
}

/**
 * How a preview shows the content. `view`: drawn from what the gateway's
 * readers made of it (`AttachmentViewData`: a document's words, sheets, an
 * archive's tree, an email); `notebook`: a Jupyter notebook's cells.
 */
export type PreviewMode =
  'text' | 'code' | 'table' | 'image' | 'pdf' | 'audio' | 'video' | 'notebook' | 'view' | 'none';

const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'sql',
  'css',
  'scss',
  'html',
  'htm',
  'xml',
  'svg',
  'vue',
  'svelte',
  'lua',
  'r',
  'dart',
  'scala',
  'toml',
  'ini',
  'dockerfile',
  'makefile',
  'tf',
  'graphql',
  'proto',
]);
const DATA = new Set(['json', 'jsonl', 'ndjson', 'yaml', 'yml']);
const TABLE = new Set(['csv', 'tsv']);
const words = (list: string) => new Set(list.split(' '));
const DOC = words('doc docx docm dot dotx odt ott fodt rtf pages wpd wps');
const SHEET = words('xls xlsx xlsm xlsb xlt xltx ods ots fods numbers');
const SLIDES = words('ppt pptx pptm pps ppsx pot potx odp otp fodp key');
const ARCHIVE = words('zip gz tgz tar rar 7z bz2 tbz tbz2 xz txz zst lz lzma cab cpio');
const AUDIO = words('mp3 wav m4a ogg oga flac aac opus aif aiff wma amr caf mid midi weba');
const VIDEO = words('mp4 mov webm mkv avi m4v wmv flv mpg mpeg 3gp ogv m2ts');

/** Families named by their extension alone. */
const NAMED: Record<string, FileFamily> = {};
for (const [family, list] of [
  ['email', 'eml emlx msg mbox mbx'],
  ['ebook', 'epub mobi azw azw3 fb2 ibooks djvu'],
  ['database', 'sqlite sqlite3 db db3 s3db sl3 mdb accdb duckdb'],
  ['font', 'ttf otf ttc woff woff2 eot'],
  ['model', 'stl obj fbx glb gltf usdz usd 3mf ply blend dae step stp 3ds'],
  [
    'binary',
    'exe msi dll so dylib dmg pkg app apk aab ipa deb rpm appimage bin wasm jar class o iso img',
  ],
  ['notebook', 'ipynb'],
] as const)
  for (const ext of list.split(' ')) NAMED[ext] = family;

/** Families known by their type, for a file whose name says nothing. */
const BY_MIME: [RegExp, FileFamily][] = [
  [/^message\/rfc822$|ms-outlook|^application\/mbox$/, 'email'],
  [/epub|mobipocket|x-fictionbook/, 'ebook'],
  [/sqlite|x-msaccess/, 'database'],
  [/^font\/|x-font-|font-(ttf|otf|woff)|ms-fontobject/, 'font'],
  [/^model\//, 'model'],
  [/ipynb/, 'notebook'],
  [
    /x-msdownload|portable-executable|x-executable|x-mach-?binary|x-elf|x-sharedlib|wasm|java-archive|x-apple-diskimage|x-iso9660|android\.package/,
    'binary',
  ],
  [/wordprocessingml|msword|opendocument\.text|rtf/, 'doc'],
  [/spreadsheetml|ms-excel|opendocument\.spreadsheet/, 'sheet'],
  [/presentationml|ms-powerpoint|opendocument\.presentation/, 'slides'],
  [/zip|x-tar|gzip|x-7z|x-rar|x-bzip|x-xz|zstd|x-lzma|vnd\.ms-cab/, 'archive'],
];

/** What each family is called, for people: "Email", "3D model". */
const FAMILY_WORDS: Record<FileFamily, string> = {
  pasted: 'Pasted text',
  text: 'Text',
  code: 'Code',
  data: 'Data',
  pdf: 'PDF',
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Presentation',
  archive: 'Archive',
  image: 'Picture',
  audio: 'Recording',
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

/** Languages the code preview highlights, by extension. */
const LANGUAGE: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  vue: 'vue',
  svelte: 'svelte',
  lua: 'lua',
  toml: 'toml',
  ini: 'ini',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  graphql: 'graphql',
  dockerfile: 'dockerfile',
  tf: 'hcl',
};

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower === 'makefile') return lower;
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

export function familyOf(
  info: Pick<AttachmentInfo, 'name' | 'kind' | 'mimeType' | 'pasted'>,
): FileFamily {
  if (info.pasted) return 'pasted';
  if (info.kind === 'image') return 'image';
  const ext = extensionOf(info.name);
  const mime = info.mimeType ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (TABLE.has(ext) || SHEET.has(ext)) return info.kind === 'text' ? 'data' : 'sheet';
  const named = NAMED[ext];
  if (named) return named;
  if (DATA.has(ext)) return 'data';
  if (CODE.has(ext)) return 'code';
  if (DOC.has(ext)) return 'doc';
  if (SLIDES.has(ext)) return 'slides';
  if (ARCHIVE.has(ext)) return 'archive';
  if (AUDIO.has(ext) || mime.startsWith('audio/')) return 'audio';
  if (VIDEO.has(ext) || mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  for (const [pattern, family] of BY_MIME) if (pattern.test(mime)) return family;
  if (info.kind === 'text') return 'text';
  return 'file';
}

/** The families every surface names alike: an email, an e-book, a database, a font, a 3D model, a program, a notebook. */
export type SpecialFamily =
  'email' | 'ebook' | 'database' | 'font' | 'model' | 'binary' | 'notebook';
const SPECIAL = new Set<FileFamily>([
  'email',
  'ebook',
  'database',
  'font',
  'model',
  'binary',
  'notebook',
]);

/** One of those, by its name first, then its type; undefined for everything else. */
export function specialFamilyOf(info: {
  name: string;
  mimeType?: string;
}): SpecialFamily | undefined {
  const named = NAMED[extensionOf(info.name)];
  if (named) return named as SpecialFamily;
  for (const [pattern, family] of BY_MIME)
    if (SPECIAL.has(family) && pattern.test(info.mimeType ?? '')) return family as SpecialFamily;
  return undefined;
}

/** What a file is called, for people: "Spreadsheet", "Email", "Disk image". */
export function typeWordOf(
  info: Pick<AttachmentInfo, 'name' | 'kind' | 'mimeType' | 'pasted'>,
): string {
  const family = familyOf(info);
  if (family === 'binary') {
    const ext = extensionOf(info.name);
    if (/^(dll|so|dylib)$/.test(ext)) return 'Library';
    if (/^(dmg|iso|img)$/.test(ext)) return 'Disk image';
    if (ext === 'wasm') return 'WebAssembly';
    if (/^(bin|o|class)$/.test(ext)) return 'Binary file';
  }
  return FAMILY_WORDS[family];
}

/** The short label on a card: "PASTED", "PDF", "CSV", or the extension. */
export function badgeOf(
  info: Pick<AttachmentInfo, 'name' | 'kind' | 'mimeType' | 'pasted'>,
): string {
  if (info.pasted) return 'Pasted';
  const ext = extensionOf(info.name);
  if (ext && ext.length <= 6) return ext.toUpperCase();
  if (info.kind === 'image') return 'Image';
  const family = familyOf(info);
  if (family !== 'file' && family !== 'text') return FAMILY_WORDS[family];
  return info.kind === 'text' ? 'Text' : 'File';
}

export function languageOf(name: string): string | undefined {
  return LANGUAGE[extensionOf(name)];
}

/** Families the gateway's readers show (`GET /api/attachments/:id/view`), even when they're text. */
const VIEWED = new Set<FileFamily>([
  'doc',
  'sheet',
  'slides',
  'archive',
  'email',
  'ebook',
  'database',
  'font',
  'model',
  'binary',
  'file',
]);

/** How the preview shows an attachment. */
export function previewModeOf(info: AttachmentInfo): PreviewMode {
  if (info.kind === 'image') return 'image';
  const family = familyOf(info);
  const ext = extensionOf(info.name);
  if (family === 'pdf') return 'pdf';
  if (family === 'audio') return info.kind === 'file' ? 'audio' : 'none';
  if (family === 'video') return info.kind === 'file' ? 'video' : 'none';
  if (family === 'notebook' && info.kind === 'text') return 'notebook';
  // An email or an RTF saved as text reads better as what it says than as its source.
  if (info.kind === 'text' ? family === 'email' || ext === 'rtf' : VIEWED.has(family))
    return 'view';
  if (info.kind !== 'text') return 'none';
  if (TABLE.has(ext)) return 'table';
  if (!info.pasted && languageOf(info.name)) return 'code';
  return 'text';
}

/**
 * Whether the preview asks the gateway for a view of it: everything it draws
 * from the readers, and a recording's or a video's words under its player.
 */
export function wantsView(info: AttachmentInfo): boolean {
  const mode = previewModeOf(info);
  return mode === 'view' || (info.kind === 'file' && (mode === 'audio' || mode === 'video'));
}

/** "2.4 MB", "812 KB", "96 B", "1.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const count = new Intl.NumberFormat();

/** The quiet second line: "142 lines", "PDF · 2.4 MB", "1920 × 1080". */
export function metaOf(info: AttachmentInfo): string {
  if (info.kind === 'text' && info.lines !== undefined) {
    return `${count.format(info.lines)} ${info.lines === 1 ? 'line' : 'lines'}`;
  }
  if (info.kind === 'image' && info.width && info.height) return `${info.width} × ${info.height}`;
  return info.size === undefined ? '' : formatBytes(info.size);
}

/** Parses a small CSV/TSV for the table preview (quotes and escaped quotes handled). */
export function parseDelimited(text: string, delimiter: string, maxRows = 500): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= maxRows) return rows;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
