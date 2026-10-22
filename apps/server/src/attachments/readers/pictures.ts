import type { Attachment } from '@conch/protocol';

import type { TurnImage } from '../../engines/types';
import { CONVERTIBLE, MODEL_FIT, fitPicture, loadSharp, systemConverters, toJpeg } from '../fit';
import { extension, RAW_EXTENSIONS } from '../sniff';
import type { Reader } from './types';

/**
 * Picture formats no provider takes, kept as they are (a photographer's RAW
 * file, a Photoshop document, an icon) and shown to the model as a JPEG made
 * for this turn. HEIC, AVIF, TIFF and BMP are already JPEGs by now (the store
 * converts them when they're saved); one this computer couldn't convert then
 * is tried once more, in case a converter has arrived since.
 */
interface Format {
  label: string;
  /** Developed by the computer's converters, not sharp (which sees only the preview inside). */
  raw?: boolean;
}

/** What kind of picture this is, from its header (and, for RAW, its name); undefined when it isn't one. */
export function pictureFormat(attachment: Attachment, head: Buffer): Format | undefined {
  if (attachment.kind !== 'file') return undefined;
  const ext = extension(attachment.name);
  if (RAW_EXTENSIONS.has(ext)) return { label: `camera RAW photo (.${ext})`, raw: true };
  const ascii = head.subarray(0, 12).toString('latin1');
  if (ascii.startsWith('8BPS')) return { label: 'Photoshop document' };
  // ICO and CUR: a zero, the type (1 or 2), and how many pictures (at least one).
  if (head.length >= 6 && head.readUInt16LE(0) === 0 && head.readUInt16LE(4) > 0) {
    const type = head.readUInt16LE(2);
    if (type === 1 && ext === 'ico') return { label: 'icon (.ico)' };
    if (type === 2 && ext === 'cur') return { label: 'cursor (.cur)' };
  }
  if (ascii.startsWith('\0\0\0\x0CjP  ') || head.subarray(0, 4).equals(J2K))
    return { label: 'JPEG 2000 picture' };
  if (ascii.startsWith('\0\0\0\x0CJXL ') || head.subarray(0, 2).equals(JXL))
    return { label: 'JPEG XL picture' };
  if (head.subarray(0, 4).equals(EXR)) return { label: 'OpenEXR picture' };
  if (ascii.startsWith('DDS ')) return { label: 'DirectDraw texture (.dds)' };
  if (ascii.startsWith('qoif')) return { label: 'QOI picture' };
  if (CONVERTIBLE.has(attachment.mimeType))
    return { label: `${attachment.mimeType.slice('image/'.length).toUpperCase()} picture` };
  return undefined;
}

const J2K = Buffer.from([0xff, 0x4f, 0xff, 0x51]);
const JXL = Buffer.from([0xff, 0x0a]);
const EXR = Buffer.from([0x76, 0x2f, 0x31, 0x01]);

/** A JPEG fitted for models, as a turn's picture. */
async function asPicture(jpeg: Buffer, name: string): Promise<TurnImage> {
  const fitted = await fitPicture(jpeg, 'image/jpeg', MODEL_FIT);
  return { name, mimeType: fitted.mimeType, data: fitted.bytes.toString('base64') };
}

export const pictures: Reader = {
  id: 'pictures',
  // Programs that open files can't look inside a PSD or a RAW file either.
  everywhere: true,
  matches: (attachment, head) => pictureFormat(attachment, head) !== undefined,
  async read({ attachment, bytes, can }) {
    const format = pictureFormat(attachment, bytes.subarray(0, 64));
    if (!format) return undefined;
    const article = /^[aeiou]/i.test(format.label) ? 'An' : 'A';
    if (!can.images)
      return {
        note: `(${article} ${format.label}. This model can't see pictures; if the message depends on it, say so.)`,
      };
    const ext = extension(attachment.name);
    // A RAW file is developed by the computer's own converters; sharp's small preview is the last resort.
    const jpeg = format.raw
      ? ((await toJpeg(bytes, ext, systemConverters, false)) ?? (await toJpeg(bytes, ext, [])))
      : await toJpeg(bytes, ext);
    // Nothing here could turn it into a picture: the plain notes after the readers say so.
    if (!jpeg) return undefined;
    const kept = can.files
      ? ' The file itself is unchanged at the path above, for anything that needs the original.'
      : '';
    return {
      note: `(${article} ${format.label}, turned into a picture by Conch so it can be shown to you.${kept})`,
      images: [await asPicture(jpeg, attachment.name)],
    };
  },
};

/** Most of an SVG's source that's drawn for models (a drawing, not a data dump). */
const SVG_MAX_BYTES = 2_000_000;

/**
 * An SVG drawn as a picture, for engines that see, beside its source text
 * (an icon or a chart is easier seen than read). Drawn by sharp from the
 * bytes alone: nothing it links to is fetched, and it has 10 seconds.
 */
export async function svgPicture(bytes: Buffer, name: string): Promise<TurnImage | undefined> {
  if (bytes.length > SVG_MAX_BYTES) return undefined;
  const sharp = await loadSharp();
  if (!sharp) return undefined;
  const png = await sharp(bytes, { failOn: 'none', limitInputPixels: 50_000_000, density: 144 })
    .resize({ width: 1024, height: 1024, fit: 'inside' })
    .flatten({ background: '#ffffff' })
    .png()
    .timeout({ seconds: 10 })
    .toBuffer()
    .catch(() => undefined);
  if (!png?.length) return undefined;
  return { name, mimeType: 'image/png', data: png.toString('base64') };
}
