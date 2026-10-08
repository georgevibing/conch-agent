import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { fitPicture, MODEL_FIT, toJpeg, type PictureConverter } from './fit';
import { forTurn } from './prompt';
import { sniff } from './sniff';
import { AttachmentStore } from './store';

/** A phone photo: 4032×3024 of noise (so it doesn't compress away), on its side, with GPS. */
async function phonePhoto(): Promise<Buffer> {
  const width = 4032;
  const height = 3024;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'Phone', Orientation: '6' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1' },
    })
    .toBuffer();
}

/** A small HEIC file's start: an `ftyp` box with the `heic` brand. */
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypheic', 'latin1'),
  Buffer.alloc(16),
]);

describe('pictures fitted for models', () => {
  it('turns a 12 MP phone photo upright, scales it to fit, and drops its location', async () => {
    const photo = await phonePhoto();
    expect(photo.length).toBeGreaterThan(MODEL_FIT.bytes);
    const fitted = await fitPicture(photo, 'image/jpeg');
    expect(fitted.changed).toBe(true);
    expect(fitted.mimeType).toBe('image/jpeg');
    expect(fitted.bytes.length).toBeLessThanOrEqual(MODEL_FIT.bytes);
    const meta = await sharp(fitted.bytes).metadata();
    // On its side in the file, so upright it's taller than it's wide.
    expect([meta.width, meta.height]).toEqual([1500, 2000]);
    expect(meta.orientation ?? 1).toBe(1);
    expect(meta.exif).toBeUndefined();
  }, 30_000);

  it('leaves a picture that already fits, with nothing in it, as it is', async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 4, background: '#33669980' },
    })
      .png()
      .toBuffer();
    const fitted = await fitPicture(png, 'image/png');
    expect(fitted.changed).toBe(false);
    expect(fitted.bytes).toBe(png);
  });

  it('sends something it can’t read as it is', async () => {
    const junk = Buffer.from('not a picture at all');
    expect(await fitPicture(junk, 'image/jpeg')).toMatchObject({ bytes: junk, changed: false });
  });
});

describe('a HEIC photo', () => {
  it('is known by its bytes, whatever it is called', () => {
    expect(sniff(HEIC, 'IMG_0001.jpg', 'image/jpeg')).toEqual({
      kind: 'file',
      mimeType: 'image/heic',
    });
  });

  it('is kept as a JPEG every model reads, using this computer’s converter', async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#808080' },
    })
      .jpeg()
      .toBuffer();
    const converter: PictureConverter = async (path, out) => {
      expect(path.endsWith('.heic')).toBe(true);
      await sharp(jpeg).toFile(out);
      return true;
    };
    const store = new AttachmentStore(await mkdtemp(join(tmpdir(), 'conch-heic-')), {
      converters: [converter],
    });
    const saved = await store.save({ name: 'IMG_0001.HEIC', bytes: HEIC });
    expect(saved).toMatchObject({
      kind: 'image',
      mimeType: 'image/jpeg',
      name: 'IMG_0001.jpg',
      width: 40,
      height: 30,
    });
  });

  it('stays a file, said plainly to the model, when nothing here converts it', async () => {
    expect(await toJpeg(HEIC, 'heic', [async () => false])).toBeUndefined();
    const store = new AttachmentStore(await mkdtemp(join(tmpdir(), 'conch-heic-')), {
      converters: [async () => false],
    });
    const saved = await store.save({ name: 'IMG_0001.HEIC', bytes: HEIC });
    expect(saved).toMatchObject({ kind: 'file', mimeType: 'image/heic' });
    const turn = await forTurn(store, [saved], { images: true, files: true });
    expect(turn.block).toContain('ask for it as a JPEG or a screenshot');
    expect(turn.images).toEqual([]);
  });
});

describe('a photo on its way to a model', () => {
  it('goes fitted, by a path beside the original, and is made once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conch-fit-'));
    const store = new AttachmentStore(dir);
    const photo = await phonePhoto();
    const saved = await store.save({ name: 'me.jpg', bytes: photo });
    const first = await forTurn(store, [saved], { images: true, files: true });
    const image = first.images[0];
    expect(image?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(image?.data ?? '', 'base64').length).toBeLessThanOrEqual(MODEL_FIT.bytes);
    expect(image?.path).toBe(join(store.folder(saved.id), '.for-models.jpeg'));
    // The original stays as it was sent.
    expect((await store.bytes(saved.id))?.equals(photo)).toBe(true);
    const again = await forTurn(store, [saved], { images: true, files: true });
    expect(again.images[0]?.data).toBe(image?.data);
    expect((await readdir(store.folder(saved.id))).sort()).toEqual([
      '.for-models.jpeg',
      'me.jpg',
      'meta.json',
    ]);
  }, 30_000);
});
