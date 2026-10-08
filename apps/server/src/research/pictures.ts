/**
 * Pictures for the chat's rich views (a product's photo, an album's cover, a
 * video's thumbnail), fetched by the gateway and kept as the chat's own
 * attachments.
 *
 * The page never loads a remote image (security.ts: `img-src 'self'`), so a
 * reply can't leak anything through an image address. Instead the gateway
 * fetches the picture once, through the same SSRF-guarded public fetcher as
 * `web_fetch` (no cookies, no private addresses, every redirect checked), and
 * keeps it only when its bytes really are a raster image. The view then
 * carries the attachment, served from Conch itself.
 */
import type { Attachment } from '@conch/protocol';

import type { AttachmentStore } from '../attachments/store';
import type { AppFetcher } from '../conchapps/types';
import { httpsUrl } from './pageData';

/** The most a picture may weigh; a bigger one is left out, not shrunk. */
export const PICTURE_MAX_BYTES = 4 * 1024 * 1024;
/** Fetched at once. */
const PARALLEL = 4;
const RASTER = /^image\/(png|jpeg|webp|gif|avif)$/;

export interface PictureDeps {
  fetcher: AppFetcher;
  store: AttachmentStore;
}

/**
 * One picture, fetched and kept for this chat, or nothing when it couldn't be
 * (not https, refused, too big, not a raster image). Never throws: a card
 * without its picture is still a card.
 */
export async function capturePicture(
  deps: PictureDeps,
  conversationId: string,
  raw: string | undefined,
  signal: AbortSignal,
  name = 'Picture',
): Promise<Attachment | undefined> {
  const href = raw ? httpsUrl(raw) : undefined;
  if (!href) return undefined;
  try {
    const url = new URL(href);
    const response = await deps.fetcher(
      { id: `pictures-${conversationId}`, reaches: [url.hostname] },
      {
        url: url.href,
        method: 'GET',
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
      },
      signal,
    );
    if (signal.aborted || response.refused || !response.ok || !response.bodyBase64)
      return undefined;
    const bytes = Buffer.from(response.body, 'base64');
    if (!bytes.length || bytes.length > PICTURE_MAX_BYTES) return undefined;
    const ext = /\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i.exec(url.pathname)?.[1] ?? 'jpg';
    const saved = await deps.store.save({ name: `${name.slice(0, 80)}.${ext}`, bytes });
    if (saved.kind !== 'image' || !RASTER.test(saved.mimeType)) {
      await deps.store.discard(saved.id);
      return undefined;
    }
    const [claimed] = await deps.store.claim([saved.id], conversationId);
    return claimed ?? saved;
  } catch {
    return undefined;
  }
}

/**
 * Several pictures, a few at a time, in the order asked. A missing one is
 * `undefined` in its place, so callers can zip the result with their items.
 */
export async function capturePictures(
  deps: PictureDeps,
  conversationId: string,
  urls: readonly (string | undefined)[],
  signal: AbortSignal,
  names?: readonly (string | undefined)[],
): Promise<(Attachment | undefined)[]> {
  const out: (Attachment | undefined)[] = new Array(urls.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const i = next++;
      out[i] = await capturePicture(deps, conversationId, urls[i], signal, names?.[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker));
  return out;
}
