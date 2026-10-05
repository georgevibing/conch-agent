/**
 * An app's picture (ADR 0090) is someone else's bytes. These are the
 * attacks: a document dressed as a PNG, something hidden after the end, a
 * picture that lies about its kind or size, one that moves, and a folder
 * that changed after it was added (a link, a second name, a swap).
 */
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APP_LIMITS } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { jpeg, png, pngChunk, webp } from '../test/pictures';
import { textFiles } from '../test/conchapps';
import { packApp, findApps, readFiles } from './package';
import {
  hasPictureFile,
  pictureOf,
  pictureProblem,
  readPicture,
  readPictureFile,
  withoutPicture,
} from './picture';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const folder = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conch-picture-'));
  dirs.push(dir);
  return dir;
};

const manifest = JSON.stringify({
  conch: 1,
  id: 'yoga',
  name: 'Yoga',
  tagline: 'Logs each yoga class',
  version: '1.0.0',
  icon: { glyph: 'heart', color: 'pink' },
  pages: [{ id: 'main', title: 'Yoga', file: 'pages/main.html' }],
});
const app = (extra: Record<string, Buffer> = {}) => {
  const files = textFiles({ 'conch-app.json': manifest, 'pages/main.html': '<p>Yoga</p>' });
  for (const [path, bytes] of Object.entries(extra)) files.set(path, bytes);
  return files;
};
const problemsOf = (files: Map<string, Buffer>) => {
  const read = readFiles(files);
  return read.ok ? [] : read.problems.map((p) => p.message);
};

describe('reading a picture from its bytes', () => {
  it('reads a PNG, a JPEG and a WebP, with their sides', () => {
    expect(readPicture(png(180))).toEqual({ ok: true, type: 'image/png', width: 180, height: 180 });
    expect(readPicture(jpeg(256, 128))).toEqual({
      ok: true,
      type: 'image/jpeg',
      width: 256,
      height: 128,
    });
    expect(readPicture(webp(96))).toEqual({ ok: true, type: 'image/webp', width: 96, height: 96 });
    expect(readPicture(webp(120, 64, { extended: true }))).toMatchObject({
      ok: true,
      width: 120,
      height: 64,
    });
  });

  it('refuses SVG and HTML, whatever they’re called', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const html = Buffer.from('﻿  <!doctype html><html><script>fetch("/api/state")</script>');
    for (const bytes of [svg, html]) {
      const read = readPicture(bytes);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.problem).toMatch(/document \(SVG or HTML\), not a picture/);
    }
    expect(pictureProblem('icon.png', svg)).toMatch(/^icon\.png: This is a document/);
  });

  it('refuses bytes that aren’t a picture at all, and a GIF', () => {
    expect(readPicture(Buffer.from('just some words')).ok).toBe(false);
    expect(readPicture(Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1')).ok).toBe(false);
    expect(readPicture(Buffer.alloc(0)).ok).toBe(false);
  });

  it('refuses a PNG with something after its end (a polyglot)', () => {
    const read = readPicture(Buffer.concat([png(64), Buffer.from('<html><script>x</script>')]));
    expect(read).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/hidden after its end/),
    });
  });

  it('refuses a damaged PNG: a wrong checksum, cut short, no picture data', () => {
    const bad = Buffer.from(png(64));
    bad[30] = (bad[30] ?? 0) ^ 0xff; // inside IHDR, so its checksum no longer holds
    expect(readPicture(bad)).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/checksum/),
    });
    expect(readPicture(png(64).subarray(0, 40)).ok).toBe(false);
    // A chunk that says it's longer than the file.
    const long = Buffer.from(png(64));
    long.writeUInt32BE(0x7fffffff, 33);
    expect(readPicture(long).ok).toBe(false);
  });

  it('refuses pictures that move', () => {
    const apng = png(64, 64, { extra: [pngChunk('acTL', Buffer.alloc(8))] });
    expect(readPicture(apng)).toMatchObject({ ok: false, problem: expect.stringMatching(/moves/) });
    expect(readPicture(webp(64, 64, { animated: true }))).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/moves/),
    });
  });

  it('refuses a JPEG that doesn’t end where a JPEG ends, or has no frame', () => {
    expect(readPicture(jpeg(64).subarray(0, -2)).ok).toBe(false);
    const noFrame = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
    expect(readPicture(noFrame).ok).toBe(false);
  });

  it('refuses a WebP that isn’t the size it says', () => {
    expect(readPicture(Buffer.concat([webp(64), Buffer.from('extra!')])).ok).toBe(false);
  });

  it('holds a picture to the size and the sides an icon may have', () => {
    const { picture } = APP_LIMITS;
    const padded = png(64, 64, {
      extra: [pngChunk('tEXt', Buffer.alloc(picture.bytes, 0x41))],
    });
    expect(readPicture(padded)).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/at most 512 KB/),
    });
    expect(readPicture(png(picture.maxSide + 1, 8 * 3))).toMatchObject({ ok: false });
    expect(readPicture(jpeg(4000, 4000))).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/at most 1024 × 1024/),
    });
    expect(readPicture(png(8))).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/too small/),
    });
  });

  it('holds the name to the kind the bytes are', () => {
    expect(pictureProblem('icon.png', png(64))).toBeUndefined();
    expect(pictureProblem('icon.png', jpeg(64))).toBe(
      'icon.png is a JPEG picture: name it icon.jpg.',
    );
    expect(pictureProblem('icon.webp', png(64))).toMatch(/name it icon\.png/);
  });
});

describe('a picture in an app’s package', () => {
  it('is carried, hashed and found', () => {
    const files = app({ 'icon.png': png(128) });
    const read = readFiles(files);
    expect(read.ok).toBe(true);
    expect(pictureOf(files)).toMatchObject({ name: 'icon.png', width: 128, type: 'image/png' });
    expect(withoutPicture(files).has('icon.png')).toBe(false);
    // A different picture is a different app.
    const other = readFiles(app({ 'icon.png': png(128, 128, { rgb: [1, 2, 3] }) }));
    if (read.ok && other.ok) expect(other.app.hash).not.toBe(read.app.hash);
  });

  it('refuses a document dressed as the picture', () => {
    expect(problemsOf(app({ 'icon.png': Buffer.from('<html><body>hi</body></html>') }))).toEqual([
      expect.stringMatching(/^icon\.png: This is a document/),
    ]);
  });

  it('refuses a picture whose name says another kind', () => {
    expect(problemsOf(app({ 'icon.jpg': png(64) }))).toEqual([
      'icon.jpg is a PNG picture: name it icon.png.',
    ]);
  });

  it('has one picture at most', () => {
    expect(problemsOf(app({ 'icon.png': png(64), 'icon.webp': webp(64) }))).toEqual([
      expect.stringMatching(/one picture as its icon.*icon\.png and icon\.webp/),
    ]);
    expect(pictureOf(app({ 'icon.png': png(64), 'icon.webp': webp(64) }))).toBeUndefined();
  });

  it('carries no other pictures, anywhere else or by any other name', () => {
    for (const path of ['pages/logo.png', 'images/icon.png', 'Icon.png', 'icon.jpeg', 'icon.gif'])
      expect(problemsOf(app({ [path]: png(64) })), path).toEqual([
        expect.stringMatching(/isn’t a kind of file an app can carry/),
      ]);
  });

  it('goes into a .conchapp and comes out the same', async () => {
    const files = app({ 'icon.webp': webp(64) });
    const read = readFiles(files);
    if (!read.ok) throw new Error('It should read.');
    const [found] = await findApps(await packApp(read.app));
    expect(found?.read.ok).toBe(true);
    if (found?.read.ok) {
      expect(found.read.app.files.get('icon.webp')?.equals(webp(64))).toBe(true);
      expect(found.read.app.hash).toBe(read.app.hash);
    }
  });
});

describe('a picture in a folder on disk', () => {
  it('is read and checked again', async () => {
    const dir = await folder();
    expect(await readPictureFile(dir)).toBeUndefined();
    expect(await hasPictureFile(dir)).toBe(false);
    await writeFile(join(dir, 'icon.png'), png(64));
    expect(await hasPictureFile(dir)).toBe(true);
    const read = await readPictureFile(dir);
    expect(read?.type).toBe('image/png');
    expect(read?.bytes.equals(png(64))).toBe(true);
  });

  it('isn’t served when it was changed into something else after it was added', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'icon.png'), '<svg onload="alert(1)"/>');
    expect(await readPictureFile(dir)).toBeUndefined();
    await writeFile(join(dir, 'icon.png'), jpeg(64));
    expect(await readPictureFile(dir)).toBeUndefined();
  });

  it('isn’t served when there are two', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'icon.png'), png(64));
    await writeFile(join(dir, 'icon.jpg'), jpeg(64));
    expect(await readPictureFile(dir)).toBeUndefined();
  });

  it('is never a folder, a second name for a file, or a link', async () => {
    const dir = await folder();
    await mkdir(join(dir, 'icon.png'));
    expect(await readPictureFile(dir)).toBeUndefined();

    const linked = await folder();
    const outside = join(await folder(), 'secret.png');
    await writeFile(outside, png(64));
    await link(outside, join(linked, 'icon.png'));
    expect(await readPictureFile(linked)).toBeUndefined();

    const viaLink = await folder();
    try {
      await symlink(outside, join(viaLink, 'icon.png'));
    } catch (error) {
      // Windows needs Developer Mode or an administrator to make a link.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    expect(await readPictureFile(viaLink)).toBeUndefined();
  });
});
