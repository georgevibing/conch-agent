/** Small pieces every Office writer shares: XML text, package parts, the zip. */
import { strToU8, zipSync, type Zippable } from 'fflate';

/** Text that is valid inside XML: escaped, and without the characters XML 1.0 forbids. */
export function x(text: string | number): string {
  return (
    String(text)
      // eslint-disable-next-line no-control-regex -- the characters XML 1.0 can't carry
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  );
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export interface Part {
  path: string;
  data: string | Uint8Array;
}

/** The package: `[Content_Types].xml` first, every part deflated, dates fixed so the same input makes the same bytes. */
export function pack(parts: readonly Part[]): Buffer {
  const files: Zippable = {};
  const mtime = new Date('2020-01-01T00:00:00Z');
  for (const part of parts) {
    files[part.path] = [
      typeof part.data === 'string' ? strToU8(part.data) : part.data,
      { level: part.path.match(/\.(?:png|jpe?g|gif)$/) ? 0 : 6, mtime },
    ];
  }
  return Buffer.from(zipSync(files));
}

export function coreProps(title: string | undefined, created = new Date()): string {
  const when = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${title ? `<dc:title>${x(title)}</dc:title>` : ''}<dc:creator>Conch</dc:creator><cp:lastModifiedBy>Conch</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`;
}

export function appProps(extra = ''): string {
  return `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Conch</Application>${extra}</Properties>`;
}

export const REL = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
} as const;

export function rels(
  list: readonly { id: string; type: string; target: string; external?: boolean }[],
) {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`,
    )
    .join('')}</Relationships>`;
}

export function contentTypes(
  overrides: readonly { part: string; type: string }[],
  images: readonly string[] = [],
): string {
  const defaults = new Set(['rels', 'xml', ...images]);
  const mime: Record<string, string> = {
    rels: 'application/vnd.openxmlformats-package.relationships+xml',
    xml: 'application/xml',
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
  };
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[
    ...defaults,
  ]
    .map(
      (ext) =>
        `<Default Extension="${ext}" ContentType="${mime[ext] ?? 'application/octet-stream'}"/>`,
    )
    .join('')}${overrides
    .map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`)
    .join('')}</Types>`;
}

/** A picture placed in a document: its bytes, and its size in pixels. */
export interface Picture {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif';
  width: number;
  height: number;
  alt?: string;
}

export const EXT: Record<Picture['mimeType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
};

/** EMU per CSS pixel (96 dpi). */
export const EMU_PX = 9525;

/** A picture's size in EMU, at most `maxWidth` EMU wide and `maxHeight` tall. */
export function fit(picture: Picture, maxWidth: number, maxHeight: number) {
  const width = picture.width * EMU_PX;
  const height = picture.height * EMU_PX;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { cx: Math.round(width * scale), cy: Math.round(height * scale) };
}
