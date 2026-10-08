import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachmentStore } from '../attachments/store';
import type { AppFetcher } from '../conchapps/types';
import { capturePicture, capturePictures } from './pictures';

// The smallest real PNG: one transparent pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const signal = new AbortController().signal;
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function deps(fetcher: AppFetcher) {
  dir = await mkdtemp(join(tmpdir(), 'conch-pictures-'));
  return { fetcher, store: new AttachmentStore(dir) };
}

describe('pictures for rich views', () => {
  it('keeps a real raster picture as the chat’s own attachment', async () => {
    const fetcher = vi.fn<AppFetcher>(async () => ({
      ok: true,
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG.toString('base64'),
      bodyBase64: true,
    }));
    const d = await deps(fetcher);
    const picture = await capturePicture(d, 'c1', 'https://cdn.example/a.png', signal, 'Kettle');
    expect(picture).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 1, height: 1 });
    expect(fetcher.mock.calls[0]?.[0].reaches).toEqual(['cdn.example']);
    expect(await d.store.inConversation(picture!.id, 'c1')).toBeDefined();
  });
  it('leaves out what isn’t a safe picture, without throwing', async () => {
    const d = await deps(async (_app, request) =>
      request.url.includes('svg')
        ? { ok: true, status: 200, headers: {}, body: '<svg onload="x()"/>' }
        : request.url.includes('html')
          ? {
              ok: true,
              status: 200,
              headers: {},
              body: Buffer.from('<html>').toString('base64'),
              bodyBase64: true,
            }
          : { ok: false, status: 0, headers: {}, body: '', refused: 'private address' },
    );
    const got = await capturePictures(
      d,
      'c1',
      [
        'http://cdn.example/a.png',
        'https://cdn.example/a.svg',
        'https://cdn.example/a.html',
        'https://10.0.0.1/a.png',
        undefined,
      ],
      signal,
    );
    expect(got).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
