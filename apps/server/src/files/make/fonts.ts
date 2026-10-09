/**
 * The fonts Conch's own PDF writer (`pdf-lite.ts`) draws with: the ones this
 * computer already has, found where each system keeps them, so a PDF made
 * without a browser still says "Καλημέρα", "Привет" or "你好" in real letters,
 * each font embedded as a subset of the glyphs the document uses. Nothing is
 * downloaded and nothing is installed: on a computer with no fonts at all the
 * writer falls back to the standard PDF fonts (Latin only) and says so.
 *
 * Only plain OpenType files are used (TrueType or CFF outlines, `.ttf`,
 * `.otf`, and the first face of a `.ttc` collection): web fonts (WOFF2) don't
 * subset cleanly.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];

export type FontRole = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono';

/** Files for each role (the first that exists wins), and wide-coverage fonts for what they lack. */
export interface FontFiles {
  roles: Partial<Record<FontRole, string>>;
  /** For characters the role's own font doesn't have, in order. */
  fallbacks: string[];
}

/** A family by its files, case-insensitive: regular, bold, italic, bold italic. */
type Family = [regular: string[], bold: string[], italic: string[], boldItalic: string[]];

/** Closest to the Helvetica the standard fonts give, first; then the widest. */
const SANS: Family[] = [
  [
    ['Arial.ttf', 'arial.ttf'],
    ['Arial Bold.ttf', 'arialbd.ttf'],
    ['Arial Italic.ttf', 'ariali.ttf'],
    ['Arial Bold Italic.ttf', 'arialbi.ttf'],
  ],
  [
    ['LiberationSans-Regular.ttf'],
    ['LiberationSans-Bold.ttf'],
    ['LiberationSans-Italic.ttf'],
    ['LiberationSans-BoldItalic.ttf'],
  ],
  [
    ['NotoSans-Regular.ttf', 'NotoSans-Regular.otf'],
    ['NotoSans-Bold.ttf', 'NotoSans-Bold.otf'],
    ['NotoSans-Italic.ttf', 'NotoSans-Italic.otf'],
    ['NotoSans-BoldItalic.ttf', 'NotoSans-BoldItalic.otf'],
  ],
  [
    ['DejaVuSans.ttf'],
    ['DejaVuSans-Bold.ttf'],
    ['DejaVuSans-Oblique.ttf'],
    ['DejaVuSans-BoldOblique.ttf'],
  ],
  [
    ['FreeSans.ttf', 'FreeSans.otf'],
    ['FreeSansBold.ttf', 'FreeSansBold.otf'],
    ['FreeSansOblique.ttf', 'FreeSansOblique.otf'],
    ['FreeSansBoldOblique.ttf', 'FreeSansBoldOblique.otf'],
  ],
  [['segoeui.ttf'], ['segoeuib.ttf'], ['segoeuii.ttf'], ['segoeuiz.ttf']],
];

const MONO = [
  'Menlo.ttc',
  'Courier New.ttf',
  'consola.ttf',
  'DejaVuSansMono.ttf',
  'LiberationMono-Regular.ttf',
  'NotoSansMono-Regular.ttf',
  'FreeMono.ttf',
  'FreeMono.otf',
  'cour.ttf',
];

/** Fonts with many scripts in them, for what the family lacks. */
const WIDE = [
  'DejaVuSans.ttf',
  'NotoSans-Regular.ttf',
  'FreeSans.ttf',
  'FreeSerif.ttf',
  'Arial Unicode.ttf',
  'ARIALUNI.TTF',
  'segoeui.ttf',
  'NotoSansArmenian-Regular.ttf',
  'NotoSansGeorgian-Regular.ttf',
  'NotoSansHebrew-Regular.ttf',
  'NotoSansArabic-Regular.ttf',
  'NotoSansDevanagari-Regular.ttf',
  'NotoSansThai-Regular.ttf',
  'NotoSansCJK-Regular.ttc',
  'NotoSansCJKsc-Regular.otf',
  'NotoSansSC-Regular.otf',
  'NotoSansSC-Regular.ttf',
  'DroidSansFallbackFull.ttf',
  'DroidSansFallback.ttf',
  'wqy-microhei.ttc',
  'wqy-zenhei.ttc',
  'Hiragino Sans GB.ttc',
  'AppleGothic.ttf',
  'msyh.ttc',
  'msgothic.ttc',
  'malgun.ttf',
  'Nirmala.ttf',
  'NotoSansSymbols2-Regular.ttf',
  'seguisym.ttf',
  'Apple Symbols.ttf',
];

type Env = Record<string, string | undefined>;

/** Where each system keeps its fonts (and where a person's own go). */
export function fontDirs(
  platform: NodeJS.Platform = osPlatform(),
  env: Env = process.env,
  home = homedir(),
): string[] {
  if (platform === 'win32') {
    const windows = env.WINDIR ?? env.SystemRoot ?? 'C:\\Windows';
    return [
      join(windows, 'Fonts'),
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : []),
    ];
  }
  if (platform === 'darwin')
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      join(home, 'Library', 'Fonts'),
    ];
  const data = env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(data, 'fonts'), join(home, '.fonts')];
}

const SCAN_DEPTH = 5;
const SCAN_LIMIT = 20_000;

/** Every font file under `dirs`, by its lower-case name (the first found wins). */
function scan(dirs: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > SCAN_DEPTH || seen > SCAN_LIMIT) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++seen > SCAN_LIMIT) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (/\.(?:ttf|otf|ttc)$/i.test(entry.name)) {
        const key = entry.name.toLowerCase();
        if (!found.has(key)) found.set(key, path);
      }
    }
  };
  for (const dir of dirs) walk(dir, 0);
  return found;
}

/** The fonts to use, from what's in `dirs`. */
export function pickFonts(dirs: readonly string[]): FontFiles {
  const files = scan(dirs);
  const first = (names: readonly string[]) =>
    names.map((n) => files.get(n.toLowerCase())).find((p): p is string => Boolean(p));
  const roles: FontFiles['roles'] = {};
  const family = SANS.find((f) => first(f[0]));
  if (family) {
    const [regular, bold, italic, boldItalic] = family.map(first);
    roles.regular = regular;
    roles.bold = bold ?? regular;
    roles.italic = italic ?? regular;
    roles.boldItalic = boldItalic ?? bold ?? italic ?? regular;
  }
  const mono = first(MONO);
  if (mono) roles.mono = mono;
  const fallbacks = [
    ...new Set(WIDE.map((n) => files.get(n.toLowerCase())).filter((p): p is string => Boolean(p))),
  ].filter((p) => p !== roles.regular);
  return { roles, fallbacks };
}

let cached: { at: number; files: FontFiles } | undefined;
const RESCAN_MS = 10 * 60_000;

/** This computer's fonts, looked up at most every ten minutes. */
export function systemFonts(now = Date.now()): FontFiles {
  if (!cached || now - cached.at > RESCAN_MS) cached = { at: now, files: pickFonts(fontDirs()) };
  return cached.files;
}

/** True for a file that starts like a font pdf-lib can subset (not WOFF or WOFF2). */
export function isPlainFont(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(4);
    if (readSync(fd, head, 0, 4, 0) < 4) return false;
    const tag = head.toString('latin1');
    return tag === '\0\x01\0\0' || tag === 'true' || tag === 'OTTO' || tag === 'ttcf';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ── Reading them ─────────────────────────────────────────────────────────────

/** A font as fontkit reads it: just what Conch uses. */
export interface FontFace {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

const MAX_FONT_BYTES = 64 * 1024 * 1024;
const kept = new Map<string, { bytes: Uint8Array; face: FontFace; mtime: number }>();
let forget: NodeJS.Timeout | undefined;

/** A font file's bytes and its glyphs, kept a little while for the next PDF. */
export function loadFont(path: string): { bytes: Uint8Array; face: FontFace } | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_FONT_BYTES) return undefined;
    const hit = kept.get(path);
    if (hit && hit.mtime === stat.mtimeMs) return hit;
    if (!isPlainFont(path)) return undefined;
    const bytes = new Uint8Array(readFileSync(path));
    const face = firstFace(fontkit.create(Buffer.from(bytes)));
    if (!face) return undefined;
    const entry = { bytes, face, mtime: stat.mtimeMs };
    kept.set(path, entry);
    clearTimeout(forget);
    forget = setTimeout(() => kept.clear(), 2 * 60_000);
    forget.unref();
    return entry;
  } catch {
    return undefined;
  }
}

/** One face of a collection (`.ttc`), or the font itself. */
function firstFace(font: unknown): (FontFace & Record<string, unknown>) | undefined {
  const value = font as { fonts?: unknown[] } & FontFace & Record<string, unknown>;
  const face = (Array.isArray(value.fonts) ? value.fonts[0] : value) as
    (FontFace & Record<string, unknown>) | undefined;
  return face && typeof face.hasGlyphForCodePoint === 'function' ? face : undefined;
}

/**
 * fontkit as pdf-lib wants it, with two guards: a collection gives its first
 * face, and a font whose subset can't be written fails the save (an error
 * pdf-lib hands back) instead of throwing on a timer, where nothing could
 * catch it and the gateway would stop.
 */
export const safeFontkit: Fontkit = {
  create(data: Uint8Array) {
    const face = firstFace(fontkit.create(Buffer.from(data)));
    if (!face) throw new Error('That isn’t a font Conch can use.');
    const createSubset = face.createSubset as (() => Record<string, unknown>) | undefined;
    if (typeof createSubset === 'function')
      face.createSubset = () => {
        const subset = createSubset.call(face);
        const encode = subset.encode as ((stream: unknown) => void) | undefined;
        if (typeof encode === 'function')
          subset.encode = (stream: { emit(event: string, error: unknown): void }) => {
            try {
              encode.call(subset, stream);
            } catch (error) {
              stream.emit('error', error);
            }
          };
        return subset;
      };
    return face as unknown as ReturnType<Fontkit['create']>;
  },
};
