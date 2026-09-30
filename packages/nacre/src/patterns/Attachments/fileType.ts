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

/** How a preview shows the content. */
export type PreviewMode = 'text' | 'code' | 'table' | 'image' | 'pdf' | 'audio' | 'video' | 'none';

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
const DOC = new Set(['doc', 'docx', 'odt', 'rtf', 'pages', 'epub']);
const SHEET = new Set(['xls', 'xlsx', 'ods', 'numbers']);
const SLIDES = new Set(['ppt', 'pptx', 'odp', 'key']);
const ARCHIVE = new Set(['zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'bz2', 'xz']);
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus']);
const VIDEO = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);

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
  if (DATA.has(ext)) return 'data';
  if (CODE.has(ext)) return 'code';
  if (DOC.has(ext)) return 'doc';
  if (SLIDES.has(ext)) return 'slides';
  if (ARCHIVE.has(ext)) return 'archive';
  if (AUDIO.has(ext) || mime.startsWith('audio/')) return 'audio';
  if (VIDEO.has(ext) || mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (info.kind === 'text') return 'text';
  return 'file';
}

/** The short label on a card: "PASTED", "PDF", "CSV", or the extension. */
export function badgeOf(
  info: Pick<AttachmentInfo, 'name' | 'kind' | 'mimeType' | 'pasted'>,
): string {
  if (info.pasted) return 'Pasted';
  const ext = extensionOf(info.name);
  if (ext && ext.length <= 5) return ext.toUpperCase();
  if (info.kind === 'image') return 'Image';
  return info.kind === 'text' ? 'Text' : 'File';
}

export function languageOf(name: string): string | undefined {
  return LANGUAGE[extensionOf(name)];
}

/** How the preview shows an attachment. */
export function previewModeOf(info: AttachmentInfo): PreviewMode {
  if (info.kind === 'image') return 'image';
  const family = familyOf(info);
  const ext = extensionOf(info.name);
  if (family === 'pdf') return 'pdf';
  if (family === 'audio') return info.kind === 'file' ? 'audio' : 'none';
  if (family === 'video') return info.kind === 'file' ? 'video' : 'none';
  if (info.kind !== 'text') return 'none';
  if (TABLE.has(ext)) return 'table';
  if (!info.pasted && languageOf(info.name)) return 'code';
  return 'text';
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
