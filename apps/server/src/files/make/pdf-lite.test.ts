/**
 * Conch's own PDF writer without a browser: this computer's fonts embedded
 * (as subsets) so Greek, Cyrillic and the rest are real letters, the standard
 * fonts when there are none, and honest word of what it couldn't draw.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

import { extractDocument } from '../documents';
import { fromMarkdown } from './blocks';
import { isPlainFont, loadFont, pickFonts, systemFonts } from './fonts';
import { makeLitePdf } from './pdf-lite';

const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

const signal = () => new AbortController().signal;

async function textOf(pdf: Buffer) {
  const read = await extractDocument(pdf, 'x.pdf', 0, 5, signal());
  return read.sections.map((s) => s.text).join(' ');
}

/** The font files embedded in a PDF (FontFile2: TrueType; FontFile3: CFF). */
async function embeddedFonts(pdf: Buffer) {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFDict &&
        (object.has(PDFName.of('FontFile2')) || object.has(PDFName.of('FontFile3'))),
    ).length;
}

const MULTI = `# Καλημέρα κόσμε

Привет, мир. **Γειά σου** and *café* — “quotes”.

- Ελληνικά
- Русский

| Λέξη | Слово |
|---|---|
| ένα | один |

\`\`\`
print("Ωμέγα")
\`\`\`
`;

/** This computer's fonts, if any of them draws Greek and Cyrillic. */
const fonts = systemFonts();
const regular = fonts.roles.regular ?? fonts.fallbacks[0];
const face = regular ? loadFont(regular)?.face : undefined;
const greek = Boolean(face?.hasGlyphForCodePoint(0x3b1) && face.hasGlyphForCodePoint(0x436));

describe.skipIf(!greek)('with this computer’s fonts', () => {
  it('draws Greek and Cyrillic as real letters, with the fonts embedded as subsets', async () => {
    const made = await makeLitePdf(fromMarkdown(MULTI), { title: 'Αναφορά' });
    expect(made.embedded).toBe(true);
    expect(made.lossy).toBe(false);
    expect(made.missing).toEqual([]);
    const text = await textOf(made.pdf);
    for (const word of ['Καλημέρα', 'Привет', 'Γειά', 'café', 'один', 'Ωμέγα']) {
      expect(text).toContain(word);
    }
    expect(await embeddedFonts(made.pdf)).toBeGreaterThan(0);
    // Subsets, not whole font files: a page of text stays small.
    expect(made.pdf.length).toBeLessThan(400_000);
  });
});

describe('Conch’s own PDF writer', () => {
  it('with no fonts here, still makes the PDF and names what it replaced', async () => {
    const made = await makeLitePdf(fromMarkdown('# Report\n\nCafé Καλη → done'), {
      fonts: false,
    });
    expect(made.embedded).toBe(false);
    expect(made.lossy).toBe(true);
    expect(made.missing).toEqual(expect.arrayContaining(['Κ', 'α', 'λ', 'η']));
    const text = await textOf(made.pdf);
    expect(text).toContain('Café');
    // A character the standard fonts lack has a close substitute.
    expect(text).toContain('->');
    expect(await embeddedFonts(made.pdf)).toBe(0);
  });

  it('says when right-to-left text is drawn left to right', async () => {
    const made = await makeLitePdf(fromMarkdown('שלום'), { fonts: false });
    expect(made.rtl).toBe(true);
  });

  it('falls back to the standard fonts when a font file is broken', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-fonts-'));
    folders.push(home);
    const broken = join(home, 'DejaVuSans.ttf');
    // Starts like a TrueType font, and isn't one.
    await writeFile(broken, Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(200, 7)]));
    const made = await makeLitePdf(fromMarkdown('# Fine\n\nStill made.'), {
      fonts: { roles: { regular: broken, bold: broken }, fallbacks: [broken] },
    });
    expect(made.embedded).toBe(false);
    expect(await textOf(made.pdf)).toContain('Still made.');
  });
});

describe('finding fonts', () => {
  it('picks one family for every style, a monospace font, and wide fonts for the rest', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-fonts-'));
    folders.push(home);
    const dir = join(home, 'truetype', 'dejavu');
    await mkdir(dir, { recursive: true });
    for (const name of [
      'DejaVuSans.ttf',
      'DejaVuSans-Bold.ttf',
      'DejaVuSans-Oblique.ttf',
      'DejaVuSans-BoldOblique.ttf',
      'DejaVuSansMono.ttf',
      'DroidSansFallbackFull.ttf',
      'NotoSansCJK-Regular.ttc',
      'ignored.woff2',
    ])
      await writeFile(join(dir, name), '');
    const found = pickFonts([home]);
    expect(found.roles).toEqual({
      regular: join(dir, 'DejaVuSans.ttf'),
      bold: join(dir, 'DejaVuSans-Bold.ttf'),
      italic: join(dir, 'DejaVuSans-Oblique.ttf'),
      boldItalic: join(dir, 'DejaVuSans-BoldOblique.ttf'),
      mono: join(dir, 'DejaVuSansMono.ttf'),
    });
    // The family's own regular isn't asked twice; web fonts are never used.
    expect(found.fallbacks).toEqual([
      join(dir, 'NotoSansCJK-Regular.ttc'),
      join(dir, 'DroidSansFallbackFull.ttf'),
    ]);
  });

  it('finds nothing on a computer without fonts, and reads only plain font files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-fonts-'));
    folders.push(home);
    expect(pickFonts([home, join(home, 'missing')])).toEqual({ roles: {}, fallbacks: [] });
    const woff2 = join(home, 'a.ttf');
    await writeFile(woff2, 'wOF2rest');
    expect(isPlainFont(woff2)).toBe(false);
    expect(loadFont(woff2)).toBeUndefined();
  });
});
