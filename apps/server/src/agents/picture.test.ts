import { describe, expect, it } from 'vitest';

import { carriesSecret, jpeg, png, pngChunk, webp } from '../test/faces';
import { cleanPicture, pictureType } from './picture';

const ok = (bytes: Buffer) => {
  const read = cleanPicture(bytes);
  if (!read.ok) throw new Error(read.problem);
  return read;
};

describe('an agent’s picture', () => {
  it('keeps a PNG without its words, times and EXIF, and it still reads as the same PNG', () => {
    const dirty = png(64, { text: true });
    expect(carriesSecret(dirty)).toBe(true);
    const clean = ok(dirty);
    expect(clean.type).toBe('image/png');
    expect([clean.width, clean.height]).toEqual([64, 64]);
    expect(carriesSecret(clean.bytes)).toBe(false);
    expect(clean.bytes.includes(Buffer.from('tIME'))).toBe(false);
    // What's left is a PNG that reads again, unchanged.
    expect(ok(clean.bytes).bytes.equals(clean.bytes)).toBe(true);
    expect(clean.bytes.equals(png(64))).toBe(true);
  });

  it('keeps a JPEG without EXIF, XMP, IPTC or comments, and keeps its scan whole', () => {
    const dirty = jpeg(64, { exif: true });
    expect(carriesSecret(dirty)).toBe(true);
    const clean = ok(dirty);
    expect(clean.type).toBe('image/jpeg');
    expect(carriesSecret(clean.bytes)).toBe(false);
    expect(clean.bytes.equals(jpeg(64))).toBe(true);
  });

  it('keeps a WebP without EXIF and XMP, and says so in its header', () => {
    const dirty = webp(64, { exif: true });
    const clean = ok(dirty);
    expect(clean.type).toBe('image/webp');
    expect(carriesSecret(clean.bytes)).toBe(false);
    // The extended header no longer promises EXIF (0x08) or XMP (0x04).
    expect((clean.bytes[20] ?? 0) & 0x0c).toBe(0);
    expect(clean.bytes.readUInt32LE(4) + 8).toBe(clean.bytes.length);
    expect(ok(clean.bytes).bytes.equals(clean.bytes)).toBe(true);
  });

  it('never takes a document for a picture: SVG, HTML, or a name that lies', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '﻿<?xml version="1.0"?><svg/>',
      '<html><body>hi</body></html>',
    ]) {
      const read = cleanPicture(Buffer.from(text));
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.problem).toMatch(/document/);
    }
    expect(cleanPicture(Buffer.from('GIF89a……')).ok).toBe(false);
  });

  it('refuses what hides something: bytes after the end, a broken checksum, a chunk it can’t vouch for', () => {
    expect(cleanPicture(png(64, { after: Buffer.from('<script>') })).ok).toBe(false);
    const broken = png(64);
    broken[broken.length - 20] = (broken[broken.length - 20] ?? 0) ^ 0xff;
    expect(cleanPicture(broken).ok).toBe(false);
    expect(cleanPicture(png(64, { extra: [pngChunk('ZZZZ', Buffer.from('x'))] })).ok).toBe(false);
    expect(cleanPicture(Buffer.concat([jpeg(64), Buffer.from('trailing')])).ok).toBe(false);
  });

  it('refuses a picture that moves, one too small, too big, or empty', () => {
    expect(cleanPicture(png(64, { extra: [pngChunk('acTL', Buffer.alloc(8))] }))).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/moves/),
    });
    expect(cleanPicture(webp(64, { animated: true })).ok).toBe(false);
    expect(cleanPicture(png(8)).ok).toBe(false);
    expect(cleanPicture(png(4096)).ok).toBe(false);
    expect(cleanPicture(Buffer.alloc(0)).ok).toBe(false);
    expect(cleanPicture(png(64), 10).ok).toBe(false);
  });

  it('knows a kept picture by its first bytes', () => {
    expect(pictureType(png(32))).toBe('image/png');
    expect(pictureType(jpeg(32))).toBe('image/jpeg');
    expect(pictureType(webp(32))).toBe('image/webp');
    expect(pictureType(Buffer.from('<svg/>'))).toBeUndefined();
  });
});
